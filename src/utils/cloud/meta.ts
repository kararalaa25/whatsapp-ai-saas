import 'server-only'
import { z } from 'zod'
import { appSecretProof, requireProviderRelease } from './security'

export type ProviderIO = (url:string,init:RequestInit)=>Promise<Response>
export const liveProviderIO:ProviderIO=async(url,init)=>{requireProviderRelease();return fetch(url,init)}
export class ProviderFailure extends Error {
 constructor(readonly outcome:'rejected'|'unknown',readonly retryable=false,readonly retryAfter=60){super('Provider operation unavailable')}
}
export async function limitedBytes(response:Response,maximum:number):Promise<Uint8Array>{
 const length=response.headers.get('content-length')
 if(length&&(!/^\d+$/.test(length)||Number(length)>maximum))throw Error('Provider response exceeds limit')
 if(!response.body)throw Error('Provider response unavailable')
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw Error('Provider response exceeds limit')}chunks.push(value)}}finally{reader.releaseLock()}
 return Buffer.concat(chunks,size)
}
export type MetaConfig={version:string;appId:string;appSecret:string}
const numeric=z.string().regex(/^\d{1,32}$/)
export function createMetaClient(io:ProviderIO,config:MetaConfig){
 if(!/^v\d{1,2}\.0$/.test(config.version)||!/^\d{1,32}$/.test(config.appId)||!config.appSecret)throw Error('Meta configuration unavailable')
 async function graph(path:string,token:string|null,method:'GET'|'POST',values:Record<string,string>={},json?:unknown){
  const url=new URL(`https://graph.facebook.com/${config.version}/${path}`)
  const body=method==='POST'&&!json?new URLSearchParams(values):undefined
  if(method==='GET')for(const [k,v]of Object.entries(values))url.searchParams.set(k,v)
  if(token)url.searchParams.set('appsecret_proof',appSecretProof(token,config.appSecret))
  let response:Response
  try{response=await io(url.toString(),{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(json?{'Content-Type':'application/json'}:{})},body:json?JSON.stringify(json):body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)})}
  catch{throw new ProviderFailure('unknown')}
  let data:unknown
  try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await limitedBytes(response,128*1024)))}catch{throw new ProviderFailure('unknown')}
  if(!response.ok){
   // 5xx/timeouts/malformed responses may have accepted a send: never blind retry.
   if(response.status>=500)throw new ProviderFailure('unknown')
   const graphError=z.object({error:z.object({code:z.number().int()})}).safeParse(data)
   if(!graphError.success)throw new ProviderFailure('unknown')
   const retryAfter=Math.max(1,Math.min(900,Number(response.headers.get('retry-after'))||60))
   throw new ProviderFailure('rejected',response.status===429,retryAfter)
  }
  return data
 }
 return {
  async exchange(code:string,wabaId:string,phoneId:string,now=Date.now()){
   z.string().min(1).max(4096).regex(/^\S+$/).parse(code);numeric.parse(wabaId);numeric.parse(phoneId)
   const exchanged=z.object({access_token:z.string().min(1).max(8192),expires_in:z.number().nonnegative().optional()}).parse(await graph('oauth/access_token',null,'POST',{client_id:config.appId,client_secret:config.appSecret,code}))
   const token=exchanged.access_token
   const inspected=z.object({data:z.object({app_id:z.string(),is_valid:z.boolean(),expires_at:z.number().nonnegative(),data_access_expires_at:z.number().nonnegative().optional(),scopes:z.array(z.string()),granular_scopes:z.array(z.object({scope:z.string(),target_ids:z.array(z.string()).optional()})).optional()})}).parse(
    await graph('debug_token',`${config.appId}|${config.appSecret}`,'GET',{input_token:token}))
   const d=inspected.data
   if(!d.is_valid||d.app_id!==config.appId||(d.expires_at>0&&d.expires_at*1000<=now)||(d.data_access_expires_at!==undefined&&d.data_access_expires_at>0&&d.data_access_expires_at*1000<=now)||!['whatsapp_business_messaging','whatsapp_business_management'].every(s=>d.scopes.includes(s)))throw Error('Meta authorization not verified')
   const targets=d.granular_scopes?.filter(s=>s.scope==='whatsapp_business_messaging'||s.scope==='whatsapp_business_management').flatMap(s=>s.target_ids??[])??[]
   if(targets.length&&!targets.includes(wabaId))throw Error('Meta business not authorized')
   const phones=z.object({data:z.array(z.object({id:numeric})).max(1000)}).parse(await graph(`${wabaId}/phone_numbers`,token,'GET',{fields:'id',limit:'1000'}))
   if(!phones.data.some(p=>p.id===phoneId))throw Error('Meta phone ownership not verified')
   const providerEnd=d.expires_at>0?d.expires_at*1000:exchanged.expires_in?now+exchanged.expires_in*1000:now+86400000
   return {token,expiresAt:new Date(Math.min(providerEnd,d.data_access_expires_at?d.data_access_expires_at*1000:Infinity,now+30*86400000)).toISOString(),wabaId,phoneId}
  },
  async subscribe(wabaId:string,token:string){numeric.parse(wabaId);const r=z.object({success:z.literal(true)}).parse(await graph(`${wabaId}/subscribed_apps`,token,'POST'));return r.success},
  async register(phoneId:string,token:string,pin:string){numeric.parse(phoneId);z.string().regex(/^\d{6}$/).parse(pin);return z.object({success:z.literal(true)}).parse(await graph(`${phoneId}/register`,token,'POST',{}, {messaging_product:'whatsapp',pin})).success},
  async send(phoneId:string,token:string,to:string,text:string,attemptId:string){
   numeric.parse(phoneId);z.string().regex(/^\d{5,32}$/).parse(to);z.string().uuid().parse(attemptId)
   z.string().trim().min(1).refine(v=>Array.from(v).length<=4096&&!v.includes('\u0000')).parse(text)
   const result=await graph(`${phoneId}/messages`,token,'POST',{}, {messaging_product:'whatsapp',recipient_type:'individual',to,type:'text',text:{body:text,preview_url:false},biz_opaque_callback_data:attemptId})
   try{return z.object({messages:z.array(z.object({id:z.string().min(1).max(512)})).length(1)}).parse(result).messages[0].id}catch{throw new ProviderFailure('unknown')}
  },
  async media(id:string,phoneId:string,token:string){
   numeric.parse(id);numeric.parse(phoneId)
   return z.object({url:z.string().url(),mime_type:z.string().max(100),sha256:z.string().max(100),file_size:z.number().int().nonnegative().max(16*1024*1024)}).parse(await graph(id,token,'GET',{phone_number_id:phoneId}))
  },
 }
}
export type MetaClient=ReturnType<typeof createMetaClient>

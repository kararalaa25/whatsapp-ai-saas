import { readRawBody,validSignature,validVerificationToken,OversizedWebhookError } from '@/utils/whatsapp/webhook'
import { parseCloudEvents,acceptCloudBatch } from '@/utils/cloud/events'
import { createCloudRuntime } from '@/utils/cloud/runtime'
const response=(text:string,status:number)=>new Response(text,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Content-Type':'text/plain; charset=utf-8'}})
export async function GET(request:Request){
 const query=new URL(request.url).searchParams
 const expected=process.env.META_WEBHOOK_VERIFY_TOKEN
 if(!expected)return response('Unavailable',503)
 if(['hub.mode','hub.verify_token','hub.challenge'].some(k=>query.getAll(k).length!==1)||query.get('hub.mode')!=='subscribe'||(query.get('hub.verify_token')?.length??0)>1024||!/^\d{1,128}$/.test(query.get('hub.challenge')??'')||!validVerificationToken(query.get('hub.verify_token')??'',expected))return response('Forbidden',403)
 return response(query.get('hub.challenge')!,200)
}
export async function POST(request:Request){
 const secret=process.env.META_APP_SECRET
 if(!secret)return response('Unavailable',503)
 let raw:Uint8Array
 try{raw=await readRawBody(request)}catch(e){return response('Invalid request',e instanceof OversizedWebhookError?413:400)}
 if(!validSignature(raw,request.headers.get('x-hub-signature-256'),secret))return response('Forbidden',403)
 let events
 try{events=parseCloudEvents(new TextDecoder('utf-8',{fatal:true}).decode(raw))}catch{return response('Invalid event',400)}
 try{if(events.length){const runtime=createCloudRuntime();await acceptCloudBatch(events,event=>runtime.store.accept(event))}}catch{return response('Temporarily unavailable',503)}
 return response('EVENT_RECEIVED',200)
}

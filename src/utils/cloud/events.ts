import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'

const id=z.string().regex(/^[0-9]{1,32}$/)
const source=z.string().min(1).max(512).refine(v=>!v.includes('\u0000'))
const stamp=z.string().regex(/^\d{1,12}$/).refine(v=>Number(v)<=253402300799)
const hash=z.string().regex(/^(?:[a-fA-F0-9]{64}|[A-Za-z0-9+/]{43}=)$/)
const audio=z.object({id, mime_type:z.string().max(100), sha256:hash, voice:z.boolean().optional()})
const message=z.object({id:source,from:z.string().regex(/^\d{5,32}$/),timestamp:stamp,type:z.string().max(64),
 text:z.object({body:z.string().min(1).max(8192).refine(v=>Array.from(v).length<=4096&&!v.includes('\u0000'))}).optional(),audio:audio.optional(),
}).superRefine((m,ctx)=>{if((m.type==='text'&&!m.text)||(m.type==='audio'&&!m.audio))ctx.addIssue({code:'custom',message:'Missing message content'})})
const status=z.object({id:source,status:z.enum(['sent','delivered','read','failed']),timestamp:stamp,recipient_id:z.string().regex(/^\d{5,32}$/),
 biz_opaque_callback_data:z.string().uuid().optional(),errors:z.array(z.object({code:z.number().int()})).max(5).optional()})
const envelope=z.object({object:z.literal('whatsapp_business_account'),entry:z.array(z.object({id,changes:z.array(z.object({field:z.string(),value:z.object({
 messaging_product:z.literal('whatsapp').optional(),metadata:z.object({phone_number_id:id}).optional(),messages:z.array(message).max(100).optional(),statuses:z.array(status).max(100).optional(),
})})).max(100)})).max(100)})
export type CloudEvent = { key:string; kind:'text'|'audio'|'unsupported'|'status'; phoneId:string; wabaId:string; sourceId:string; sender:string; timestamp:string;
 body?:string; audio?:z.infer<typeof audio>; status?:z.infer<typeof status> }
export function parseCloudEvents(raw:string):CloudEvent[] {
 const parsed=envelope.parse(JSON.parse(raw));const result:CloudEvent[]=[]
 for(const entry of parsed.entry)for(const change of entry.changes){
  if(change.field!=='messages')continue
  const v=change.value
  if(((v.messages?.length??0)+(v.statuses?.length??0))&&(!v.metadata||v.messaging_product!=='whatsapp'))throw Error('Missing routing metadata')
  for(const m of v.messages??[]){
   const event:CloudEvent={key:`message:${m.id}`,kind:m.type==='text'?'text':m.type==='audio'?'audio':'unsupported',phoneId:v.metadata!.phone_number_id,wabaId:entry.id,sourceId:m.id,sender:m.from,timestamp:new Date(Number(m.timestamp)*1000).toISOString()}
   if(event.kind==='text')event.body=m.text!.body
   if(event.kind==='audio')event.audio=m.audio!
   result.push(event)
  }
  for(const s of v.statuses??[]){
   const compact={id:s.id,status:s.status,timestamp:s.timestamp,recipient_id:s.recipient_id,...(s.biz_opaque_callback_data?{biz_opaque_callback_data:s.biz_opaque_callback_data}:{}),...(s.errors?{errors:s.errors.map(e=>({code:e.code}))}:{})}
   result.push({key:'status:'+createHash('sha256').update(JSON.stringify(compact)).digest('hex'),kind:'status',phoneId:v.metadata!.phone_number_id,wabaId:entry.id,sourceId:s.id,sender:s.recipient_id,timestamp:new Date(Number(s.timestamp)*1000).toISOString(),status:compact})
  }
  if(result.length>100)throw Error('Too many Cloud events')
 }
 return result
}
export type AcceptCloudEvent=(event:CloudEvent)=>Promise<'accepted'|'duplicate'|'ignored'>
export async function acceptCloudBatch(events:CloudEvent[],accept:AcceptCloudEvent){
 let failures=0
 for(const event of events){try{const result=await accept(event);if(!['accepted','duplicate','ignored'].includes(result))failures++}catch{failures++}}
 if(failures)throw Error('Cloud events not durably accepted')
}

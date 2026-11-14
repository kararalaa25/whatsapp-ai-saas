import 'server-only'
import type { AgentSettings, ChatMessage } from '@/utils/ai/settings'
import { boundedHistory } from '@/utils/ai/context'
import { selectKnowledge } from '@/utils/knowledge/retrieval'
import type { Knowledge } from '@/utils/knowledge/schema'
import { requestsHuman } from '@/utils/inbox/model'
import { AudioReviewRequired, type AudioFile, type Transcriber } from './audio'
import type { MetaClient } from './meta'
import { ProviderFailure } from './meta'
import { serviceWindowOpen } from './lifecycle'
import type { KnowledgeEntry } from '@/utils/knowledge/types'

export type CloudJob={id:string;lease:string;workspaceId:string;channelId:string;threadId:string;revision:number;
 kind:'text'|'audio';text:string|null;audioId:string|null;audioHash:string|null;sender:string;phoneId:string;lastCustomerAt:string;mode:'review'|'automatic';draftId?:string}
export type ReplyInput={agent:AgentSettings;history:ChatMessage[];question:string;entries:KnowledgeEntry[]}
export interface CloudStore {
 claim():Promise<CloudJob|null>
 credential(job:CloudJob):Promise<string>
 reserveAudio(job:CloudJob):Promise<void>
 startAudio(job:CloudJob):Promise<void>
 transcript(job:CloudJob,text:string):Promise<CloudJob>
 context(job:CloudJob):Promise<{agent:AgentSettings;knowledge:Knowledge;history:ChatMessage[]}>
 reserveReply(job:CloudJob):Promise<void>
 handoff(job:CloudJob,reason:string):Promise<void>
 draft(job:CloudJob,text:string):Promise<{id:string}>
 dispatch(job:CloudJob,draftId:string):Promise<{attemptId:string;text:string;recipient:string;phoneId:string}>
 sent(job:CloudJob,attemptId:string,providerId:string):Promise<void>
 uncertain(job:CloudJob,attemptId:string):Promise<void>
 rejected(job:CloudJob,attemptId:string,retryable:boolean,seconds:number):Promise<void>
 finish(job:CloudJob):Promise<void>
 defer(job:CloudJob,reason:'access'|'processing'):Promise<void>
}
export type CloudEngineDependencies={store:CloudStore;meta:MetaClient;audio:(job:CloudJob,token:string)=>Promise<AudioFile>;transcribe:Transcriber;reply:(input:ReplyInput)=>Promise<string>;now?:()=>number}
export async function processCloudJob(deps:CloudEngineDependencies){
 const {store}=deps
 let job=await store.claim()
 if(!job)return {outcome:'idle' as const}
 try{
  if(job.mode==='automatic'&&!serviceWindowOpen(job.lastCustomerAt,(deps.now??Date.now)())){await store.handoff(job,'window_closed');await store.finish(job);return {outcome:'human' as const}}
  let draft=job.draftId?{id:job.draftId}:undefined
  if(!draft){
  if(job.kind==='audio'&&!job.text){
   await store.reserveAudio(job) // Entitlement + atomic, idempotent reservation before any media/provider request.
   const token=await store.credential(job)
   let audio:AudioFile
   try{audio=await deps.audio(job,token)}catch(error){
    if(error instanceof AudioReviewRequired){await store.handoff(job,'audio_review');await store.finish(job);return {outcome:'human' as const}}
    await store.defer(job,'processing');return {outcome:'deferred' as const}
   }
   await store.startAudio(job) // One durable provider-start marker; uncertain STT is not repeated.
   try{
    const transcript=await deps.transcribe(audio)
    if(!transcript.text.trim()||transcript.text.length>4096||!Number.isFinite(transcript.durationSeconds)||transcript.durationSeconds<=0||transcript.durationSeconds>120||/\[inaudible\]|\u0000/i.test(transcript.text))throw Error('Unusable audio')
    job=await store.transcript(job,transcript.text)
   }catch{await store.handoff(job,'audio_review');await store.finish(job);return {outcome:'human' as const}}

  }
  if(!job.text){await store.handoff(job,'unsupported');await store.finish(job);return {outcome:'human' as const}}
  if(requestsHuman(job.text)){await store.handoff(job,'requested');await store.finish(job);return {outcome:'human' as const}}
  const context=await store.context(job) // SQL derives exact tenant/thread, rechecks human control and enabled agent.
  const history=boundedHistory(context.history)
  const entries=selectKnowledge(context.knowledge,job.text,history)
  await store.reserveReply(job)
  const text=await deps.reply({agent:context.agent,history,question:job.text,entries})
  if(!text.trim()||Array.from(text).length>4096||text.includes('\u0000'))throw Error('Invalid reply')
  draft=await store.draft(job,text)
  }
  if(job.mode==='review'){await store.finish(job);return {outcome:'draft' as const}}
  if(!serviceWindowOpen(job.lastCustomerAt,(deps.now??Date.now)())){await store.handoff(job,'window_closed');await store.finish(job);return {outcome:'human' as const}}
  // SQL is the dispatch linearization point. Takeover cancels work BEFORE this
  // permit; it cannot recall an already permitted/in-flight provider request.
  const permit=await store.dispatch(job,draft.id)
  let providerId:string
  try{
   providerId=await deps.meta.send(permit.phoneId,await store.credential(job),permit.recipient,permit.text,permit.attemptId)
  }catch(error){
   if(error instanceof ProviderFailure&&error.outcome==='rejected')await store.rejected(job,permit.attemptId,error.retryable,error.retryAfter)
   else await store.uncertain(job,permit.attemptId)
   return {outcome:'delivery_pending' as const}
  }
  try{await store.sent(job,permit.attemptId,providerId)}catch{
   // Provider may have accepted: never repeat the send after a DB failure.
   await store.uncertain(job,permit.attemptId)
   return {outcome:'delivery_pending' as const}
  }
  await store.finish(job)
  return {outcome:'accepted' as const}
 }catch(error){
  await store.defer(job,error instanceof Error&&error.message==='Cloud access denied'?'access':'processing')
  return {outcome:'deferred' as const}
 }
}

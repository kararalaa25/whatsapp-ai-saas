import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { settingsSchema } from '@/utils/ai/settings'
import { productSchema,faqSchema,informationSchema } from '@/utils/knowledge/schema'
import type { CloudJob, CloudStore } from './engine'
import type { CloudEvent } from './events'
import type { SignupStore } from './onboarding'
import { openToken,sealToken,type SealedToken } from './security'

const uuid=z.string().uuid()
const jobSchema=z.object({id:uuid,lease:uuid,workspaceId:uuid,channelId:uuid,threadId:uuid,revision:z.number().int().nonnegative(),kind:z.enum(['text','audio']),text:z.string().nullable(),audioId:z.string().nullable(),audioHash:z.string().nullable(),sender:z.string().regex(/^\d{5,32}$/),phoneId:z.string().regex(/^\d{1,32}$/),lastCustomerAt:z.string().datetime({offset:true}),mode:z.enum(['review','automatic']),draftId:uuid.nullish().transform(v=>v??undefined)})
const contextSchema=z.object({workspaceId:uuid,threadId:uuid,agent:settingsSchema,knowledge:z.object({products:z.array(productSchema.extend({id:uuid})).max(500),faqs:z.array(faqSchema.extend({id:uuid})).max(200),information:z.array(informationSchema.extend({id:uuid})).max(5)}),history:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(6000)})).max(12)})
export function createCloudStore(client:SupabaseClient,keys:Readonly<Record<string,string>>,activeKeyId?:string):CloudStore&{accept(event:CloudEvent):Promise<'accepted'|'duplicate'|'ignored'>}{
 async function rpc(name:string,args:Record<string,unknown>){
  const {data,error}=await client.rpc(name,args)
  if(error)throw Error(['42501','54000'].includes(error.code)?'Cloud access denied':'Cloud storage unavailable')
  return data
 }
 async function command(name:string,job:CloudJob,payload:Record<string,unknown>={}){
  return rpc('cloud_worker',{p_command:name,p_job:job.id,p_lease:job.lease,p_payload:payload})
 }
 // Signup and job claims are distinct names to avoid overloading trust contexts.
 const worker:CloudStore={
  async claim(){const data=await rpc('cloud_worker',{p_command:'claim'});return data===null?null:jobSchema.parse(data)},
  async credential(job){const data=await command('credential',job);if(!data?.sealed)throw Error('Credential unavailable');const sealed=data.sealed as SealedToken;const token=openToken(sealed,job,keys);if(activeKeyId&&sealed.keyId!==activeKeyId){const rotated=sealToken(token,job,activeKeyId,keys);const changed=await rpc('rotate_cloud_credential',{p_job:job.id,p_lease:job.lease,p_old:sealed,p_new:rotated});if(changed!==true)throw Error('Credential changed during rotation')}return token},
  async reserveAudio(job){await command('audio',job)},
  async startAudio(job){await command('audio_started',job)},
  async transcript(job,text){return jobSchema.parse(await command('transcript',job,{text}))},
  async context(job){const data=contextSchema.parse(await command('context',job));if(data.workspaceId!==job.workspaceId||data.threadId!==job.threadId)throw Error('Cloud context binding mismatch');return {agent:data.agent,knowledge:data.knowledge,history:data.history}},
  async reserveReply(job){await command('reply',job)},
  async handoff(job,reason){await command('handoff',job,{reason})},
  async draft(job,text){return z.object({id:uuid}).parse(await command('draft',job,{text}))},
  async dispatch(job,draftId){return z.object({attemptId:uuid,text:z.string().min(1).max(4096),recipient:z.string().regex(/^\d{5,32}$/),phoneId:z.string().regex(/^\d{1,32}$/)}).parse(await command('dispatch',job,{draftId}))},
  async sent(job,attemptId,providerId){await command('sent',job,{attemptId,providerId})},
  async uncertain(job,attemptId){await command('uncertain',job,{attemptId})},
  async rejected(job,attemptId,retryable,seconds){await command('rejected',job,{attemptId,retryable,seconds})},
  async finish(job){await command('finish',job)},
  async defer(job,reason){await command('defer',job,{reason})},
 }
 return {...worker,async accept(event:CloudEvent){return z.enum(['accepted','duplicate','ignored']).parse(await rpc('accept_cloud_event',{p_event:event}))}}
}

export function createSignupStore(client:SupabaseClient,expectedWorkspaceId:string):SignupStore{
 async function control(command:string,payload:unknown){const {data,error}=await client.rpc('cloud_signup_control',{p_command:command,p_payload:payload});if(error)throw Error('Signup unavailable');return data}
 return {
  async claim(state,userId){const data=z.object({workspaceId:uuid,channelId:uuid,attemptId:uuid}).parse(await control('claim',{state,userId,workspaceId:expectedWorkspaceId}));if(data.workspaceId!==expectedWorkspaceId)throw Error('Signup binding mismatch');return data},
  async verified(claim,data){await control('verified',{...claim,...data})},
  async activate(claim){await control('activate',claim)},
  async fail(claim){await control('fail',claim)},
 }
}

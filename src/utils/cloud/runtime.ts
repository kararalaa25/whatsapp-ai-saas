import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createCloudStore, createSignupStore } from './store'
import { createMetaClient, liveProviderIO } from './meta'
import { requireCloudInstallation, requireProviderRelease,openToken,type SealedToken } from './security'
import { createOpenAITranscriber, retrieveAudio } from './audio'
import { generateReply } from '@/utils/ai/reply'
import type { CloudEngineDependencies } from './engine'

export function createCloudRuntime(){
 requireCloudInstallation()
 const config=z.object({url:z.string().url(),key:z.string().min(1),appId:z.string().regex(/^\d{1,32}$/),appSecret:z.string().min(1),version:z.string().regex(/^v\d{1,2}\.0$/),keyId:z.string().regex(/^[a-z0-9_-]{1,40}$/)}).parse({
  url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_CLOUD_SECRET_KEY,appId:process.env.META_APP_ID,appSecret:process.env.META_APP_SECRET,version:process.env.META_GRAPH_API_VERSION,keyId:process.env.META_TOKEN_ACTIVE_KEY_ID,
 })
 const rawKeys=process.env.META_TOKEN_ENCRYPTION_KEYS
 if(!rawKeys||rawKeys.length>16384)throw Error('Credential encryption unavailable')
 const keys=z.record(z.string(),z.string()).parse(JSON.parse(rawKeys))
 const service=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
 const store=createCloudStore(service,keys,config.keyId)
 const meta=createMetaClient(liveProviderIO,config)
 const engine:CloudEngineDependencies={store,meta,
  audio:async(job,token)=>{if(!job.audioId||!job.audioHash)throw Error('Audio reference unavailable');return retrieveAudio(meta,liveProviderIO,job.audioId,job.phoneId,token,job.audioHash)},
  transcribe:createOpenAITranscriber(process.env.OPENAI_API_KEY??'',z.enum(['gpt-4o-transcribe','gpt-4o-mini-transcribe','whisper-1']).parse(process.env.OPENAI_TRANSCRIPTION_MODEL??'gpt-4o-transcribe')),
  reply:async({agent,history,question,entries})=>{requireProviderRelease();return generateReply(agent,history,question,'openai',undefined,entries)},
 }
 async function readAudio(workspaceId:string,actorId:string,messageId:string){
  const {data,error}=await service.rpc('cloud_audio_for_owner',{p_workspace_id:workspaceId,p_actor_id:actorId,p_message_id:messageId})
  if(error||!data)throw Error('Audio unavailable')
  const record=z.object({workspaceId:z.string().uuid(),channelId:z.string().uuid(),phoneId:z.string().regex(/^\d{1,32}$/),mediaId:z.string().regex(/^\d{1,32}$/),hash:z.string(),sealed:z.unknown()}).parse(data)
  if(record.workspaceId!==workspaceId)throw Error('Audio binding mismatch')
  const token=openToken(record.sealed as SealedToken,record,keys)
  return retrieveAudio(meta,liveProviderIO,record.mediaId,record.phoneId,token,record.hash,1200)
 }
 return {readAudio,store,meta,signupForWorkspace:(workspaceId:string)=>createSignupStore(service,workspaceId),keys,keyId:config.keyId,engine}
}

import { createClient } from '@/utils/supabase/server'
import { requireAgentOwner } from '@/utils/ai/access'
import { createCloudRuntime } from '@/utils/cloud/runtime'
import { requireCloudInstallation,requireProviderRelease } from '@/utils/cloud/security'
import { completeEmbeddedSignup } from '@/utils/cloud/onboarding'
import { readRawBody } from '@/utils/whatsapp/webhook'
import { z } from 'zod'
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}
 if(request.headers.get('origin')!==new URL(request.url).origin)return new Response('Forbidden',{status:403,headers})
 try{
  requireCloudInstallation();requireProviderRelease()
  const raw=await readRawBody(request);if(raw.byteLength>16384)return new Response('Invalid request',{status:400,headers})
  const payload=z.object({operation:z.enum(['start','complete']),workspaceId:z.string().uuid(),channelId:z.string().uuid().optional(),signup:z.unknown().optional()}).strict().parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)))
  const client=await createClient();const workspace=await requireAgentOwner(client,payload.workspaceId)
  const {data:identity,error}=await client.auth.getUser();if(error||!identity.user)return new Response('Forbidden',{status:403,headers})
  if(payload.operation==='start'){
   const appId=process.env.META_APP_ID;const configId=process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;const version=process.env.META_GRAPH_API_VERSION
   z.string().regex(/^\d{1,32}$/).parse(appId);z.string().regex(/^\d{1,32}$/).parse(configId);z.string().regex(/^v\d{1,2}\.0$/).parse(version)
   const {data,error}=await client.rpc('begin_cloud_signup',{p_workspace_id:workspace.id,p_channel_id:payload.channelId??null})
   if(error||!data)throw Error('Signup unavailable')
   const state=z.string().regex(/^[a-f0-9]{64}$/).parse(data.state)
   return Response.json({state,appId,configId,version},{headers})
  }
  const runtime=createCloudRuntime()
  // Signup SQL derives workspace from its one-use state and actor. Verify its
  // binding again here; caller workspace cannot authorize a different flow.
  const bound=runtime.signupForWorkspace(workspace.id)
  const result=await completeEmbeddedSignup(payload.signup,identity.user.id,bound,runtime.meta,runtime.keys,runtime.keyId)
  return Response.json(result,{headers})
 }catch{return new Response('WhatsApp setup unavailable',{status:503,headers})}
}

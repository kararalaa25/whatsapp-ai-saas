import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { requireAgentOwner } from '@/utils/ai/access'
import { requireCloudInstallation,requireProviderRelease } from '@/utils/cloud/security'
import { createCloudRuntime } from '@/utils/cloud/runtime'
export async function GET(request:Request){
 const params=new URL(request.url).searchParams
 const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}
 try{
  requireCloudInstallation();requireProviderRelease()
  if(params.getAll('workspace').length!==1||params.getAll('message').length!==1)throw Error('Invalid audio selection')
  const workspaceId=z.string().uuid().parse(params.get('workspace'));const messageId=z.string().uuid().parse(params.get('message'))
  const client=await createClient();const workspace=await requireAgentOwner(client,workspaceId)
  const {data,error}=await client.auth.getUser();if(error||!data.user)throw Error('Authentication required')
  const file=await createCloudRuntime().readAudio(workspace.id,data.user.id,messageId)
  const bytes=new Uint8Array(file.bytes.byteLength);bytes.set(file.bytes)
  let offset=0
  const stream=new ReadableStream<Uint8Array>({pull(controller){if(offset>=bytes.length){controller.close();return}const end=Math.min(offset+65536,bytes.length);controller.enqueue(bytes.subarray(offset,end));offset=end}})
  return new Response(stream,{headers:{...headers,'Content-Type':file.mime,'Content-Disposition':`${params.get('download')==='1'?'attachment':'inline'}; filename="${file.name}"`}})
 }catch{return new Response('Audio unavailable',{status:503,headers})}
}

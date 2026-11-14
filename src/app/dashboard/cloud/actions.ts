'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { requireAgentOwner } from '@/utils/ai/access'
import { CLOUD_INSTALLATION_APPROVED,requireCloudInstallation } from '@/utils/cloud/security'

const cloudPanelSchema=z.object({workspaceId:z.string().uuid(),
 channels:z.array(z.object({id:z.string().uuid(),workspace_id:z.string().uuid(),phone_id:z.string().nullable(),status:z.enum(['pending','verified','active','disabled','error']),mode:z.enum(['review','automatic']),revision:z.number().int().nonnegative()})).max(50),
 threads:z.array(z.object({id:z.string().uuid(),channel_id:z.string().uuid(),customer_suffix:z.string(),human_takeover:z.boolean(),revision:z.number().int().nonnegative(),last_customer_at:z.string()})).max(25),
 messages:z.array(z.object({id:z.string().uuid(),source_job:z.string().uuid(),role:z.enum(['customer','assistant']),kind:z.string(),content:z.string().nullable(),created_at:z.string()})).max(50),
 drafts:z.array(z.object({id:z.string().uuid(),job_id:z.string().uuid(),revision:z.number().int().nonnegative(),source_revision:z.number().int().nonnegative(),content:z.string(),provider:z.enum(['ai','manual']),approved_at:z.string().nullable()})).max(50),
 attempts:z.array(z.object({id:z.string().uuid(),draft_id:z.string().uuid(),status:z.enum(['dispatching','unknown','rejected','failed','accepted','sent','delivered','read']),created_at:z.string()})).max(50),
})

export async function loadCloud(workspaceId:string,threadId?:string){
 const client=await createClient();const workspace=await requireAgentOwner(client,workspaceId)
 if(!CLOUD_INSTALLATION_APPROVED)return {workspace,available:false as const}
 const {data,error}=await client.rpc('get_cloud_workspace',{p_workspace_id:workspace.id,p_thread_id:threadId?z.string().uuid().parse(threadId):null})
 if(error||!data)return {workspace,available:false as const}
 const parsed=cloudPanelSchema.safeParse(data)
 if(!parsed.success||parsed.data.workspaceId!==workspace.id||parsed.data.channels.some(c=>c.workspace_id!==workspace.id))return {workspace,available:false as const}
 return {workspace,available:true as const,data:parsed.data}
}
export async function cloudControl(workspaceId:string,objectId:string,revision:number,action:'disable'|'review'|'automatic'|'takeover'|'release'|'approve'|'retry'){
 try{
  z.string().uuid().parse(objectId);z.number().int().nonnegative().parse(revision);z.enum(['disable','review','automatic','takeover','release','approve','retry']).parse(action)
  const client=await createClient();const workspace=await requireAgentOwner(client,workspaceId);requireCloudInstallation()
  const {error}=await client.rpc('manage_cloud',{p_workspace_id:workspace.id,p_object_id:objectId,p_revision:revision,p_action:action})
  if(error)return {ok:false as const}
  revalidatePath('/dashboard/cloud');return {ok:true as const}
 }catch{return {ok:false as const}}
}
export async function saveCloudManual(workspaceId:string,threadId:string,revision:number,text:string,draftRevision:number|null,expectedSource:string){
 try{
  z.string().uuid().parse(expectedSource);z.string().uuid().parse(threadId);z.number().int().nonnegative().parse(revision);z.number().int().nonnegative().nullable().parse(draftRevision);z.string().trim().min(1).max(4096).refine(v=>!v.includes('\u0000')).parse(text)
  const client=await createClient();const workspace=await requireAgentOwner(client,workspaceId);requireCloudInstallation()
  const {error}=await client.rpc('save_cloud_manual_draft',{p_workspace_id:workspace.id,p_thread_id:threadId,p_revision:revision,p_content:text,p_draft_revision:draftRevision,p_expected_source:expectedSource})
  if(error)return {ok:false as const}
  revalidatePath('/dashboard/cloud');return {ok:true as const}
 }catch{return {ok:false as const}}
}

'use server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { requireAgentOwner } from '@/utils/ai/access'
import { requireCloudInstallation } from '@/utils/cloud/security'
export async function requestPlanReview(workspaceId:string,plan:string,action:'change'|'cancel'|'renewal'='change'){
 try{
  z.enum(['change','cancel','renewal']).parse(action)
  if(action==='change')z.enum(['starter','pro','business']).parse(plan)
  const client=await createClient();const workspace=await requireAgentOwner(client,workspaceId);requireCloudInstallation()
  const {data,error}=await client.rpc('request_subscription_review',{p_workspace_id:workspace.id,p_plan_id:action==='change'?plan:null,p_action:action})
  if(error||!data)return {ok:false as const}
  z.string().uuid().parse(data);return {ok:true as const}
 }catch{return {ok:false as const}}
}
export async function loadPlanReviews(workspaceId:string){
 const client=await createClient();const workspace=await requireAgentOwner(client,workspaceId);requireCloudInstallation()
 const {data,error}=await client.rpc('get_subscription_requests',{p_workspace_id:workspace.id})
 if(error)throw Error('Subscription reviews unavailable')
 return z.array(z.object({id:z.string().uuid(),plan_id:z.enum(['trial','starter','pro','business']),action:z.enum(['change','cancel','renewal']),status:z.enum(['pending','withdrawn','rejected','approved_pending_activation']),created_at:z.string(),reviewed_at:z.string().nullable()})).max(20).parse(data)
}

export async function withdrawPlanRequest(workspaceId:string,id:string){
 try{
  z.string().uuid().parse(id);const client=await createClient();const workspace=await requireAgentOwner(client,workspaceId);requireCloudInstallation()
  const {error}=await client.rpc('withdraw_subscription_request',{p_workspace_id:workspace.id,p_request_id:id})
  return {ok:!error}
 }catch{return {ok:false}}
}

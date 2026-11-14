'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { requireAgentOwner } from '@/utils/ai/access'
import { CLOUD_INSTALLATION_APPROVED,requireCloudInstallation } from '@/utils/cloud/security'
export async function loadTeam(workspaceId:string){
 const client=await createClient();const workspace=await requireAgentOwner(client,workspaceId)
 const {data,error}=await client.from('workspace_members').select('user_id,role').eq('workspace_id',workspace.id).order('created_at').limit(100)
 if(error||!data)throw Error('Team unavailable')
 let members:Array<{user_id:string;role:'owner'|'admin'|'member';email?:string|null}>=z.array(z.object({user_id:z.string().uuid(),role:z.enum(['owner','admin','member'])})).max(100).parse(data)
 if(!CLOUD_INSTALLATION_APPROVED)return {workspace,members,available:false as const,invitations:[]}
 const roster=await client.rpc('get_workspace_team',{p_workspace_id:workspace.id})
 if(roster.error)throw Error('Team unavailable')
 members=z.array(z.object({user_id:z.string().uuid(),role:z.enum(['owner','admin','member']),email:z.string().email().nullable()})).max(100).parse(roster.data)
 const invitations=await client.rpc('get_workspace_invitations',{p_workspace_id:workspace.id})
 if(invitations.error)return {workspace,members,available:false as const,invitations:[]}
 return {workspace,members,available:true as const,invitations:z.array(z.object({id:z.string().uuid(),email:z.string().email(),status:z.enum(['pending','accepted','revoked']),expires_at:z.string()})).parse(invitations.data)}
}
export async function inviteMember(workspaceId:string,email:string){
 try{
  const normalized=z.string().trim().email().max(254).parse(email).toLowerCase()
  const client=await createClient();const workspace=await requireAgentOwner(client,workspaceId);requireCloudInstallation()
  const {data,error}=await client.rpc('create_workspace_invitation',{p_workspace_id:workspace.id,p_email:normalized})
  if(error)return {ok:false as const}
  const invitation=z.object({id:z.string().uuid(),token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(data)
  revalidatePath('/dashboard/team');return {ok:true as const,token:invitation.token}
 }catch{return {ok:false as const}}
}
export async function revokeInvitation(workspaceId:string,id:string){
 try{
  z.string().uuid().parse(id);const client=await createClient();const workspace=await requireAgentOwner(client,workspaceId);requireCloudInstallation()
  const {error}=await client.rpc('revoke_workspace_invitation',{p_workspace_id:workspace.id,p_invitation_id:id})
  if(error)return {ok:false as const};revalidatePath('/dashboard/team');return {ok:true as const}
 }catch{return {ok:false as const}}
}
export async function acceptInvitation(token:string){
 try{
  z.string().regex(/^[a-f0-9]{64}$/).parse(token);requireCloudInstallation()
  const client=await createClient();const {data:identity,error:authError}=await client.auth.getUser()
  if(authError||!identity.user)return {ok:false as const}
  const {data,error}=await client.rpc('accept_workspace_invitation',{p_token:token})
  if(error)return {ok:false as const};const workspaceId=z.string().uuid().parse(data)
  revalidatePath('/dashboard');return {ok:true as const,workspaceId}
 }catch{return {ok:false as const}}
}
export async function removeMember(workspaceId:string,userId:string){
 try{
  z.string().uuid().parse(userId);const client=await createClient();const workspace=await requireAgentOwner(client,workspaceId);requireCloudInstallation()
  const {error}=await client.rpc('remove_workspace_member',{p_workspace_id:workspace.id,p_user_id:userId})
  if(error)return {ok:false as const};revalidatePath('/dashboard/team');revalidatePath('/dashboard/inbox');return {ok:true as const}
 }catch{return {ok:false as const}}
}

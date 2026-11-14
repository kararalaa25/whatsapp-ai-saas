import 'server-only'
import { z } from 'zod'
import type { MetaClient } from './meta'
import { sealToken, type SealedToken } from './security'

export type SignupClaim={workspaceId:string;channelId:string;attemptId:string}
export interface SignupStore {
 claim(state:string,userId:string):Promise<SignupClaim>
 verified(claim:SignupClaim,data:{phoneId:string;wabaId:string;expiresAt:string;token:SealedToken}):Promise<void>
 activate(claim:SignupClaim):Promise<void>
 fail(claim:SignupClaim):Promise<void>
}
// State is one-use, actor/workspace-bound, expires after ten minutes in SQL.
// Browser-supplied WABA/phone IDs are never trusted without Graph verification.
export async function completeEmbeddedSignup(input:unknown,userId:string,store:SignupStore,meta:MetaClient,keys:Readonly<Record<string,string>>,keyId:string){
 const data=z.object({state:z.string().regex(/^[a-f0-9]{64}$/),code:z.string().min(1).max(4096),wabaId:z.string().regex(/^\d{1,32}$/),phoneId:z.string().regex(/^\d{1,32}$/),pin:z.string().regex(/^\d{6}$/)}).strict().parse(input)
 z.string().uuid().parse(userId)
 const claim=await store.claim(data.state,userId)
 try{
  const verified=await meta.exchange(data.code,data.wabaId,data.phoneId)
  const token=sealToken(verified.token,claim,keyId,keys)
  // Persist only encrypted credentials after verified token/app/phone ownership.
  await store.verified(claim,{phoneId:verified.phoneId,wabaId:verified.wabaId,expiresAt:verified.expiresAt,token})
  await meta.subscribe(verified.wabaId,verified.token)
  await meta.register(verified.phoneId,verified.token,data.pin)
  await store.activate(claim)
  return {status:'connected' as const,channelId:claim.channelId}
 }catch{
  // Failed/ambiguous external registration is not an active connection. Recovery
  // requires inspecting provider state and starting a fresh one-use flow.
  await store.fail(claim)
  throw Error('WhatsApp connection could not be confirmed')
 }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loader } from './helpers/load-ts.mjs'
const globals={Buffer,Uint8Array,Response,Request,TextDecoder,AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout}
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',D='44444444-4444-4444-8444-444444444444'
const baseline=loader({}, {},globals)
const {createCloudStore,createSignupStore}=baseline('../src/utils/cloud/store.ts')
const security=baseline('../src/utils/cloud/security.ts')
const {collectEmbeddedSignup}=baseline('../src/utils/cloud/embedded.ts')
const job={id:A,lease:B,workspaceId:A,channelId:C,threadId:D,revision:1,kind:'text',text:'hello',audioId:null,audioHash:null,sender:'9647000000000',phoneId:'300',lastCustomerAt:'2026-11-15T12:00:00Z',mode:'review',draftId:null}
const keys={one:Buffer.alloc(32,1).toString('base64'),two:Buffer.alloc(32,2).toString('base64')}
function hub(){const listeners=new Set();return {addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn),emit:(origin,data)=>{for(const fn of listeners)fn({origin,data})},size:()=>listeners.size}}
test('Embedded Signup waits for both SDK code and trusted-origin phone result, cleans up and ignores spoofed window messages',async()=>{
 const events=hub();const abort=new AbortController();let callback
 const pending=collectEmbeddedSignup({login(fn,options){callback=fn;assert.equal(options.response_type,'code');assert.equal(options.override_default_response_type,true)}},events,'synthetic-config',abort.signal)
 events.emit('https://evil.test',JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{phone_number_id:'999',waba_id:'999'}}))
 callback({authResponse:{code:'synthetic-code'}})
 events.emit('https://www.facebook.com','bad-json')
 events.emit('https://www.facebook.com',JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{phone_number_id:'300',waba_id:'200'}}))
 const result=await pending;assert.equal(result.phoneId,'300');assert.equal(result.wabaId,'200');assert.equal(result.code,'synthetic-code');assert.equal(events.size(),0)
})
test('SDK cancellation and abort cannot leave a completion listener or return an authorization token',async()=>{
 for(const cancel of ['sdk','abort']){
  const events=hub();const abort=new AbortController();let callback
  const promise=collectEmbeddedSignup({login(fn){callback=fn}},events,'config',abort.signal)
  if(cancel==='sdk')callback({status:'unknown',authResponse:{accessToken:'not-a-code'}});else abort.abort()
  await assert.rejects(promise,/canceled/);assert.equal(events.size(),0)
 }
})
test('store exposes only fixed RPCs and binds every job command to its server lease',async()=>{
 const calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});if(args.p_command==='claim')return {data:job,error:null};return {data:{},error:null}}}
 const store=createCloudStore(client,keys)
 const claimed=await store.claim();await store.reserveReply(claimed);await store.finish(claimed)
 assert.equal(calls[0].name,'cloud_worker');assert.equal(calls[1].args.p_job,A);assert.equal(calls[1].args.p_lease,B);assert.equal(calls[1].args.p_command,'reply')
 assert.equal('p_workspace_id' in calls[1].args,false)
})
test('signup store rejects a response from a foreign workspace even if the RPC contract is malformed',async()=>{
 let payload
 const store=createSignupStore({rpc:async(name,args)=>{assert.equal(name,'cloud_signup_control');payload=args.p_payload;return {data:{workspaceId:B,channelId:C,attemptId:D},error:null}}},A)
 await assert.rejects(store.claim('a'.repeat(64),D),/binding mismatch/)
 assert.equal(payload.workspaceId,A);assert.equal(payload.userId,D)
})
test('credential retrieval enforces cryptographic tenant binding and compare-and-swap key rotation',async()=>{
 for(const foreign of [false,true]){
  const sealed=security.sealToken('synthetic-token',{workspaceId:foreign?B:A,channelId:C},'one',keys);let rotations=0
  const client={rpc:async(name,args)=>{
   if(name==='rotate_cloud_credential'){rotations++;assert.equal(args.p_job,A);assert.equal(args.p_lease,B);assert.equal(args.p_old.keyId,'one');assert.equal(security.openToken(args.p_new,{workspaceId:A,channelId:C},keys),'synthetic-token');return {data:true,error:null}}
   return {data:{sealed},error:null}
  }}
  const store=createCloudStore(client,keys,'two')
  if(foreign){await assert.rejects(store.credential(job),/Credential unavailable/);assert.equal(rotations,0)}
  else{assert.equal(await store.credential(job),'synthetic-token');assert.equal(rotations,1)}
 }
})
test('malformed claims and cross-tenant context fail closed before any provider request',async()=>{
 const bad=createCloudStore({rpc:async()=>({data:{id:A},error:null})},keys);await assert.rejects(bad.claim())
 const data={workspaceId:B,threadId:D,agent:{business_description:'',instructions:'',language:'auto',tone:'professional',model:'gpt-4.1-mini',enabled:true},knowledge:{products:[],faqs:[],information:[]},history:[]}
 const foreign=createCloudStore({rpc:async()=>({data,error:null})},keys);await assert.rejects(foreign.context(job),/binding mismatch/)
})
function actions(authorized=true,enabled=true){
 const calls=[]
 const client={auth:{getUser:async()=>({data:{user:{id:A}},error:null})},rpc:async(name,args)=>{calls.push({name,args});return {data:name==='create_workspace_invitation'?{id:D,token:'a'.repeat(64)}:name==='accept_workspace_invitation'?A:D,error:null}}}
 const load=loader({'next/cache':{revalidatePath(){}},'@/utils/supabase/server':{createClient:async()=>client},'@/utils/ai/access':{requireAgentOwner:async()=>{if(!authorized)throw Error('not owner');return {id:A,name:'Verified'}}},'@/utils/cloud/security':{requireCloudInstallation(){if(!enabled)throw Error('disabled')},CLOUD_INSTALLATION_APPROVED:enabled}}, {},globals)
 return {team:load('../src/app/dashboard/team/actions.ts'),billing:load('../src/app/dashboard/billing/actions.ts'),cloud:load('../src/app/dashboard/cloud/actions.ts'),calls}
}
test('ordinary members and foreign owners cannot invite, revoke, request a plan or mutate Cloud state',async()=>{
 const f=actions(false)
 assert.equal((await f.team.inviteMember(A,'person@example.test')).ok,false)
 assert.equal((await f.team.revokeInvitation(A,D)).ok,false)
 assert.equal((await f.billing.requestPlanReview(A,'pro')).ok,false)
 assert.equal((await f.cloud.cloudControl(A,D,0,'approve')).ok,false)
 assert.equal((await f.cloud.saveCloudManual(A,D,0,'hello',null,C)).ok,false)
 assert.equal(f.calls.length,0)
})
test('owner actions use only verified workspace identities and do not accept roles, prices or activation state',async()=>{
 const f=actions()
 const invite=await f.team.inviteMember(B,' Person@Example.test ');assert.equal(invite.ok,true)
 assert.equal(f.calls[0].args.p_workspace_id,A);assert.equal(f.calls[0].args.p_email,'person@example.test');assert.equal(Object.keys(f.calls[0].args).sort().join(','),'p_email,p_workspace_id')
 assert.equal((await f.billing.requestPlanReview(B,'pro')).ok,true)
 const request=f.calls.at(-1);assert.equal(request.name,'request_subscription_review');assert.equal(request.args.p_workspace_id,A);assert.equal(Object.keys(request.args).sort().join(','),'p_action,p_plan_id,p_workspace_id')
 assert.equal((await f.billing.requestPlanReview(A,{plan:'business',price:0,status:'active'})).ok,false)
})
test('new invitation and Cloud writes remain unavailable until reviewed schema installation',async()=>{
 const f=actions(true,false)
 assert.equal((await f.team.inviteMember(A,'person@example.test')).ok,false)
 assert.equal((await f.team.acceptInvitation('a'.repeat(64))).ok,false)
 assert.equal((await f.billing.requestPlanReview(A,'business')).ok,false)
 assert.equal((await f.cloud.cloudControl(A,D,0,'automatic')).ok,false)
 assert.equal(f.calls.length,0)
})
test('invitation acceptance forwards only a one-use token with a live signed-in Auth user',async()=>{
 const f=actions();assert.equal((await f.team.acceptInvitation('a'.repeat(64))).workspaceId,A)
 const call=f.calls[0];assert.equal(call.name,'accept_workspace_invitation');assert.equal(Object.keys(call.args).join(','),'p_token')
 assert.equal((await f.team.acceptInvitation('malformed')).ok,false);assert.equal(f.calls.length,1)
})
test('SQL lease, source-order, status matching, quotas, private grants and manual approval contracts remain explicit',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261114221600_cloud_business_runtime.sql',import.meta.url),'utf8')
 for(const text of ["FOR UPDATE SKIP LOCKED","state<>'leased'","j.lease IS DISTINCT FROM p_lease","source_revision<>t.revision","audio_started_at",'workspace_slot<=10',"DISTINCT ON(workspace_id,channel_id,sender,(kind='status'))","prior.kind<>'status'","cloud_legacy_number_capacity AFTER INSERT",'total+(CASE WHEN TG_WHEN','cloud_pilot_workspaces','50','EXISTS','subscription_one_pending_request'])assert.ok(sql.includes(text),text)
 assert.match(sql,/invitation\.email IS DISTINCT FROM verified_email/)
 assert.match(sql,/role\) VALUES\(w,auth.uid\(\),'member'\)/)
 const privateReview=sql.slice(sql.indexOf('CREATE FUNCTION workspace_private.review_subscription_request'),sql.indexOf('CREATE FUNCTION public.rotate_cloud_credential'))
 assert.doesNotMatch(privateReview,/UPDATE public\.workspace_subscriptions|plan_id=|billing_events/)
})
test('cancellation and renewal requests carry no client-authorized plan or payment amount, and withdrawal is owner-scoped',async()=>{
 const f=actions()
 for(const action of ['cancel','renewal']){
  assert.equal((await f.billing.requestPlanReview(B,'business',action)).ok,true)
  const call=f.calls.at(-1);assert.equal(call.args.p_workspace_id,A);assert.equal(call.args.p_plan_id,null);assert.equal(call.args.p_action,action)
 }
 assert.equal((await f.billing.withdrawPlanRequest(B,D)).ok,true)
 assert.equal(f.calls.at(-1).name,'withdraw_subscription_request');assert.equal(f.calls.at(-1).args.p_workspace_id,A)
 const member=actions(false);assert.equal((await member.billing.withdrawPlanRequest(A,D)).ok,false);assert.equal(member.calls.length,0)
})
test('member removal is owner-only, scoped to the verified workspace and does not delete customer history or Auth users',async()=>{
 const owner=actions();assert.equal((await owner.team.removeMember(B,D)).ok,true)
 assert.equal(owner.calls[0].name,'remove_workspace_member');assert.equal(owner.calls[0].args.p_workspace_id,A);assert.equal(owner.calls[0].args.p_user_id,D)
 const denied=actions(false);assert.equal((await denied.team.removeMember(A,D)).ok,false);assert.equal(denied.calls.length,0)
 const sql=readFileSync(new URL('../supabase/migrations/20261114221600_cloud_business_runtime.sql',import.meta.url),'utf8')
 const removal=sql.slice(sql.indexOf('CREATE FUNCTION public.remove_workspace_member'),sql.indexOf('CREATE TABLE workspace_private.subscription_requests'))
 assert.match(removal,/role<>'owner'/);assert.match(removal,/assigned_user_id=NULL,human_takeover=true/);assert.match(removal,/status='revoked'/)
 assert.doesNotMatch(removal,/DELETE FROM auth.users|DELETE FROM public.ai_|DELETE FROM public.cloud_/)
})
test('manual Cloud draft explicitly forwards the observed incoming source so SQL can reject unseen replacements',async()=>{
 const f=actions();assert.equal((await f.cloud.saveCloudManual(B,D,1,'رد يدوي',null,C)).ok,true)
 const call=f.calls.at(-1);assert.equal(call.args.p_workspace_id,A);assert.equal(call.args.p_expected_source,C)
 const sql=readFileSync(new URL('../supabase/migrations/20261114221600_cloud_business_runtime.sql',import.meta.url),'utf8');assert.match(sql,/j.id IS DISTINCT FROM p_expected_source/)
})
test('private voice playback refuses foreign ownership before any privileged media lookup',async()=>{
 let requests=0
 const l=loader({'@/utils/cloud/security':{requireCloudInstallation(){},requireProviderRelease(){}},'@/utils/supabase/server':{createClient:async()=>({})},'@/utils/ai/access':{requireAgentOwner:async()=>{throw Error('foreign owner')}},'@/utils/cloud/runtime':{createCloudRuntime:()=>{requests++;assert.fail()}}},{},globals)
 const r=await l('../src/app/api/cloud/audio/route.ts').GET(new Request(`https://example.test/api/cloud/audio?workspace=${A}&message=${B}`))
 assert.equal(r.status,503);assert.equal(requests,0);assert.match(r.headers.get('cache-control'),/no-store/)
})
test('owner playback streams only verified-workspace media without exposing provider URL or token',async()=>{
 let args
 const l=loader({'@/utils/cloud/security':{requireCloudInstallation(){},requireProviderRelease(){}},'@/utils/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:C}},error:null})}})},'@/utils/ai/access':{requireAgentOwner:async()=>({id:A,name:'Verified'})},'@/utils/cloud/runtime':{createCloudRuntime:()=>({readAudio:async(...values)=>{args=values;return {bytes:Buffer.from('synthetic audio'),mime:'audio/wav',name:'voice.wav',durationSeconds:1}}})}},{},{...globals,ReadableStream})
 const response=await l('../src/app/api/cloud/audio/route.ts').GET(new Request(`https://example.test/api/cloud/audio?workspace=${B}&message=${D}`))
 assert.equal(response.status,200);assert.equal(args.join(','),[A,C,D].join(','));assert.equal(await response.text(),'synthetic audio')
 assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');assert.equal(response.headers.get('content-type'),'audio/wav');assert.equal(response.headers.get('location'),null)
})

test('accepted unprojected customer messages invalidate old processing, approvals and manual replies',()=>{
 const sql=readFileSync('supabase/migrations/20261114221600_cloud_business_runtime.sql','utf8')
 assert.match(sql,/state='review',reason='superseded'/)
 assert.match(sql,/p_command IN \('audio','audio_started','context','reply','draft','dispatch'\) AND EXISTS/)
 assert.match(sql,/source\.id=d\.job_id AND source\.workspace_id=p_workspace_id/)
 assert.match(sql,/p_expected_source IS NULL[^;]*newer\.intake_order>j\.intake_order/)
})

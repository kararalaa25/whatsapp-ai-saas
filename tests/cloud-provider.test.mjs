import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash,createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loader } from './helpers/load-ts.mjs'
const globals={Buffer,Uint8Array,Response,Request,TextDecoder,AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout}
const load=loader({}, {},globals)
const security=load('../src/utils/cloud/security.ts')
const {createMetaClient,ProviderFailure,liveProviderIO}=load('../src/utils/cloud/meta.ts')
const audio=load('../src/utils/cloud/audio.ts')
const events=load('../src/utils/cloud/events.ts')
const lifecycle=load('../src/utils/cloud/lifecycle.ts')
const onboarding=load('../src/utils/cloud/onboarding.ts')
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333'
const binding={workspaceId:A,channelId:C},keys={one:Buffer.alloc(32,1).toString('base64'),two:Buffer.alloc(32,2).toString('base64')}
const config={version:'v23.0',appId:'100',appSecret:'synthetic-test-secret'} // Contract fixture, not a claim of current Graph-version support.
const reply=(data,status=200,headers={})=>Response.json(data,{status,headers})
const packet=(messages=[],statuses=[])=>JSON.stringify({object:'whatsapp_business_account',entry:[{id:'200',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'300'},messages,statuses}}]}]})
const text={id:'wamid.synthetic',from:'9647000000000',timestamp:'1700000000',type:'text',text:{body:'شكد سعره؟'}}

test('token encryption authenticates workspace, channel, key version and ciphertext; rotation preserves plaintext only server-side',()=>{
 const sealed=security.sealToken('synthetic-token',binding,'one',keys)
 assert.equal(security.openToken(sealed,binding,keys),'synthetic-token')
 assert.doesNotMatch(JSON.stringify(sealed),/synthetic-token/)
 for(const changed of [{workspaceId:B,channelId:C},{workspaceId:A,channelId:B}])assert.throws(()=>security.openToken(sealed,changed,keys),/Credential unavailable/)
 assert.throws(()=>security.openToken({...sealed,ciphertext:Buffer.from('corrupted').toString('base64')},binding,keys),/Credential unavailable/)
 assert.throws(()=>security.openToken({...sealed,keyId:'two'},binding,keys),/Credential unavailable/)
 const rotated=security.rotateToken(sealed,binding,'two',keys)
 assert.equal(rotated.keyId,'two');assert.equal(security.openToken(rotated,binding,{two:keys.two}),'synthetic-token')
 assert.notEqual(rotated.iv,sealed.iv)
})
test('provider and installation gates cannot be enabled with flags or supplied credentials',async()=>{
 assert.equal(security.CLOUD_INSTALLATION_APPROVED,false);assert.equal(security.CLOUD_PROVIDER_RELEASE_APPROVED,false)
 assert.throws(()=>security.requireCloudInstallation(),/awaiting/)
 await assert.rejects(liveProviderIO('https://graph.facebook.com',{}),/approval/)
 await assert.rejects(audio.createOpenAITranscriber('synthetic-not-a-live-key')({bytes:new Uint8Array(),name:'voice.wav',mime:'audio/wav',durationSeconds:1}),/approval/)
 let initialized=0
 const runtime=loader({'@supabase/supabase-js':{createClient(){initialized++;throw Error('must not connect')}}},{SUPABASE_CLOUD_SECRET_KEY:'synthetic',META_LIVE_ENABLED:'true'},globals)('../src/utils/cloud/runtime.ts')
 assert.throws(()=>runtime.createCloudRuntime(),/awaiting/);assert.equal(initialized,0)
})
test('official send request uses bearer auth, app-secret proof and opaque attempt correlation, without inventing provider idempotency',async()=>{
 let count=0
 const client=createMetaClient(async(url,init)=>{
  count++;const u=new URL(url);assert.equal(u.hostname,'graph.facebook.com');assert.equal(u.pathname,'/v23.0/300/messages')
  assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer synthetic-token')
  assert.equal(u.searchParams.get('appsecret_proof'),createHmac('sha256',config.appSecret).update('synthetic-token').digest('hex'))
  const body=JSON.parse(init.body);assert.equal(body.to,'9647000000000');assert.equal(body.biz_opaque_callback_data,A);assert.equal(body.text.body,'أهلاً من متجرك');assert.equal(body.messaging_product,'whatsapp')
  assert.equal('Idempotency-Key' in init.headers,false)
  return reply({messages:[{id:'wamid.accepted'}]})
 },config)
 assert.equal(await client.send('300','synthetic-token','9647000000000','أهلاً من متجرك',A),'wamid.accepted');assert.equal(count,1)
 await assert.rejects(client.send('https://evil.test','synthetic-token','9647000000000','hello',A));assert.equal(count,1)
})
for(const [name,response,outcome,retryable]of [
 ['rate limit',()=>reply({error:{code:4}},429,{'retry-after':'99999'}),'rejected',true],
 ['permission denied',()=>reply({error:{code:190,message:'private token detail'}},403),'rejected',false],
 ['server ambiguity',()=>reply({error:{code:1}},500),'unknown',false],
 ['malformed success',()=>reply({}),'unknown',false],
 ['malformed rejection',()=>new Response('private token detail',{status:400}),'unknown',false],
 ['timeout',()=>{throw Error('private token detail')},'unknown',false],
])test(`provider ${name} produces a sanitized ${outcome} outcome without an automatic retry`,async()=>{
 let calls=0;const client=createMetaClient(async()=>{calls++;return response()},config)
 await assert.rejects(client.send('300','synthetic-token','9647000000000','hello',A),error=>{
  assert.equal(error instanceof ProviderFailure,true);assert.equal(error.outcome,outcome);assert.equal(error.retryable,retryable);assert.ok(error.retryAfter<=900)
  assert.doesNotMatch(error.message,/private token|synthetic-token/);return true
 });assert.equal(calls,1)
})
function graphFixture(change={}){
 const calls=[]
 const io=async(url,init)=>{
  const path=new URL(url).pathname;calls.push(path)
  if(path.endsWith('/oauth/access_token')){assert.equal(init.method,'POST');assert.ok(init.body instanceof URLSearchParams);return reply({access_token:'synthetic-owned-token',expires_in:3600})}
  if(path.endsWith('/debug_token'))return reply({data:{app_id:'100',is_valid:true,expires_at:Math.floor(Date.now()/1000)+3600,scopes:['whatsapp_business_messaging','whatsapp_business_management'],granular_scopes:[{scope:'whatsapp_business_messaging',target_ids:['200']}],...change}})
  if(path.endsWith('/phone_numbers'))return reply({data:[{id:'300'}]})
  if(path.endsWith('/subscribed_apps')||path.endsWith('/register'))return reply({success:true})
  assert.fail('unexpected provider path')
 }
 return {client:createMetaClient(io,config),calls}
}
test('embedded code exchange verifies app, expiry, scopes, WABA grant and exact phone before enrollment',async()=>{
 const f=graphFixture();const verified=await f.client.exchange('synthetic-code','200','300')
 assert.equal(verified.phoneId,'300');assert.equal(verified.token,'synthetic-owned-token');assert.ok(Date.parse(verified.expiresAt)>Date.now())
 await f.client.subscribe('200',verified.token);await f.client.register('300',verified.token,'123456')
 assert.equal(f.calls.length,5)
})
for(const [label,change]of [['app',{app_id:'foreign'}],['validity',{is_valid:false}],['expiry',{expires_at:1}],['scope',{scopes:['whatsapp_business_management']}],['WABA',{granular_scopes:[{scope:'whatsapp_business_messaging',target_ids:['999']}]}]])test(`onboarding rejects a foreign or invalid ${label} before changing provider registration`,async()=>{
 const f=graphFixture(change);await assert.rejects(f.client.exchange('synthetic-code','200','300'))
 assert.equal(f.calls.some(p=>p.endsWith('/register')||p.endsWith('/subscribed_apps')),false)
})
test('onboarding orchestration seals actor-bound credentials before registering, and failures never activate the channel',async()=>{
 const claim={workspaceId:A,channelId:C,attemptId:B}
 for(const failure of [false,true]){
  const calls=[];const store={claim:async(state,user)=>{assert.equal(user,A);assert.equal(state,'a'.repeat(64));calls.push('claim');return claim},verified:async(c,data)=>{calls.push('verified');assert.equal(security.openToken(data.token,c,keys),'synthetic-token')},activate:async()=>calls.push('active'),fail:async()=>calls.push('failed')}
  const meta={exchange:async()=>({token:'synthetic-token',phoneId:'300',wabaId:'200',expiresAt:'2099-01-01T00:00:00Z'}),subscribe:async()=>{calls.push('subscribe');if(failure)throw Error('private Meta error')},register:async()=>calls.push('register')}
  const input={state:'a'.repeat(64),code:'code',wabaId:'200',phoneId:'300',pin:'123456'}
  if(failure){await assert.rejects(onboarding.completeEmbeddedSignup(input,A,store,meta,keys,'one'),/could not be confirmed/);assert.equal(calls.includes('active'),false)}
  else{const result=await onboarding.completeEmbeddedSignup(input,A,store,meta,keys,'one');assert.equal(result.status,'connected');assert.equal(calls.join(','),'claim,verified,subscribe,register,active');assert.doesNotMatch(JSON.stringify(result),/token|pin|code/)}
 }
})
function wav(seconds=1){
 const data=Buffer.alloc(Math.floor(seconds*16000)*2);const b=Buffer.alloc(44+data.length)
 b.write('RIFF',0);b.writeUInt32LE(36+data.length,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(data.length,40);return b
}
function mediaFixture(bytes=wav(),changes={}){
 const hash=createHash('sha256').update(bytes).digest('hex')
 const metadata={url:'https://lookaside.fbsbx.com/whatsapp_business/attachments',mime_type:'audio/wav',sha256:hash,file_size:bytes.length,...changes}
 const meta={media:async(id,phone,token)=>{assert.equal(id,'400');assert.equal(phone,'300');assert.equal(token,'synthetic-token');return metadata}}
 let downloads=0
 const io=async(url,init)=>{downloads++;assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer synthetic-token');return new Response(bytes,{headers:{'content-length':String(bytes.length)}})}
 return {meta,io,hash,downloads:()=>downloads}
}
test('audio retrieval verifies Graph/phone binding, CDN, digest, actual bytes, signature and decoded duration before STT',async()=>{
 const f=mediaFixture();const file=await audio.retrieveAudio(f.meta,f.io,'400','300','synthetic-token',f.hash)
 assert.equal(file.mime,'audio/wav');assert.equal(file.durationSeconds,1);assert.equal(f.downloads(),1)
})
for(const url of ['http://lookaside.fbsbx.com/file','https://127.0.0.1/file','https://fbcdn.net.evil.test/file','https://user@lookaside.fbsbx.com/file','https://lookaside.fbsbx.com:8443/file'])test(`media URL policy blocks SSRF target ${new URL(url).hostname}`,async()=>{
 const f=mediaFixture(wav(),{url});await assert.rejects(audio.retrieveAudio(f.meta,f.io,'400','300','synthetic-token',f.hash));assert.equal(f.downloads(),0)
})
test('audio digest, content size, unsupported format, corrupt container and duration failures cannot reach transcription',async()=>{
 const cases=[mediaFixture(wav(),{sha256:'0'.repeat(64)}),mediaFixture(wav(),{file_size:1}),mediaFixture(wav(),{mime_type:'audio/amr'}),mediaFixture(Buffer.from('OggSinvalid'),{mime_type:'audio/ogg'}),mediaFixture(wav(121)),mediaFixture(wav(0))]
 for(const f of cases)await assert.rejects(audio.retrieveAudio(f.meta,f.io,'400','300','synthetic-token',f.hash))
 assert.match(audio.IRAQI_TRANSCRIPTION_PROMPT,/Iraqi Arabic/);assert.match(audio.IRAQI_TRANSCRIPTION_PROMPT,/code-switching/);assert.match(audio.IRAQI_TRANSCRIPTION_PROMPT,/do not translate, answer, invent prices/)
})
test('Cloud parser minimizes text/audio/status metadata and does not accept a client workspace route',()=>{
 const data=JSON.parse(packet([{...text,workspace_id:B,contacts:[{name:'private'}]},{...text,id:'audio-1',type:'audio',text:undefined,audio:{id:'400',mime_type:'audio/ogg; codecs=opus',sha256:'0'.repeat(64),voice:true}}],[{id:'out-1',status:'delivered',timestamp:'1700000001',recipient_id:text.from,biz_opaque_callback_data:A,pricing:{private:true},errors:[{code:1,title:'private error'}]}]))
 const parsed=events.parseCloudEvents(JSON.stringify(data));assert.equal(parsed.length,3);assert.equal(parsed[1].kind,'audio');assert.equal(parsed[2].kind,'status')
 assert.doesNotMatch(JSON.stringify(parsed),/workspace_id|contacts|pricing|private error/);assert.equal(parsed[0].wabaId,'200');assert.equal(parsed[0].phoneId,'300')
})
test('one saturated event cannot starve later messages; ambiguous acceptance never counts as durable success',async()=>{
 const batch=events.parseCloudEvents(packet([text,{...text,id:'later'}]));const seen=[]
 await assert.rejects(events.acceptCloudBatch(batch,async event=>{seen.push(event.sourceId);if(event.sourceId===text.id)throw Error('capacity');return 'accepted'}),/not durably/)
 assert.equal(seen.join(','),`${text.id},later`)
 await assert.rejects(events.acceptCloudBatch([batch[0]],async()=>undefined),/not durably/)
})
test('delivery statuses reconcile out of order without downgrading confirmed delivery and enforce the exact 24h window',()=>{
 assert.equal(lifecycle.nextDeliveryStatus('unknown','delivered'),'delivered');assert.equal(lifecycle.nextDeliveryStatus('read','failed'),'read');assert.equal(lifecycle.nextDeliveryStatus('delivered','sent'),'delivered');assert.equal(lifecycle.nextDeliveryStatus('accepted','failed'),'failed')
 const now=Date.parse('2026-11-15T12:00:00Z');assert.equal(lifecycle.serviceWindowOpen('2026-11-14T12:00:00Z',now),false);assert.equal(lifecycle.serviceWindowOpen('2026-11-14T12:00:01Z',now),true);assert.equal(lifecycle.serviceWindowOpen('invalid',now),false)
})
test('pending SQL contracts preserve old migrations, isolate Cloud storage and never authorize client-side activation',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261114221600_cloud_business_runtime.sql',import.meta.url),'utf8')
 for(const name of ['cloud_credentials','cloud_signups','cloud_jobs','cloud_attempts','cloud_audit'])assert.ok(sql.includes(`'${name}'`))
 assert.match(sql,/REVOKE ALL ON SEQUENCE workspace_private\.cloud_jobs_intake_order_seq FROM PUBLIC,anon,authenticated,service_role/)
 assert.match(sql,/GRANT EXECUTE ON FUNCTION [^;]*public\.rotate_cloud_credential[^;]*TO service_role/)
 assert.match(sql,/WHERE thread.channel_id=channel AND thread.customer_id=s->>'recipient_id'/)
 assert.match(sql,/CREATE UNIQUE INDEX cloud_source_once/)
 assert.match(sql,/audio_started_at IS NOT NULL/)
 const review=sql.slice(sql.indexOf('CREATE FUNCTION workspace_private.review_subscription_request'),sql.indexOf('CREATE FUNCTION public.rotate_cloud_credential'))
 assert.doesNotMatch(review,/UPDATE public\.workspace_subscriptions|INSERT INTO.*billing_events/)
 assert.match(sql,/email_confirmed_at IS NOT NULL/);assert.doesNotMatch(sql,/user_metadata|raw_user_meta_data/)
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.ingest|DROP TABLE|TRUNCATE|GRANT ALL/i)
})
test('transcript confidence routing rejects empty, silent, overlong and unreliable text instead of inventing a reply',()=>{
 for(const [text,duration,probabilities]of [['',1,[-0.1]],['[inaudible]',1,[-0.1]],['hello',121,[-0.1]],['hello',1,[]],['hello',1,[-4]],['hello',1,[-2,-1]],['hello',1,[NaN]]])assert.throws(()=>audio.validateTranscript(text,duration,probabilities))
 const result=audio.validateTranscript('شكد سعر iPhone والتوصيل للمنصور؟',3,[-0.1,-0.2]);assert.match(result.text,/iPhone/);assert.equal(result.durationSeconds,3)
})
test('expired data-access permission is rejected even while token expiry and is_valid look acceptable',async()=>{
 const f=graphFixture({data_access_expires_at:1});await assert.rejects(f.client.exchange('code','200','300'));assert.equal(f.calls.length,2)
})

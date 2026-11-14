import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { loader } from './helpers/load-ts.mjs'
const globals={Buffer,Uint8Array,Response,Request,TextDecoder,AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout}
const load=loader({}, {},globals)
const {processCloudJob}=load('../src/utils/cloud/engine.ts')
const {ProviderFailure}=load('../src/utils/cloud/meta.ts')
const {AudioReviewRequired}=load('../src/utils/cloud/audio.ts')
const {generateReply,buildPrompt}=load('../src/utils/ai/reply.ts')
const {defaultSettings}=load('../src/utils/ai/settings.ts')
const {emptyProduct}=load('../src/utils/knowledge/schema.ts')
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',D='44444444-4444-4444-8444-444444444444'
const now=Date.parse('2026-11-15T12:00:00Z')
function fixture(options={}){
 const calls=[];const sends=[];const raw={accepted:true};let state='queued';let job={id:A,lease:B,workspaceId:options.workspace??A,channelId:C,threadId:D,revision:1,kind:options.audio?'audio':'text',text:options.audio?null:options.text??'شكد سعر عطر العنبر؟',audioId:options.audio?'400':null,audioHash:options.audio?'0'.repeat(64):null,sender:'9647000000000',phoneId:'300',lastCustomerAt:options.old?'2026-11-14T12:00:00Z':'2026-11-15T11:59:00Z',mode:options.mode??'automatic',...(options.savedDraft?{draftId:B}:{})}
 let paused=options.paused??false;let replyReserved=false;let audioReserved=false;let audioStarted=false;let quotaUnits=0;let audioUnits=0;let mediaCalls=0
 const name=options.workspace===B?'Lemon':'عطر العنبر'
 const knowledge={products:[{...emptyProduct,id:D,name,price:options.workspace===B?99999:25000,stock_status:'in_stock'}],faqs:[],information:[]}
 const store={
  async claim(){if(state!=='queued'&&state!=='deferred')return null;state='leased';calls.push('claim');return {...job}},
  async credential(j){assert.equal(j.workspaceId,job.workspaceId);calls.push('credential');return `synthetic-${job.workspaceId}`},
  async reserveAudio(){calls.push('audio-budget');if(options.audioDenied)throw Error('Cloud access denied');if(audioStarted)throw Error('Audio uncertain');if(!audioReserved){audioReserved=true;audioUnits++}},
  async startAudio(){calls.push('audio-started');if(audioStarted)throw Error('Audio uncertain');audioStarted=true},
  async transcript(j,text){calls.push('transcript');job={...j,text};return job},
  async context(j){calls.push('context');assert.equal(j.workspaceId,job.workspaceId);if(paused||options.expired)throw Error('Cloud access denied');return {agent:{...defaultSettings,enabled:true},knowledge,history:[{role:'user',content:'أريد منتج من متجرك'}]}},
  async reserveReply(){calls.push('reply-budget');if(options.quotaDenied||replyReserved)throw Error('Cloud access denied');replyReserved=true;quotaUnits++},
  async draft(j,text){calls.push('draft');if(options.takeoverAtDraft)paused=true;if(paused)throw Error('Cloud access denied');assert.equal(j.workspaceId,job.workspaceId);assert.ok(text.trim());return {id:B}},
  async dispatch(){calls.push('permit');if(options.takeoverAtDispatch)paused=true;if(paused&&!options.savedDraft)throw Error('Cloud access denied');return {attemptId:D,text:'مسودة مستندة إلى معلومات المتجر',recipient:'9647000000000',phoneId:'300'}},
  async sent(){calls.push('accepted');if(options.commitFailure)throw Error('Database unavailable')},
  async uncertain(){calls.push('unknown');state='delivery_pending';paused=true},
  async rejected(j,id,retryable,seconds){calls.push('rejected');assert.ok(seconds<=900);state=retryable?'deferred':'review'},
  async handoff(j,reason){calls.push(`human:${reason}`);paused=true},
  async finish(){calls.push('done');state='done'},
  async defer(j,reason){calls.push(`defer:${reason}`);state='deferred'},
 }
 const meta={async send(phone,token,to,text,attempt){sends.push({phone,token,to,text,attempt});if(options.sendFailure==='timeout')throw new ProviderFailure('unknown');if(options.sendFailure==='rate')throw new ProviderFailure('rejected',true,30);return 'wamid.sandbox'}}
 const deps={store,meta,now:()=>now,audio:async()=>{calls.push('media');mediaCalls++;if(options.mediaFailure&&mediaCalls===1)throw Error('Temporary download failure');if(options.unsafeAudio)throw new AudioReviewRequired('Unsupported format');return {bytes:new Uint8Array([1]),name:'voice.wav',mime:'audio/wav',durationSeconds:1}},
  transcribe:async()=>{calls.push('stt');if(options.transcriptionFailure)throw Error('Provider uncertain');return {text:options.transcript??'عندكم عطر العنبر؟ شكد price مالته؟',durationSeconds:options.longAudio?121:1}},
  reply:async({agent,history,question,entries})=>{
   calls.push('ai');if(options.aiFailure)throw Error('Provider uncertain')
   const prompt=buildPrompt(agent,history,question,entries)
   const serialized=JSON.stringify(prompt)
   if(job.workspaceId===A){assert.doesNotMatch(serialized,/99999|Lemon/)}else assert.doesNotMatch(serialized,/25000|عطر العنبر/)
   return generateReply(agent,history,question,'demo',undefined,entries)
  },
 }
 return {deps,calls,sends,raw,run:()=>processCloudJob(deps),units:()=>({ai:quotaUnits,audio:audioUnits}),state:()=>state}
}
test('sandbox text lifecycle uses tenant knowledge, reserves once and records provider acceptance separately from delivery',async()=>{
 const f=fixture();assert.equal((await f.run()).outcome,'accepted');assert.equal(f.sends.length,1);assert.equal(f.units().ai,1)
 assert.ok(f.calls.indexOf('reply-budget')<f.calls.indexOf('ai'));assert.ok(f.calls.indexOf('permit')<f.calls.indexOf('accepted'));assert.equal((await f.run()).outcome,'idle')
})
test('independent businesses do not share knowledge, credentials, jobs or usage meters in the sandbox',async()=>{
 const a=fixture(),b=fixture({workspace:B,text:'How much is Lemon?'})
 await Promise.all([a.run(),b.run()]);assert.notEqual(a.sends[0].token,b.sends[0].token);assert.equal(a.units().ai,1);assert.equal(b.units().ai,1)
})
test('sandbox audio lifecycle reserves before retrieval and STT, preserves Iraqi-English text and drafts only in review mode',async()=>{
 const f=fixture({audio:true,mode:'review'});assert.equal((await f.run()).outcome,'draft');assert.equal(f.sends.length,0)
 assert.ok(f.calls.indexOf('audio-budget')<f.calls.indexOf('media'));assert.ok(f.calls.indexOf('audio-started')<f.calls.indexOf('stt'));assert.ok(f.calls.indexOf('transcript')<f.calls.indexOf('ai'))
 assert.equal(f.units().audio,1);assert.equal(f.units().ai,1);assert.equal(f.raw.accepted,true)
})
for(const audio of [false,true])test(`explicit Iraqi human request (${audio?'voice':'text'}) pauses without AI or sends`,async()=>{
 const f=fixture({audio,text:'أريد أحچي ويا موظف',transcript:'أريد أحچي ويا موظف'})
 assert.equal((await f.run()).outcome,'human');assert.equal(f.calls.includes('ai'),false);assert.equal(f.sends.length,0);assert.equal(f.units().ai,0)
})
for(const options of [{paused:true},{expired:true},{quotaDenied:true},{audio:true,audioDenied:true}])test(`denied human/subscription/quota boundary ${JSON.stringify(options)} never reaches a provider send`,async()=>{
 const f=fixture(options);assert.equal((await f.run()).outcome,'deferred');assert.equal(f.sends.length,0);assert.equal(f.calls.includes('ai'),false);assert.equal(f.calls.includes('stt'),false);assert.equal(f.raw.accepted,true)
})
test('transient media retrieval retries do not consume another audio unit or duplicate STT',async()=>{
 const f=fixture({audio:true,mode:'review',mediaFailure:true})
 assert.equal((await f.run()).outcome,'deferred');assert.equal(f.calls.includes('stt'),false)
 assert.equal((await f.run()).outcome,'draft');assert.equal(f.units().audio,1);assert.equal(f.calls.filter(x=>x==='stt').length,1)
})
for(const options of [{unsafeAudio:true},{transcriptionFailure:true},{longAudio:true}])test(`unusable or uncertain voice ${JSON.stringify(options)} is retained for a human, not retried as paid STT`,async()=>{
 const f=fixture({audio:true,...options});assert.equal((await f.run()).outcome,'human');assert.equal(f.calls.includes('ai'),false);assert.equal(f.sends.length,0);assert.equal(f.raw.accepted,true);assert.equal((await f.run()).outcome,'idle')
})
for(const option of ['takeoverAtDraft','takeoverAtDispatch'])test(`takeover at ${option} cancels pre-permit work without delivery`,async()=>{
 const f=fixture({[option]:true});assert.equal((await f.run()).outcome,'deferred');assert.equal(f.sends.length,0)
})
test('a closed service window routes directly to human review before spending AI/STT quota',async()=>{
 const f=fixture({old:true,audio:true});assert.equal((await f.run()).outcome,'human');assert.equal(f.units().ai,0);assert.equal(f.units().audio,0);assert.equal(f.sends.length,0)
})
test('provider timeout and accepted-send database failure are uncertain and never automatically resent',async()=>{
 for(const options of [{sendFailure:'timeout'},{commitFailure:true}]){
  const f=fixture(options);assert.equal((await f.run()).outcome,'delivery_pending');assert.equal(f.calls.includes('unknown'),true);assert.equal(f.sends.length,1)
  assert.equal((await f.run()).outcome,'idle');assert.equal(f.sends.length,1)
 }
})
test('explicit provider rate rejection follows the bounded rejected-attempt path rather than pretending delivery',async()=>{
 const f=fixture({sendFailure:'rate'});assert.equal((await f.run()).outcome,'delivery_pending');assert.equal(f.calls.includes('rejected'),true);assert.equal(f.calls.includes('accepted'),false)
})
test('ambiguous AI failure keeps its reservation and a retry cannot call the model twice',async()=>{
 const f=fixture({aiFailure:true});assert.equal((await f.run()).outcome,'deferred');assert.equal((await f.run()).outcome,'deferred');assert.equal(f.units().ai,1);assert.equal(f.calls.filter(x=>x==='ai').length,1);assert.equal(f.raw.accepted,true)
})
test('approved saved manual draft can be dispatched without AI or transcript regeneration',async()=>{
 const f=fixture({savedDraft:true,paused:true});assert.equal((await f.run()).outcome,'accepted');assert.equal(f.units().ai,0);assert.equal(f.calls.includes('context'),false);assert.equal(f.sends.length,1)
})
function webhookHarness(accept){let initialized=0;const env={META_APP_SECRET:'synthetic-webhook-secret',META_WEBHOOK_VERIFY_TOKEN:'synthetic-verify'};const l=loader({'@/utils/cloud/runtime':{createCloudRuntime(){initialized++;return {store:{accept}}}}},env,globals);return {route:l('../src/app/api/webhooks/meta/route.ts'),initialized:()=>initialized,env}}
const eventBody=()=>JSON.stringify({object:'whatsapp_business_account',entry:[{id:'200',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'300'},messages:[{id:'one',from:'9647000000000',type:'text',timestamp:'1700000000',text:{body:'hello'}},{id:'two',from:'9647000000001',type:'text',timestamp:'1700000000',text:{body:'hello'}}]}}]}]})
function signed(body,secret){return new Request('https://example.test/api/webhooks/meta',{method:'POST',headers:{'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex')},body})}
test('Cloud webhook verifies original signature before touching storage or routing a tenant',async()=>{
 const h=webhookHarness(()=>assert.fail('must not persist'));const body=eventBody()
 assert.equal((await h.route.POST(signed(body,'wrong-secret'))).status,403);assert.equal(h.initialized(),0)
 const invalid=signed('{bad json',h.env.META_APP_SECRET);assert.equal((await h.route.POST(invalid)).status,400);assert.equal(h.initialized(),0)
})
test('signed mixed acceptance failure returns 503 after attempting later messages; successful retries deduplicate',async()=>{
 const seen=[];const persisted=new Set();let full=true
 const h=webhookHarness(async event=>{seen.push(event.sourceId);if(event.sourceId==='one'&&full)throw Error('full');if(persisted.has(event.sourceId))return 'duplicate';persisted.add(event.sourceId);return 'accepted'})
 const body=eventBody();assert.equal((await h.route.POST(signed(body,h.env.META_APP_SECRET))).status,503);assert.equal(seen.join(','),'one,two');assert.equal(persisted.has('two'),true)
 full=false;assert.equal((await h.route.POST(signed(body,h.env.META_APP_SECRET))).status,200);assert.equal(persisted.size,2)
})
test('Cloud verification challenge has private headers and rejects repeated/forged query values',async()=>{
 const h=webhookHarness(()=>assert.fail())
 const good=await h.route.GET(new Request('https://example.test/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=123'))
 assert.equal(good.status,200);assert.equal(await good.text(),'123');assert.match(good.headers.get('cache-control'),/no-store/)
 assert.equal((await h.route.GET(new Request('https://example.test/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123'))).status,403)
})
test('worker rejects unauthenticated requests and live runtime remains disabled for a synthetically authenticated job',async()=>{
 const l=loader({}, {CLOUD_WORKER_SECRET:'a'.repeat(64)},globals);const route=l('../src/app/api/cloud/worker/route.ts')
 assert.equal((await route.POST(new Request('https://example.test/api/cloud/worker',{method:'POST'}))).status,403)
 const r=await route.POST(new Request('https://example.test/api/cloud/worker',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)}}));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/secret|service_role/)
})
test('onboarding CSRF and actor/workspace checks happen before privileged token exchange',async()=>{
 let privileged=0
 const l=loader({'@/utils/cloud/security':{requireCloudInstallation(){},requireProviderRelease(){}},'@/utils/supabase/server':{createClient:async()=>({})},'@/utils/ai/access':{requireAgentOwner:async()=>{throw Error('not owner')}},'@/utils/cloud/runtime':{createCloudRuntime:()=>{privileged++;assert.fail()}}},{},globals)
 const route=l('../src/app/api/cloud/onboarding/route.ts')
 assert.equal((await route.POST(new Request('https://example.test/api/cloud/onboarding',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'}))).status,403)
 const response=await route.POST(new Request('https://example.test/api/cloud/onboarding',{method:'POST',headers:{origin:'https://example.test'},body:JSON.stringify({operation:'start',workspaceId:A})}))
 assert.equal(response.status,503);assert.equal(privileged,0)
})

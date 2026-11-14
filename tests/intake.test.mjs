import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loader } from './helpers/load-ts.mjs'
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222'
const secret='synthetic-intake-signing-secret'
const globals={Buffer,Uint8Array,TextDecoder,Request,Response,URL}
const sql=readFileSync(new URL('../supabase/migrations/20261114180000_phase8_subscriptions.sql',import.meta.url),'utf8')

// Contract model behind the REAL route, adapter and owner actions. It is not a
// database emulator and cannot prove RLS, locks, SQL binding or transactions.
function fixture(){
 const raw=new Map(),waiting=new Map(),conversations=new Set(),projected=new Set(),failAccept=new Set(),failProcess=new Set()
 const expired=new Set(),used=new Map(),limits=new Map([[A,1],[B,1]]),disabled=new Set(),lastRun=new Map()
 let actor='owner-a',clock=0,tail=Promise.resolve(),sequence=0;const calls=[]
 const owns=w=>actor===(w===A?'owner-a':'owner-b')
 const key=(w,s)=>`${w}:${s}`
 function process(q){
  if(q.status==='processed')return true
  if(q.failures>=5)return false
  q.last=clock
  if([...waiting.values()].some(p=>p.w===q.w&&p.sender===q.sender&&p.status!=='processed'&&p.order<q.order)){q.reason='predecessor';return false}
  if(disabled.has(q.w)){q.reason='connection_disabled';return false}
  if(failProcess.has(q.id)){q.status='failed';q.failures++;q.reason=q.failures>=5?'retry_exhausted':'processing_error';return false}
  const customer=key(q.w,q.sender)
  if(!conversations.has(customer)){
   if(expired.has(q.w)||(used.get(q.w)??0)>=limits.get(q.w)){q.reason='quota';return false}
   conversations.add(customer);used.set(q.w,(used.get(q.w)??0)+1)
  }
  projected.add(q.id);q.status='processed';q.reason='processed';return true
 }
 function accept(args){
  assert.equal('p_workspace_id' in args,false)
  const w=args.p_phone_number_id==='100'&&args.p_waba_id==='200'?A:args.p_phone_number_id==='101'&&args.p_waba_id==='201'?B:null
  if(!w)return {data:'ignored',error:null}
  const id=args.p_meta_message_id
  if(failAccept.has(id))return {data:null,error:{code:'storage'}}
  if(raw.has(id)){
   const prior=raw.get(id)
   return prior.w===w&&prior.body===args.p_body&&prior.sender===args.p_sender_id?{data:'duplicate',error:null}:{data:null,error:{code:'22023'}}
  }
  raw.set(id,{w,body:args.p_body,sender:args.p_sender_id})
  const q={id,w,sender:args.p_sender_id,status:'deferred',reason:'pending',failures:0,last:null,order:sequence++}
  waiting.set(id,q)
  const success=process(q)
  if(!success&&[...waiting.values()].filter(p=>p.w===w&&p.status!=='processed').length>1000){raw.delete(id);waiting.delete(id);return {data:null,error:{code:'54000'}}}
  return {data:success?'inserted':'deferred',error:null}
 }
 async function rpc(name,args,service=false){
  calls.push({name,args,service})
  const task=tail.then(()=>{
   if(name==='ingest_whatsapp_ai_test_message')return service?accept(args):{data:null,error:{code:'42501'}}
   const w=args.p_workspace_id
   if(service||!owns(w))return {data:null,error:{code:'42501'}}
   if(name==='get_whatsapp_intake'){
    const rows=[...waiting.values()].filter(q=>q.w===w&&q.status!=='processed')
    return {data:{capacity:1000,outstanding:rows.length,rows:rows.slice(args.p_offset,args.p_offset+25).map(q=>({inbound_id:q.id,body:raw.get(q.id)?.body,status:q.status,reason:q.reason,failures:q.failures}))},error:null}
   }
   if(name==='reconcile_whatsapp_intake'){
    if(lastRun.has(w)&&clock-lastRun.get(w)<60)return {data:null,error:{code:'54000'}}
    lastRun.set(w,clock);let attempted=0,processed=0
    for(const q of [...waiting.values()].filter(q=>q.w===w&&q.status!=='processed'&&q.failures<5&&(q.last===null||clock-q.last>=300)).sort((a,b)=>(a.last??-1)-(b.last??-1)||a.order-b.order).slice(0,25)){
     attempted++;if(process(q))processed++
    }
    return {data:{attempted,processed},error:null}
   }
   throw Error('Unexpected RPC')
  });tail=task.catch(()=>{});return task
 }
 const load=loader({
  '@supabase/supabase-js':{createClient:()=>({rpc:(name,args)=>rpc(name,args,true)})},
  '@/utils/supabase/server':{createClient:async()=>({rpc:(name,args)=>rpc(name,args)})},
  '@/utils/ai/access':{requireAgentOwner:async(_client,w)=>{if(!owns(w))throw Error('Denied');return {id:w,name:'Synthetic shop'}}},
  'next/cache':{revalidatePath(){}},'next/navigation':{redirect(url){throw Error(url)}},
 },{META_APP_SECRET:secret,META_TEST_PHONE_NUMBER_IDS:'100,101',NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_WEBHOOK_SECRET_KEY:'synthetic'},globals)
 const route=load('../src/app/api/webhooks/whatsapp/route.ts'),actions=load('../src/app/dashboard/intake/actions.ts')
 function event(id,sender='123456789',w=A){return {w,id,sender}}
 async function post(events,valid=true){
  const payload={object:'whatsapp_business_account',entry:events.map(e=>({id:e.w===A?'200':'201',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:e.w===A?'100':'101'},workspace_id:B,messages:[{id:e.id,from:e.sender,type:'text',timestamp:'1700000000',text:{body:`Synthetic ${e.id}`}}]}}]}))}
  const body=JSON.stringify(payload),signature='sha256='+createHmac('sha256',secret).update(body).digest('hex')
  return route.POST(new Request('https://example.invalid/api/webhooks/whatsapp',{method:'POST',headers:{'x-hub-signature-256':valid?signature:'sha256='+'0'.repeat(64)},body}))
 }
 return {post,event,actions,raw,waiting,conversations,projected,used,limits,expired,disabled,failAccept,failProcess,calls,
  actor(value){actor=value},advance(seconds=300){clock+=seconds},
  fill(w){for(let j=0;j<1000;j++){const id=`seed-${j}`;raw.set(id,{w,body:'Synthetic backlog',sender:String(j+100000)});waiting.set(id,{id,w,sender:String(j+100000),status:'deferred',reason:'quota',failures:0,last:clock,order:sequence++})}}
 }
}

test('quota exhaustion durably defers a new customer without granting a conversation; batch continues',async()=>{
 const f=fixture()
 assert.equal((await f.post([f.event('first','111111')])).status,200)
 assert.equal((await f.post([f.event('over','222222'),f.event('existing','111111'),f.event('other-tenant','333333',B)])).status,200)
 assert.equal(f.raw.size,4);assert.equal(f.waiting.get('over').reason,'quota')
 assert.equal(f.projected.has('over'),false);assert.equal(f.projected.has('existing'),true);assert.equal(f.projected.has('other-tenant'),true)
 assert.equal(f.used.get(A),1);assert.equal(f.used.get(B),1)
})
test('expired subscriptions retain new texts and existing-customer history without feature activation',async()=>{
 const f=fixture();await f.post([f.event('first')]);f.expired.add(A)
 assert.equal((await f.post([f.event('expired-new','222222'),f.event('expired-existing')])).status,200)
 assert.equal(f.waiting.get('expired-new').status,'deferred');assert.equal(f.projected.has('expired-existing'),true)
 f.advance();const check=await f.actions.reconcileIntake(A)
 assert.equal(check.ok,true);assert.equal(check.processed,0);assert.equal(f.expired.has(A),true)
 assert.equal(f.calls.some(c=>/reserve_subscription_ai|automation|billing/.test(c.name)),false)
})
test('storage/capacity failures are not acknowledged and cannot starve later batch events',async()=>{
 const f=fixture();f.failAccept.add('broken')
 const response=await f.post([f.event('broken'),f.event('later','222222')])
 assert.equal(response.status,503);assert.equal(await response.text(),'Temporarily unavailable')
 assert.equal(f.raw.has('broken'),false);assert.equal(f.projected.has('later'),true)
 f.failAccept.delete('broken');assert.equal((await f.post([f.event('broken'),f.event('later','222222')])).status,200)
 assert.equal(f.raw.size,2);assert.equal(f.used.get(A),1)
})
test('full deferred storage rejects unpersisted events but still accepts processable existing customers',async()=>{
 const f=fixture();await f.post([f.event('first')]);f.fill(A)
 assert.equal((await f.post([f.event('overflow','9999999'),f.event('allowed')])).status,503)
 assert.equal(f.raw.has('overflow'),false);assert.equal(f.projected.has('allowed'),true)
 assert.equal([...f.waiting.values()].filter(q=>q.status!=='processed').length,1000)
})
test('duplicates/concurrent deliveries neither consume quota nor reprocess deferred messages',async()=>{
 const f=fixture();f.expired.add(A)
 const events=[f.event('retry')]
 assert.ok((await Promise.all(Array.from({length:20},()=>f.post(events)))).every(r=>r.status===200))
 assert.equal(f.raw.size,1);assert.equal(f.waiting.size,1);assert.equal(f.waiting.get('retry').failures,0)
 f.expired.delete(A);await f.post(events);assert.equal(f.projected.has('retry'),false)
 f.advance();assert.equal((await f.actions.reconcileIntake(A)).processed,1)
 assert.equal(f.used.get(A),1)
})
test('owner reconciliation is bounded, cooldown limited, ordered and idempotent after eligibility returns',async()=>{
 const f=fixture();f.expired.add(A)
 for(let j=0;j<30;j++)await f.post([f.event(`held-${j}`)])
 f.expired.delete(A);f.advance()
 const first=await f.actions.reconcileIntake(A);assert.equal(first.attempted,25);assert.equal(first.processed,25)
 assert.equal((await f.actions.reconcileIntake(A)).ok,false)
 f.advance();assert.equal((await f.actions.reconcileIntake(A)).processed,5)
 assert.equal(f.used.get(A),1);assert.equal(f.projected.size,30)
 f.advance();assert.equal((await f.actions.reconcileIntake(A)).attempted,0)
})
test('recoverable processing errors preserve raw messages; retry exhaustion never deletes them',async()=>{
 const f=fixture();f.failProcess.add('failed');await f.post([f.event('failed')])
 assert.equal(f.waiting.get('failed').failures,1);assert.equal(f.raw.has('failed'),true)
 f.failProcess.delete('failed');f.advance();assert.equal((await f.actions.reconcileIntake(A)).processed,1)
 f.failProcess.add('exhausted');await f.post([f.event('exhausted')])
 for(let j=0;j<6;j++){f.advance();await f.actions.reconcileIntake(A)}
 assert.equal(f.waiting.get('exhausted').failures,5);assert.equal(f.waiting.get('exhausted').reason,'retry_exhausted')
 assert.equal(f.raw.has('exhausted'),true)
})
test('invalid signatures, foreign identities, non-owners and privileged-client misuse fail closed',async()=>{
 const f=fixture();assert.equal((await f.post([f.event('unsigned')],false)).status,403);assert.equal(f.raw.size,0)
 await f.post([f.event('same-id')]);assert.equal((await f.post([f.event('same-id','999999',B)])).status,503)
 assert.equal(f.raw.get('same-id').w,A)
 for(const actor of ['member','owner-b',null]){f.actor(actor);const before=f.calls.length
  await assert.rejects(f.actions.loadIntake(A));assert.equal((await f.actions.reconcileIntake(A)).ok,false);assert.equal(f.calls.length,before)
 }
 f.actor('owner-a');assert.equal((await f.actions.loadIntake(A)).workspace.id,A)
 const before=f.calls.length;await assert.rejects(f.actions.loadIntake(A,1000));assert.equal(f.calls.length,before)
})
test('SQL intake preserves transaction boundaries, bounded state, tenant FKs and narrow execution grants',()=>{
 const process=sql.slice(sql.indexOf('CREATE FUNCTION workspace_private.process_whatsapp_intake'),sql.indexOf('-- Same RPC identity'))
 const accept=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.ingest_whatsapp_ai_test_message'),sql.indexOf('CREATE FUNCTION public.get_whatsapp_intake'))
 assert.match(process,/BEGIN\s+IF EXISTS[\s\S]*?INSERT INTO public.ai_conversations[\s\S]*?EXCEPTION WHEN SQLSTATE '54000'/)
 assert.doesNotMatch(process,/INSERT INTO public.whatsapp_inbound_messages|DELETE FROM|reserve_subscription_ai|generateReply|automation/)
 assert.ok(accept.indexOf('INSERT INTO public.whatsapp_inbound_messages')<accept.indexOf('process_whatsapp_intake(w,i.id)'))
 assert.match(accept,/status <> 'processed'\) > 1000/)
 assert.match(accept,/outcome <> 'processed'[\s\S]*?RETURN 'deferred'/)
 assert.match(accept,/i.workspace_id IS DISTINCT FROM w/)
 assert.match(sql,/FOREIGN KEY \(workspace_id,inbound_id\) REFERENCES public.whatsapp_inbound_messages\(workspace_id,id\)/)
 assert.match(sql,/FOREIGN KEY \(workspace_id,connection_id\) REFERENCES public.whatsapp_connections\(workspace_id,id\)/)
 for(const table of ['whatsapp_intake','whatsapp_intake_reconciliation'])assert.match(sql,new RegExp(`ALTER TABLE workspace_private\\.${table} ENABLE ROW LEVEL SECURITY`))
 assert.match(sql,/REVOKE ALL ON workspace_private.whatsapp_intake,workspace_private.whatsapp_intake_reconciliation FROM PUBLIC,anon,authenticated,service_role/)
 assert.match(sql,/REVOKE ALL ON FUNCTION workspace_private.process_whatsapp_intake\(uuid,uuid\) FROM PUBLIC,anon,authenticated,service_role/)
 assert.match(sql,/failures < 5[\s\S]*?interval '5 minutes'[\s\S]*?LIMIT 25/)
 assert.match(sql,/interval '1 minute'/)
 assert.match(sql,/intake_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE/)
 assert.match(sql,/p.intake_order < q.intake_order/)
 assert.match(sql,/REVOKE ALL ON SEQUENCE workspace_private.whatsapp_intake_intake_order_seq FROM PUBLIC,anon,authenticated,service_role/)
 assert.doesNotMatch(accept,/ALTER TABLE|UPDATE public.workspace_subscriptions|GRANT.*authenticated/)
})

test('disabled mapped connections retain messages without projection and recover only after trusted reactivation',async()=>{
 const f=fixture();f.disabled.add(A)
 assert.equal((await f.post([f.event('paused')])).status,200)
 assert.equal(f.raw.has('paused'),true);assert.equal(f.waiting.get('paused').reason,'connection_disabled')
 f.advance();assert.equal((await f.actions.reconcileIntake(A)).processed,0)
 f.disabled.delete(A);f.advance();assert.equal((await f.actions.reconcileIntake(A)).processed,1)
})
test('same-customer backlog preserves acceptance order through recoverable faults',async()=>{
 const f=fixture();f.failProcess.add('older')
 await f.post([f.event('older'),f.event('newer')])
 assert.equal(f.waiting.get('newer').reason,'predecessor');assert.equal(f.projected.size,0)
 f.failProcess.delete('older');f.advance()
 assert.equal((await f.actions.reconcileIntake(A)).processed,2)
 assert.deepEqual([...f.projected],['older','newer']);assert.equal(f.used.get(A),1)
})
test('reconciliation after a simulated monthly reset still consumes a unit for the new customer',async()=>{
 const f=fixture();await f.post([f.event('existing')]);await f.post([f.event('held','222222')])
 f.used.set(A,0);f.advance(32*24*60*60) // Model a trusted UTC bucket rollover, not an owner mutation.
 assert.equal((await f.actions.reconcileIntake(A)).processed,1)
 assert.equal(f.used.get(A),1);assert.equal(f.raw.size,2)
})
test('an unrecognized or ambiguous ingestion RPC result is never acknowledged as durable',async()=>{
 let calls=0
 const load=loader({'@supabase/supabase-js':{createClient:()=>({async rpc(){calls++;return {data:'not-a-durable-result',error:null}}})}},
  {META_APP_SECRET:secret,META_TEST_PHONE_NUMBER_IDS:'100',NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_WEBHOOK_SECRET_KEY:'synthetic'},globals)
 const route=load('../src/app/api/webhooks/whatsapp/route.ts')
 const body=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'200',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'100'},messages:[1,2].map(n=>({id:`invalid-${n}`,type:'text',from:'123456',timestamp:'1700000000',text:{body:'Synthetic'}}))}}]}]})
 const response=await route.POST(new Request('https://example.invalid/api/webhooks/whatsapp',{method:'POST',headers:{'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex')},body}))
 assert.equal(response.status,503);assert.equal(calls,2)
})

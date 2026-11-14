import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const require = createRequire(import.meta.url)
function load(path, deps = {}, patch = s => s) {
 const context = { exports: {}, require(name) { if (name === 'server-only') return {}; return name in deps ? deps[name] : require(name) } }
 vm.runInNewContext(ts.transpileModule(patch(readFileSync(new URL(path,import.meta.url),'utf8')), { fileName:path, compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true } }).outputText,context)
 return context.exports
}
const model = load('../src/utils/billing/model.ts')
const now = Date.parse('2026-11-14T12:00:00Z')
const subscription = { plan_id:'trial',status:'trialing',interval:'monthly',currency:'IQD',trial_ends_at:'2026-11-20T00:00:00Z',period_ends_at:'2026-11-20T00:00:00Z',grace_ends_at:null,revision:0 }
const migration = readFileSync(new URL('../supabase/migrations/20261114180000_phase8_subscriptions.sql',import.meta.url),'utf8')

test('all subscription states respect bounded access and exact trial/grace expiration', () => {
 assert.equal(model.hasAccess(subscription,now),true)
 assert.equal(model.effectiveStatus(subscription,Date.parse(subscription.trial_ends_at)),'expired')
 for (const status of ['active','canceled']) {
  assert.equal(model.hasAccess({...subscription,status},now),true)
  assert.equal(model.hasAccess({...subscription,status},Date.parse(subscription.period_ends_at)),false)
 }
 assert.equal(model.hasAccess({...subscription,status:'past_due'},now),false)
 const grace = {...subscription,status:'past_due',grace_ends_at:'2026-11-15T00:00:00Z'}
 assert.equal(model.hasAccess(grace,now),true)
 assert.equal(model.hasAccess(grace,Date.parse(grace.grace_ends_at)),false)
 assert.equal(model.hasAccess({...subscription,status:'expired'},now),false)
 assert.equal(model.hasAccess({...subscription,trial_ends_at:'invalid'},now),false)
})
test('usage warnings cover near, at, over and zero limits after downgrade', () => {
 for (const [used,limit,result] of [[79,100,'normal'],[80,100,'warning'],[100,100,'blocked'],[110,10,'blocked'],[0,0,'blocked']]) assert.equal(model.usageWarning(used,limit),result)
})
test('billing panel rejects a foreign tenant before any subscription query',async () => {
 let calls=0
 const access=load('../src/utils/billing/access.ts',{'@/utils/ai/access':{requireAgentOwner:async()=>{throw Error('Denied')}}})
 await assert.rejects(access.loadBillingPanel({rpc(){calls++}},'foreign'))
 assert.equal(calls,0)
})
test('owner dashboard uses the verified workspace and fails closed on pending schema',async () => {
 const access=load('../src/utils/billing/access.ts',{'@/utils/ai/access':{requireAgentOwner:async()=>({id:'verified',name:'Shop'})}})
 const missing=await access.loadBillingPanel({async rpc(name,args){assert.equal(name,'get_workspace_billing');assert.equal(args.p_workspace_id,'verified');return {data:null,error:{code:'PGRST202'}}}},'requested')
 assert.equal(missing.available,false)
})
test('forged billing events cannot activate or mutate anything',async () => {
 const provider=load('../src/utils/billing/provider.ts')
 await assert.rejects(provider.acceptBillingEvent({provider:'forged',kind:'payment_succeeded',amount:{currency:'IQD',minorUnits:0}}),/Billing disabled/)
 assert.doesNotMatch(readFileSync(new URL('../src/utils/billing/provider.ts',import.meta.url),'utf8'),/fetch\(|process\.env/)
})
test('database contracts deny upgrades, client quotas and forged payment writes',()=>{
 assert.match(migration,/REVOKE ALL ON public\.subscription_plans, public\.workspace_subscriptions FROM PUBLIC, anon, authenticated, service_role/)
 assert.match(migration,/subscriptions_owner_read[\s\S]*?is_workspace_owner\(workspace_id\)/)
 assert.match(migration,/next_status NOT IN \('past_due','canceled','expired'\)/)
 assert.match(migration,/s\.revision IS DISTINCT FROM expected_revision/)
 assert.match(migration,/Upgrade disabled/)
 assert.match(migration,/PRIMARY KEY\(provider,event_id\)/)
 assert.match(migration,/FOREIGN KEY \(workspace_id,invoice_id\)/)
 assert.doesNotMatch(migration,/GRANT (INSERT|UPDATE|DELETE|ALL)/)
 for (const name of ['subscription_plans','workspace_subscriptions','subscription_usage','subscription_reservations','subscription_audit','billing_invoices','billing_events']) assert.match(migration,new RegExp(`ALTER TABLE (public|workspace_private)\\.${name} ENABLE ROW LEVEL SECURITY`))
})
test('atomic metering has workspace lock, bounded period, global operation uniqueness and original abuse cap',()=>{
 assert.match(migration,/FOR UPDATE/)
 assert.match(migration,/period_end <= period_start \+ interval '32 days'/)
 assert.match(migration,/PRIMARY KEY \(workspace_id, metric, operation_key\)/)
 assert.match(migration,/used=used\+1[\s\S]*?used < maximum RETURNING used/)
 assert.match(migration,/IF fresh THEN PERFORM public\.reserve_ai_preview/)
 assert.match(migration,/p_conversation_id::text \|\| ':' \|\| p_revision::text/)
 assert.match(migration,/subscription_conversations AFTER INSERT OR UPDATE/)
 // No destructive downgrade or automatic live billing migration statements.
 assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE |http_post|pg_net|cron\.schedule/i)
})
test('insert quotas cover catalog, FAQs, numbers and team; updates preserve data',()=>{
 for (const [table,metric] of [['business_products','products'],['business_faqs','faqs'],['whatsapp_connections','numbers'],['workspace_members','members']]) assert.match(migration,new RegExp(`BEFORE INSERT OR UPDATE ON public\\.${table}[\\s\\S]*?guard_subscription_capacity\\('${metric}'\\)`))
 assert.match(migration,/IF TG_OP='UPDATE' THEN[\s\S]*?Tenant reassignment denied[\s\S]*?RETURN NEW/)
 assert.match(migration,/p\.features->'ai_drafts'='true'/)
 assert.match(migration,/guard_subscription_draft/)
 assert.match(migration,/"automation":false/)
})

// Mock transaction adapter verifies the expected application contract under a
// retry storm. SQL lock scheduling/isolation still requires live PostgreSQL.
test('mock atomic usage: concurrent retries reserve one unit and tenants remain separate',async()=>{
 const rows=new Map(),operations=new Set();let tail=Promise.resolve()
 function reserve(workspace,key,limit){const task=tail.then(()=>{
  const op=`${workspace}:${key}`;if(operations.has(op))return false
  const used=rows.get(workspace)??0;if(used>=limit)throw Error('quota')
  rows.set(workspace,used+1);operations.add(op);return true
 });tail=task.catch(()=>{});return task}
 const results=await Promise.all(Array.from({length:50},()=>reserve('a','turn-1',1)))
 assert.equal(results.filter(Boolean).length,1);assert.equal(rows.get('a'),1)
 await assert.rejects(reserve('a','turn-2',1),/quota/)
 assert.equal(await reserve('b','turn-1',1),true)
 assert.equal(rows.get('b'),1)
})

const plan={id:'trial',name_en:'Free Trial',name_ar:'تجربة مجانية',trial_days:14,grace_days:0,provisional:true,prices:{IQD:{monthly:null,annual:null},USD:{monthly:null,annual:null}},limits:{ai_generations:50,whatsapp_conversations:50,numbers:1,products:25,members:1,faqs:25},features:{automation:false}}
function page(panel){return load('../src/app/dashboard/billing/page.tsx',{
 'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},
 'next/server':{connection:async()=>{}},'@/utils/supabase/server':{createClient:async()=>({})},
 '@/utils/billing/access':{loadBillingPanel:async()=>{if(panel instanceof Error)throw panel;return panel}},'@/utils/billing/model':model,
},s=>s.replace('async function BillingContent','export async function BillingContent'))}
test('owner UI renders Arabic RTL, warnings, disabled comparisons and no payment success',async()=>{
 const p=page({workspace:{id:'w',name:'متجر'},available:true,subscription:{...subscription,trial_ends_at:'2099-01-01',period_ends_at:'2099-01-01'},plans:[plan],usage:{products:24},period_start:'2026-11-01',period_end:'2026-12-01'})
 const html=renderToStaticMarkup(await p.BillingContent({searchParams:Promise.resolve({workspace:'w',lang:'ar'})}))
 assert.match(html,/dir="rtl"/);assert.match(html,/lang="ar"/);assert.match(html,/قرب بلوغ الحد/)
 assert.match(html,/غير محدد/);assert.match(html,/disabled=""/)
 assert.doesNotMatch(html,/payment successful|checkout|action="/i)
 assert.match(html,/sm:grid-cols-2/)
})
test('UI schema and owner failures do not invent subscription or payment state',async()=>{
 for(const panel of [{workspace:{id:'w',name:'Shop'},available:false},Error('Not owner')]){
 const p=page(panel);const html=renderToStaticMarkup(await p.BillingContent({searchParams:Promise.resolve({workspace:'w'})}))
 assert.doesNotMatch(html,/Current plan|Free Trial|Paid plan preview/)
 assert.match(html,/unavailable|owner access/)
 }
})

test('optional Phase 7B guards enforce automation while keeping disable/handoff available',()=>{
 assert.match(migration,/to_regclass\('public.whatsapp_automation_settings'\) IS NOT NULL/)
 assert.match(migration,/subscription_automation_settings BEFORE INSERT OR UPDATE/)
 assert.match(migration,/subscription_automation_runs BEFORE INSERT OR UPDATE/)
 assert.match(migration,/NEW.mode='disabled' THEN RETURN NEW/)
 assert.match(migration,/NEW.status='pending_human' THEN RETURN NEW/)
 assert.match(migration,/p.features->'automation'='true'/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loader } from './helpers/load-ts.mjs'
const plain = loader()
const { automationSchema, defaultAutomation, withinWorkingHours } = plain('../src/utils/automation/settings.ts')
const lifecycle = plain('../src/utils/automation/lifecycle.ts')
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const S = '44444444-4444-4444-8444-444444444444'
const T = '55555555-5555-4555-8555-555555555555'
const U = '66666666-6666-4666-8666-666666666666'
const D = '77777777-7777-4777-8777-777777777777'
const baseAgent = { ...plain('../src/utils/ai/settings.ts').defaultSettings, enabled: true }

// Real engine/actions/access guards/retrieval/generator, with modeled storage.
// This does NOT execute PostgreSQL, RLS, triggers, or transaction locking.
function harness(actor = 'owner') {
  const config = { ...structuredClone(defaultAutomation), mode: 'draft_only' }
  const detail = {
    conversation: { id: C, connection_id: B, customer_wa_id: '000000000', revision: 3 },
    state: { status: 'open', human_takeover: false, assigned_user_id: null, revision: 2, last_read_position: 0 },
    messages: [{ id: T, position: 1, content: 'What is the price of Amber?', source_id: S, received_at: '2026-11-14T06:00:00Z' }], drafts: [], before: null,
  }
  const product = { ...plain('../src/utils/knowledge/schema.ts').emptyProduct, id: D, name: 'Amber', price: 25000, currency: 'IQD', stock_status: 'in_stock' }
  const agent = { ...baseAgent }
  const calls = []; const reads = []; const runs = new Map(); const drafts = []; const audit = []
  let now = 0; let race = () => {}; let failKnowledge = false; let activeConnection = true; let forged = false; let quota = false
  const success = data => ({ data, error: null }); const failure = () => ({ data: null, error: { code: '40001' } })
  const identity = actor === null ? null : U
  const client = {
    auth: { async getClaims() { return { data: identity ? { claims: { sub: identity, user_metadata: { role: 'owner' } } } : null, error: null } } },
    from(table) {
      const filters = []; let limit = Infinity
      const execute = () => {
        reads.push({ table, filters: structuredClone(filters) })
        if (table === 'workspaces') return success(actor === 'foreign' || actor === null ? [] : [{ id: A, name: 'Synthetic tenant' }])
        if (table === 'workspace_members') return success(actor === 'owner' ? [{ user_id: U, role: 'owner' }] : [])
        if (!filters.some(([key, value]) => key === 'workspace_id' && value === A)) return failure()
        if (table === 'whatsapp_automation_settings') return success([structuredClone(config)])
        if (table === 'ai_agent_settings') return success([structuredClone(agent)])
        if (table === 'business_products') { race(); if (failKnowledge) return failure(); return success([structuredClone(product)]) }
        if (table === 'business_faqs' || table === 'business_information') return success([])
        if (table === 'whatsapp_automation_audit') return success(audit.slice(-limit))
        return failure()
      }
      const q = { select() { return q }, eq(key, value) { filters.push([key,value]); return q }, order() { return q }, limit(n) { limit=n; return q },
        async maybeSingle() { const r=execute(); return r.error ? r : success(r.data[0] ?? null) }, then(resolve,reject) { return Promise.resolve(execute()).then(resolve,reject) } }
      return q
    },
    async rpc(name, args) {
      calls.push({ name, args: structuredClone(args) })
      if (actor !== 'owner' || args.p_workspace_id !== A) return failure()
      if (name === 'save_whatsapp_automation_settings') {
        if (config.revision !== args.p_revision) return failure()
        Object.assign(config, args.p_settings, { revision: config.revision+1 }); audit.push({ event: 'settings_updated' }); return success(null)
      }
      const check = (revision, stateRevision, settingsRevision) => !forged && activeConnection && detail.state.status === 'open' && !detail.state.human_takeover && config.mode === 'draft_only' && revision === detail.conversation.revision && stateRevision === detail.state.revision && settingsRevision === config.revision
      if (name === 'reserve_whatsapp_automation') {
        if (quota || args.p_conversation_id !== C || args.p_position !== detail.messages.at(-1)?.position || !check(args.p_revision,args.p_state_revision,args.p_settings_revision)) return failure()
        const source = detail.messages.at(-1).source_id
        const previous = runs.get(source)
        if (previous && (previous.status !== 'generating' || previous.attempts >= 3 || now-previous.time < 300000)) return failure()
        const human = plain('../src/utils/inbox/model.ts').requestsHuman(detail.messages.at(-1).content)
        if (!human && !agent.enabled) return failure()
        const run = { token: `00000000-0000-4000-8000-${String((previous?.attempts ?? 0)+1).padStart(12,'0')}`, status: human ? 'pending_human' : 'generating', attempts: (previous?.attempts ?? 0)+1, time: now, revision: args.p_revision, stateRevision: args.p_state_revision, settingsRevision: config.revision, agent: JSON.stringify(agent) }
        runs.set(source,run); audit.push({ event: human ? 'pending_human' : previous ? 'retried' : 'reserved' })
        if (human) { detail.state.human_takeover=true; detail.state.status='pending_human'; detail.state.revision++; detail.conversation.revision++ }
        return success(human ? 'pending_human' : run.token)
      }
      if (name === 'complete_whatsapp_automation') {
        const run = [...runs.values()].find(row => row.token === args.p_token)
        if (!run) return failure()
        if (run.status === 'draft') return success(D)
        if (now-run.time >= 300000 || !check(run.revision,run.stateRevision,run.settingsRevision) || run.agent !== JSON.stringify(agent)) return failure()
        if (args.p_refs.some(ref => ref.type === 'product' && ref.data.price !== product.price)) return failure()
        if (drafts.length) return failure()
        drafts.push(args); run.status='draft'; audit.push({ event: 'draft_created' }); return success(D)
      }
      return failure()
    },
  }
  const load = loader({
    '@/utils/supabase/server': { createClient: async () => client },
    '../inbox/actions': { readInbox: async (workspace,id) => workspace === A && id === C ? { ok:true,data:structuredClone(detail) } : { ok:false,error:'Unavailable' } },
  }, { OPENAI_API_KEY: 'synthetic-never-use', META_ACCESS_TOKEN: 'synthetic-never-use', ENABLE_OUTBOUND: 'true' }, {
    fetch() { throw Error('NETWORK FORBIDDEN') },
  })
  const engine = load('../src/utils/automation/engine.ts')
  const actions = load('../src/app/dashboard/automation/actions.ts')
  return { config, detail, product, agent, calls, reads, drafts, audit, runs, actions, client,
    run: (workspace=A, conversation=C) => engine.processAutomation(client,workspace,conversation,async (tenant,id) => tenant===A && id===C ? { ok:true,data:structuredClone(detail) } : { ok:false,error:'Unavailable' }, new Date('2026-11-14T06:00:00Z')),
    race(fn) { race=fn }, failKnowledge(value) { failKnowledge=value }, tick(ms) { now+=ms }, inactive() { activeConnection=false }, forge() { forged=true }, limit() { quota=true },
  }
}

test('automation settings reject unavailable auto-reply, extra fields, invalid hours and time zones', () => {
  const { revision, ...raw } = defaultAutomation
  assert.equal(revision,0)
  for (const patch of [{ mode:'auto_reply' },{ send:true },{ timezone:'not-a-zone' },{ working_days:[] },{ working_days:[1,1] },{ start_minute:1100,end_minute:1000 },{ business_rules:'x'.repeat(2001) }]) assert.equal(automationSchema.safeParse({ ...raw,...patch }).success,false)
  assert.equal(automationSchema.safeParse(raw).success,true)
})
test('working hours handle Baghdad day boundaries, exclusive end, UTC and DST', () => {
  const s={ ...defaultAutomation,working_hours_enabled:true,working_days:[6] }
  assert.equal(withinWorkingHours(s,new Date('2026-11-14T06:00:00Z')),true)
  assert.equal(withinWorkingHours(s,new Date('2026-11-14T14:00:00Z')),false)
  assert.equal(withinWorkingHours(s,new Date('2026-11-13T21:30:00Z')),false)
  assert.equal(withinWorkingHours({ ...s,timezone:'UTC' },new Date('2026-11-14T06:00:00Z')),false)
  const dst={ ...s,timezone:'America/New_York',working_days:[0],start_minute:60,end_minute:120 }
  assert.equal(withinWorkingHours(dst,new Date('2026-11-01T05:30:00Z')),true)
  assert.equal(withinWorkingHours(dst,new Date('2026-11-01T06:30:00Z')),true)
})
test('disabled automation creates no reservation or draft', async () => {
  const h=harness();h.config.mode='disabled';await assert.rejects(h.run(),/disabled/);assert.equal(h.calls.length,0);assert.equal(h.drafts.length,0)
})
test('owner-only actions and engine reject anonymous, members, foreign owners and forged metadata', async () => {
  for (const actor of [null,'member','foreign']) {
    const h=harness(actor)
    await assert.rejects(h.run(),/authorized/)
    assert.equal((await h.actions.saveAutomation(A,0,Object.fromEntries(Object.entries(h.config).filter(([key])=>key !== 'revision')))).ok,false)
    assert.equal(h.calls.length,0)
  }
  await assert.rejects(harness().run(B),/authorized/)
})
test('settings updates are scoped and stale revisions fail', async () => {
  const h=harness();const { revision,...raw }=h.config
  assert.equal((await h.actions.saveAutomation(A,revision,{ ...raw,language:'ar' })).ok,true)
  assert.equal(h.config.language,'ar')
  assert.equal((await h.actions.saveAutomation(A,revision,raw)).ok,false)
  assert.equal((await h.actions.saveAutomation(B,0,raw)).ok,false)
  assert.equal(h.audit.length,1)
})
test('draft-only engine uses tenant knowledge and creates one unsent draft per source', async () => {
  const h=harness();const result=await h.run()
  assert.equal(result.outcome,'draft');assert.equal(h.drafts.length,1)
  assert.match(h.drafts[0].p_content,/25000 IQD/)
  assert.equal(h.drafts[0].p_refs[0].id,D)
  await assert.rejects(h.run(),/already processed/)
  assert.equal(h.drafts.length,1)
  assert.deepEqual(h.audit.map(row=>row.event),['reserved','draft_created'])
  for (const read of h.reads.filter(row=>!['workspaces','workspace_members'].includes(row.table))) assert.ok(read.filters.some(([key,value])=>key==='workspace_id' && value===A))
})
test('human takeover, pending-human, closed state and empty/forged/inactive sources block generation', async () => {
  for (const change of [h=>h.detail.state.human_takeover=true,h=>h.detail.state.status='pending_human',h=>h.detail.state.status='closed',h=>h.detail.messages=[],h=>h.inactive(),h=>h.forge(),h=>h.limit()]) {
    const h=harness();change(h);await assert.rejects(h.run());assert.equal(h.drafts.length,0)
  }
})
test('English and Arabic human requests persist pending-human without knowledge, agent or provider access', async () => {
  for (const question of ['I want a human representative','اريد احچي ويا موظف']) {
    const h=harness();h.detail.messages[0].content=question;h.agent.enabled=false
    h.config.working_hours_enabled=true;h.config.working_days=[1]
    assert.equal((await h.run()).outcome,'pending_human')
    assert.equal(h.detail.state.human_takeover,true);assert.equal(h.drafts.length,0)
    assert.equal(h.reads.some(row=>row.table==='business_products'),false)
  }
})
test('new inbound, workflow changes, settings and agent edits reject in-flight generation (modeled transactions)', async () => {
  for (const mutate of [h=>h.detail.conversation.revision++,h=>h.detail.state.revision++,h=>h.detail.state.human_takeover=true,h=>h.config.revision++,h=>h.config.mode='disabled',h=>h.agent.tone='friendly',h=>h.inactive()]) {
    const h=harness();h.race(()=>mutate(h));await assert.rejects(h.run(),/rejected/);assert.equal(h.drafts.length,0)
  }
})
test('knowledge failure fails closed; reservations expire and retries stop after three attempts', async () => {
  const h=harness();h.failKnowledge(true)
  for (let attempt=0;attempt<3;attempt++) {
    await assert.rejects(h.run(),/Knowledge unavailable/)
    await assert.rejects(h.run(),/already processed/)
    h.tick(300001)
  }
  await assert.rejects(h.run(),/already processed/)
  assert.equal(h.runs.get(S).attempts,3);assert.equal(h.drafts.length,0)
})
test('expired completion rejected; bounded redacted history never includes local assistant drafts', async () => {
  const h=harness()
  h.detail.messages=Array.from({ length:25 },(_,index)=>({ id:T,source_id:S,position:index+1,content:'Amber price? email=customer@example.com token=privatevalue +9647700000000',received_at:'2026-11-14T06:00:00Z' }))
  h.detail.drafts=[{ content:'invented assistant commitment' }]
  await h.run();assert.ok(h.drafts[0].p_context_count<=12)
  assert.equal(JSON.stringify(h.drafts).includes('customer@example.com'),false)
  const expired=harness();expired.race(()=>expired.tick(300001));await assert.rejects(expired.run(),/rejected/)
})
test('Arabic and English scenarios do not invent unknown prices, products or uncertain variants', async () => {
  for (const [question,patch,pattern] of [
    ['Amber price?',{ price:null },/not recorded/],
    ['سعر Amber؟',{ price:null },/مو مسجّل/],
    ['Amber stock?',{ stock_status:'unknown' },/unconfirmed/],
    ['Amber 100ml price?',{},/confirm the product/],
    ['UnknownWidget price?',{},/Which product/],
    ['التوصيل متوفر؟',{},/مدينة أو منطقة/],
  ]) {
    const h=harness();h.detail.messages[0].content=question;Object.assign(h.product,patch)
    await h.run();assert.match(h.drafts[0].p_content,pattern)
    assert.equal(h.drafts[0].p_content.includes('reservation confirmed'),false)
  }
})
test('official transport is unconditionally disabled even with credentials, flags and hostile inputs', async () => {
  let network=0
  const transport=loader({}, { WHATSAPP_OUTBOUND_ENABLED:'true', META_ACCESS_TOKEN:'synthetic' }, { fetch() { network++;throw Error('network') } })('../src/utils/automation/transport.ts')
  assert.equal(transport.outboundEnabled,false)
  await assert.rejects(transport.officialMetaTransport.send({}),/hard-disabled/)
  await assert.rejects(transport.officialMetaTransport.send(new Proxy({}, { get() { throw Error('input touched') } })),/hard-disabled/)
  assert.equal(network,0)
  assert.equal(Object.isFrozen(transport.officialMetaTransport),true)
})
test('future delivery and retry contracts keep approval local, avoid blind retries and preserve status ordering', () => {
  const approval=lifecycle.localApproval();assert.equal(approval.state,'approved');assert.equal(approval.delivery,null)
  assert.equal(lifecycle.futureRetry('ambiguous',1).action,'reconcile')
  assert.equal(lifecycle.futureRetry('permanent',1).action,'stop')
  assert.equal(lifecycle.futureRetry('transient',5).action,'stop')
  assert.equal(lifecycle.futureRetry('transient',0).action,'stop')
  assert.equal(lifecycle.futureRetry('transient',2).delayMs,2000)
  assert.equal(lifecycle.futureStatus('read','sent','wamid.synthetic'),'read')
  assert.equal(lifecycle.futureStatus('delivered','failed','wamid.synthetic'),'delivered')
  assert.equal(lifecycle.futureStatus('failed','read','wamid.synthetic'),'read')
  assert.equal(lifecycle.futureStatus('sent','failed','wamid.synthetic'),'failed')
  assert.equal(lifecycle.futureStatus('failed','sent','wamid.synthetic'),'failed')
  assert.throws(()=>lifecycle.futureStatus('queued','sent',null),/identity/)
  assert.throws(()=>lifecycle.futureStatus('approved','sent','wamid.synthetic'),/Invalid delivery state/)
  assert.throws(()=>lifecycle.futureRetry('unclassified',1),/Invalid failure kind/)
  assert.equal(lifecycle.automationKey(A,B,D.toUpperCase()),lifecycle.automationKey(A,B,D))
  assert.notEqual(lifecycle.automationKey(A,B,S),lifecycle.automationKey(B,B,S))
  assert.equal(lifecycle.automationKey(A,B,S),lifecycle.automationKey(A,B,S))
  assert.equal(lifecycle.deliveryKey(A,B,D,1),lifecycle.deliveryKey(A,B,D,1))
  assert.notEqual(lifecycle.deliveryKey(A,B,D,1),lifecycle.deliveryKey(A,B,D,2))
})
test('migration and source contracts restrict RPC privileges, states, locks and network capability (static review)', () => {
  const sql=readFileSync(new URL('../supabase/migrations/20261114050000_whatsapp_automation_draft_engine.sql',import.meta.url),'utf8')
  for (const table of ['settings','runs','audit']) {
    assert.match(sql,new RegExp(`ALTER TABLE public.whatsapp_automation_${table} ENABLE ROW LEVEL SECURITY`))
    assert.match(sql,new RegExp(`CREATE POLICY automation_${table}_owner`))
  }
  for (const name of ['save_whatsapp_automation_settings','reserve_whatsapp_automation','complete_whatsapp_automation']) {
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public.${name}[^;]+FROM PUBLIC,anon,authenticated,service_role`))
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public.${name}[^;]+TO authenticated`))
  }
  assert.match(sql,/PRIMARY KEY \(workspace_id, source_message_id\)/)
  assert.match(sql,/r\.created_by IS DISTINCT FROM auth.uid\(\)/)
  assert.match(sql,/r\.agent_snapshot/)
  assert.match(sql,/r\.state_revision,r\.settings_revision/)
  assert.match(sql,/attempts BETWEEN 1 AND 3/)
  assert.match(sql,/Verified text required/)
  assert.doesNotMatch(sql,/\b(?:http_post|net\.http|cron\.schedule|pgmq\.send)\s*\(/i)
  const engine=readFileSync(new URL('../src/utils/automation/engine.ts',import.meta.url),'utf8')
  assert.match(engine,/'demo', undefined, knowledge.entries, config.business_rules/)
  for (const file of ['transport','engine','lifecycle']) assert.doesNotMatch(readFileSync(new URL(`../src/utils/automation/${file}.ts`,import.meta.url),'utf8'),/\bfetch\s*\(|https?:\/\/graph\./)
})

test('owner settings page renders unavailable safely and never offers enabled auto-reply', async () => {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const { renderToStaticMarkup } = require('react-dom/server')
  const React = require('react')
  for (const available of [true,false]) {
    const Page=loader({
      'next/server': { connection: async()=>{} },
      'next/link': { __esModule:true, default: ({ children, ...props })=>React.createElement('a',props,children) },
      './actions': {
        loadAutomation: async()=> { if(!available) throw Error('Unavailable');return { workspace:{ id:A,name:'Synthetic tenant' },settings:defaultAutomation,audit:[] } },
        saveAutomationForm: async()=>{},
      },
    })('../src/app/dashboard/automation/page.tsx').default
    const content=Page({ searchParams:Promise.resolve({ workspace:A }) }).props.children
    const html=renderToStaticMarkup(await content.type(content.props))
    if(available) {
      assert.match(html,/Auto-reply · unavailable/)
      assert.match(html,/Nothing is sent/)
      assert.match(html,/name="start_time"/)
      assert.match(html,/disabled=""/)
      assert.doesNotMatch(html,/value="auto_reply"/)
      assert.match(html,/name="mode"/)
    } else { assert.match(html,/Automation unavailable/);assert.doesNotMatch(html,/<form/) }
  }
})

test('competing owner runs and exact completion retries preserve a single local draft (modeled storage)', async () => {
  const h=harness()
  const results=await Promise.allSettled([h.run(),h.run()])
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
  assert.equal(h.drafts.length,1)
  const completion=h.calls.find(call=>call.name==='complete_whatsapp_automation')
  assert.equal((await h.client.rpc(completion.name,completion.args)).data,D)
  assert.equal(h.drafts.length,1)
  await assert.rejects(h.run(A,B),/inbox unavailable/i)
})
test('automation prompt preserves full agent instructions and bounded business rules without granting delivery', () => {
  const reply=plain('../src/utils/ai/reply.ts')
  const prompt=reply.buildPrompt({ ...baseAgent,instructions:'a'.repeat(4000) },[],'Synthetic question',[],'b'.repeat(2000))
  assert.ok(prompt.messages[0].content.includes('a'.repeat(4000)))
  assert.ok(prompt.messages[0].content.includes('b'.repeat(2000)))
  assert.match(prompt.messages[0].content,/cannot authorize sending/)
  assert.throws(()=>reply.buildPrompt(baseAgent,[],'Synthetic question',[],'b'.repeat(2001)))
})

test('server action connects the verified reader to the engine and returns local-only outcomes', async () => {
  const h=harness()
  const result=await h.actions.runAutomation(A,C)
  assert.equal(result.ok,true)
  assert.match(result.notice,/NOT SENT/)
  assert.equal(h.drafts.length,1)
  assert.equal((await h.actions.runAutomation(A,C)).ok,false)
  assert.equal((await h.actions.runAutomation(B,C)).ok,false)
  assert.equal((await harness('member').actions.runAutomation(A,C)).ok,false)
  const human=harness();human.detail.messages[0].content='اريد موظف'
  const handed=await human.actions.runAutomation(A,C)
  assert.equal(handed.ok,true);assert.match(handed.notice,/No transfer/);assert.equal(human.drafts.length,0)
})
test('retry rotates the reservation token and rejects a late first-attempt completion', async () => {
  const h=harness();h.failKnowledge(true)
  await assert.rejects(h.run(),/Knowledge unavailable/)
  const oldToken=h.runs.get(S).token
  h.tick(300001);h.failKnowledge(false)
  await h.run()
  assert.notEqual(h.runs.get(S).token,oldToken)
  const late=await h.client.rpc('complete_whatsapp_automation',{ p_workspace_id:A,p_conversation_id:C,p_token:oldToken,p_content:'Late obsolete draft',p_refs:[],p_context_count:0 })
  assert.ok(late.error);assert.equal(h.drafts.length,1)
})

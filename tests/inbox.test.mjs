import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function loader(overrides = {}, env = {}, globals = {}) {
  const cache = new Map()
  function load(path) {
    const url = new URL(path, import.meta.url)
    if (cache.has(url.href)) return cache.get(url.href)
    const exports = {}; cache.set(url.href, exports)
    vm.runInNewContext(ts.transpileModule(readFileSync(url, 'utf8'), { fileName: url.pathname, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
      ...globals, exports, URL, process: { env }, require(name) {
        if (name in overrides) return overrides[name]
        if (name === 'server-only') return {}
        if (name.startsWith('.') || name.startsWith('@/')) {
          const base = name.startsWith('@/') ? new URL(`../src/${name.slice(2)}`, import.meta.url) : new URL(name, url)
          const file = ['.ts', '.tsx'].map(extension => `${base.href}${extension}`).find(file => existsSync(new URL(file)))
          if (!file) throw Error(`Missing dependency ${name}`)
          return load(file)
        }
        return require(name)
      },
    })
    return exports
  }
  return load
}
const plain = loader()
const model = plain('../src/utils/inbox/model.ts')
const defaults = plain('../src/utils/knowledge/schema.ts').emptyProduct
const settings = { ...plain('../src/utils/ai/settings.ts').defaultSettings, enabled: true }
const A = '11111111-1111-4111-8111-111111111111'; const B = '22222222-2222-4222-8222-222222222222'
const users = { a: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', member: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', dual: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }
const connectionA = '33333333-3333-4333-8333-333333333333'; const connectionA2 = '44444444-4444-4444-8444-444444444444'; const connectionB = '55555555-5555-4555-8555-555555555555'

// Executes real server actions, auth/workspace guards, ingestion adapter,
// retrieval and demo generator. SQL/RLS/transactions are MODELED, not executed.
function harness(actor = 'a', mockProvider = false) {
  let counter = 1; let tick = 0; let minute = 0; let race = false
  const uid = () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`
  const now = () => new Date(Date.UTC(2026, 10, 14, 6, 0, tick++)).toISOString()
  const rows = {
    workspaces: [{ id: A, name: 'Synthetic A' }, { id: B, name: 'Synthetic B' }],
    workspace_members: [...(actor === 'dual' ? [[A, users.dual], [B, users.dual]] : [[A, users.a], [B, users.b]])].map(([workspace_id, user_id]) => ({ workspace_id, user_id, role: 'owner' })).concat([{ workspace_id: A, user_id: users.member, role: 'member' }, { workspace_id: B, user_id: users.member, role: 'member' }]),
    ai_agent_settings: [A, B].map(workspace_id => ({ ...settings, workspace_id })),
    ai_conversations: [], ai_messages: [], whatsapp_inbound_messages: [], whatsapp_inbox_state: [], whatsapp_reply_drafts: [],
    business_products: [A, B].map(workspace_id => ({ ...defaults, workspace_id, id: uid(), name: 'Synthetic amber perfume', price: 25000, stock_status: 'in_stock' })),
    business_faqs: [], business_information: [{ workspace_id: A, id: uid(), topic: 'delivery', content: 'Synthetic policy: central districts only; fees require confirmation.' }],
  }
  const calls = []; const reads = []; const quota = new Map(); const providerCalls = []
  const identity = () => actor === null ? null : users[actor]
  const owns = tenant => rows.workspace_members.some(row => row.workspace_id === tenant && row.user_id === identity() && row.role === 'owner')
  const verified = conv => rows.ai_messages.filter(m => m.workspace_id === conv.workspace_id && m.conversation_id === conv.id && m.role === 'user' && m.provider === 'customer' && rows.whatsapp_inbound_messages.some(i => i.workspace_id === m.workspace_id && i.id === m.inbound_message_id && i.connection_id === conv.connection_id && i.body === m.content && i.message_type === 'text'))
  const latest = conv => Math.max(0, ...verified(conv).map(row => row.position))
  const state = conv => rows.whatsapp_inbox_state.find(row => row.workspace_id === conv.workspace_id && row.conversation_id === conv.id)
  const deny = code => ({ data: null, error: { code: code ?? '42501' } })
  const ok = data => ({ data, error: null })
  const referencesValid = (refs, tenant) => refs.every(ref => {
    const table = { product: 'business_products', faq: 'business_faqs', information: 'business_information' }[ref.type]
    const fields = { product: ['name','description','category','sku','price','currency','stock_status'], faq: ['question','answer'], information: ['topic','content'] }[ref.type]
    const row = rows[table]?.find(row => row.workspace_id === tenant && row.id === ref.id && row.active !== false)
    return row && fields.every(key => row[key] === ref.data[key]) && Object.keys(ref.data).length === fields.length
  })
  const client = { auth: { async getClaims() { return identity() ? { data: { claims: { sub: identity(), user_metadata: { role: 'owner' } } }, error: null } : { data: null, error: { code: 'missing_session' } } } },
    from(table) {
      const filters = []; const orders = []; const read = { table, filters }; reads.push(read)
      let columns = ''; let max = Infinity
      const execute = () => {
        let data = rows[table]
        if (!data) return deny('42P01')
        if (table === 'workspaces') {
          const user = filters.find(f => f[0] === 'workspace_members.user_id')?.[1]
          data = data.filter(row => rows.workspace_members.some(m => m.workspace_id === row.id && m.user_id === user))
        }
        for (const [column, value, op] of filters.filter(f => !f[0].startsWith('workspace_members.'))) data = data.filter(row => op === 'lt' ? row[column] < value : op === 'not-null' ? row[column] !== null && row[column] !== undefined : row[column] === value)
        data = data.slice().sort((left, right) => {
          for (const [column, ascending] of orders) { const compare = left[column] < right[column] ? -1 : left[column] > right[column] ? 1 : 0; if (compare) return ascending ? compare : -compare }
          return 0
        }).slice(0, max)
        data = data.map(row => {
          if (columns.includes('whatsapp_inbound_messages!inner')) return { id: row.id, position: row.position, content: row.content, inbound_message_id: row.inbound_message_id, whatsapp_inbound_messages: rows.whatsapp_inbound_messages.find(i => i.id === row.inbound_message_id) ?? null }
          return Object.fromEntries(Object.entries(row).filter(([key]) => columns.split(',').map(s => s.trim()).includes(key)))
        })
        return ok(data)
      }
      const q = { select(value) { columns = value; return q }, eq(column, value) { filters.push([column, value, 'eq']); return q }, not(column) { filters.push([column, null, 'not-null']); return q }, lt(column, value) { filters.push([column, value, 'lt']); return q }, order(column, options = {}) { orders.push([column, options.ascending !== false]); return q }, limit(value) { max = value; return q }, async maybeSingle() { const result = execute(); return result.error ? result : ok(result.data[0] ?? null) }, then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject) } }
      return q
    },
    async rpc(name, args) {
      calls.push({ name, args: structuredClone(args) })
      if (name === 'ingest_wasla_whatsapp_test_message') {
        if (rows.whatsapp_inbound_messages.some(row => row.meta_message_id === args.p_meta_message_id)) return ok('duplicate')
        const mapping = { '100': [A, connectionA], '101': [A, connectionA2], '200': [B, connectionB] }[args.p_phone_number_id]
        if (!mapping || args.p_waba_id !== '900') return ok('ignored')
        const [workspace_id, connection_id] = mapping
        const inbound = { id: uid(), workspace_id, connection_id, meta_message_id: args.p_meta_message_id, body: args.p_body, message_type: args.p_message_type, received_at: now() }
        rows.whatsapp_inbound_messages.push(inbound)
        if (!args.p_sender_id || args.p_message_type !== 'text') return ok('inserted')
        let conv = rows.ai_conversations.find(row => row.workspace_id === workspace_id && row.connection_id === connection_id && row.customer_wa_id === args.p_sender_id)
        if (!conv) {
          conv = { id: uid(), workspace_id, connection_id, customer_wa_id: args.p_sender_id, channel: 'whatsapp_test', title: 'Synthetic customer', status: 'open', revision: 0, updated_at: now() }
          rows.ai_conversations.push(conv)
          rows.whatsapp_inbox_state.push({ workspace_id, conversation_id: conv.id, status: 'open', human_takeover: false, assigned_user_id: null, revision: 0, last_read_position: 0 })
        }
        const position = Math.max(0, ...rows.ai_messages.filter(m => m.conversation_id === conv.id).map(m => m.position)) + 1
        rows.ai_messages.push({ id: uid(), workspace_id, conversation_id: conv.id, position, role: 'user', provider: 'customer', content: args.p_body, inbound_message_id: inbound.id })
        if (conv.status === 'closed') { conv.status = 'open'; state(conv).status = 'pending_human'; state(conv).human_takeover = true }
        conv.revision++; conv.updated_at = now(); state(conv).revision++
        return ok('inserted')
      }
      if (!owns(args.p_workspace_id)) return deny()
      if (name === 'list_whatsapp_inbox') {
        const data = rows.ai_conversations.filter(c => c.workspace_id === args.p_workspace_id && c.channel === 'whatsapp_test')
          .filter(c => args.p_status === 'all' || state(c).status === args.p_status)
          .filter(c => !args.p_before_at || c.updated_at < args.p_before_at || (c.updated_at === args.p_before_at && c.id < args.p_before_id))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id)).slice(0, 31)
          .map(c => { const messages = verified(c).sort((a, b) => a.position - b.position); const message = messages.at(-1); const source = rows.whatsapp_inbound_messages.find(i => i.id === message?.inbound_message_id); return { id: c.id, connection_id: c.connection_id, customer_wa_id: c.customer_wa_id, updated_at: c.updated_at, status: state(c).status, human_takeover: state(c).human_takeover, assigned_user_id: state(c).assigned_user_id, unread_count: messages.filter(m => m.position > state(c).last_read_position).length, recent_message: source?.body.slice(0, 160) ?? null, latest_received_at: source?.received_at ?? null } })
        return ok(data)
      }
      if (name === 'reserve_subscription_ai') return ok(true)
      const conv = rows.ai_conversations.find(c => c.workspace_id === args.p_workspace_id && c.id === args.p_conversation_id && c.channel === 'whatsapp_test')
      if (!conv) return deny()
      const control = state(conv)
      if (name === 'save_ai_turn') {
        if (conv.status !== 'open' || control.human_takeover || control.status !== 'open' || conv.revision !== args.p_revision || args.p_customer_message !== null) return deny('40001')
        const position = Math.max(0, ...rows.ai_messages.filter(row => row.conversation_id === conv.id).map(row => row.position)) + 1
        rows.ai_messages.push({ id: uid(), workspace_id: conv.workspace_id, conversation_id: conv.id, position, role: 'assistant', provider: args.p_provider, content: args.p_reply, inbound_message_id: null })
        conv.revision++; conv.updated_at = now(); return ok(null)
      }
      if (name === 'manage_whatsapp_inbox') {
        if (control.revision !== args.p_revision) return deny('40001')
        if (args.p_assignee && !rows.workspace_members.some(m => m.workspace_id === conv.workspace_id && m.user_id === args.p_assignee)) return deny()
        control.status = args.p_status; control.human_takeover = args.p_takeover || args.p_status !== 'open'; control.assigned_user_id = args.p_assignee; control.revision++
        conv.status = args.p_status === 'closed' ? 'closed' : 'open'; conv.revision++; conv.updated_at = now()
        return ok(null)
      }
      if (name === 'mark_whatsapp_inbox_read') {
        if (!verified(conv).some(m => m.position === args.p_position)) return deny('22023')
        control.last_read_position = Math.max(control.last_read_position, args.p_position); return ok(null)
      }
      if (name === 'reserve_whatsapp_inbox_generation') {
        if (control.status !== 'open' || control.human_takeover || args.p_revision !== conv.revision || args.p_position !== latest(conv)) return deny('40001')
        const minuteKey = `${identity()}:${minute}`; const dayKey = `${identity()}:day`
        if ((quota.get(minuteKey) ?? 0) >= 6 || (quota.get(dayKey) ?? 0) >= 100) return deny('54000')
        quota.set(minuteKey, (quota.get(minuteKey) ?? 0) + 1); quota.set(dayKey, (quota.get(dayKey) ?? 0) + 1)
        if (race) { control.human_takeover = true; conv.revision++ }
        return ok(null)
      }
      if (name === 'create_whatsapp_inbox_draft') {
        if (conv.status === 'closed' || args.p_revision !== conv.revision || latest(conv) !== args.p_position || !verified(conv).some(m => m.position === args.p_position && m.inbound_message_id === args.p_source_id)) return deny('40001')
        if (args.p_provider !== 'manual' && (control.human_takeover || control.status !== 'open')) return deny()
        if (rows.whatsapp_reply_drafts.some(d => d.conversation_id === conv.id && d.source_position === args.p_position && d.status !== 'discarded')) return deny('23505')
        if (!referencesValid(args.p_refs, conv.workspace_id)) return deny('40001')
        const draft = { id: uid(), workspace_id: conv.workspace_id, conversation_id: conv.id, source_position: args.p_position, content: args.p_content, provider: args.p_provider, status: 'draft', revision: 0, edited: false, knowledge_refs: args.p_refs, context_count: args.p_context_count, created_at: now(), approved_at: null }
        rows.whatsapp_reply_drafts.push(draft); return ok(draft.id)
      }
      if (name === 'update_whatsapp_inbox_draft') {
        const draft = rows.whatsapp_reply_drafts.find(d => d.workspace_id === conv.workspace_id && d.conversation_id === conv.id && d.id === args.p_draft_id)
        if (!draft || draft.status === 'discarded') return deny()
        if (draft.revision !== args.p_revision) return deny('40001')
        if (args.p_operation !== 'discard' && conv.status === 'closed') return deny()
        if (args.p_operation === 'approve' && (draft.source_position !== latest(conv) || draft.status !== 'draft')) return deny('40001')
        if (args.p_operation === 'approve' && !referencesValid(draft.knowledge_refs, conv.workspace_id)) return deny('40001')
        if (args.p_operation === 'edit') { draft.content = args.p_content; draft.edited = true; draft.status = 'draft'; draft.approved_at = null }
        if (args.p_operation === 'approve') { draft.status = 'approved'; draft.approved_at = now() }
        if (args.p_operation === 'discard') { draft.status = 'discarded'; draft.approved_at = null }
        draft.revision++; return ok(null)
      }
      throw Error(`Unexpected RPC ${name}`)
    },
  }
  const source = loader({ ...(mockProvider ? { '@/utils/ai/reply': { generateReply: async (...args) => { providerCalls.push(args); return 'Mock provider draft; no external request made.' } } } : {}), '@/utils/supabase/server': { createClient: async () => client }, '@supabase/supabase-js': { createClient: () => client }, 'next/link': { default: 'a' }, 'next/server': { connection: async () => {} } }, { NEXT_PUBLIC_SUPABASE_URL: 'https://example.test', SUPABASE_WEBHOOK_SECRET_KEY: 'synthetic-not-a-key', ...(mockProvider ? { OPENAI_API_KEY: 'synthetic-mock-only' } : {}) })
  const actions = source('../src/app/dashboard/inbox/actions.ts')
  const ingestor = source('../src/utils/whatsapp/ingestion.ts').createIngestor()
  const deliver = source('../src/utils/whatsapp/webhook.ts').deliverMessages
  async function inbound({ phone = '100', sender = '12345678901', body = 'Synthetic amber perfume price?', meta = `test-${counter}`, type = 'text' } = {}) {
    await deliver([{ phoneNumberId: phone, wabaId: '900', metaMessageId: meta, senderId: sender, body: type === 'text' ? body : null, messageType: type, timestamp: '2026-11-14T06:00:00Z' }], new Set(['100','101','200']), ingestor)
    return rows.ai_conversations.find(c => c.connection_id === ({ '100': connectionA, '101': connectionA2, '200': connectionB }[phone]) && c.customer_wa_id === sender)
  }
  return { actions, rows, reads, calls, client, source, inbound, latest, state, quota, providerCalls, nextMinute() { minute++ }, race() { race = true } }
}

const management = (detail, changes = {}) => ({ status: detail.state.status, human_takeover: detail.state.human_takeover, assigned_user_id: detail.state.assigned_user_id, revision: detail.state.revision, ...changes })

test('ingestion groups by tenant + connection + customer and deduplicates Meta retries without unread inflation', async () => {
  const h = harness('dual')
  const a = await h.inbound({ meta: 'same' }); await h.inbound({ meta: 'same' }); await h.inbound({ meta: 'second' })
  const otherConnection = await h.inbound({ phone: '101' }); const otherCustomer = await h.inbound({ sender: '12345678902' }); const b = await h.inbound({ phone: '200' })
  assert.equal(h.rows.ai_conversations.length, 4); assert.equal(h.rows.ai_messages.length, 5)
  assert.notEqual(a.id, otherConnection.id); assert.notEqual(a.id, otherCustomer.id); assert.notEqual(a.id, b.id)
  const listA = await h.actions.listInbox(A)
  assert.equal(listA.ok, true); assert.equal(listA.data.rows.length, 3)
  assert.equal(listA.data.rows.find(row => row.id === a.id).unread_count, 2)
  assert.equal((await h.actions.listInbox(B)).data.rows.length, 1)
})

test('unsupported/senderless test events never become inbox customer text', async () => {
  const h = harness()
  await h.inbound({ sender: null }); await h.inbound({ type: 'unsupported' })
  assert.equal(h.rows.ai_conversations.length, 0)
  assert.equal((await h.actions.listInbox(A)).data.rows.length, 0)
})

test('message pages are exclusive keysets in chronological order, deduplicated when merged', async () => {
  const h = harness(); let conv
  for (let index = 1; index <= 65; index++) conv = await h.inbound({ body: `Question ${index}`, meta: `page-${index}` })
  const first = await h.actions.loadInboxMessages(A, conv.id)
  assert.equal(first.ok, true); assert.equal(first.data.messages.length, 30)
  assert.equal(first.data.messages[0].position, 36); assert.equal(first.data.messages.at(-1).position, 65)
  const second = await h.actions.loadInboxMessages(A, conv.id, first.data.before)
  const third = await h.actions.loadInboxMessages(A, conv.id, second.data.before)
  assert.equal(third.data.before, null)
  const merged = model.mergeMessages([...third.data.messages, ...second.data.messages], [...first.data.messages, ...second.data.messages])
  assert.equal(merged.length, 65)
  assert.deepEqual(Array.from(merged, row => row.position), Array.from({ length: 65 }, (_, index) => index + 1))
})

test('conversation pages have stable tie-breaking and preserve tenant filters', async () => {
  const h = harness();
  for (let index = 0; index < 35; index++) await h.inbound({ sender: String(12345678900 + index) })
  for (const row of h.rows.ai_conversations) row.updated_at = '2026-11-14T06:00:00.123456Z'
  const first = await h.actions.listInbox(A)
  const second = await h.actions.listInbox(A, first.data.next)
  assert.equal(first.data.rows.length, 30); assert.equal(second.data.rows.length, 5); assert.equal(second.data.next, null)
  assert.equal(model.mergeConversations(first.data.rows, second.data.rows).length, 35)
  assert.equal((await h.actions.listInbox(A, { updated_at: 'invalid,or(id)', id: A })).ok, false)
})

test('customer history excludes legacy assistants and unverified local rows; mismatched source records fail closed', async () => {
  const h = harness(); const conv = await h.inbound()
  h.rows.ai_messages.push({ id: 'local', workspace_id: A, conversation_id: conv.id, position: 2, role: 'assistant', provider: 'demo', content: 'Never sent', inbound_message_id: null }, { id: 'fake', workspace_id: A, conversation_id: conv.id, position: 3, role: 'user', provider: 'customer', content: 'Unverified customer forgery', inbound_message_id: null })
  const page = await h.actions.loadInboxMessages(A, conv.id)
  assert.equal(page.ok, true); assert.equal(page.data.messages.length, 1)
  h.rows.ai_messages[0].content = 'Does not match source body'
  assert.equal((await h.actions.loadInboxMessages(A, conv.id)).ok, false)
})

test('read marker marks only the observed position, preserving newer incoming unread messages', async () => {
  const h = harness(); const conv = await h.inbound()
  const visible = (await h.actions.readInbox(A, conv.id)).data.messages.at(-1).position
  await h.inbound({ body: 'New message before the mark-read request' })
  assert.equal((await h.actions.markInboxRead(A, conv.id, visible)).ok, true)
  assert.equal((await h.actions.listInbox(A)).data.rows[0].unread_count, 1)
  assert.equal((await h.actions.markInboxRead(A, conv.id, 9999)).ok, false)
  assert.equal((await h.actions.listInbox(A)).data.rows[0].unread_count, 1)
})

for (const actor of ['member', null]) test(`${actor ?? 'unauthenticated'} cannot list, read, manage or create/review drafts`, async () => {
  const h = harness(actor); const conv = await h.inbound(); h.calls.length = 0
  assert.equal((await h.actions.listInbox(A)).ok, false)
  assert.equal((await h.actions.readInbox(A, conv.id)).ok, false)
  assert.equal((await h.actions.manageInbox(A, conv.id, { status: 'open', human_takeover: false, assigned_user_id: null, revision: 0 })).ok, false)
  assert.equal((await h.actions.generateInboxDraft(A, conv.id, 'demo')).ok, false)
  assert.equal((await h.actions.createManualInboxDraft(A, conv.id, 'local only', 1)).ok, false)
  assert.equal((await h.actions.changeInboxDraft(A, conv.id, A, 0, 'approve')).ok, false)
  assert.equal(h.calls.length, 0)
})

test('foreign workspace/conversation/draft tuples cannot read, mutate or review another tenant', async () => {
  const h = harness('dual'); const a = await h.inbound(); const b = await h.inbound({ phone: '200' })
  const created = await h.actions.createManualInboxDraft(A, a.id, 'A private local reply', 1)
  assert.equal(created.ok, true)
  const draft = created.data.drafts[0]; const before = JSON.stringify(h.rows)
  assert.equal((await h.actions.readInbox(B, a.id)).ok, false)
  assert.equal((await h.actions.loadInboxMessages(B, a.id)).ok, false)
  assert.equal((await h.actions.generateInboxDraft(B, a.id, 'demo')).ok, false)
  assert.equal((await h.actions.changeInboxDraft(B, b.id, draft.id, draft.revision, 'approve')).ok, false)
  assert.equal((await h.actions.changeInboxDraft(B, b.id, draft.id, draft.revision, 'edit', 'Foreign overwrite')).ok, false)
  assert.equal((await h.actions.changeInboxDraft(B, b.id, draft.id, draft.revision, 'discard')).ok, false)
  assert.equal(JSON.stringify(h.rows), before)
  assert.equal((await h.actions.listInbox(B)).data.rows.some(row => row.id === a.id), false)
})

test('assignment stays inside membership; open/pending/closed and explicit takeover release are owner-controlled', async () => {
  const h = harness(); const conv = await h.inbound(); let detail = (await h.actions.readInbox(A, conv.id)).data
  assert.equal((await h.actions.manageInbox(A, conv.id, management(detail, { assigned_user_id: users.b }))).ok, false)
  let result = await h.actions.manageInbox(A, conv.id, management(detail, { status: 'pending_human', assigned_user_id: users.member }))
  assert.equal(result.ok, true); assert.equal(result.data.state.human_takeover, true)
  result = await h.actions.manageInbox(A, conv.id, management(result.data, { status: 'closed' }))
  assert.equal(result.data.state.status, 'closed')
  result = await h.actions.manageInbox(A, conv.id, management(result.data, { status: 'open' }))
  assert.equal(result.data.state.human_takeover, true)
  detail = result.data
  result = await h.actions.manageInbox(A, conv.id, management(detail, { human_takeover: false }))
  assert.equal(result.data.state.human_takeover, false)
  assert.equal((await h.actions.manageInbox(A, conv.id, management(detail))).ok, false, 'Stale management revisions must fail')
})

test('human takeover blocks generation before knowledge/provider/quota, but permits manual owner drafts', async () => {
  const h = harness(); const conv = await h.inbound(); h.state(conv).human_takeover = true
  h.calls.length = 0; h.reads.length = 0
  assert.equal((await h.actions.generateInboxDraft(A, conv.id, 'demo')).ok, false)
  assert.equal(h.calls.some(call => call.name === 'reserve_whatsapp_inbox_generation'), false)
  assert.equal(h.reads.some(read => read.table.startsWith('business_')), false)
  const manual = await h.actions.createManualInboxDraft(A, conv.id, 'Human-written local response', 1)
  assert.equal(manual.ok, true); assert.equal(manual.data.drafts[0].provider, 'manual')
})

test('a verified customer human request routes to pending human without generating a draft or claiming handoff', async () => {
  const h = harness(); const conv = await h.inbound({ body: 'اريد احچي ويا موظف' }); h.calls.length = 0
  const result = await h.actions.generateInboxDraft(A, conv.id, 'demo')
  assert.equal(result.ok, true); assert.equal(result.data.state.status, 'pending_human'); assert.equal(result.data.drafts.length, 0)
  assert.match(result.notice, /no reply was generated or delivered/)
  assert.equal(h.calls.some(call => call.name === 'reserve_whatsapp_inbox_generation'), false)
})

test('knowledge-aware simulated draft uses verified text, persists references, and never joins customer history', async () => {
  const h = harness(); const conv = await h.inbound()
  const result = await h.actions.generateInboxDraft(A, conv.id, 'demo')
  assert.equal(result.ok, true)
  const draft = result.data.drafts[0]
  assert.match(draft.content, /simulated reply/); assert.match(draft.content, /25000 IQD/)
  assert.equal(draft.knowledge_refs[0].data.price, 25000)
  assert.equal(draft.status, 'draft'); assert.equal(draft.provider, 'demo')
  assert.equal(result.data.messages.length, 1)
  assert.ok(h.calls.findIndex(call => call.name === 'reserve_whatsapp_inbox_generation') < h.calls.findIndex(call => call.name === 'create_whatsapp_inbox_draft'))
  assert.equal((await h.actions.generateInboxDraft(A, conv.id, 'demo')).ok, false, 'One active candidate per source')
})

test('edit -> local approval -> edit resets approval -> discard remains NOT SENT with no Meta request path', async () => {
  const h = harness(); const conv = await h.inbound()
  let result = await h.actions.createManualInboxDraft(A, conv.id, 'Original local text', 1)
  let draft = result.data.drafts[0]
  result = await h.actions.changeInboxDraft(A, conv.id, draft.id, draft.revision, 'edit', 'Edited local text')
  draft = result.data.drafts[0]; assert.equal(draft.edited, true)
  result = await h.actions.changeInboxDraft(A, conv.id, draft.id, draft.revision, 'approve')
  assert.equal(result.ok, true); assert.equal(result.data.drafts[0].status, 'approved'); assert.match(result.notice, /NOT SENT/)
  assert.match(result.notice, /No Meta request/)
  draft = result.data.drafts[0]
  result = await h.actions.changeInboxDraft(A, conv.id, draft.id, draft.revision, 'edit', 'Approval must be renewed')
  draft = result.data.drafts[0]; assert.equal(draft.status, 'draft'); assert.equal(draft.approved_at, null)
  result = await h.actions.changeInboxDraft(A, conv.id, draft.id, draft.revision, 'discard')
  assert.equal(result.data.drafts[0].status, 'discarded')
  assert.equal(result.data.messages.length, 1)
  assert.equal(h.calls.some(call => /send|deliver|outbound/i.test(call.name)), false)
})

test('new inbound text prevents stale approval; closed threads reject approval; a fresh message reopens for human review', async () => {
  const h = harness(); const conv = await h.inbound()
  let result = await h.actions.createManualInboxDraft(A, conv.id, 'Reply to first question', 1); const draft = result.data.drafts[0]
  await h.inbound({ body: 'A second customer question' })
  assert.equal((await h.actions.changeInboxDraft(A, conv.id, draft.id, draft.revision, 'approve')).ok, false)
  result = await h.actions.readInbox(A, conv.id)
  await h.actions.manageInbox(A, conv.id, management(result.data, { status: 'closed' }))
  assert.equal((await h.actions.createManualInboxDraft(A, conv.id, 'No closed draft', 2)).ok, false)
  await h.inbound({ body: 'New text to closed conversation' })
  result = await h.actions.readInbox(A, conv.id)
  assert.equal(result.data.state.status, 'pending_human'); assert.equal(result.data.state.human_takeover, true)
})

test('fixed-window owner limits apply across requests; takeover during generation prevents persistence', async () => {
  const h = harness(); const conv = await h.inbound()
  for (let index = 0; index < 6; index++) {
    const result = await h.actions.generateInboxDraft(A, conv.id, 'demo'); assert.equal(result.ok, true)
    const draft = result.data.drafts[0]; await h.actions.changeInboxDraft(A, conv.id, draft.id, draft.revision, 'discard')
  }
  const limited = await h.actions.generateInboxDraft(A, conv.id, 'demo')
  assert.equal(limited.ok, false); assert.match(limited.error, /rate limit/)
  h.nextMinute(); h.race()
  assert.equal((await h.actions.generateInboxDraft(A, conv.id, 'demo')).ok, false)
  assert.equal(h.rows.whatsapp_reply_drafts.filter(d => d.status !== 'discarded').length, 0)
})

test('missing OpenAI configuration rejects before provider quota, while manual and demo remain available', async () => {
  const h = harness(); const conv = await h.inbound(); h.calls.length = 0
  assert.equal((await h.actions.generateInboxDraft(A, conv.id, 'openai', conv.revision)).ok, false)
  assert.equal(h.calls.some(call => call.name.startsWith('reserve_')), false)
  assert.equal((await h.actions.generateInboxDraft(A, conv.id, 'demo')).ok, true)
})

test('legacy Studio guard allows only pre-migration absence or open released inbox, and shares the new rate limit', async () => {
  const h = harness(); const conv = await h.inbound(); const guard = h.source('../src/utils/inbox/guard.ts').legacyInboxGenerationAllowed
  assert.equal(await guard(h.client, A, conv.id, conv.revision), true)
  assert.equal(h.calls.at(-1).name, 'reserve_whatsapp_inbox_generation')
  h.state(conv).human_takeover = true
  assert.equal(await guard(h.client, A, conv.id, conv.revision), false)
  const missing = (code, rpcCode = 'PGRST202') => ({ from() { const q = { select() { return q }, eq() { return q }, not() { return q }, order() { return q }, limit() { return Promise.resolve({ data: [{ position: 1 }], error: null }) }, async maybeSingle() { return { data: null, error: { code } } } }; return q }, async rpc() { return { data: null, error: { code: rpcCode } } } })
  assert.equal(await guard(missing('42P01'), A, conv.id, 0), true)
  assert.equal(await guard(missing('42501'), A, conv.id, 0), false)
  assert.equal(await guard(missing('PGRST205', '40001'), A, conv.id, 0), false, 'An installed RPC must gate even a missing table cache')
})

test('knowledge changes invalidate local approval; recorded draft references remain the original exact snapshot', async () => {
  const h = harness(); const conv = await h.inbound()
  const generated = await h.actions.generateInboxDraft(A, conv.id, 'demo'); const draft = generated.data.drafts[0]
  h.rows.business_products.find(row => row.workspace_id === A).price = 50000
  assert.equal((await h.actions.changeInboxDraft(A, conv.id, draft.id, draft.revision, 'approve')).ok, false)
  assert.equal((await h.actions.readInbox(A, conv.id)).data.drafts[0].knowledge_refs[0].data.price, 25000)
})

test('rates are per owner across workspaces; daily exhaustion blocks reservations as well', async () => {
  const h = harness('dual'); const a = await h.inbound(); const b = await h.inbound({ phone: '200' })
  for (let index = 0; index < 6; index++) {
    const [workspace, conv] = index % 2 ? [A, a] : [B, b]
    const result = await h.actions.generateInboxDraft(workspace, conv.id, 'demo'); assert.equal(result.ok, true)
    const draft = result.data.drafts[0]; await h.actions.changeInboxDraft(workspace, conv.id, draft.id, draft.revision, 'discard')
  }
  assert.equal((await h.actions.generateInboxDraft(A, a.id, 'demo')).ok, false)
  h.nextMinute(); h.quota.set(`${users.dual}:day`, 100)
  assert.equal((await h.actions.generateInboxDraft(A, a.id, 'demo')).ok, false)
})

test('invalid management/draft input cannot reach write RPCs', async () => {
  const h = harness(); const conv = await h.inbound(); h.calls.length = 0
  assert.equal((await h.actions.manageInbox(A, conv.id, { status: 'sent', human_takeover: false, revision: 0, assigned_user_id: null })).ok, false)
  for (const content of ['', 'a'.repeat(6001), 'bad\0text']) assert.equal((await h.actions.createManualInboxDraft(A, conv.id, content, 1)).ok, false)
  assert.equal((await h.actions.generateInboxDraft(A, conv.id, 'malicious-provider')).ok, false)
  assert.equal(h.calls.length, 0)
})

const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
test('inbox HTML escapes Arabic/English customer text and labels approvals NOT SENT without a send control', async () => {
  const h = harness(); const conv = await h.inbound({ body: 'مرحبا <script>attack()</script>' })
  const made = await h.actions.createManualInboxDraft(A, conv.id, '<img src="https://example.com/track"> Local only', 1)
  const draft = made.data.drafts[0]
  const approved = await h.actions.changeInboxDraft(A, conv.id, draft.id, draft.revision, 'approve')
  const { default: Inbox } = h.source('../src/app/dashboard/inbox/inbox.tsx')
  const html = renderToStaticMarkup(React.createElement(Inbox, { initial: await h.actions.loadInboxPanel(A), selected: approved.data }))
  assert.match(html, /Approved locally/); assert.match(html, /NOT SENT/); assert.match(html, /Sending disabled/)
  assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<script>|<img/)
  assert.match(html, /dir="auto"/); assert.match(html, /Human takeover/)
  assert.doesNotMatch(html, />Send reply<|META_ACCESS_TOKEN|SUPABASE_WEBHOOK_SECRET_KEY/)
})

function uiHarness(h, initial, selected) {
  const values = []; let cursor = 0; let task
  const hooks = { ...React, useState(value) { const index = cursor++; if (!(index in values)) values[index] = value; return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }] }, useTransition() { return [false, callback => { task = callback() }] } }
  const browser = { location: { href: `https://example.test/dashboard/inbox?workspace=${A}` }, history: { state: {}, replaceState(_state, _title, url) { browser.location.href = String(url) } } }
  const { default: Inbox } = loader({ react: hooks, 'next/link': { default: 'a' }, './actions': h.actions }, {}, { window: browser })('../src/app/dashboard/inbox/inbox.tsx')
  const render = () => { cursor = 0; return Inbox({ initial, selected }) }
  const elements = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(elements)]
  const button = label => elements(render()).find(node => node.type === 'button' && node.props.children === label)
  return { render, button,
    async click(label) { const node = button(label); assert.ok(node, label); assert.equal(!!node.props.disabled, false); node.props.onClick(); await task },
    change(label, value) { const wrapper = elements(render()).find(node => node.type === 'label' && [node.props.children].flat().some(child => typeof child === 'string' && child.trim() === label)); assert.ok(wrapper, label); elements(wrapper).find(node => ['input','textarea','select'].includes(node.type)).props.onChange({ target: { value, checked: value } }) },
    async submit(label) { const form = elements(render()).find(node => node.type === 'form' && elements(node).some(child => child.type === 'button' && child.props.children === label)); assert.ok(form, label); form.props.onSubmit({ preventDefault() {} }); await task },
  }
}

test('inbox UI saves manual text, approves only locally, and blocks generation immediately when takeover is selected', async () => {
  const h = harness(); const conv = await h.inbound()
  const ui = uiHarness(h, await h.actions.loadInboxPanel(A), (await h.actions.readInbox(A, conv.id)).data)
  ui.change('Human takeover — block AI generation', true)
  assert.equal(ui.button('Generate suggested draft').props.disabled, true)
  await ui.submit('Save management')
  assert.equal(h.state(conv).human_takeover, true)
  ui.change('Manual reply draft', 'Owner-controlled local answer')
  await ui.submit('Save manual draft')
  await ui.click('Approve locally · do not send')
  assert.equal(h.rows.whatsapp_reply_drafts[0].status, 'approved')
  assert.match(JSON.stringify(ui.render()), /NOT SENT/)
  assert.equal(h.calls.some(call => /send|deliver/i.test(call.name)), false)
})

test('inbox page fails closed for foreign selection and remounts state per workspace and conversation', async () => {
  const h = harness(); const conv = await h.inbound(); const b = await h.inbound({ phone: '200' })
  const { default: Page } = h.source('../src/app/dashboard/inbox/page.tsx')
  async function render(params) { const element = Page({ searchParams: Promise.resolve(params) }).props.children; return element.type(element.props) }
  const valid = await render({ workspace: A, conversation: conv.id })
  assert.equal(valid.key, `${A}:${conv.id}`)
  assert.match(JSON.stringify(await render({ workspace: A, conversation: b.id })), /Inbox unavailable/)
  assert.match(JSON.stringify(await render({ workspace: B })), /Inbox unavailable/)
})

const migration = readFileSync(new URL('../supabase/migrations/20261114040000_whatsapp_conversation_inbox.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '')
test('migration source keeps owner-only RLS, composite tenant FKs, private quota, and unsent-only draft states', () => {
  for (const table of ['whatsapp_inbox_state','whatsapp_reply_drafts']) assert.ok(migration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`))
  assert.match(migration, /FOREIGN KEY \(workspace_id, conversation_id\) REFERENCES public\.ai_conversations\(workspace_id, id\)/)
  assert.match(migration, /FOREIGN KEY \(workspace_id, assigned_user_id\) REFERENCES public\.workspace_members\(workspace_id, user_id\)/)
  assert.match(migration, /FOREIGN KEY \(workspace_id, source_message_id\) REFERENCES public\.whatsapp_inbound_messages\(workspace_id, id\)/)
  assert.match(migration, /status IN \('draft','approved','discarded'\)/)
  assert.doesNotMatch(migration, /'sent'|'delivered'|net\.http|http_post|pg_net|CREATE OR REPLACE|ALTER TABLE public\.ai_conversations/)
  assert.match(migration, /CREATE UNIQUE INDEX whatsapp_drafts_one_active_source/)
  assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role/)
})

test('migration source validates every mutation through the owner lock and prevents stale approval/knowledge forgery', () => {
  for (const name of ['manage_whatsapp_inbox','mark_whatsapp_inbox_read','reserve_whatsapp_inbox_generation','create_whatsapp_inbox_draft','update_whatsapp_inbox_draft']) {
    const body = migration.split(`CREATE FUNCTION public.${name}(`)[1].split('$function$;')[0]
    assert.match(body, /SECURITY DEFINER SET search_path = ''/)
    assert.match(body, /workspace_private\.lock_whatsapp_inbox\(p_workspace_id, p_conversation_id\)/)
    assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.${name}(`))
  }
  const helper = migration.split('CREATE FUNCTION workspace_private.lock_whatsapp_inbox')[1].split('$function$;')[0]
  assert.match(helper, /auth\.uid\(\) IS NULL OR NOT workspace_private\.is_workspace_owner/)
  assert.match(helper, /workspace_id = p_workspace_id AND id = p_conversation_id AND channel = 'whatsapp_test' FOR UPDATE/)
  assert.match(migration, /p_revision OR v_conversation.status <> 'open'/)
  assert.match(migration, /v_draft.source_position IS DISTINCT FROM workspace_private.latest_whatsapp_inbox_position/)
  assert.match(migration, /PERFORM workspace_private.whatsapp_inbox_references\(p_workspace_id, v_draft.knowledge_refs\)/)
  for (const table of ['business_products','business_faqs','business_information']) assert.match(migration, new RegExp(`FROM public\\.${table} WHERE workspace_id = p_workspace_id AND id =`))
})

test('migration source protects legacy generation, signed-source chronology and deterministic keyset pages', () => {
  assert.match(migration, /Human control blocks legacy generation/)
  assert.match(migration, /Verified inbound source required/)
  assert.match(migration, /ON public\.ai_messages/)
  assert.match(migration, /\(c.updated_at, c.id\) < \(p_before_at, p_before_id\)/)
  assert.match(migration, /ORDER BY c.updated_at DESC, c.id DESC LIMIT 31/)
  assert.match(migration, /\('minute',6\),\('day',100\)/)
  assert.match(migration, /date_trunc\(v_period, now\(\) AT TIME ZONE 'UTC'\)/)
  assert.match(migration, /last_read_position = greatest\(last_read_position, p_position\)/)
  assert.match(migration, /NEW.status = 'closed' THEN 'closed' ELSE 'pending_human'/)
})

test('a manual reply is never silently rebound to a newer unseen customer message', async () => {
  const h = harness(); const conv = await h.inbound()
  const observed = (await h.actions.readInbox(A, conv.id)).data.messages.at(-1).position
  await h.inbound({ body: 'New question while owner types' })
  const result = await h.actions.createManualInboxDraft(A, conv.id, 'Reply written for the old question', observed)
  assert.equal(result.ok, false); assert.match(result.error, /new customer text/)
  assert.equal(h.rows.whatsapp_reply_drafts.length, 0)
})

test('mocked OpenAI inbox path reserves both budgets and receives verified customer history plus Phase 6B references', async () => {
  const h = harness('a', true); const conv = await h.inbound({ body: 'Synthetic amber perfume' })
  await h.inbound({ body: 'وشكد سعره؟' })
  h.rows.ai_messages.push({ id: 'old-assistant', workspace_id: A, conversation_id: conv.id, position: 3, role: 'assistant', provider: 'demo', content: 'Unsent fabricated price 0', inbound_message_id: null })
  const result = await h.actions.generateInboxDraft(A, conv.id, 'openai', conv.revision)
  assert.equal(result.ok, true); assert.equal(h.providerCalls.length, 1)
  const args = h.providerCalls[0]
  assert.equal(args[3], 'openai'); assert.equal(args[2], 'وشكد سعره؟')
  assert.ok(args[1].every(message => message.role === 'user'))
  assert.equal(JSON.stringify(args[1]).includes('fabricated'), false)
  assert.equal(args[5][0].data.price, 25000)
  const order = h.calls.map(call => call.name)
  assert.ok(order.indexOf('reserve_whatsapp_inbox_generation') < order.indexOf('reserve_subscription_ai'))
  assert.ok(order.indexOf('reserve_subscription_ai') < order.indexOf('create_whatsapp_inbox_draft'))
})

test('unknown customer questions produce an explicitly simulated clarification without made-up business facts', async () => {
  const h = harness(); const conv = await h.inbound({ body: 'Unrelated astrophysics question' })
  const result = await h.actions.generateInboxDraft(A, conv.id, 'demo')
  assert.equal(result.ok, true)
  assert.equal(result.data.drafts[0].knowledge_refs.length, 0)
  assert.match(result.data.drafts[0].content, /simulated reply/)
  assert.match(result.data.drafts[0].content, /Missing business facts need confirmation/)
  assert.doesNotMatch(result.data.drafts[0].content, /25000|free delivery/)
})

test('direct mocked draft RPC rejects foreign inbound sources and foreign knowledge references in an authorized conversation', async () => {
  const h = harness('dual'); const a = await h.inbound(); const b = await h.inbound({ phone: '200' })
  const aSource = h.rows.ai_messages.find(m => m.conversation_id === a.id).inbound_message_id
  const bSource = h.rows.ai_messages.find(m => m.conversation_id === b.id).inbound_message_id
  const base = { p_workspace_id: A, p_conversation_id: a.id, p_source_id: aSource, p_position: 1, p_revision: a.revision, p_content: 'Local only', p_provider: 'manual', p_refs: [], p_context_count: 0 }
  assert.ok((await h.client.rpc('create_whatsapp_inbox_draft', { ...base, p_source_id: bSource })).error)
  const foreign = h.rows.business_products.find(row => row.workspace_id === B)
  const data = Object.fromEntries(['name','description','category','sku','price','currency','stock_status'].map(key => [key, foreign[key]]))
  assert.ok((await h.client.rpc('create_whatsapp_inbox_draft', { ...base, p_provider: 'demo', p_refs: [{ type: 'product', id: foreign.id, data }] })).error)
  assert.equal(h.rows.whatsapp_reply_drafts.length, 0)
})

test('stale draft revisions cannot overwrite a newer edit or approval', async () => {
  const h = harness(); const conv = await h.inbound()
  const created = await h.actions.createManualInboxDraft(A, conv.id, 'Initial text', 1); const draft = created.data.drafts[0]
  assert.equal((await h.actions.changeInboxDraft(A, conv.id, draft.id, draft.revision, 'edit', 'Newer text')).ok, true)
  assert.equal((await h.actions.changeInboxDraft(A, conv.id, draft.id, draft.revision, 'approve')).ok, false)
  assert.equal((await h.actions.changeInboxDraft(A, conv.id, draft.id, draft.revision, 'edit', 'Stale overwrite')).ok, false)
  assert.equal(h.rows.whatsapp_reply_drafts[0].content, 'Newer text')
})

test('legacy Studio demo can still use enabled editor settings rather than requiring saved preview settings', async () => {
  const h = harness(); const conv = await h.inbound()
  h.rows.ai_agent_settings.find(row => row.workspace_id === A).enabled = false
  const agent = h.source('../src/app/dashboard/agent/actions.ts')
  const result = await agent.previewReply(A, conv.id, '', 'demo', settings, [])
  assert.ok(h.calls.some(call => call.name === 'reserve_whatsapp_inbox_generation'))
  assert.ok(h.calls.some(call => call.name === 'save_ai_turn'))
  assert.equal(result.ok, true)
  assert.equal(result.data.messages.at(-1).provider, 'demo')
})

test('provider inbox retry for a stale or missing observed revision never reserves or calls provider', async () => {
 for (const missing of [false, true]) {
  const h = harness('a', true); const conv = await h.inbound()
  const oldRevision = conv.revision
  await h.inbound({ body: 'New inbound after the original request' })
  const result = await h.actions.generateInboxDraft(A, conv.id, 'openai', missing ? undefined : oldRevision)
  assert.equal(result.ok, false)
  assert.equal(h.providerCalls.length, 0)
  assert.equal(h.calls.some(c => c.name === 'reserve_subscription_ai'), false)
 }
})

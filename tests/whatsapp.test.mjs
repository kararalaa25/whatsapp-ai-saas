import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const appSecret = 'synthetic-app-secret-for-unit-tests'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const foreignId = '22222222-2222-4222-8222-222222222222'

function load(path, dependencies = {}, env = {}) {
  const context = {
    exports: {}, Buffer, Uint8Array, TextDecoder, Request, Response, URL, Set,
    process: { env },
    require(name) {
      if (name === 'server-only') return {}
      if (name in dependencies) return dependencies[name]
      return require(name)
    },
  }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context)
  return context.exports
}

const webhook = load('../src/utils/whatsapp/webhook.ts')
function event(id = 'wamid.synthetic') {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '200', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: '100' },
      messages: [{ id, timestamp: '1700000000', type: 'text', text: { body: 'Synthetic test only' } }],
      workspace_id: foreignId,
    } }] }],
  }
}
const signature = (raw) => 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex')

function receiver({ storageFailure = false } = {}) {
  const rows = new Map()
  const calls = []
  let initialized = 0
  const ingestion = load('../src/utils/whatsapp/ingestion.ts', {
    '@supabase/supabase-js': { createClient(url, key, options) {
      initialized++
      assert.equal(key, 'synthetic-server-credential')
      assert.equal(options.auth.persistSession, false)
      return { async rpc(name, args) {
        calls.push({ name, args })
        assert.equal(name, 'ingest_whatsapp_ai_test_message')
        assert.equal(Object.keys(args).length, 7)
        assert.equal('workspace_id' in args, false)
        if (storageFailure) return { data: null, error: { message: 'internal' } }
        // Mock the administrator-controlled database lookup and UNIQUE constraint.
        // Actual PostgreSQL/RLS and concurrent uniqueness need live verification.
        if (args.p_phone_number_id !== '100' || args.p_waba_id !== '200') return { data: 'ignored', error: null }
        if (rows.has(args.p_meta_message_id)) return { data: 'duplicate', error: null }
        rows.set(args.p_meta_message_id, { ...args, workspace_id: workspaceId })
        return { data: 'inserted', error: null }
      } }
    } },
  }, { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', SUPABASE_WEBHOOK_SECRET_KEY: 'synthetic-server-credential' })
  const route = load('../src/app/api/webhooks/whatsapp/route.ts', {
    '@/utils/whatsapp/ingestion': ingestion,
    '@/utils/whatsapp/webhook': webhook,
  }, { META_APP_SECRET: appSecret, META_WEBHOOK_VERIFY_TOKEN: 'synthetic-verify', META_TEST_PHONE_NUMBER_IDS: '100' })
  return { ...route, rows, calls, initialized: () => initialized }
}

function request(raw, header = signature(raw)) {
  return new Request('https://example.invalid/api/webhooks/whatsapp', {
    method: 'POST', headers: { 'x-hub-signature-256': header }, body: raw,
  })
}

test('HMAC uses exact raw bytes and rejects missing, malformed and modified signatures', () => {
  const raw = Buffer.from(JSON.stringify(event()))
  assert.equal(webhook.validSignature(raw, signature(raw), appSecret), true)
  for (const header of [null, '', 'sha256=x', 'sha1=' + '0'.repeat(64), 'sha256=' + '0'.repeat(64)]) {
    assert.equal(webhook.validSignature(raw, header, appSecret), false)
  }
  assert.equal(webhook.validSignature(Buffer.concat([raw, Buffer.from(' ')]), signature(raw), appSecret), false)
})

test('GET verification returns the exact challenge only for valid unique parameters', async () => {
  const route = receiver()
  const base = 'https://example.invalid/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=12345'
  const response = await route.GET(new Request(base))
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '12345')
  assert.match(response.headers.get('cache-control'), /no-store/)
  assert.equal((await route.GET(new Request(base + '&hub.challenge=12345'))).status, 403)
  assert.equal((await route.GET(new Request(base.replace('synthetic-verify', 'wrong')))).status, 403)
})

test('invalid signatures are rejected before JSON parsing or database initialization', async () => {
  const route = receiver()
  assert.equal((await route.POST(request('{not-json', 'sha256=' + '0'.repeat(64)))).status, 403)
  assert.equal(route.initialized(), 0)
  assert.equal(route.calls.length, 0)
})

test('malformed signed events fail without writes, including mixed valid/invalid batches', async () => {
  const route = receiver()
  const missingMetadata = event()
  delete missingMetadata.entry[0].changes[0].value.metadata
  const missingText = event()
  delete missingText.entry[0].changes[0].value.messages[0].text
  const mixed = event()
  mixed.entry[0].changes[0].value.messages.push({ id: 'bad', type: 'text' })
  for (const raw of ['{invalid', JSON.stringify({}), JSON.stringify(missingMetadata), JSON.stringify(missingText), JSON.stringify(mixed)]) {
    assert.equal((await route.POST(request(raw))).status, 400)
  }
  assert.equal(route.calls.length, 0)
})

test('repeated/concurrent deliveries preserve one message via duplicate-safe RPC contract', async () => {
  const route = receiver()
  const raw = JSON.stringify(event())
  const responses = await Promise.all([route.POST(request(raw)), route.POST(request(raw)), route.POST(request(raw))])
  assert.ok(responses.every((response) => response.status === 200))
  assert.equal(route.calls.length, 3)
  assert.equal(route.rows.size, 1)
  assert.equal(route.rows.get('wamid.synthetic').workspace_id, workspaceId)
})

test('payload workspace IDs are ignored; unknown test IDs and mismatched WABAs never route', async () => {
  const route = receiver()
  const unknown = event()
  unknown.entry[0].changes[0].value.metadata.phone_number_id = '999'
  assert.equal((await route.POST(request(JSON.stringify(unknown)))).status, 200)
  assert.equal(route.initialized(), 0)
  const mismatch = event()
  mismatch.entry[0].id = '999'
  assert.equal((await route.POST(request(JSON.stringify(mismatch)))).status, 200)
  assert.equal(route.rows.size, 0)
  assert.equal((await route.POST(request(JSON.stringify(event())))).status, 200)
  assert.equal(route.rows.get('wamid.synthetic').workspace_id, workspaceId)
})

test('storage failure requests retry without revealing internal errors', async () => {
  const route = receiver({ storageFailure: true })
  const response = await route.POST(request(JSON.stringify(event())))
  assert.equal(response.status, 503)
  assert.equal(await response.text(), 'Temporarily unavailable')
})

test('status-only events are acknowledged without persistence; oversized bodies rejected', async () => {
  const route = receiver()
  const status = event()
  delete status.entry[0].changes[0].value.messages
  status.entry[0].changes[0].value.statuses = [{ status: 'delivered' }]
  assert.equal((await route.POST(request(JSON.stringify(status)))).status, 200)
  assert.equal(route.initialized(), 0)
  assert.equal((await route.POST(request('x'.repeat(webhook.MAX_WEBHOOK_BYTES + 1)))).status, 413)
})

test('media and payload workspace IDs are stripped; test sender is normalized for customer routing', () => {
  const payload = event()
  payload.entry[0].changes[0].value.messages[0] = { id: 'wamid.media', timestamp: '1700000000', type: 'image', image: { id: 'private-media' }, from: '123456789' }
  const [message] = webhook.parseMessages(JSON.stringify(payload))
  assert.equal(message.body, null)
  assert.equal(message.messageType, 'unsupported')
  assert.equal('from' in message, false)
  assert.equal(message.senderId, '123456789')
  assert.equal('image' in message, false)
  assert.equal('workspace_id' in message, false)
})

test('NUL and overlong text are rejected before reaching PostgreSQL', () => {
  for (const body of ['synthetic\u0000text', 'x'.repeat(4097)]) {
    const payload = event()
    payload.entry[0].changes[0].value.messages[0].text.body = body
    assert.throws(() => webhook.parseMessages(JSON.stringify(payload)))
  }
})

test('missing server webhook configuration fails closed', async () => {
  const route = load('../src/app/api/webhooks/whatsapp/route.ts', {
    '@/utils/whatsapp/ingestion': { createIngestor() { assert.fail('Must not initialize storage') } },
    '@/utils/whatsapp/webhook': webhook,
  })
  assert.equal((await route.GET(new Request('https://example.invalid'))).status, 503)
  assert.equal((await route.POST(request(JSON.stringify(event())))).status, 503)
})

test('authorized WhatsApp reads explicitly filter both tables to the verified workspace', async () => {
  const workspace = load('../src/utils/whatsapp/workspace.ts', {
    '@/utils/workspaces/access': { loadDashboardState: async () => ({ status: 'ready', selected: { id: workspaceId, name: 'Test Shop' } }) },
  })
  const tables = []
  const supabase = { from(table) {
    tables.push(table)
    const query = {
      select() { return query },
      eq(column, id) { assert.equal(column, 'workspace_id'); assert.equal(id, workspaceId); return query },
      order() { return table === 'whatsapp_connections' ? Promise.resolve({ data: [], error: null }) : query },
      limit(count) { assert.equal(count, 50); return Promise.resolve({ data: [], error: null }) },
    }
    return query
  } }
  const state = await workspace.loadWhatsAppWorkspace(supabase, workspaceId)
  assert.equal(state.status, 'ready')
  assert.deepEqual(tables.sort(), ['whatsapp_connections', 'whatsapp_inbound_messages'])
  assert.equal(state.messages.length, 0)
})

test('WhatsApp dashboard refuses unauthorized workspace BEFORE querying WhatsApp tables', async () => {
  const access = load('../src/utils/workspaces/access.ts')
  const workspace = load('../src/utils/whatsapp/workspace.ts', { '@/utils/workspaces/access': access })
  const query = {
    select() { return query },
    eq(column, id) { assert.equal(column, 'workspace_members.user_id'); assert.equal(id, 'user-a'); return query },
    order(column) { return column === 'created_at' ? query : Promise.resolve({ data: [{ id: workspaceId, name: 'Test Shop' }], error: null }) },
  }
  const supabase = {
    auth: { getClaims: async () => ({ data: { claims: { sub: 'user-a' } }, error: null }) },
    from(table) { assert.equal(table, 'workspaces', 'Unauthorized request must not read WhatsApp tables'); return query },
  }
  const state = await workspace.loadWhatsAppWorkspace(supabase, foreignId)
  assert.equal(state.status, 'unauthorized')
  assert.equal('messages' in state, false)
})

test('migration statically retains tenant FK, RLS, RPC-only webhook writes and atomic deduplication', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261114010000_whatsapp_test_foundation.sql', import.meta.url), 'utf8')
  assert.match(sql, /FOREIGN KEY \(workspace_id, connection_id\)/)
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length, 2)
  assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(sql, /TO service_role;/)
  assert.match(sql, /ON CONFLICT \(meta_message_id\) DO NOTHING/)
  assert.match(sql, /c\.waba_id = p_waba_id/)
  assert.match(sql, /c\.is_test = true AND c\.status = 'active'/)
  assert.doesNotMatch(sql, /FOR (INSERT|UPDATE|DELETE) TO authenticated/)
})

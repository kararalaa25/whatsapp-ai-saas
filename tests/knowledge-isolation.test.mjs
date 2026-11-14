import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(path, dependencies = {}) {
  const context = { exports: {}, require(name) {
    if (name in dependencies) return dependencies[name]
    if (name === 'server-only') return {}
    return require(name)
  } }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return context.exports
}
const schema = load('../src/utils/knowledge/schema.ts')
const workspaceAccess = load('../src/utils/workspaces/access.ts')
const ownerAccess = load('../src/utils/ai/access.ts', { '@/utils/workspaces/access': workspaceAccess })
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const entities = [
  { kind: 'product', table: 'business_products', collection: 'products',
    ids: ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'],
    data: { ...schema.emptyProduct, name: 'Synthetic amber perfume', sku: 'TEST-AMBER', price: 25000 },
    edit: { name: 'Unauthorized replacement', price: 0 }, archive: { active: false } },
  { kind: 'faq', table: 'business_faqs', collection: 'faqs',
    ids: ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'],
    data: { question: 'Synthetic sample question?', answer: 'Synthetic confirmed answer', active: true },
    edit: { answer: 'Unauthorized replacement' }, archive: { active: false } },
  { kind: 'information', table: 'business_information', collection: 'information',
    ids: ['77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888'],
    data: { topic: 'delivery', content: 'Synthetic confirmed delivery policy' },
    edit: { content: 'Unauthorized replacement' } },
]

// Only transport and persistent storage are mocked. The actual workspace loader,
// owner guard, knowledge reader, retrieval layer and server actions run together.
// The RPC mock MODELS the inspected SQL contract; it does not execute PostgreSQL
// or prove that the connected database has the expected function/policy/grants.
function harness(actor = 'owner-a') {
  const memberships = [
    // Respect the foundation's unique-owner-per-workspace constraint.
    ...(actor === 'dual-owner'
      ? [['dual-owner', A, 'owner'], ['dual-owner', B, 'owner']]
      : [['owner-a', A, 'owner'], ['owner-b', B, 'owner']]),
    ['member', A, 'member'], ['member', B, 'member'],
    ['admin', A, 'admin'], ['admin', B, 'admin'],
  ].map(([user_id, workspace_id, role]) => ({ user_id, workspace_id, role }))
  const rows = Object.fromEntries(entities.map(entity => [entity.table, [A, B].map((workspace_id, index) => ({ ...entity.data, id: entity.ids[index], workspace_id }))]))
  const reads = []; const rpcCalls = []; const invalidations = []
  const owns = workspace => memberships.some(m => m.user_id === actor && m.workspace_id === workspace && m.role === 'owner')
  const client = {
    auth: { async getClaims() {
      return actor === null ? { data: null, error: { code: 'missing_session' } } : {
        data: { claims: { sub: actor, user_metadata: { role: 'owner', workspace_id: A } } }, error: null,
      }
    } },
    from(table) {
      const filters = []; const read = { table, filters }; reads.push(read)
      let columns
      const execute = () => {
        let data
        if (table === 'workspaces') {
          const user = filters.find(([key]) => key === 'workspace_members.user_id')?.[1]
          data = [A, B].filter(id => memberships.some(m => m.workspace_id === id && m.user_id === user)).map(id => ({ id, name: `Synthetic ${id === A ? 'A' : 'B'}` }))
        } else if (table === 'workspace_members') {
          data = memberships.filter(row => filters.every(([key, value]) => row[key] === value))
        } else {
          // Deliberately no simulated RLS here: both tenants' rows are available.
          // Read tests must succeed because production code applies its filter.
          data = rows[table].filter(row => filters.every(([key, value]) => row[key] === value))
        }
        return { data: data.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => columns.split(',').map(column => column.trim()).includes(key)))), error: null }
      }
      const query = {
        select(value) { columns = value; return query },
        eq(key, value) { filters.push([key, value]); return query },
        order() { return query },
        async limit(max) { const result = execute(); return { ...result, data: result.data.slice(0, max) } },
        async maybeSingle() { const result = execute(); return { ...result, data: result.data[0] ?? null } },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject) },
      }
      return query
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args: structuredClone(args) })
      const denied = { data: null, error: { code: '42501', message: 'Not authorized or unavailable' } }
      if (!owns(args.p_workspace_id)) return denied
      const entity = entities.find(entity => entity.kind === args.p_kind)
      if (!entity) return denied
      const index = rows[entity.table].findIndex(row => row.workspace_id === args.p_workspace_id && row.id === args.p_id)
      if (index < 0) return denied
      if (name === 'save_business_knowledge') {
        rows[entity.table][index] = { ...rows[entity.table][index], ...args.p_data }
        return { data: args.p_id, error: null }
      }
      if (name === 'delete_business_knowledge') {
        rows[entity.table].splice(index, 1)
        return { data: null, error: null }
      }
      throw Error(`Unexpected RPC ${name}`)
    },
  }
  const access = load('../src/utils/knowledge/access.ts', { './schema': schema, '@/utils/ai/access': ownerAccess })
  const actions = load('../src/app/dashboard/knowledge/actions.ts', {
    'next/cache': { revalidatePath(path) { invalidations.push(path) } },
    '@/utils/supabase/server': { createClient: async () => client }, '@/utils/ai/access': ownerAccess,
    '@/utils/knowledge/access': access, '@/utils/knowledge/schema': schema,
  })
  const retrieval = load('../src/utils/knowledge/retrieval.ts', { './schema': schema, './access': access })
  return { rows, memberships, reads, rpcCalls, invalidations, client, access, actions, retrieval,
    snapshot() { return structuredClone(rows) } }
}

for (const entity of entities) {
  test(`${entity.kind}: owner A cannot read or mutate using unauthorized workspace B`, async () => {
    const h = harness(); const before = h.snapshot()
    await assert.rejects(h.actions.loadKnowledgePanel(B))
    await assert.rejects(h.access.readKnowledge(h.client, B))
    assert.equal((await h.actions.saveKnowledge(B, entity.kind, entity.ids[0], { ...entity.data, ...entity.edit })).ok, false)
    if (entity.archive) assert.equal((await h.actions.saveKnowledge(B, entity.kind, entity.ids[0], { ...entity.data, ...entity.archive })).ok, false)
    assert.equal((await h.actions.deleteKnowledge(B, entity.kind, entity.ids[0])).ok, false)
    assert.equal((await h.retrieval.retrieveKnowledge(h.client, B, 'Synthetic perfume sample delivery')).available, false)
    assert.equal(h.reads.some(read => read.table.startsWith('business_')), false)
    assert.equal(h.rpcCalls.length, 0); assert.equal(h.invalidations.length, 0)
    assert.deepEqual(h.rows, before)
  })

  test(`${entity.kind}: authorized workspace reads never expose another tenant's stored IDs`, async () => {
    const h = harness('dual-owner')
    for (const [workspace, ownId, foreignId] of [[A, entity.ids[0], entity.ids[1]], [B, entity.ids[1], entity.ids[0]]]) {
      const panel = await h.actions.loadKnowledgePanel(workspace)
      assert.deepEqual(Array.from(panel[entity.collection], row => row.id), [ownId])
      assert.equal(JSON.stringify(panel).includes(foreignId), false)
      const knowledge = await h.retrieval.retrieveKnowledge(h.client, workspace, 'Synthetic perfume sample delivery')
      assert.equal(knowledge.available, true)
      assert.ok(knowledge.entries.some(entry => entry.id === ownId))
      assert.equal(knowledge.entries.some(entry => entry.id === foreignId), false)
    }
    const dataReads = h.reads.filter(read => read.table.startsWith('business_'))
    assert.ok(dataReads.length > 0)
    for (const read of dataReads) assert.equal(read.filters.filter(([column]) => column === 'workspace_id').length, 1)
  })

  test(`${entity.kind}: authorized owner B cannot ${entity.archive ? 'update/archive/delete' : 'update/delete'} existing A ID under B (mock RPC contract)`, async () => {
    const h = harness('owner-b'); const before = h.snapshot()
    const writes = [{ ...entity.data, ...entity.edit }, ...(entity.archive ? [{ ...entity.data, ...entity.archive }] : [])]
    for (const data of writes) assert.equal((await h.actions.saveKnowledge(B, entity.kind, entity.ids[0], data)).ok, false)
    assert.equal((await h.actions.deleteKnowledge(B, entity.kind, entity.ids[0])).ok, false)
    assert.equal(h.rpcCalls.length, writes.length + 1)
    for (const call of h.rpcCalls) {
      assert.equal(call.args.p_workspace_id, B); assert.equal(call.args.p_id, entity.ids[0]); assert.equal(call.args.p_kind, entity.kind)
    }
    assert.equal(h.invalidations.length, 0)
    assert.deepEqual(h.rows, before, 'Both tenants must remain byte-for-byte unchanged')
  })

  test(`${entity.kind}: dual owner cannot mix workspace/item IDs in either direction (mock RPC contract)`, async () => {
    const h = harness('dual-owner'); const before = h.snapshot()
    for (const [workspace, foreignId] of [[A, entity.ids[1]], [B, entity.ids[0]]]) {
      assert.equal((await h.actions.saveKnowledge(workspace, entity.kind, foreignId, { ...entity.data, ...entity.edit })).ok, false)
      if (entity.archive) assert.equal((await h.actions.saveKnowledge(workspace, entity.kind, foreignId, { ...entity.data, ...entity.archive })).ok, false)
      assert.equal((await h.actions.deleteKnowledge(workspace, entity.kind, foreignId)).ok, false)
    }
    assert.deepEqual(h.rows, before)
    assert.equal(h.invalidations.length, 0)
  })

  test(`${entity.kind}: correct owner/workspace/item tuple still supports editing and deletion`, async () => {
    const h = harness('owner-b'); const originalA = structuredClone(h.rows[entity.table][0])
    assert.equal((await h.actions.saveKnowledge(B, entity.kind, entity.ids[1], { ...entity.data, ...entity.edit })).ok, true)
    if (entity.archive) {
      assert.equal((await h.actions.saveKnowledge(B, entity.kind, entity.ids[1], { ...entity.data, ...entity.archive })).ok, true)
      assert.equal(h.rows[entity.table][1].active, false)
    }
    assert.equal((await h.actions.deleteKnowledge(B, entity.kind, entity.ids[1])).ok, true)
    assert.deepEqual(h.rows[entity.table], [originalA])
    assert.ok(h.invalidations.length > 0)
  })
}

for (const actor of ['member', 'admin', null]) {
  test(`${actor ?? 'unauthenticated'} cannot read, create, update, archive or delete owner-only knowledge`, async () => {
    const h = harness(actor); const before = h.snapshot()
    for (const workspace of [A, B]) {
      await assert.rejects(h.actions.loadKnowledgePanel(workspace))
      await assert.rejects(h.access.readKnowledge(h.client, workspace))
      for (const entity of entities) {
        const id = entity.ids[workspace === A ? 0 : 1]
        assert.equal((await h.actions.saveKnowledge(workspace, entity.kind, null, entity.data)).ok, false)
        assert.equal((await h.actions.saveKnowledge(workspace, entity.kind, id, { ...entity.data, ...entity.edit })).ok, false)
        if (entity.archive) assert.equal((await h.actions.saveKnowledge(workspace, entity.kind, id, { ...entity.data, ...entity.archive })).ok, false)
        assert.equal((await h.actions.deleteKnowledge(workspace, entity.kind, id)).ok, false)
      }
    }
    assert.equal(h.reads.some(read => read.table.startsWith('business_')), false)
    assert.equal(h.rpcCalls.length, 0); assert.equal(h.invalidations.length, 0)
    assert.deepEqual(h.rows, before)
    if (actor) {
      const roleReads = h.reads.filter(read => read.table === 'workspace_members')
      assert.ok(roleReads.length > 0)
      for (const read of roleReads) {
        assert.ok(read.filters.some(([key, value]) => key === 'user_id' && value === actor))
        assert.ok(read.filters.some(([key, value]) => key === 'role' && value === 'owner'))
      }
    }
  })
}

test('owner downgrade is honored by the next knowledge action, without reusing earlier owner access', async () => {
  const h = harness()
  assert.equal((await h.actions.loadKnowledgePanel(A)).products.length, 1)
  h.memberships.find(row => row.user_id === 'owner-a' && row.workspace_id === A).role = 'member'
  h.reads.length = 0
  const before = h.snapshot()
  for (const entity of entities) {
    assert.equal((await h.actions.saveKnowledge(A, entity.kind, entity.ids[0], entity.data)).ok, false)
    assert.equal((await h.actions.deleteKnowledge(A, entity.kind, entity.ids[0])).ok, false)
  }
  await assert.rejects(h.actions.loadKnowledgePanel(A))
  assert.equal(h.reads.some(read => read.table.startsWith('business_')), false)
  assert.equal(h.rpcCalls.length, 0)
  assert.deepEqual(h.rows, before)
})

// Static source guards are a distinct evidence level from mocked behavior.
// They deliberately inspect each SQL branch instead of only counting clauses.
test('migration source: each knowledge table has only owner SELECT RLS and no client DML grants', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261114030000_business_knowledge_catalog.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '')
  for (const { table } of entities) {
    assert.ok(sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`))
    assert.ok(sql.includes(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated, service_role;`))
    assert.ok(sql.includes(`GRANT SELECT ON TABLE public.${table} TO authenticated;`))
    const policies = sql.match(new RegExp(`CREATE POLICY [^;]+ ON public\\.${table} [^;]+;`, 'g')) ?? []
    assert.equal(policies.length, 1)
    assert.match(policies[0], /FOR SELECT TO authenticated\s+USING \(workspace_private\.is_workspace_owner\(workspace_id\)\)/)
  }
  assert.doesNotMatch(sql, /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE)\b/i)
})

test('migration source: both RPCs check auth/owner before mutations and each branch matches workspace AND ID', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261114030000_business_knowledge_catalog.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '')
  for (const [name, operation, signature] of [
    ['save_business_knowledge', 'UPDATE', 'uuid,text,uuid,jsonb'], ['delete_business_knowledge', 'DELETE FROM', 'uuid,text,uuid'],
  ]) {
    const body = sql.split(`CREATE FUNCTION public.${name}(`)[1].split('$function$;')[0]
    assert.match(body, /SECURITY DEFINER SET search_path = ''/)
    assert.match(body, /IF auth\.uid\(\) IS NULL OR NOT workspace_private\.is_workspace_owner\(p_workspace_id\) THEN\s+RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/)
    assert.ok(body.indexOf('is_workspace_owner(p_workspace_id)') < body.search(/(?:INSERT INTO|UPDATE|DELETE FROM) public\./))
    for (const { table } of entities) {
      const mutation = body.match(new RegExp(`${operation} public\\.${table}\\b[^;]+;`))
      assert.ok(mutation, table)
      assert.match(mutation[0], /WHERE workspace_id = p_workspace_id AND id = p_id/)
    }
    assert.ok(sql.includes(`ALTER FUNCTION public.${name}(${signature}) OWNER TO postgres;`))
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.save_business_knowledge\(uuid,text,uuid,jsonb\), public\.delete_business_knowledge\(uuid,text,uuid\)\s+FROM PUBLIC, anon, authenticated, service_role;/)
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.save_business_knowledge\(uuid,text,uuid,jsonb\), public\.delete_business_knowledge\(uuid,text,uuid\) TO authenticated;/)
  }
  const helper = readFileSync(new URL('../supabase/migrations/20261114020000_ai_agent_playground.sql', import.meta.url), 'utf8').split('CREATE FUNCTION workspace_private.is_workspace_owner')[1].split('$function$;')[0]
  assert.match(helper, /m\.workspace_id = p_workspace_id AND m\.user_id = \(SELECT auth\.uid\(\)\)\s+AND m\.role = 'owner'/)
  assert.doesNotMatch(helper, /user_metadata/)
})

for (const entity of entities) {
  test(`${entity.kind}: payload cannot override tenant, identity or item ID before RPC invocation`, async () => {
    const h = harness(); const before = h.snapshot()
    for (const injection of [{ workspace_id: B }, { owner_id: 'owner-a' }, { user_id: 'owner-b' }, { id: entity.ids[1] }]) {
      assert.equal((await h.actions.saveKnowledge(A, entity.kind, entity.ids[0], { ...entity.data, ...injection })).ok, false)
    }
    assert.equal(h.rpcCalls.length, 0)
    assert.deepEqual(h.rows, before)
  })
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Transpile the actual server helper using the installed TypeScript dependency.
// No network, real credentials, database writes, or generated test files.
const source = readFileSync(new URL('../src/utils/workspaces/access.ts', import.meta.url), 'utf8')
const context = {
  exports: {},
  require(name) {
    assert.equal(name, 'server-only')
    return {}
  },
}
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context)
const { loadDashboardState } = context.exports

const first = { id: '11111111-1111-4111-8111-111111111111', name: 'Perfume Shop' }
const second = { id: '22222222-2222-4222-8222-222222222222', name: 'Clothing Store' }
const foreignId = '33333333-3333-4333-8333-333333333333'

function client(rows, { authError = false, queryError = false, authThrows = false, queryThrows = false } = {}) {
  let queried = false
  const query = {
    select(columns) {
      assert.equal(columns, 'id, name, workspace_members!inner(user_id)')
      return query
    },
    eq(column, value) {
      assert.equal(column, 'workspace_members.user_id')
      assert.equal(value, 'current-user')
      return query
    },
    order(column) {
      if (column === 'created_at') return query
      assert.equal(column, 'id')
      if (queryThrows) throw new Error('internal query failure')
      return Promise.resolve({ data: rows, error: queryError ? { message: 'internal' } : null })
    },
  }
  return {
    auth: { async getClaims() {
      if (authThrows) throw new Error('internal auth failure')
      return { data: authError ? null : { claims: { sub: 'current-user' } }, error: authError ? {} : null }
    } },
    from(table) {
      queried = true
      assert.equal(table, 'workspaces')
      return query
    },
    wasQueried: () => queried,
  }
}

test('zero accessible workspaces requires onboarding', async () => {
  assert.equal((await loadDashboardState(client([]), undefined)).status, 'onboarding')
})

test('one workspace is selected by default', async () => {
  const state = await loadDashboardState(client([first]), undefined)
  assert.equal(state.status, 'ready')
  assert.equal(state.selected.id, first.id)
})

test('multiple workspaces default deterministically and can switch', async () => {
  const state = await loadDashboardState(client([first, second]), undefined)
  assert.equal(state.selected.id, first.id)
  const switched = await loadDashboardState(client([first, second]), second.id)
  assert.equal(switched.status, 'ready')
  assert.equal(switched.selected.name, second.name)
  assert.equal(switched.workspaces.length, 2)
})

test('foreign workspace cannot be selected and exposes no selected data', async () => {
  const state = await loadDashboardState(client([first]), foreignId)
  assert.equal(state.status, 'unauthorized')
  assert.equal('selected' in state, false)
  assert.equal(state.workspaces.length, 1)
})

test('malformed, empty, duplicated, and URL-shaped selections are rejected', async () => {
  for (const selection of ['', 'not-a-uuid', [first.id, second.id], 'https://example.invalid']) {
    const state = await loadDashboardState(client([first]), selection)
    assert.equal(state.status, 'unauthorized')
    assert.equal('selected' in state, false)
  }
})

test('membership revocation is honored on the next request', async () => {
  assert.equal((await loadDashboardState(client([first, second]), second.id)).status, 'ready')
  assert.equal((await loadDashboardState(client([first]), second.id)).status, 'unauthorized')
})

test('auth failures never query workspace data', async () => {
  for (const options of [{ authError: true }, { authThrows: true }]) {
    const supabase = client([first], options)
    assert.equal((await loadDashboardState(supabase, first.id)).status, 'login')
    assert.equal(supabase.wasQueried(), false)
  }
})

test('query failures are errors, not empty-workspace onboarding', async () => {
  for (const options of [{ queryError: true }, { queryThrows: true }]) {
    const state = await loadDashboardState(client([], options), first.id)
    assert.equal(state.status, 'error')
    assert.equal('selected' in state, false)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration, runSmoke } from '../verification/integration/read-only-smoke.mjs'

const own = '00000000-0000-4000-8000-000000000001'
const foreign = '00000000-0000-4000-8000-000000000002'
const env = { WASLA_DEV_PROJECT_REF: 'a'.repeat(20), WASLA_DEV_TARGET_CONFIRMED: 'a'.repeat(20),
  NEXT_PUBLIC_SUPABASE_URL: `https://${'a'.repeat(20)}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  WASLA_SMOKE_ACCESS_TOKEN: 'fixture.user.jwt', WASLA_SMOKE_OWN_WORKSPACE: own, WASLA_SMOKE_FOREIGN_WORKSPACE: foreign }
const response = (status, data) => ({ status, async json() { return data } })
function fixture(url, options) {
  assert.equal(options.method, 'GET')
  assert.equal(options.redirect, 'error')
  assert.equal(new URL(url).origin, env.NEXT_PUBLIC_SUPABASE_URL)
  assert.ok(!url.includes('/rpc/'))
  if (options.headers['Accept-Profile'] === 'workspace_private') return response(406, { code: 'PGRST106' })
  if (url.includes('/auth/v1/user')) return response(200, { id: own })
  if (url.includes('/wasla_subscription_plans?')) return response(200, ['business','pro','starter','trial'].map(id => ({ id, provisional: true })))
  if (!options.headers.Authorization || url.includes(foreign)) return response(200, [])
  if (url.includes('/workspaces?')) return response(200, [{ id: own }])
  return response(200, [{ workspace_id: own }])
}
test('read-only smoke refuses unconfirmed targets and privileged keys before networking', async () => {
  for (const patch of [{ WASLA_DEV_TARGET_CONFIRMED: '' }, { NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: `${env.NEXT_PUBLIC_SUPABASE_URL}/` }, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_fixture' },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'legacy.jwt.key' }, { WASLA_SMOKE_FOREIGN_WORKSPACE: own }, { WASLA_SMOKE_ROLE: 'service_role' }]) {
    await assert.rejects(runSmoke({ ...env, ...patch }, () => assert.fail('must not send a request')))
  }
  assert.equal(configuration(env).origin, env.NEXT_PUBLIC_SUPABASE_URL)
})
test('owner smoke uses GET only and validates real response contracts using fixtures', async () => {
  const results = await runSmoke(env, fixture)
  assert.ok(results.length > 10)
  assert.ok(results.every(r => r.status === 'PASS'))
})
test('empty own fixtures and absent JWT are not counted as successful integration', async () => {
  const results = await runSmoke(env, (url, options) => url.includes('/whatsapp_reply_drafts?') ? response(200, []) : fixture(url, options))
  assert.equal(results.find(r => r.name === 'whatsapp_reply_drafts: own fixture visible').status, 'NOT TESTED')
  const anonymous = await runSmoke({ ...env, WASLA_SMOKE_ACCESS_TOKEN: undefined }, fixture)
  assert.equal(anonymous.at(-1).status, 'NOT TESTED')
})
test('member owner-data leaks and foreign workspace leaks fail checks', async () => {
  const member = await runSmoke({ ...env, WASLA_SMOKE_ROLE: 'member' }, fixture)
  assert.ok(member.some(r => r.name.includes('member') && r.status === 'FAIL'))
  const foreignLeak = await runSmoke(env, (url, options) => url.includes(`/workspaces?select=id&id=eq.${foreign}`) ? response(200, [{ id: foreign }]) : fixture(url, options))
  assert.equal(foreignLeak.find(r => r.name === 'Foreign workspace hidden').status, 'FAIL')
})
test('missing schema and authentication failures cannot pass', async () => {
  const results = await runSmoke(env, (url, options) => url.includes('/auth/v1/user') ? response(401, {}) :
    url.includes('/wasla_subscription_plans?') ? response(404, {}) : fixture(url, options))
  assert.equal(results.find(r => r.name === 'Auth server accepts user JWT').status, 'FAIL')
  assert.equal(results.find(r => r.name === 'Four provisional plans visible').status, 'FAIL')
})

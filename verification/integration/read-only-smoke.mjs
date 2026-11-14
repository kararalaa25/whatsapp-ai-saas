// Opt-in, GET-only checks against a dedicated development Supabase project.
// Does not create users, refresh sessions, call RPCs, seed fixtures or mutate data.
import { pathToFileURL } from 'node:url'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function configuration(env) {
  const ref = env.WASLA_DEV_PROJECT_REF
  if (!/^[a-z0-9]{20}$/.test(ref ?? '') || env.WASLA_DEV_TARGET_CONFIRMED !== ref) {
    throw Error('Confirm the dedicated synthetic development project reference first')
  }
  const origin = `https://${ref}.supabase.co`
  if (env.NEXT_PUBLIC_SUPABASE_URL !== origin) throw Error('Development URL must exactly match the confirmed project')
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!key?.startsWith('sb_publishable_') || /\s/.test(key)) throw Error('Use a development publishable key; privileged/legacy keys are refused')
  const token = env.WASLA_SMOKE_ACCESS_TOKEN
  const own = env.WASLA_SMOKE_OWN_WORKSPACE
  const foreign = env.WASLA_SMOKE_FOREIGN_WORKSPACE
  if (token && (!uuid.test(own ?? '') || !uuid.test(foreign ?? '') || own.toLowerCase() === foreign.toLowerCase())) {
    throw Error('Authenticated checks need distinct synthetic own/foreign workspace UUIDs')
  }
  if (token && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw Error('Expected a synthetic user access JWT')
  const role = env.WASLA_SMOKE_ROLE ?? 'owner'
  if (!['owner', 'member'].includes(role)) throw Error('Expected owner or member fixture role')
  return { origin, key, token, own: own?.toLowerCase(), foreign: foreign?.toLowerCase(), role }
}

export async function runSmoke(env, fetcher = fetch) {
  const config = configuration(env) // Validate everything before the first request.
  const results = []
  async function get(path, token, profile = 'public') {
    const headers = { apikey: config.key, 'Accept-Profile': profile }
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetcher(`${config.origin}${path}`, {
      method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(10000),
    })
    let data
    try { data = await response.json() } catch { /* Never print error bodies. */ }
    return { status: response.status, data }
  }
  const array = r => r.status === 200 && Array.isArray(r.data)
  const denied = r => [401, 403].includes(r.status)
  function check(name, pass, inconclusive = false) {
    results.push({ name, status: pass ? 'PASS' : inconclusive ? 'NOT TESTED' : 'FAIL' })
  }
  const anon = await get('/rest/v1/workspaces?select=id&limit=1')
  check('Anonymous workspace read denied or empty', denied(anon) || (array(anon) && anon.data.length === 0))
  const privateRead = await get('/rest/v1/subscription_usage?select=workspace_id&limit=1', config.token, 'workspace_private')
  check('Private schema excluded from Data API', privateRead.status === 406 && privateRead.data?.code === 'PGRST106')
  if (!config.token) {
    results.push({ name: 'Real user JWT and tenant fixtures (token not supplied)', status: 'NOT TESTED' })
    return results
  }
  const user = await get('/auth/v1/user', config.token)
  check('Auth server accepts user JWT', user.status === 200 && uuid.test(user.data?.id ?? ''))
  const own = await get(`/rest/v1/workspaces?select=id&id=eq.${config.own}`, config.token)
  check('Own workspace visible', array(own) && own.data.length === 1 && own.data[0].id === config.own)
  const foreign = await get(`/rest/v1/workspaces?select=id&id=eq.${config.foreign}`, config.token)
  check('Foreign workspace hidden', array(foreign) && foreign.data.length === 0)
  const plans = await get('/rest/v1/subscription_plans?select=id,provisional&order=id', config.token)
  check('Four provisional plans visible', array(plans) && plans.data.length === 4 &&
    plans.data.every(p => p.provisional === true) && plans.data.map(p => p.id).join(',') === 'business,pro,starter,trial')
  for (const table of ['workspace_subscriptions', 'whatsapp_inbox_state', 'whatsapp_reply_drafts', 'whatsapp_automation_settings']) {
    const other = await get(`/rest/v1/${table}?select=workspace_id&workspace_id=eq.${config.foreign}&limit=1`, config.token)
    check(`${table}: foreign rows hidden`, array(other) && other.data.length === 0)
    const mine = await get(`/rest/v1/${table}?select=workspace_id&workspace_id=eq.${config.own}&limit=1`, config.token)
    if (config.role === 'member') {
      check(`${table}: member cannot read owner data`, array(mine) && mine.data.length === 0)
    } else {
      const visible = array(mine) && mine.data.length === 1 && mine.data[0].workspace_id === config.own
      // Empty inbox/draft fixtures do not prove owner access, so never call it PASS.
      check(`${table}: own fixture visible`, visible, array(mine) && mine.data.length === 0)
    }
  }
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const results = await runSmoke(process.env)
    for (const row of results) console.log(`${row.status}: ${row.name}`)
    process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : results.some(r => r.status === 'NOT TESTED') ? 2 : 0
  } catch {
    console.error('BLOCKED: invalid development configuration or request failure; no credentials or response bodies logged')
    process.exitCode = 2
  }
}

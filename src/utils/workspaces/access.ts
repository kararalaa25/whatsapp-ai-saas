import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type Workspace = { id: string; name: string }
export type DashboardState =
  | { status: 'login' | 'error' | 'onboarding' }
  | { status: 'unauthorized'; workspaces: Workspace[] }
  | { status: 'ready'; workspaces: Workspace[]; selected: Workspace }

// Run only on the server with the request-scoped, authenticated Supabase client.
// Neither a selected ID nor this result authorizes future tenant-data operations.
export async function loadDashboardState(
  supabase: SupabaseClient,
  requestedId: string | string[] | undefined
): Promise<DashboardState> {
  let userId: string
  try {
    const { data, error } = await supabase.auth.getClaims()
    if (error || typeof data?.claims?.sub !== 'string' || !data.claims.sub) {
      return { status: 'login' }
    }
    userId = data.claims.sub
  } catch {
    return { status: 'login' }
  }

  try {
    // Explicit own-membership filter plus RLS on BOTH tables. Do not trust a
    // cookie, URL, or a previously rendered list after membership is revoked.
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name, workspace_members!inner(user_id)')
      .eq('workspace_members.user_id', userId)
      .order('created_at')
      .order('id')
    if (error || !data) return { status: 'error' }
    const workspaces: Workspace[] = data.map(({ id, name }) => ({ id, name }))
    if (!workspaces.length) return { status: 'onboarding' }

    if (requestedId !== undefined) {
      if (typeof requestedId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedId)) {
        return { status: 'unauthorized', workspaces }
      }
      const selected = workspaces.find(({ id }) => id === requestedId.toLowerCase())
      if (!selected) return { status: 'unauthorized', workspaces }
      return { status: 'ready', workspaces, selected }
    }

    return { status: 'ready', workspaces, selected: workspaces[0] }
  } catch {
    return { status: 'error' }
  }
}

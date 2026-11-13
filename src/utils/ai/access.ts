import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadDashboardState } from '@/utils/workspaces/access'

export async function requireAgentOwner(supabase: SupabaseClient, workspaceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error('Not authorized')
  const access = await loadDashboardState(supabase, workspaceId)
  if (access.status !== 'ready') throw new Error('Not authorized')
  const { data: identity, error: authError } = await supabase.auth.getClaims()
  if (authError || !identity?.claims?.sub) throw new Error('Not authorized')
  const { data, error } = await supabase.from('workspace_members').select('role')
    .eq('workspace_id', access.selected.id).eq('user_id', identity.claims.sub).eq('role', 'owner').maybeSingle()
  if (error || data?.role !== 'owner') throw new Error('Not authorized')
  return access.selected
}

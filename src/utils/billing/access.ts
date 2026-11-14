import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAgentOwner } from '@/utils/ai/access'
import type { Plan, Subscription } from './model'
export async function loadBillingPanel(client: SupabaseClient, workspaceId: string) {
  const workspace = await requireAgentOwner(client, workspaceId)
  const { data, error } = await client.rpc('get_workspace_billing', { p_workspace_id: workspace.id })
  if (error || !data) return { workspace, available: false as const }
  return { workspace, available: true as const, ...data as {
    plans: Plan[]; subscription: Subscription; usage: Record<string, number>; period_start: string; period_end: string
  } }
}

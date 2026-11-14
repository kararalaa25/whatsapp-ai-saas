import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// The old Studio must respect inbox takeover too. Before the separately reviewed
// Phase 7A migration exists, its original behavior remains available; other read
// failures never grant permission. A DB trigger guards saves after migration.
export async function legacyInboxGenerationAllowed(supabase: SupabaseClient, workspaceId: string, conversationId: string, expectedRevision: number) {
  const { data, error } = await supabase.from('whatsapp_inbox_state').select('status, human_takeover')
    .eq('workspace_id', workspaceId).eq('conversation_id', conversationId).maybeSingle()
  const missingState = error?.code === '42P01' || error?.code === 'PGRST205'
  if (error && !missingState) return false
  if (!missingState && (!data || data.status !== 'open' || data.human_takeover !== false)) return false
  const latest = await supabase.from('ai_messages').select('position').eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId).eq('role', 'user').eq('provider', 'customer')
    .not('inbound_message_id', 'is', null).order('position', { ascending: false }).limit(1)
  if (latest.error || !latest.data?.[0]?.position) return false
  const reserved = await supabase.rpc('reserve_whatsapp_inbox_generation', {
    p_workspace_id: workspaceId, p_conversation_id: conversationId, p_revision: expectedRevision, p_position: latest.data[0].position,
  })
  // A stale table cache must not bypass an already installed RPC's controls.
  // Only simultaneous missing capabilities retain the pre-migration behavior.
  if (missingState && (reserved.error?.code === 'PGRST202' || reserved.error?.code === '42883')) return true
  return !reserved.error
}

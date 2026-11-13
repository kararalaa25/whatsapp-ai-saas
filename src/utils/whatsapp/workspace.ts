import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadDashboardState } from '@/utils/workspaces/access'

export type WhatsAppConnection = { id: string; phone_number_id: string; status: string }
export type TestMessage = { id: string; message_type: string; body: string | null; received_at: string }

export async function loadWhatsAppWorkspace(supabase: SupabaseClient, workspaceId: string | string[] | undefined) {
  const access = await loadDashboardState(supabase, workspaceId)
  if (access.status !== 'ready') return access
  try {
    // Every read uses the user's JWT, explicit tenant filtering, and table RLS.
    const [connections, messages] = await Promise.all([
      supabase.from('whatsapp_connections').select('id, phone_number_id, status')
        .eq('workspace_id', access.selected.id).order('created_at'),
      supabase.from('whatsapp_inbound_messages').select('id, message_type, body, received_at')
        .eq('workspace_id', access.selected.id).order('received_at', { ascending: false }).limit(50),
    ])
    if (connections.error || messages.error || !connections.data || !messages.data) return { status: 'error' as const }
    return {
      status: 'ready' as const,
      workspace: access.selected,
      connections: connections.data as WhatsAppConnection[],
      messages: messages.data as TestMessage[],
    }
  } catch {
    return { status: 'error' as const }
  }
}

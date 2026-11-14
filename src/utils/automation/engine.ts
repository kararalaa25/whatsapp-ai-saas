import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAgentOwner } from '@/utils/ai/access'
import { boundedHistory, redactCustomerText } from '@/utils/ai/context'
import { generateReply } from '@/utils/ai/reply'
import { settingsSchema } from '@/utils/ai/settings'
import { retrieveKnowledge } from '@/utils/knowledge/retrieval'
import { requestsHuman, uuid, type InboxDetail } from '@/utils/inbox/model'
import { automationSchema, withinWorkingHours, type SavedAutomation } from './settings'

export async function readAutomation(client: SupabaseClient, workspaceId: string): Promise<SavedAutomation> {
  const { data, error } = await client.from('whatsapp_automation_settings')
    .select('mode, language, business_rules, working_hours_enabled, timezone, working_days, start_minute, end_minute, revision')
    .eq('workspace_id', workspaceId).maybeSingle()
  if (error || !data) throw Error('Automation settings unavailable')
  const { revision, ...raw } = data
  if (!Number.isInteger(revision) || revision < 0) throw Error('Invalid settings revision')
  return { ...automationSchema.parse(raw), revision }
}
// Owner-operated processing of a persisted inbox event. Customer content is
// loaded by the verified Phase 7A reader, never accepted as an action argument.
// Webhook ingestion remains fast, signature-verified and independently retryable.
export async function processAutomation(client: SupabaseClient, workspaceId: string, conversationId: string,
  read: (workspace: string, conversation: string) => Promise<{ ok: true; data: InboxDetail } | { ok: false; error: string }>, now = new Date()) {
  uuid.parse(workspaceId); uuid.parse(conversationId)
  const workspace = await requireAgentOwner(client, workspaceId)
  const config = await readAutomation(client, workspace.id)
  if (config.mode !== 'draft_only') throw Error('Automation is disabled')
  const loaded = await read(workspace.id, conversationId)
  if (!loaded.ok) throw Error('Verified inbox unavailable')
  const detail = loaded.data
  if (detail.conversation.id !== conversationId || !detail.conversation.connection_id) throw Error('Conversation unavailable')
  if (detail.state.human_takeover || detail.state.status !== 'open') throw Error('Human control blocks automation')
  const latest = detail.messages.at(-1)
  if (!latest) throw Error('No verified inbound text')
  // Handoff takes precedence over hours and agent configuration. Commit RPC
  // independently inspects authoritative inbound text before any draft insert.
  const human = requestsHuman(latest.content)
  if (!human && !withinWorkingHours(config, now)) throw Error('Outside preferred working hours')
  const reservation = await client.rpc('reserve_whatsapp_automation', {
    p_workspace_id: workspace.id, p_conversation_id: conversationId, p_position: latest.position,
    p_revision: detail.conversation.revision, p_state_revision: detail.state.revision, p_settings_revision: config.revision,
  })
  if (reservation.error || !reservation.data) throw Error('Automation blocked, already processed, rate limited or stale')
  if (reservation.data === 'pending_human') return { outcome: 'pending_human' as const }
  const token = uuid.parse(reservation.data)
  const { data, error } = await client.from('ai_agent_settings')
    .select('business_description, instructions, language, tone, model, enabled').eq('workspace_id', workspace.id).maybeSingle()
  if (error || !data) throw Error('Agent settings unavailable')
  const agent = settingsSchema.parse(data)
  if (!agent.enabled) throw Error('Agent previews are disabled')
  const history = boundedHistory(detail.messages.slice(0, -1).map(message => ({ role: 'user' as const, content: message.content })))
  const question = redactCustomerText(latest.content)
  const knowledge = await retrieveKnowledge(client, workspace.id, question, history)
  if (!knowledge.available) throw Error('Knowledge unavailable')
  // Explicit demo mode: no configurable provider, credentials or real AI calls.
  const content = await generateReply({ ...agent, language: config.language }, history, question, 'demo', undefined, knowledge.entries, config.business_rules)
  const result = await client.rpc('complete_whatsapp_automation', {
    p_workspace_id: workspace.id, p_conversation_id: conversationId, p_token: token,
    p_content: content, p_refs: knowledge.entries, p_context_count: history.length,
  })
  if (result.error || !result.data) throw Error('Draft rejected: source, settings, knowledge or workflow changed')
  return { outcome: 'draft' as const, draftId: result.data as string }
}

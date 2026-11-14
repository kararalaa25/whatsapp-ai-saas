'use server'

import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { requireAgentOwner } from '@/utils/ai/access'
import { settingsSchema, type ChatMessage } from '@/utils/ai/settings'
import { boundedHistory } from '@/utils/ai/context'
import { generateReply } from '@/utils/ai/reply'
import { retrieveKnowledge } from '@/utils/knowledge/retrieval'
import { conversationPageSize, messagePageSize, cursorSchema, draftText, statusSchema, uuid, requestsHuman, type InboxCursor, type InboxRow, type InboxDetail, type Inbound, type InboxDraft } from '@/utils/inbox/model'

type Result<T> = { ok: true; data: T; notice?: string } | { ok: false; error: string }
const positive = z.number().int().positive().max(2147483647)
const revision = z.number().int().nonnegative().max(2147483647)
const conversationColumns = 'id, connection_id, customer_wa_id, revision'
async function owner(workspaceId: string) {
  uuid.parse(workspaceId)
  const supabase = await createClient()
  const workspace = await requireAgentOwner(supabase, workspaceId)
  return { supabase, workspace }
}
async function conversation(workspaceId: string, id: string) {
  uuid.parse(id)
  const { supabase, workspace } = await owner(workspaceId)
  const result = await supabase.from('ai_conversations').select(conversationColumns)
    .eq('workspace_id', workspace.id).eq('id', id).eq('channel', 'whatsapp_test').maybeSingle()
  if (result.error || !result.data?.connection_id || !result.data.customer_wa_id) throw Error('Conversation unavailable')
  return { supabase, workspace, row: result.data as InboxDetail['conversation'] }
}
function errorMessage() { return 'Inbox unavailable. Check owner access, the selected conversation, and Phase 7A storage.' }
export async function listInbox(workspaceId: string, cursor: InboxCursor | null = null, status: string = 'all'): Promise<Result<{ rows: InboxRow[]; next: InboxCursor | null }>> {
  try {
    const page = cursor === null ? null : cursorSchema.parse(cursor)
    z.enum(['all', ...statusSchema.options]).parse(status)
    const { supabase, workspace } = await owner(workspaceId)
    const { data, error } = await supabase.rpc('list_whatsapp_inbox', { p_workspace_id: workspace.id, p_before_at: page?.updated_at ?? null, p_before_id: page?.id ?? null, p_status: status })
    if (error || !Array.isArray(data)) return { ok: false, error: errorMessage() }
    const rows = (data as InboxRow[]).slice(0, conversationPageSize)
    const last = rows.at(-1)
    return { ok: true, data: { rows, next: data.length > conversationPageSize && last ? { updated_at: last.updated_at, id: last.id } : null } }
  } catch { return { ok: false, error: errorMessage() } }
}
export async function loadInboxPanel(workspaceId: string) {
  const { supabase, workspace } = await owner(workspaceId)
  const [page, members, settings] = await Promise.all([
    listInbox(workspace.id),
    supabase.from('workspace_members').select('user_id, role').eq('workspace_id', workspace.id).order('user_id').limit(100),
    supabase.from('ai_agent_settings').select('enabled').eq('workspace_id', workspace.id).maybeSingle(),
  ])
  if (!page.ok || members.error || settings.error) throw Error('Inbox unavailable')
  return { workspace, ...page.data, members: members.data ?? [], agentEnabled: settings.data?.enabled === true, openAIAvailable: !!process.env.OPENAI_API_KEY }
}
export async function loadInboxMessages(workspaceId: string, id: string, before: number | null = null): Promise<Result<{ messages: Inbound[]; before: number | null }>> {
  try {
    if (before !== null) positive.parse(before)
    const { supabase, workspace, row } = await conversation(workspaceId, id)
    let query = supabase.from('ai_messages').select('id, position, content, inbound_message_id, whatsapp_inbound_messages!inner(id, workspace_id, connection_id, body, message_type, received_at)')
      .eq('workspace_id', workspace.id).eq('conversation_id', row.id).eq('role', 'user').eq('provider', 'customer').not('inbound_message_id', 'is', null)
      .order('position', { ascending: false }).limit(messagePageSize + 1)
    if (before !== null) query = query.lt('position', before)
    const { data, error } = await query
    if (error || !data) throw Error('Message read failed')
    // Never turn a local draft/playground row into a customer message. Validate
    // the joined authoritative source and connection, not only its display role.
    const valid = data.map(raw => {
      const source = raw.whatsapp_inbound_messages as unknown as { id: string; workspace_id: string; connection_id: string; body: string; message_type: string; received_at: string }
      if (!source || source.id !== raw.inbound_message_id || source.workspace_id !== workspace.id || source.connection_id !== row.connection_id || source.message_type !== 'text' || source.body !== raw.content) throw Error('Unverified source')
      return { id: raw.id, position: raw.position, content: source.body, source_id: source.id, received_at: source.received_at } as Inbound
    })
    const messages = valid.slice(0, messagePageSize).reverse()
    return { ok: true, data: { messages, before: valid.length > messagePageSize ? messages[0]?.position ?? null : null } }
  } catch { return { ok: false, error: errorMessage() } }
}
export async function readInbox(workspaceId: string, id: string): Promise<Result<InboxDetail>> {
  try {
    const { supabase, workspace, row } = await conversation(workspaceId, id)
    const [state, page, drafts] = await Promise.all([
      supabase.from('whatsapp_inbox_state').select('status, human_takeover, assigned_user_id, revision, last_read_position').eq('workspace_id', workspace.id).eq('conversation_id', row.id).maybeSingle(),
      loadInboxMessages(workspace.id, row.id),
      supabase.from('whatsapp_reply_drafts').select('id, source_position, content, provider, status, revision, edited, knowledge_refs, context_count, created_at, approved_at')
        .eq('workspace_id', workspace.id).eq('conversation_id', row.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20),
    ])
    if (state.error || !state.data || !page.ok || drafts.error || !drafts.data) throw Error('Storage unavailable')
    return { ok: true, data: { conversation: row, state: state.data, ...page.data, drafts: drafts.data as InboxDraft[] } }
  } catch { return { ok: false, error: errorMessage() } }
}
export async function manageInbox(workspaceId: string, id: string, raw: unknown): Promise<Result<InboxDetail>> {
  try {
    const changes = z.object({ status: statusSchema, human_takeover: z.boolean(), assigned_user_id: uuid.nullable(), revision }).strict().parse(raw)
    const { supabase, workspace, row } = await conversation(workspaceId, id)
    const { error } = await supabase.rpc('manage_whatsapp_inbox', { p_workspace_id: workspace.id, p_conversation_id: row.id, p_status: changes.status, p_takeover: changes.human_takeover, p_assignee: changes.assigned_user_id, p_revision: changes.revision })
    if (error) return { ok: false, error: 'Management change rejected. Refresh and check assignment/access before retrying.' }
    return readInbox(workspace.id, row.id)
  } catch { return { ok: false, error: errorMessage() } }
}
export async function markInboxRead(workspaceId: string, id: string, seenPosition: number): Promise<Result<InboxDetail>> {
  try {
    positive.parse(seenPosition)
    const { supabase, workspace, row } = await conversation(workspaceId, id)
    const { error } = await supabase.rpc('mark_whatsapp_inbox_read', { p_workspace_id: workspace.id, p_conversation_id: row.id, p_position: seenPosition })
    if (error) return { ok: false, error: 'Read marker could not be saved. Refresh before retrying.' }
    return readInbox(workspace.id, row.id)
  } catch { return { ok: false, error: errorMessage() } }
}
async function createDraft(workspaceId: string, id: string, mode: 'demo' | 'openai' | 'manual', manual = '', expectedPosition?: number): Promise<Result<InboxDetail>> {
  const { supabase, workspace, row } = await conversation(workspaceId, id)
  const loaded = await readInbox(workspace.id, row.id)
  if (!loaded.ok) return loaded
  const detail = loaded.data
  if (detail.state.status === 'closed') return { ok: false, error: 'Reopen this conversation first.' }
  const latest = detail.messages.at(-1)
  if (!latest) return { ok: false, error: 'No verified inbound text is available.' }
  if (mode === 'manual' && latest.position !== expectedPosition) return { ok: false, error: 'A new customer text arrived or the view changed. Refresh before saving this manual reply.' }
  const automatic = mode !== 'manual'
  if (automatic && (detail.state.human_takeover || detail.state.status !== 'open')) return { ok: false, error: 'Human takeover or pending-human status blocks AI generation. An owner must explicitly release it.' }
  if (detail.drafts.some(draft => draft.source_position === latest.position && draft.status !== 'discarded')) return { ok: false, error: 'A draft already exists for this customer message. Edit or discard it first.' }
  if (automatic && requestsHuman(latest.content)) {
    const result = await manageInbox(workspace.id, row.id, { status: 'pending_human', human_takeover: true, assigned_user_id: detail.state.assigned_user_id, revision: detail.state.revision })
    return result.ok ? { ...result, notice: 'Customer requested a person. Marked pending human; no reply was generated or delivered.' } : result
  }
  let content = manual
  let refs: InboxDraft['knowledge_refs'] = []
  let contextCount = 0
  if (automatic) {
    const { data: saved, error: configError } = await supabase.from('ai_agent_settings').select('business_description, instructions, language, tone, model, enabled').eq('workspace_id', workspace.id).maybeSingle()
    if (configError || !saved) return { ok: false, error: 'Save and enable agent settings in Agent Studio first.' }
    const settings = settingsSchema.parse(saved)
    if (!settings.enabled) return { ok: false, error: 'Enable previews in Agent Studio first.' }
    if (mode === 'openai' && !process.env.OPENAI_API_KEY) return { ok: false, error: 'OpenAI previews are unavailable. Simulated drafts need no credentials.' }
    const history: ChatMessage[] = detail.messages.slice(0, -1).map(message => ({ role: 'user', content: message.content }))
    const context = boundedHistory(history)
    const retrieved = await retrieveKnowledge(supabase, workspace.id, latest.content, context)
    if (!retrieved.available) return { ok: false, error: 'Knowledge could not be loaded. Use a manual draft or check storage/access.' }
    refs = retrieved.entries; contextCount = context.length
    const reserved = await supabase.rpc('reserve_whatsapp_inbox_generation', { p_workspace_id: workspace.id, p_conversation_id: row.id, p_revision: detail.conversation.revision, p_position: latest.position })
    if (reserved.error) return { ok: false, error: reserved.error.code === '54000' ? 'Generation rate limit reached (6/minute, 100/day per owner). Try later or write a manual draft.' : 'Generation blocked by changed conversation, human control, or access. Refresh first.' }
    if (mode === 'openai') {
      const { error } = await supabase.rpc('reserve_ai_preview', { p_workspace_id: workspace.id })
      if (error) return { ok: false, error: 'OpenAI preview budget or authorization unavailable. No provider request was made.' }
    }
    content = await generateReply(settings, history.slice(-20), latest.content, mode, undefined, refs)
  }
  const { error } = await supabase.rpc('create_whatsapp_inbox_draft', {
    p_workspace_id: workspace.id, p_conversation_id: row.id, p_source_id: latest.source_id, p_position: latest.position,
    p_revision: detail.conversation.revision, p_content: draftText.parse(content), p_provider: mode, p_refs: refs, p_context_count: contextCount,
  })
  if (error?.code === '54000') return { ok: false, error: 'This conversation reached the 100 local-draft limit. History is preserved; retention must be reviewed before creating more drafts.' }
  if (error) return { ok: false, error: 'Draft was not saved: conversation, knowledge, or human control changed, or another active draft exists. Refresh before retrying.' }
  const result = await readInbox(workspace.id, row.id)
  return result.ok ? { ...result, notice: 'Draft saved locally — NOT SENT. Review before any future delivery workflow.' } : result
}
export async function generateInboxDraft(workspaceId: string, id: string, mode: 'demo' | 'openai'): Promise<Result<InboxDetail>> {
  try { z.enum(['demo', 'openai']).parse(mode); return await createDraft(workspaceId, id, mode) }
  catch { return { ok: false, error: 'Draft generation failed. Nothing was sent; check owner access, storage, and agent settings.' } }
}
export async function createManualInboxDraft(workspaceId: string, id: string, content: string, expectedPosition: number): Promise<Result<InboxDetail>> {
  try { positive.parse(expectedPosition); return await createDraft(workspaceId, id, 'manual', draftText.parse(content), expectedPosition) }
  catch { return { ok: false, error: 'Manual draft could not be saved. Check owner access and text length.' } }
}
export async function changeInboxDraft(workspaceId: string, id: string, draftId: string, expectedRevision: number, operation: 'edit' | 'approve' | 'discard', content = ''): Promise<Result<InboxDetail>> {
  try {
    uuid.parse(draftId); revision.parse(expectedRevision); z.enum(['edit', 'approve', 'discard']).parse(operation)
    const text = operation === 'edit' ? draftText.parse(content) : null
    const { supabase, workspace, row } = await conversation(workspaceId, id)
    const { error } = await supabase.rpc('update_whatsapp_inbox_draft', { p_workspace_id: workspace.id, p_conversation_id: row.id, p_draft_id: draftId, p_revision: expectedRevision, p_operation: operation, p_content: text })
    if (error) return { ok: false, error: 'Draft change rejected. Check for new customer messages, a closed conversation, changed knowledge, or another edit; refresh before retrying.' }
    const result = await readInbox(workspace.id, row.id)
    return result.ok ? { ...result, notice: operation === 'approve' ? 'Approved locally — NOT SENT. No Meta request, notification, or delivery was triggered.' : 'Draft updated locally — NOT SENT.' } : result
  } catch { return { ok: false, error: errorMessage() } }
}

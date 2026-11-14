'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { requireAgentOwner } from '@/utils/ai/access'
import { defaultSettings, settingsSchema, type AgentSettings, type ChatMessage, type Conversation } from '@/utils/ai/settings'
import { retrieveKnowledge } from '@/utils/knowledge/retrieval'
import { generateReply } from '@/utils/ai/reply'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
export type Snapshot = { conversation: Conversation; messages: ChatMessage[] }
const uuid = z.string().uuid()
const customerText = z.string().trim().min(1).max(3000).refine((value) => !value.includes('\u0000'))
const historySchema = z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(6000) })).max(20)
const settingsColumns = 'business_description, instructions, language, tone, model, enabled'
const conversationColumns = 'id, title, channel, status, revision, updated_at'

async function ownerClient(workspaceId: string) {
  uuid.parse(workspaceId)
  const supabase = await createClient()
  const workspace = await requireAgentOwner(supabase, workspaceId)
  return { supabase, workspace }
}

export async function loadAgentPanel(workspaceId: string, conversationId?: string) {
  const { supabase, workspace } = await ownerClient(workspaceId)
  const [config, threads] = await Promise.all([
    supabase.from('ai_agent_settings').select(settingsColumns).eq('workspace_id', workspace.id).maybeSingle(),
    supabase.from('ai_conversations').select(conversationColumns).eq('workspace_id', workspace.id).order('updated_at', { ascending: false }).limit(30),
  ])
  const selected = conversationId === undefined ? undefined : await readConversation(workspace.id, conversationId)
  if (selected && !selected.ok) throw new Error(selected.error)
  return {
    snapshot: selected?.ok ? selected.data : null,
    workspace,
    settings: config.data ? settingsSchema.parse(config.data) : defaultSettings,
    conversations: (threads.data ?? []) as Conversation[],
    storageAvailable: !config.error && !threads.error,
    openAIAvailable: !!process.env.OPENAI_API_KEY,
  }
}

export async function saveAgent(workspaceId: string, raw: unknown): Promise<Result<AgentSettings>> {
  const parsed = settingsSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Check the field lengths and selected options.' }
  try {
    const { supabase, workspace } = await ownerClient(workspaceId)
    const s = parsed.data
    const { error } = await supabase.rpc('save_ai_agent_settings', {
      p_workspace_id: workspace.id, p_description: s.business_description, p_instructions: s.instructions,
      p_language: s.language, p_tone: s.tone, p_model: s.model, p_enabled: s.enabled,
    })
    if (error) return { ok: false, error: 'Settings could not be saved. Verify owner access and that the Phase 5B migration is applied.' }
    revalidatePath('/dashboard/agent')
    return { ok: true, data: s }
  } catch {
    return { ok: false, error: 'Settings could not be saved. Please check your session and workspace access.' }
  }
}

export async function readConversation(workspaceId: string, conversationId: string): Promise<Result<Snapshot>> {
  try {
    uuid.parse(conversationId)
    const { supabase, workspace } = await ownerClient(workspaceId)
    const [conversation, messages] = await Promise.all([
      supabase.from('ai_conversations').select(conversationColumns).eq('workspace_id', workspace.id).eq('id', conversationId).maybeSingle(),
      supabase.from('ai_messages').select('role, content, provider').eq('workspace_id', workspace.id).eq('conversation_id', conversationId)
        .order('position', { ascending: false }).limit(20),
    ])
    if (conversation.error || !conversation.data || messages.error || !messages.data) return { ok: false, error: 'Conversation unavailable or access denied.' }
    return { ok: true, data: { conversation: conversation.data as Conversation, messages: messages.data.reverse() as ChatMessage[] } }
  } catch {
    return { ok: false, error: 'Conversation unavailable or access denied.' }
  }
}

export async function newConversation(workspaceId: string): Promise<Result<Snapshot>> {
  try {
    const { supabase, workspace } = await ownerClient(workspaceId)
    const { data, error } = await supabase.rpc('create_ai_playground', { p_workspace_id: workspace.id })
    if (error || typeof data !== 'string') return { ok: false, error: 'Unable to create a conversation. The Phase 5B migration may still be pending.' }
    return readConversation(workspace.id, data)
  } catch {
    return { ok: false, error: 'Unable to create a conversation. Check your owner access.' }
  }
}

export async function setConversationStatus(workspaceId: string, conversationId: string, status: 'open' | 'closed'): Promise<Result<Snapshot>> {
  try {
    uuid.parse(conversationId)
    z.enum(['open', 'closed']).parse(status)
    const { supabase, workspace } = await ownerClient(workspaceId)
    const { error } = await supabase.rpc('set_ai_conversation_status', { p_workspace_id: workspace.id, p_conversation_id: conversationId, p_status: status })
    if (error) return { ok: false, error: 'Conversation status could not be changed.' }
    return readConversation(workspace.id, conversationId)
  } catch {
    return { ok: false, error: 'Conversation status could not be changed.' }
  }
}

export async function previewReply(workspaceId: string, conversationId: string | null, input: string, mode: 'demo' | 'openai', draft: unknown, localHistory: unknown): Promise<Result<{ messages: ChatMessage[]; snapshot?: Snapshot }>> {
  try {
    z.enum(['demo', 'openai']).parse(mode)
    const { supabase, workspace } = await ownerClient(workspaceId)
    let settings = settingsSchema.parse(draft)
    let history: ChatMessage[] = historySchema.parse(localHistory)
    let message = input
    let snapshot: Snapshot | undefined

    if (conversationId) {
      const result = await readConversation(workspace.id, uuid.parse(conversationId))
      if (!result.ok) return result
      snapshot = result.data
      if (snapshot.conversation.status !== 'open') return { ok: false, error: 'Reopen this conversation before generating a reply.' }
      history = snapshot.messages
      if (snapshot.conversation.channel === 'whatsapp_test') {
        const latest = history.at(-1)
        if (!latest || latest.role !== 'user') return { ok: false, error: 'No unanswered text message. Refresh after the next test delivery.' }
        message = latest.content
        history = history.slice(0, -1)
      } else {
        message = customerText.parse(input)
      }
    } else {
      if (mode !== 'demo') return { ok: false, error: 'Start a saved conversation before using OpenAI.' }
      message = customerText.parse(input)
    }

    if (mode === 'openai') {
      if (!process.env.OPENAI_API_KEY) return { ok: false, error: 'OpenAI is not configured on the server. Demo mode remains available.' }
      const saved = await supabase.from('ai_agent_settings').select(settingsColumns).eq('workspace_id', workspace.id).maybeSingle()
      if (saved.error || !saved.data) return { ok: false, error: 'Save your agent settings first.' }
      settings = settingsSchema.parse(saved.data)
    }
    if (!settings.enabled) return { ok: false, error: 'Enable agent previews first. OpenAI uses the saved setting; demo uses the editor.' }
    const knowledge = await retrieveKnowledge(supabase, workspace.id, message)
    if (mode === 'openai' && !knowledge.available) return { ok: false, error: 'Business knowledge could not be loaded. Check owner access and knowledge storage, or use simulated demo mode.' }
    if (mode === 'openai') {
      const { error } = await supabase.rpc('reserve_ai_preview', { p_workspace_id: workspace.id })
      if (error) return { ok: false, error: error.code === '54000' ? 'Daily OpenAI preview limit reached. Demo mode is still available.' : 'OpenAI preview could not be authorized. Check saved settings and workspace access.' }
    }
    const reply = await generateReply(settings, history, message, mode, undefined, knowledge.entries)

    if (snapshot && conversationId) {
      const { error } = await supabase.rpc('save_ai_turn', {
        p_workspace_id: workspace.id, p_conversation_id: conversationId, p_revision: snapshot.conversation.revision,
        p_customer_message: snapshot.conversation.channel === 'playground' ? message : null,
        p_reply: reply, p_provider: mode,
      })
      if (error) return { ok: false, error: error.code === '40001' ? 'Conversation changed while generating. Reload it before trying again.' : 'Draft could not be saved. Check access, conversation limits, and reload before retrying.' }
      const updated = await readConversation(workspace.id, conversationId)
      if (!updated.ok) return updated
      return { ok: true, data: { messages: updated.data.messages, snapshot: updated.data } }
    }
    return { ok: true, data: { messages: [...history, { role: 'user', content: message }, { role: 'assistant', content: reply, provider: 'demo' }].slice(-20) as ChatMessage[] } }
  } catch {
    return { ok: false, error: 'Reply preview failed. Check owner access, message length and agent settings. If OpenAI was selected, check server configuration or try demo mode.' }
  }
}

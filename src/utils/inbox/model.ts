import { z } from 'zod'
import type { KnowledgeEntry } from '@/utils/knowledge/types'

export const inboxStatuses = ['open', 'pending_human', 'closed'] as const
export const statusSchema = z.enum(inboxStatuses)
export const uuid = z.string().uuid()
export const cursorSchema = z.object({ updated_at: z.string().datetime({ offset: true }), id: uuid }).strict()
export const draftText = z.string().trim().min(1).max(6000).refine(text => !text.includes('\u0000'))
export type InboxCursor = z.infer<typeof cursorSchema>
export type InboxStatus = z.infer<typeof statusSchema>
export type InboxRow = {
  id: string; connection_id: string; customer_wa_id: string; updated_at: string
  status: InboxStatus; human_takeover: boolean; assigned_user_id: string | null
  unread_count: number; recent_message: string | null; latest_received_at: string | null
}
export type InboxState = { status: InboxStatus; human_takeover: boolean; assigned_user_id: string | null; revision: number; last_read_position: number }
export type Inbound = { id: string; position: number; content: string; received_at: string; source_id: string }
export type InboxDraft = {
  id: string; source_position: number; content: string; provider: 'demo' | 'openai' | 'manual'
  status: 'draft' | 'approved' | 'discarded'; revision: number; edited: boolean
  knowledge_refs: KnowledgeEntry[]; context_count: number; created_at: string; approved_at: string | null
}
export type InboxDetail = {
  conversation: { id: string; connection_id: string; customer_wa_id: string; revision: number }
  state: InboxState; messages: Inbound[]; before: number | null; drafts: InboxDraft[]
}
export function mergeMessages(previous: Inbound[], next: Inbound[]) {
  return [...new Map([...previous, ...next].map(message => [message.id, message])).values()].sort((a, b) => a.position - b.position)
}
export function mergeConversations(previous: InboxRow[], next: InboxRow[]) {
  return [...new Map([...previous, ...next].map(conversation => [conversation.id, conversation])).values()]
}
// A request for a person routes to human review, never a claim of handoff.
export function requestsHuman(question: string) {
  return /\b(?:human|representative|person|someone|staff)\b|موظف|انسان|بشري|مسؤول|مسوول/i.test(question.normalize('NFKC'))
}
export const conversationPageSize = 30
export const messagePageSize = 30

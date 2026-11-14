// Future contracts only. Nothing in this module persists or dispatches a message.
export type LocalDraftState = 'draft' | 'approved' | 'discarded'
export type DeliveryState = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown'
export type FailureKind = 'transient' | 'permanent' | 'ambiguous'
export function futureRetry(kind: FailureKind, attempt: number): { action: 'stop' | 'reconcile' | 'retry'; delayMs?: number } {
  if (!['transient', 'permanent', 'ambiguous'].includes(kind)) throw Error('Invalid failure kind')
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 5 || kind === 'permanent') return { action: 'stop' }
  // A timeout can mean Meta accepted the message: never blindly resend it.
  if (kind === 'ambiguous') return { action: 'reconcile' }
  if (attempt === 5) return { action: 'stop' }
  return { action: 'retry', delayMs: Math.min(60000, 1000 * 2 ** (attempt - 1)) }
}
export function futureStatus(current: DeliveryState, incoming: 'sent' | 'delivered' | 'read' | 'failed', providerMessageId: string | null): DeliveryState {
  if (!['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'unknown'].includes(current) || !['sent', 'delivered', 'read', 'failed'].includes(incoming)) throw Error('Invalid delivery state')
  if (!providerMessageId?.trim()) throw Error('Verified provider message identity required')
  // Future status ingestion must additionally verify signature, tenant/connection,
  // provider ID mapping and deduplicate event IDs before calling this reducer.
  if (current === 'read' || current === 'delivered' && incoming !== 'read') return current
  if (current === 'failed' && incoming === 'sent') return current
  return incoming
}
export function localApproval(): { state: 'approved'; delivery: null } { return { state: 'approved', delivery: null } }
export function automationKey(workspace: string, connection: string, source: string) {
  if (![workspace, connection, source].every(value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))) throw Error('Invalid scope')
  return `whatsapp-draft:v1:${workspace.toLowerCase()}:${connection.toLowerCase()}:${source.toLowerCase()}`
}

export type FutureDeliveryEvent = {
  workspaceId: string; connectionId: string; providerMessageId: string
  eventId: string; occurredAt: string; status: 'sent' | 'delivered' | 'read' | 'failed'
}
// Stable across transport retries; a newly reviewed draft revision gets a new
// identity. Future enqueue must atomically enforce uniqueness in storage.
export function deliveryKey(workspace: string, connection: string, draft: string, revision: number) {
  if (!Number.isInteger(revision) || revision < 0 || revision > 2147483647) throw Error('Invalid draft revision')
  return `${automationKey(workspace, connection, draft).replace('whatsapp-draft:', 'whatsapp-delivery:')}:${revision}`
}

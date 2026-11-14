import 'server-only'
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const MAX_WEBHOOK_BYTES = 1024 * 1024

export function validSignature(body: Uint8Array, signature: string | null, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false
  const expected = createHmac('sha256', secret).update(body).digest()
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))
}

export function validVerificationToken(provided: string, expected: string): boolean {
  if (!expected || !provided) return false
  return timingSafeEqual(createHash('sha256').update(provided).digest(), createHash('sha256').update(expected).digest())
}

const numericId = z.string().regex(/^[0-9]{1,32}$/)
const message = z.object({
  id: z.string().min(1).max(512).refine((value) => !value.includes('\u0000')),
  timestamp: z.string().regex(/^[0-9]{1,12}$/).refine((value) => Number(value) <= 253402300799),
  type: z.string().min(1).max(64),
  from: z.string().regex(/^[0-9]{5,32}$/).optional(),
  text: z.object({ body: z.string().max(8192).refine((value) => !value.includes('\u0000') && Array.from(value).length <= 4096) }).optional(),
}).refine((value) => value.type !== 'text' || value.text !== undefined)

const envelope = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.object({
    id: numericId,
    changes: z.array(z.object({
      field: z.string().min(1).max(64),
      value: z.object({
        messaging_product: z.literal('whatsapp').optional(),
        metadata: z.object({ phone_number_id: numericId }).optional(),
        messages: z.array(message).max(100).optional(),
        statuses: z.array(z.unknown()).max(100).optional(),
      }),
    })).max(100),
  })).max(100),
})

export type InboundMessage = {
  phoneNumberId: string
  wabaId: string
  metaMessageId: string
  messageType: 'text' | 'unsupported'
  body: string | null
  timestamp: string
  senderId: string | null
}

// Call only AFTER raw-body signature verification. Unknown fields are stripped;
// Raw payloads, contact profiles and media are never persisted. A test sender ID
// is retained by Phase 5B solely to scope customer history within a connection.
export function parseMessages(raw: string): InboundMessage[] {
  const payload = envelope.parse(JSON.parse(raw))
  const result: InboundMessage[] = []
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue
      if (change.value.messages?.length && (!change.value.metadata || change.value.messaging_product !== 'whatsapp')) {
        throw new Error('Invalid message metadata')
      }
      for (const item of change.value.messages ?? []) {
        result.push({
          phoneNumberId: change.value.metadata!.phone_number_id,
          wabaId: entry.id,
          metaMessageId: item.id,
          messageType: item.type === 'text' ? 'text' : 'unsupported',
          body: item.type === 'text' ? item.text!.body : null,
          timestamp: new Date(Number(item.timestamp) * 1000).toISOString(),
          senderId: item.from ?? null,
        })
        if (result.length > 100) throw new Error('Too many messages')
      }
    }
  }
  return result
}

export type Ingest = (message: InboundMessage) => Promise<'inserted' | 'duplicate' | 'ignored' | 'deferred'>

export async function deliverMessages(messages: InboundMessage[], allowedIds: Set<string>, ingest: Ingest) {
  // Resolve workspace ownership only inside the database RPC, never from payload.
  let failed = false
  for (const item of messages) {
    if (!allowedIds.has(item.phoneNumberId)) continue
    try { await ingest(item) } catch { failed = true }
  }
  // Every later event gets an independent durable-acceptance attempt. A failed
  // event still makes the batch non-2xx; committed successes deduplicate on retry.
  if (failed) throw new Error('Some webhook events were not durably accepted')
}

export class OversizedWebhookError extends Error {}

export async function readRawBody(request: Request): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_WEBHOOK_BYTES) {
        await reader.cancel()
        throw new OversizedWebhookError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size)
}

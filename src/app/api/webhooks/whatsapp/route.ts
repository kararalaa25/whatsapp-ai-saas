import { createIngestor } from '@/utils/whatsapp/ingestion'
import { deliverMessages, OversizedWebhookError, parseMessages, readRawBody, validSignature, validVerificationToken } from '@/utils/whatsapp/webhook'

// Uses the default Node.js runtime; cacheComponents forbids runtime overrides.
function reply(text: string, status: number) {
  return new Response(text, { status, headers: {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Type': 'text/plain; charset=utf-8',
  } })
}

export async function GET(request: Request) {
  // Read request state before configuration checks so this never prerenders a
  // missing-configuration response when Cache Components is enabled.
  const params = new URL(request.url).searchParams
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN
  if (!expected) return reply('Unavailable', 503)
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')
  if (['hub.mode', 'hub.verify_token', 'hub.challenge'].some((key) => params.getAll(key).length !== 1) ||
      mode !== 'subscribe' || !token || token.length > 1024 ||
      !challenge || !/^[0-9]{1,128}$/.test(challenge) || !validVerificationToken(token, expected)) {
    return reply('Forbidden', 403)
  }
  return reply(challenge, 200)
}

export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET
  const allowedIds = new Set((process.env.META_TEST_PHONE_NUMBER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean))
  if (!secret || !allowedIds.size || [...allowedIds].some((id) => !/^[0-9]{1,32}$/.test(id))) {
    return reply('Unavailable', 503)
  }

  let raw: Uint8Array
  try {
    raw = await readRawBody(request)
  } catch (error) {
    return reply('Invalid request', error instanceof OversizedWebhookError ? 413 : 400)
  }
  // Never decode, parse, route, or persist an unverified payload.
  if (!validSignature(raw, request.headers.get('x-hub-signature-256'), secret)) return reply('Forbidden', 403)

  let messages
  try {
    messages = parseMessages(new TextDecoder('utf-8', { fatal: true }).decode(raw))
  } catch {
    return reply('Invalid event', 400)
  }

  try {
    // Status-only and unallowlisted events need no database access.
    if (messages.some((item) => allowedIds.has(item.phoneNumberId))) {
      await deliverMessages(messages, allowedIds, createIngestor())
    }
  } catch {
    // Meta retries non-2xx responses. Already inserted messages deduplicate.
    return reply('Temporarily unavailable', 503)
  }
  return reply('EVENT_RECEIVED', 200)
}

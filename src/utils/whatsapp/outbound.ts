import 'server-only'

type TestReply = { phoneNumberId: string; recipient: string; text: string; isTest: boolean }
type TestPolicy = { phoneIds: readonly string[]; recipients: readonly string[]; graphVersion: string }

// Preparation only. No access token is accepted, stored, or returned.
export function prepareTestReply(input: TestReply, policy: TestPolicy) {
  if (!input.isTest || !/^[0-9]{1,32}$/.test(input.phoneNumberId) || !policy.phoneIds.includes(input.phoneNumberId)) throw new Error('Test number not allowed')
  if (!/^[0-9]{8,15}$/.test(input.recipient) || !policy.recipients.includes(input.recipient)) throw new Error('Test recipient not allowed')
  if (!/^v[1-9][0-9]*\.[0-9]+$/.test(policy.graphVersion)) throw new Error('Invalid API version')
  if (!input.text.trim() || Array.from(input.text).length > 4096 || input.text.includes('\u0000')) throw new Error('Invalid message')
  return {
    url: `https://graph.facebook.com/${policy.graphVersion}/${input.phoneNumberId}/messages`,
    body: { messaging_product: 'whatsapp', to: input.recipient, type: 'text', text: { body: input.text } },
  }
}

// HARD STOP: no environment flag or owner setting can enable delivery.
// A later reviewed implementation and explicit live-test approval are required.
export async function sendTestReply(input: TestReply, policy: TestPolicy): Promise<never> {
  prepareTestReply(input, policy)
  throw new Error('WhatsApp delivery is disabled. Drafts and playground only.')
}

import 'server-only'

// Contract only: no token, fetch implementation, queue, worker or env override.
export type OfficialMetaText = {
  workspaceId: string; connectionId: string; sourceMessageId: string; draftId: string
  idempotencyKey: string; text: string
}
export type DeliveryReceipt = { provider: 'meta_whatsapp_cloud'; providerMessageId: string; acceptedAt: string }
export interface WhatsAppTransport { send(message: OfficialMetaText): Promise<DeliveryReceipt> }
export const outboundEnabled = false as const
export const officialMetaTransport: WhatsAppTransport = Object.freeze({
  async send(): Promise<never> {
    throw new Error('WhatsApp outbound delivery is hard-disabled in Phase 7B')
  },
})

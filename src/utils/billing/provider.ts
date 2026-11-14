import 'server-only'

// Architecture only. No adapter, route, credentials, checkout, or network calls.
export type Money = Readonly<{ currency: 'IQD' | 'USD'; minorUnits: number }>
export type Invoice = Readonly<{
  id: string; workspaceId: string; subscriptionRevision: number; planVersion: string
  amount: Money; interval: 'monthly' | 'annual'; startsAt: string; endsAt: string
  status: 'draft' | 'issued' | 'paid' | 'void' | 'refunded'
}>
export type PaymentEvent = Readonly<{
  provider: string; eventId: string; invoiceId: string; occurredAt: string
  kind: 'payment_succeeded' | 'payment_failed' | 'renewed' | 'canceled' | 'refunded'
  amount: Money; providerTransactionId: string
}>
export interface BillingProvider {
  // Must verify raw bytes BEFORE parsing, timing-safe signature, timestamp/replay
  // window, merchant account, environment, authoritative invoice and amount.
  verifyWebhook(rawBody: Uint8Array, headers: Readonly<Record<string, string>>): Promise<PaymentEvent>
  reconcile(invoice: Invoice): Promise<PaymentEvent | null>
  cancel(invoice: Invoice, idempotencyKey: string): Promise<void>
  refund(invoice: Invoice, amount: Money, idempotencyKey: string): Promise<void>
}
export async function acceptBillingEvent(): Promise<never> {
  // Deliberately fail closed until an audited provider verifier and atomic,
  // monotonic invoice/event transaction are implemented and authorized.
  throw new Error('Billing disabled: verified payment integration is not configured')
}

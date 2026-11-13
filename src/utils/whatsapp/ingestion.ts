import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { InboundMessage } from './webhook'

// Never import this in browser components or use it for dashboard reads.
// The server credential can bypass RLS: keep its use confined to this RPC.
export function createIngestor() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_WEBHOOK_SECRET_KEY
  if (!url || !secret) throw new Error('Webhook storage unavailable')
  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  return async (message: InboundMessage): Promise<'inserted' | 'duplicate' | 'ignored'> => {
    const { data, error } = await supabase.rpc('ingest_whatsapp_ai_test_message', {
      p_phone_number_id: message.phoneNumberId,
      p_waba_id: message.wabaId,
      p_meta_message_id: message.metaMessageId,
      p_message_type: message.messageType,
      p_body: message.body,
      p_meta_timestamp: message.timestamp,
      p_sender_id: message.senderId,
    })
    if (error || !['inserted', 'duplicate', 'ignored'].includes(data)) {
      throw new Error('Webhook storage unavailable')
    }
    return data
  }
}

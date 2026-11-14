'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { requireAgentOwner } from '@/utils/ai/access'

export type IntakePage = { capacity: number; outstanding: number; rows: Array<{
  inbound_id: string; status: 'deferred' | 'failed'; reason: string; failures: number
  received_at: string; last_attempt_at: string | null; customer_suffix: string; body: string
}> }
export async function loadIntake(workspaceId: string, offset = 0) {
  z.number().int().min(0).max(975).parse(offset)
  const client = await createClient()
  const workspace = await requireAgentOwner(client, workspaceId)
  const { data, error } = await client.rpc('get_whatsapp_intake', { p_workspace_id: workspace.id, p_offset: offset })
  if (error || !data) throw Error('Retained intake unavailable')
  return { workspace, intake: data as IntakePage }
}
export async function reconcileIntake(workspaceId: string) {
  try {
    const client = await createClient()
    const workspace = await requireAgentOwner(client, workspaceId)
    const { data, error } = await client.rpc('reconcile_whatsapp_intake', { p_workspace_id: workspace.id })
    if (error || !data) return { ok: false as const }
    revalidatePath('/dashboard/intake')
    revalidatePath('/dashboard/inbox')
    return { ok: true as const, attempted: data.attempted as number, processed: data.processed as number }
  } catch { return { ok: false as const } }
}
export async function reconcileIntakeForm(workspaceId: string) {
  const result = await reconcileIntake(workspaceId)
  redirect(`/dashboard/intake?workspace=${encodeURIComponent(workspaceId)}&result=${result.ok ? 'checked' : 'unavailable'}`)
}

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { requireAgentOwner } from '@/utils/ai/access'

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const timestamp = z.string().datetime({ offset: true })
const planId = z.enum(['trial', 'starter', 'pro', 'business'])
const prices = z.object({ monthly: counter.nullable(), annual: counter.nullable() })
const billingResponse = z.object({
  plans: z.array(z.object({
    id: planId, name_en: z.string(), name_ar: z.string(),
    trial_days: counter, grace_days: counter, provisional: z.literal(true),
    prices: z.object({ IQD: prices, USD: prices }),
    limits: z.record(z.string(), counter), features: z.record(z.string(), z.boolean()),
  })).length(4).refine(plans => new Set(plans.map(plan => plan.id)).size === 4),
  subscription: z.object({
    workspace_id: z.uuid(), plan_id: planId,
    status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'expired']),
    interval: z.enum(['monthly', 'annual']), currency: z.enum(['IQD', 'USD']),
    trial_ends_at: timestamp, period_ends_at: timestamp,
    grace_ends_at: timestamp.nullable(), revision: counter,
  }),
  usage: z.record(z.string(), counter), period_start: timestamp, period_end: timestamp,
}).refine(data => Date.parse(data.period_end) > Date.parse(data.period_start))

export async function loadBillingPanel(client: SupabaseClient, workspaceId: string) {
  const workspace = await requireAgentOwner(client, workspaceId)
  try {
    const { data, error } = await client.rpc('get_workspace_billing', { p_workspace_id: workspace.id })
    if (error) return { workspace, available: false as const }
    const parsed = billingResponse.safeParse(data)
    if (!parsed.success || parsed.data.subscription.workspace_id !== workspace.id) {
      return { workspace, available: false as const }
    }
    // Strip unrecognized JSON fields; the RPC cannot replace verified identity.
    return { ...parsed.data, workspace, available: true as const }
  } catch {
    return { workspace, available: false as const }
  }
}

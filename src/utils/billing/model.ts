export type Status = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
export type Plan = {
  id: string; name_en: string; name_ar: string; trial_days: number; grace_days: number
  // NULL means commercially unconfigured. Values, when set, are minor units.
  prices: Record<'IQD' | 'USD', Record<'monthly' | 'annual', number | null>>
  limits: Record<string, number>; features: Record<string, boolean>; provisional: boolean
}
export type Subscription = {
  plan_id: string; status: Status; interval: 'monthly' | 'annual'; currency: 'IQD' | 'USD'
  trial_ends_at: string; period_ends_at: string; grace_ends_at: string | null; revision: number
}
export function hasAccess(s: Subscription, now = Date.now()) {
  const end = Date.parse(s.status === 'trialing' ? s.trial_ends_at : s.status === 'past_due' ? s.grace_ends_at ?? '' : s.period_ends_at)
  return s.status !== 'expired' && Number.isFinite(end) && now < end
}
export function effectiveStatus(s: Subscription, now = Date.now()): Status {
  return hasAccess(s, now) ? s.status : 'expired'
}
export function usageWarning(used: number, limit: number): 'blocked' | 'warning' | 'normal' {
  return used >= limit ? 'blocked' : used >= limit * 0.8 ? 'warning' : 'normal'
}

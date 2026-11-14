import { z } from 'zod'

export const automationSchema = z.object({
  mode: z.enum(['disabled', 'draft_only']),
  language: z.enum(['auto', 'ar', 'en']),
  business_rules: z.string().max(2000).refine(value => !value.includes('\u0000')),
  working_hours_enabled: z.boolean(),
  timezone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true } catch { return false }
  }),
  working_days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length),
  start_minute: z.number().int().min(0).max(1439),
  end_minute: z.number().int().min(1).max(1440),
}).strict().refine(value => value.start_minute < value.end_minute, 'Use a same-day working window')
export type AutomationSettings = z.infer<typeof automationSchema>
export type SavedAutomation = AutomationSettings & { revision: number }
export const defaultAutomation: SavedAutomation = {
  mode: 'disabled', language: 'auto', business_rules: '', working_hours_enabled: false,
  timezone: 'Asia/Baghdad', working_days: [0, 1, 2, 3, 4], start_minute: 540, end_minute: 1020, revision: 0,
}
// Sunday = 0. Same-day windows, inclusive start and exclusive end. No promises
// about public holidays, staffing, response time or customer delivery are made.
export function withinWorkingHours(settings: AutomationSettings, now: Date) {
  if (!settings.working_hours_enabled) return true
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'))
  const minute = Number(part('hour')) * 60 + Number(part('minute'))
  return settings.working_days.includes(day) && minute >= settings.start_minute && minute < settings.end_minute
}

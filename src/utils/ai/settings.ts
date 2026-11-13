import { z } from 'zod'

const text = (max: number) => z.string().max(max).refine((value) => !value.includes('\u0000'))
export const settingsSchema = z.object({
  business_description: text(3000),
  instructions: text(4000),
  language: z.enum(['auto', 'en', 'ar']),
  tone: z.enum(['professional', 'friendly', 'concise']),
  model: z.enum(['gpt-4.1-mini', 'gpt-4.1']),
  enabled: z.boolean(),
}).strict()
export type AgentSettings = z.infer<typeof settingsSchema>
export const defaultSettings: AgentSettings = {
  business_description: '', instructions: '', language: 'auto', tone: 'professional', model: 'gpt-4.1-mini', enabled: false,
}
export type ChatMessage = { role: 'user' | 'assistant'; content: string; provider?: string }
export type Conversation = { id: string; title: string; channel: string; status: string; revision: number; updated_at: string }

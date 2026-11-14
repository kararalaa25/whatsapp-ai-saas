import 'server-only'
import type { ChatMessage } from './settings'

export const MAX_HISTORY_MESSAGES = 12
export const MAX_HISTORY_CHARS = 12000
// Best-effort minimization for customer text sent to providers, not a complete
// PII detector. Keep business knowledge untouched to preserve exact facts.
export function redactCustomerText(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, '[credential redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[credential redacted]')
    .replace(/\b(?:api[_ -]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, '[credential redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/(?<![\p{L}\p{N}])\+?[\d٠-٩۰-۹](?:[\d٠-٩۰-۹ ()-]{5,}[\d٠-٩۰-۹])(?![\p{L}\p{N}])/gu, '[number redacted]')
}
// A contiguous recent tail; never summarize old replies as verified facts, or
// cut messages in the middle where a qualification could be lost.
export function boundedHistory(history: ChatMessage[]): ChatMessage[] {
  const recent: ChatMessage[] = []
  let size = 0
  for (const message of history.slice(-MAX_HISTORY_MESSAGES).reverse()) {
    const content = redactCustomerText(message.content)
    if (size + content.length > MAX_HISTORY_CHARS) break
    recent.unshift({ role: message.role, content })
    size += content.length
  }
  while (recent[0]?.role === 'assistant') recent.shift()
  return recent
}

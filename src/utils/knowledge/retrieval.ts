import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from '@/utils/ai/settings'
import { readKnowledge } from './access'
import { topicLabels, type Knowledge } from './schema'
import { normalize, words, terms, intents, intentKeys, oneEdit, transliterated } from './matching'
import type { KnowledgeEntry } from './types'
export { normalize } from './matching'
export type { KnowledgeEntry } from './types'

export const MAX_KNOWLEDGE_CHARS = 10000
export const MAX_KNOWLEDGE_ITEMS = 8
const policyIntent = { opening_hours: 'hours', delivery: 'delivery', payment_methods: 'payment', returns: 'returns', general: 'contact' }
function nameMatch(name: string[], query: string[]) {
  let score = 0
  let reason: KnowledgeEntry['reason'] = 'keyword'
  for (const term of query.filter(term => !intentKeys.has(term))) {
    if (name.includes(term)) { score += 12; if (reason === 'keyword') reason = 'name' }
    else if (/^\p{L}{5,}$/u.test(term) && name.some(word => /^\p{L}{5,}$/u.test(word) && oneEdit(term, word))) { score += 6; reason = 'spelling' }
    else if (name.some(word => transliterated(term, word))) { score += 5; if (reason !== 'spelling') reason = 'transliteration' }
  }
  return { score, reason }
}
function sizeTokens(text: string) {
  return (normalize(text).match(/\d+(?:\.\d+)?\s*(?:ml|gb|tb|kg|mg|l|مل|ملي)(?=$|[^\p{L}\p{N}])/gu) ?? []).map(size => size.replace(/\s/g, ''))
}
function rankKnowledge(knowledge: Knowledge, question: string, history: ChatMessage[]) {
  const query = terms(question).slice(0, 24)
  const requested = intents(question)
  const phrase = ` ${words(question).join(' ')} `
  const skuHints: string[] = normalize(question).match(/[a-z0-9]+(?:[-_][a-z0-9]+)+/g) ?? []
  const askedSizes = sizeTokens(question)
  const active = knowledge.products.filter(product => product.active)
  const names = active.map(product => terms(`${product.name} ${product.sku}`))
  // Terms already in the product category are useful matches but not a unique
  // product anchor (e.g. "perfume" alone should not resolve an ambiguous "it").
  const anchors = active.map((product, index) => names[index].filter(term => !terms(product.category).includes(term)))
  const currentNames = anchors.map(name => nameMatch(name, query))
  let previousTerms: string[] = []
  const followup = /\b(?:it|its|that|this|one|those|them)\b|سعره|سعرها|بيها|بيه|هذا|هذي|هاي|متوفره|موجوده|وشكد/.test(normalize(question)) || (query.length <= 3 && (requested.has('price') || requested.has('stock')))
  // Use only previous CUSTOMER subjects, never assistant drafts as evidence.
  // An explicit new product name always takes precedence over old context.
  const categoryTerms = new Set(active.flatMap(product => terms(product.category)))
  const hasNewSubject = query.some(term => !intentKeys.has(term) && !categoryTerms.has(term))
  if (followup && !hasNewSubject && !currentNames.some(match => match.score > 0)) {
    for (const turn of history.filter(turn => turn.role === 'user').slice(-3).reverse()) {
      const candidate = terms(turn.content).slice(0, 24)
      if (anchors.some(name => nameMatch(name, candidate).score > 0)) { previousTerms = candidate; break }
    }
  }
  const historyUsed = previousTerms.length > 0
  const combined = [...new Set([...query, ...previousTerms])]
  const named = anchors.map((name, index) => historyUsed ? nameMatch(name, previousTerms) : currentNames[index])
  const hasAnchor = named.some(match => match.score > 0)
  const overlap = (text: string, tokens: string[]) => { const document = new Set(terms(text)); return tokens.filter(term => document.has(term)).length }
  const candidates = [
    ...active.map((product, index) => {
      const match = named[index]
      const exact = phrase.includes(` ${words(product.name).join(' ')} `) || (!!product.sku && phrase.includes(` ${words(product.sku).join(' ')} `))
      const sku = normalize(product.sku)
      const conflictingSKU = !!sku && !skuHints.includes(sku) && skuHints.some(hint => hint.split(/[-_]/)[0] === sku.split(/[-_]/)[0])
      const namedSizes = sizeTokens(product.name)
      const conflictingSize = askedSizes.length > 0 && (namedSizes.length === 0 || !askedSizes.some(size => namedSizes.includes(size)))
      const reason = conflictingSKU || conflictingSize ? 'variant' as const : historyUsed && match.reason === 'name' ? 'history' as const : match.reason
      const score = (hasAnchor && match.score === 0 ? 0 : match.score * 4 + (exact ? 60 : 0) + overlap(product.category, combined) * 3 + overlap(product.description, combined))
      return { score, entry: { type: 'product' as const, id: product.id, reason,
        data: { name: product.name, description: product.description, category: product.category, sku: product.sku, price: product.price, currency: product.currency, stock_status: product.stock_status } } }
    }),
    ...knowledge.faqs.filter(faq => faq.active).map(faq => ({ score: overlap(faq.question, combined) * 6 + overlap(faq.answer, query),
      entry: { type: 'faq' as const, id: faq.id, reason: 'keyword' as const, data: { question: faq.question, answer: faq.answer } } })),
    ...knowledge.information.map(info => ({ score: (requested.has(policyIntent[info.topic]) || (info.topic === 'general' && requested.has('human')) ? 90 : 0) + overlap(`${topicLabels[info.topic]} ${info.content}`, query) * 2,
      entry: { type: 'information' as const, id: info.id, reason: 'keyword' as const, data: { topic: info.topic, content: info.content } } })),
  ].filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
  const selected: KnowledgeEntry[] = []
  // Explicitly requested policies get space before generic product/category hits.
  const ordered = [...candidates.filter(item => item.entry.type === 'information' && item.score >= 90), ...candidates.filter(item => !(item.entry.type === 'information' && item.score >= 90))]
  for (const { entry } of ordered) {
    if (selected.length === MAX_KNOWLEDGE_ITEMS) break
    if (JSON.stringify([...selected, entry]).length <= MAX_KNOWLEDGE_CHARS) selected.push(entry)
  }
  return { entries: selected, historyUsed }
}
export function selectKnowledge(knowledge: Knowledge, question: string, history: ChatMessage[] = []): KnowledgeEntry[] {
  return rankKnowledge(knowledge, question, history).entries
}
export async function retrieveKnowledge(supabase: SupabaseClient, workspaceId: string, question: string, history: ChatMessage[] = []) {
  try { return { available: true, ...rankKnowledge(await readKnowledge(supabase, workspaceId), question, history) } }
  catch { return { available: false, entries: [] as KnowledgeEntry[], historyUsed: false } }
}

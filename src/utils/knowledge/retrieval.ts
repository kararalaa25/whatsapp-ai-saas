import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readKnowledge } from './access'
import { topicLabels, type Knowledge } from './schema'

export const MAX_KNOWLEDGE_CHARS = 10000
export const MAX_KNOWLEDGE_ITEMS = 8
export type KnowledgeEntry = { type: 'product' | 'faq' | 'information'; id: string; data: Record<string, string | number | null> }
const ignored = new Set(['the', 'and', 'for', 'are', 'you', 'your', 'what', 'how', 'can', 'with', 'this', 'that', 'have', 'about', 'please', 'من', 'في', 'هل', 'ما', 'على', 'عن', 'الى', 'كيف'])
export function normalize(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي')
}
function tokens(value: string) { return normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [] }
const topicWords = {
  opening_hours: 'hours opening open close schedule وقت ساعات دوام فتح اغلاق',
  delivery: 'delivery shipping deliver توصيل شحن',
  payment_methods: 'payment pay cash card دفع نقد بطاقة',
  returns: 'return returns refund exchange استرجاع ارجاع استبدال',
  general: 'business contact address location information معلومات عنوان موقع اتصال',
}
// No embeddings, model calls or claims of semantic understanding. Bounded lexical
// matching works with Arabic/English and keeps prices/stock exactly as stored.
export function selectKnowledge(knowledge: Knowledge, question: string): KnowledgeEntry[] {
  const terms = [...new Set(tokens(question).filter(term => term.length > 1 && term.length <= 64 && !ignored.has(term)))].slice(0, 24)
  if (!terms.length) return []
  const score = (primary: string, secondary: string) => {
    const first = new Set(tokens(primary)); const rest = new Set(tokens(secondary))
    return terms.reduce((sum, term) => sum + (first.has(term) ? 4 : rest.has(term) ? 1 : 0), 0)
  }
  const candidates = [
    ...knowledge.products.filter(p => p.active).map(p => ({ score: score(`${p.name} ${p.sku} ${p.category}`, p.description),
      entry: { type: 'product' as const, id: p.id, data: { name: p.name, description: p.description, category: p.category, sku: p.sku, price: p.price, currency: p.currency, stock_status: p.stock_status } } })),
    ...knowledge.faqs.filter(f => f.active).map(f => ({ score: score(f.question, f.answer),
      entry: { type: 'faq' as const, id: f.id, data: { question: f.question, answer: f.answer } } })),
    ...knowledge.information.map(info => ({ score: score(`${topicLabels[info.topic]} ${topicWords[info.topic]}`, info.content),
      entry: { type: 'information' as const, id: info.id, data: { topic: info.topic, content: info.content } } })),
  ].filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
  const selected: KnowledgeEntry[] = []
  for (const { entry } of candidates) {
    if (selected.length === MAX_KNOWLEDGE_ITEMS) break
    if (JSON.stringify([...selected, entry]).length <= MAX_KNOWLEDGE_CHARS) selected.push(entry)
  }
  return selected
}
export async function retrieveKnowledge(supabase: SupabaseClient, workspaceId: string, question: string) {
  try { return { available: true, entries: selectKnowledge(await readKnowledge(supabase, workspaceId), question) } }
  catch { return { available: false, entries: [] as KnowledgeEntry[] } }
}

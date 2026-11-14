// Shared serializable data only; importing this type never exposes server clients.
export type KnowledgeEntry = {
  type: 'product' | 'faq' | 'information'
  id: string
  data: Record<string, string | number | null>
  reason?: 'name' | 'spelling' | 'transliteration' | 'keyword' | 'history' | 'variant'
}
export type KnowledgePreview = {
  available: boolean
  entries: KnowledgeEntry[]
  historyUsed: boolean
  historyMessages: number
}

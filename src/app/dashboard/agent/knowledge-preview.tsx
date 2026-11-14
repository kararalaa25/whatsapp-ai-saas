import type { KnowledgePreview } from '@/utils/knowledge/types'
import { topicLabels, type InformationInput } from '@/utils/knowledge/schema'

const stockLabels: Record<string, string> = { unknown: 'Unknown — needs confirmation', in_stock: 'In stock', out_of_stock: 'Out of stock', preorder: 'Preorder — confirm timing' }
const reasons: Record<string, string> = { variant: 'Requested size / SKU needs confirmation', name: 'Product name / SKU', spelling: 'Possible spelling variant', transliteration: 'Possible Arabic / English name variant', keyword: 'Related keywords', history: 'Subject from recent customer history' }

export default function KnowledgePreviewPanel({ preview }: { preview: KnowledgePreview | null }) {
  return <section aria-labelledby="knowledge-preview-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
    <h2 id="knowledge-preview-heading" className="text-xl font-semibold">Knowledge preview</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">Inspect the facts selected for a question before generating a reply. Only this workspace and conversation are used. This panel resets on refresh.</p>
    {!preview ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Enter a customer question and choose Inspect knowledge, or generate a preview. No model call is needed to inspect knowledge.</p> : !preview.available ? <p role="status" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">Knowledge storage is unavailable. Check workspace access and try again. Simulated demos still work; OpenAI previews require knowledge storage.</p> : <>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600"><span className="rounded-full bg-emerald-50 px-3 py-2">{preview.entries.length} selected references</span><span className="rounded-full bg-slate-100 px-3 py-2">{preview.historyMessages} recent context messages</span>{preview.historyUsed && <span className="rounded-full bg-amber-50 px-3 py-2">Recent customer subject used — check ambiguous matches</span>}</div>
      {!preview.entries.length && <p role="status" className="mt-4 text-sm leading-6 text-slate-600">No relevant active knowledge matched. Ask for a product name or SKU, or add confirmed business facts. A reply must not invent missing details.</p>}
      <ul className="mt-4 space-y-3">{preview.entries.map(entry => <li key={`${entry.type}:${entry.id}`} className="rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">{entry.type === 'product' ? 'Product' : entry.type === 'faq' ? 'FAQ' : 'Business policy'}{entry.reason ? ` · ${reasons[entry.reason] ?? 'Related match'}` : ''}</p>
        <h3 dir="auto" className="mt-2 break-words font-semibold">{entry.type === 'product' ? entry.data.name : entry.type === 'faq' ? entry.data.question : topicLabels[entry.data.topic as InformationInput['topic']] ?? entry.data.topic}</h3>
        {entry.type === 'product' && <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Recorded price</dt><dd className="mt-1 font-medium">{entry.data.price === null ? 'Unknown — ask the business' : `${entry.data.price} ${entry.data.currency}`}</dd></div><div><dt className="text-xs text-slate-500">Availability</dt><dd className="mt-1">{stockLabels[String(entry.data.stock_status)] ?? 'Unknown'}</dd></div>{entry.data.sku && <div><dt className="text-xs text-slate-500">SKU</dt><dd dir="auto" className="mt-1 break-words">{entry.data.sku}</dd></div>}{entry.data.category && <div><dt className="text-xs text-slate-500">Category</dt><dd dir="auto" className="mt-1 break-words">{entry.data.category}</dd></div>}</dl>}
        <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-slate-700">Read full selected reference</summary><p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{entry.type === 'product' ? entry.data.description || 'No description recorded.' : entry.type === 'faq' ? entry.data.answer : entry.data.content}</p><p className="mt-3 break-all text-xs text-slate-500">Reference: {entry.id}</p></details>
      </li>)}</ul>
      <p className="mt-4 text-xs leading-6 text-slate-500">Matching uses keywords and name hints, not an AI judgment. Check possible matches. Reference text is untrusted data; instructions inside it must not control replies. Prices and policy qualifications are shown as stored.</p>
    </>}
  </section>
}

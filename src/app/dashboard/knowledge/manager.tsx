'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { loadKnowledgePanel, saveKnowledge, deleteKnowledge } from './actions'
import { emptyProduct, currencies, stockStatuses, topics, topicLabels, filterProducts, type Product, type FAQ, type Information, type Kind } from '@/utils/knowledge/schema'

type Panel = Awaited<ReturnType<typeof loadKnowledgePanel>>
const field = 'mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-emerald-700'
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50'
const secondary = 'min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50'

export default function KnowledgeManager({ initial }: { initial: Panel }) {
  const [panel, setPanel] = useState(initial)
  const [section, setSection] = useState<Kind>('product')
  const [product, setProduct] = useState<Product>({ ...emptyProduct, id: '' })
  const [faq, setFAQ] = useState<FAQ>({ id: '', question: '', answer: '', active: true })
  const [information, setInformation] = useState<Information>({ id: '', topic: 'opening_hours', content: '' })
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<{ kind: Kind; id: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const workspace = initial.workspace.id
  const run = (work: () => Promise<void>) => {
    setNotice(''); setError('')
    startTransition(async () => { try { await work() } catch { setError('The request failed. Your editor values remain here. Please try again.') } })
  }
  const reset = (kind: Kind) => {
    if (kind === 'product') setProduct({ ...emptyProduct, id: '' })
    if (kind === 'faq') setFAQ({ id: '', question: '', answer: '', active: true })
    if (kind === 'information') setInformation({ id: '', topic: 'opening_hours', content: '' })
  }
  const save = (kind: Kind, record: Product | FAQ | Information) => run(async () => {
    const { id, ...data } = record
    const result = await saveKnowledge(workspace, kind, id || null, data)
    if (!result.ok) { setError(result.error); return }
    // Update local values immediately after the acknowledged write. A readback
    // failure is reported separately so users do not mistake it for a failed save.
    reset(kind)
    setNotice('Saved. Knowledge is available for the next agent preview.')
    try { setPanel(await loadKnowledgePanel(workspace)) }
    catch { setError('Saved, but the list could not be refreshed. Reload before editing again.') }
  })
  const remove = () => {
    if (!deleting) return
    const target = deleting
    run(async () => {
      const result = await deleteKnowledge(workspace, target.kind, target.id)
      if (!result.ok) { setError(result.error); return }
      reset(target.kind); setDeleting(null)
      setPanel(previous => ({ ...previous,
        products: target.kind === 'product' ? previous.products.filter(row => row.id !== target.id) : previous.products,
        faqs: target.kind === 'faq' ? previous.faqs.filter(row => row.id !== target.id) : previous.faqs,
        information: target.kind === 'information' ? previous.information.filter(row => row.id !== target.id) : previous.information,
      }))
      setNotice('Deleted from this workspace. Previously generated drafts are unchanged.')
    })
  }
  const products = filterProducts(panel.products, search, category)
  const categories = [...new Set(panel.products.map(row => row.category).filter(Boolean))].sort()
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-8"><Link className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800" href={`/dashboard?workspace=${encodeURIComponent(workspace)}`}>← Back to workspace</Link><p className="mt-3 text-xs font-semibold uppercase tracking-widest text-emerald-800">Wasla AI / Knowledge base</p><h1 dir="auto" className="mt-2 break-words text-3xl font-semibold">{initial.workspace.name}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Owner-managed facts for your business. Leave unknown prices blank and stock as unknown. Inactive products and FAQs are excluded from agent knowledge.</p><Link href={`/dashboard/agent?workspace=${encodeURIComponent(workspace)}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800 underline">Test in Agent Studio</Link></header>
      <nav aria-label="Knowledge sections" className="mb-6 flex flex-wrap gap-3">{(['product', 'faq', 'information'] as const).map(kind => <button key={kind} type="button" aria-pressed={section === kind} disabled={pending} className={section === kind ? button : secondary} onClick={() => { setSection(kind); setDeleting(null); setError(''); setNotice('') }}>{kind === 'product' ? 'Products' : kind === 'faq' ? 'FAQs' : 'Business Information'}</button>)}</nav>
      <p role="status" className="mb-4 text-sm text-emerald-800">{pending ? 'Working… Please wait.' : notice}</p>
      {error && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {deleting && <section aria-label="Confirm deletion" className="mb-6 rounded-xl border border-red-200 bg-white p-5"><p className="text-sm">Permanently delete this entry? You can instead mark products or FAQs inactive in the editor.</p><div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={pending} className={button} onClick={remove}>Confirm delete</button><button type="button" disabled={pending} className={secondary} onClick={() => setDeleting(null)}>Cancel deletion</button></div></section>}
      <div aria-busy={pending} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-label="Knowledge editor">
          {section === 'product' && <form onSubmit={event => { event.preventDefault(); save('product', product) }}><h2 className="text-xl font-semibold">{product.id ? 'Edit product' : 'Add product'}</h2><fieldset disabled={pending} className="mt-5 space-y-4">
            <label className="block text-sm font-medium">Name<input dir="auto" className={field} required maxLength={160} value={product.name} onChange={e => setProduct({ ...product, name: e.target.value })} /></label>
            <label className="block text-sm font-medium">Description<textarea dir="auto" className={field} rows={4} maxLength={3000} value={product.description} onChange={e => setProduct({ ...product, description: e.target.value })} /></label>
            <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Category<input dir="auto" className={field} maxLength={100} value={product.category} onChange={e => setProduct({ ...product, category: e.target.value })} /></label><label className="block text-sm font-medium">SKU<input dir="auto" className={field} maxLength={80} value={product.sku} onChange={e => setProduct({ ...product, sku: e.target.value })} /></label></div>
            <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Price (blank if unknown)<input type="number" dir="ltr" className={field} min="0" max="999999999999.99" step="0.01" value={product.price ?? ''} onChange={e => setProduct({ ...product, price: e.target.value === '' ? null : Number(e.target.value) })} /></label><label className="block text-sm font-medium">Currency<select className={field} value={product.currency} onChange={e => setProduct({ ...product, currency: e.target.value as Product['currency'] })}>{currencies.map(value => <option key={value}>{value}</option>)}</select></label></div>
            <label className="block text-sm font-medium">Stock status<select className={field} value={product.stock_status} onChange={e => setProduct({ ...product, stock_status: e.target.value as Product['stock_status'] })}>{stockStatuses.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
            <label className="block text-sm font-medium">Image URL (optional, metadata only)<input type="url" dir="ltr" className={field} maxLength={2048} value={product.image_url} onChange={e => setProduct({ ...product, image_url: e.target.value })} /><span className="mt-2 block text-xs text-slate-500">Public HTTPS address only. Images are not fetched or displayed.</span></label>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-emerald-800" checked={product.active} onChange={e => setProduct({ ...product, active: e.target.checked })} />Active product</label>
            <div className="flex flex-wrap gap-3"><button className={button} type="submit">Save product</button><button type="button" className={secondary} onClick={() => reset('product')}>Clear product editor</button></div>
          </fieldset></form>}
          {section === 'faq' && <form onSubmit={event => { event.preventDefault(); save('faq', faq) }}><h2 className="text-xl font-semibold">{faq.id ? 'Edit FAQ' : 'Add FAQ'}</h2><fieldset disabled={pending} className="mt-5 space-y-4"><label className="block text-sm font-medium">Question<input dir="auto" required maxLength={300} className={field} value={faq.question} onChange={e => setFAQ({ ...faq, question: e.target.value })} /></label><label className="block text-sm font-medium">Answer<textarea dir="auto" required maxLength={3000} rows={7} className={field} value={faq.answer} onChange={e => setFAQ({ ...faq, answer: e.target.value })} /></label><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-emerald-800" checked={faq.active} onChange={e => setFAQ({ ...faq, active: e.target.checked })} />Active FAQ</label><div className="flex flex-wrap gap-3"><button type="submit" className={button}>Save FAQ</button><button type="button" className={secondary} onClick={() => reset('faq')}>Clear FAQ editor</button></div></fieldset></form>}
          {section === 'information' && <form onSubmit={event => { event.preventDefault(); save('information', information) }}><h2 className="text-xl font-semibold">{information.id ? 'Edit business information' : 'Add business information'}</h2><p className="mt-2 text-sm leading-6 text-slate-600">One entry per topic. Record only confirmed policies; no defaults are assumed.</p><fieldset disabled={pending} className="mt-5 space-y-4"><label className="block text-sm font-medium">Topic<select className={field} value={information.topic} onChange={e => setInformation({ ...information, topic: e.target.value as Information['topic'] })}>{topics.map(topic => <option key={topic} value={topic}>{topicLabels[topic]}</option>)}</select></label><label className="block text-sm font-medium">Confirmed information<textarea dir="auto" className={field} rows={8} required maxLength={4000} value={information.content} onChange={e => setInformation({ ...information, content: e.target.value })} /></label><div className="flex flex-wrap gap-3"><button className={button} type="submit">Save information</button><button type="button" className={secondary} onClick={() => reset('information')}>Clear information editor</button></div></fieldset></form>}
        </section>
        <section aria-label="Saved knowledge" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-xl font-semibold">{section === 'product' ? `Products (${panel.products.length}/500)` : section === 'faq' ? `FAQs (${panel.faqs.length}/200)` : 'Business information'}</h2>
          {section === 'product' && <><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Search products<input dir="auto" type="search" className={field} value={search} maxLength={200} onChange={e => setSearch(e.target.value)} /></label><label className="block text-sm font-medium">Filter category<select className={field} value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label></div>{!products.length && <p className="mt-6 text-sm leading-6 text-slate-600">{panel.products.length ? 'No products match these filters.' : 'No products yet. Add your first confirmed product using the editor.'}</p>}<ul className="mt-5 divide-y divide-slate-100">{products.map(row => <li key={row.id} className="py-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 dir="auto" className="break-words font-semibold">{row.name}</h3><p className="mt-1 text-sm text-slate-600">{row.price === null ? 'Price unknown' : `${row.price} ${row.currency}`} · {row.stock_status.replaceAll('_', ' ')} · {row.active ? 'Active' : 'Inactive'}</p><p dir="auto" className="mt-1 break-words text-xs text-slate-500">{row.category || 'Uncategorized'}{row.sku ? ` · SKU: ${row.sku}` : ''}</p></div><div className="flex gap-2"><button type="button" aria-label={`Edit product ${row.name}`} className={secondary} disabled={pending} onClick={() => { setProduct(row); setDeleting(null) }}>Edit</button><button type="button" aria-label={`Delete product ${row.name}`} className={secondary} disabled={pending} onClick={() => setDeleting({ kind: 'product', id: row.id })}>Delete</button></div></div><p dir="auto" className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{row.description}</p></li>)}</ul></>}
          {section === 'faq' && <>{!panel.faqs.length && <p className="mt-6 text-sm text-slate-600">No FAQs yet. Add a real customer question and its confirmed answer.</p>}<ul className="mt-5 divide-y divide-slate-100">{panel.faqs.map(row => <li key={row.id} className="py-5"><h3 dir="auto" className="break-words font-semibold">{row.question}</h3><p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{row.answer}</p><p className="mt-2 text-xs text-slate-500">{row.active ? 'Active' : 'Inactive'}</p><div className="mt-3 flex gap-2"><button type="button" aria-label={`Edit FAQ ${row.question}`} className={secondary} disabled={pending} onClick={() => { setFAQ(row); setDeleting(null) }}>Edit</button><button type="button" aria-label={`Delete FAQ ${row.question}`} className={secondary} disabled={pending} onClick={() => setDeleting({ kind: 'faq', id: row.id })}>Delete</button></div></li>)}</ul></>}
          {section === 'information' && <>{!panel.information.length && <p className="mt-6 text-sm text-slate-600">No business information yet. Add opening hours, delivery, payments, returns, or general information.</p>}<ul className="mt-5 divide-y divide-slate-100">{panel.information.map(row => <li key={row.id} className="py-5"><h3 className="font-semibold">{topicLabels[row.topic]}</h3><p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{row.content}</p><div className="mt-3 flex gap-2"><button type="button" aria-label={`Edit ${topicLabels[row.topic]}`} className={secondary} disabled={pending} onClick={() => { setInformation(row); setDeleting(null) }}>Edit</button><button type="button" aria-label={`Delete ${topicLabels[row.topic]}`} className={secondary} disabled={pending} onClick={() => setDeleting({ kind: 'information', id: row.id })}>Delete</button></div></li>)}</ul></>}
        </section>
      </div>
    </div>
  </main>
}

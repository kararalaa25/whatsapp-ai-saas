'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { AgentSettings, ChatMessage, Conversation } from '@/utils/ai/settings'
import { saveAgent, newConversation, readConversation, previewReply, setConversationStatus, type Snapshot } from './actions'

type Panel = { workspace: { id: string; name: string }; settings: AgentSettings; conversations: Conversation[]; storageAvailable: boolean; openAIAvailable: boolean }
const field = 'mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100'
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50'

export default function AgentStudio({ initial }: { initial: Panel }) {
  const [settings, setSettings] = useState(initial.settings)
  const [threads, setThreads] = useState(initial.conversations)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'demo' | 'openai'>('demo')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const id = initial.workspace.id
  const adopt = (next: Snapshot) => {
    setSnapshot(next); setMessages(next.messages)
    setThreads((previous) => [next.conversation, ...previous.filter((item) => item.id !== next.conversation.id)])
  }
  const run = (work: () => Promise<void>) => {
    setError(''); setNotice('')
    startTransition(async () => { try { await work() } catch { setError('The request failed. Your draft remains here; please try again.') } })
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 font-sans text-slate-950 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><Link href={`/dashboard?workspace=${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">← Back to workspace</Link><p className="mt-3 text-xs font-semibold uppercase tracking-widest text-emerald-800">Wasla AI / Agent studio</p><h1 className="mt-2 break-words text-3xl font-semibold tracking-tight">{initial.workspace.name}</h1><p className="mt-2 text-sm text-slate-600">Shape your assistant. Test every reply before connecting delivery.</p></div>
          <span className="self-start rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900">WhatsApp sending is locked</span>
        </header>
        {!initial.storageAvailable && <p role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Saved settings and history are unavailable. Apply the reviewed Phase 5B migration later, or check database access. You can still test in temporary demo mode; nothing in that mode is saved.</p>}
        {error && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        <p role="status" className="mb-4 text-sm text-emerald-800">{pending ? 'Working… Please wait.' : notice}</p>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]">
          <section aria-labelledby="agent-settings" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <h2 id="agent-settings" className="text-xl font-semibold">Your agent</h2><p className="mt-2 text-sm leading-6 text-slate-600">Owner-only settings. These control previews and drafts, never delivery.</p>
            <form onSubmit={(event) => { event.preventDefault(); run(async () => { const result = await saveAgent(id, settings); if (!result.ok) setError(result.error); else setNotice('Agent settings saved. WhatsApp delivery remains disabled.') }) }} className="mt-6">
              <fieldset disabled={pending} className="space-y-5">
                <label className="flex min-h-11 items-center gap-3 rounded-xl bg-emerald-50 p-3 text-sm font-medium"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} className="size-5 accent-emerald-800" />Enable agent previews</label>
                <label className="block text-sm font-medium">Business description<textarea className={field} rows={4} maxLength={3000} value={settings.business_description} onChange={(event) => setSettings({ ...settings, business_description: event.target.value })} placeholder="What do you sell? What should customers know? Use synthetic test information." /></label>
                <label className="block text-sm font-medium">Agent instructions<textarea className={field} rows={5} maxLength={4000} value={settings.instructions} onChange={(event) => setSettings({ ...settings, instructions: event.target.value })} placeholder="Explain how to help, when to ask a question, and when to hand over to a person." /></label>
                <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Language<select className={field} value={settings.language} onChange={(event) => setSettings({ ...settings, language: event.target.value as AgentSettings['language'] })}><option value="auto">Match customer</option><option value="en">English</option><option value="ar">Arabic</option></select></label><label className="block text-sm font-medium">Tone<select className={field} value={settings.tone} onChange={(event) => setSettings({ ...settings, tone: event.target.value as AgentSettings['tone'] })}><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="concise">Concise</option></select></label></div>
                <label className="block text-sm font-medium">OpenAI model<select className={field} value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value as AgentSettings['model'] })}><option value="gpt-4.1-mini">GPT-4.1 mini</option><option value="gpt-4.1">GPT-4.1</option></select></label>
                <button className={button} disabled={!initial.storageAvailable} type="submit">Save agent settings</button>
                <p className="text-xs leading-5 text-slate-500">Never enter API keys, customer secrets, or production data. Demo uses the editor; OpenAI uses saved settings.</p>
              </fieldset>
            </form>
          </section>
          <div className="space-y-6">
            <section aria-labelledby="playground-heading" aria-busy={pending} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="playground-heading" className="text-xl font-semibold">{snapshot?.conversation.channel === 'whatsapp_test' ? 'Customer draft inbox' : 'Test playground'}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">{mode === 'demo' ? 'Simulated · no model calls' : 'OpenAI · draft only'}</span></div><p className="mt-2 text-sm leading-6 text-slate-600">{snapshot ? `${snapshot.conversation.title} · ${snapshot.conversation.status}` : 'Temporary demo. Start a saved conversation to keep history or use OpenAI.'}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3"><label className="text-sm">Provider<select className={field} disabled={pending} value={mode} onChange={(event) => setMode(event.target.value as 'demo' | 'openai')}><option value="demo">Demo (no API key needed)</option><option value="openai" disabled={!initial.openAIAvailable || !initial.storageAvailable}>OpenAI preview{!initial.openAIAvailable ? ' — not configured' : ''}</option></select></label><button type="button" disabled={pending} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-medium" onClick={() => { setSnapshot(null); setMessages([]); setMode('demo'); setError(''); setInput('') }}>Reset temporary demo</button></div>
              </div>
              <div role="log" aria-label="Conversation messages" aria-live="polite" className="max-h-[32rem] min-h-64 space-y-4 overflow-y-auto bg-slate-50 p-5 sm:p-7">
                {!messages.length && <div className="py-12 text-center"><p className="font-semibold">Try a customer question</p><p className="mt-2 text-sm text-slate-600">Enable previews, then ask about opening hours or a product.</p></div>}
                {messages.map((message, index) => <div key={index} className={`max-w-[95%] rounded-2xl p-4 sm:max-w-[85%] ${message.role === 'user' ? 'ml-auto bg-emerald-800 text-white' : 'border border-slate-200 bg-white'}`}><p className="mb-2 text-xs font-semibold">{message.role === 'user' ? 'Test customer' : message.provider === 'demo' ? 'Simulated reply' : 'AI draft · not sent'}</p><p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p></div>)}
              </div>
              <form className="border-t border-slate-200 p-5 sm:p-7" onSubmit={(event) => { event.preventDefault(); run(async () => { const result = await previewReply(id, snapshot?.conversation.id ?? null, input, mode, settings, messages.slice(-20)); if (!result.ok) setError(result.error); else { setMessages(result.data.messages); if (result.data.snapshot) adopt(result.data.snapshot); setInput(''); setNotice('Reply generated for review only. Nothing was sent to WhatsApp.') } }) }}>
                <fieldset disabled={pending || snapshot?.conversation.status === 'closed'}><label className="block text-sm font-medium">{snapshot?.conversation.channel === 'whatsapp_test' ? 'Reply to the latest received customer text' : 'Customer message'}{snapshot?.conversation.channel !== 'whatsapp_test' && <textarea className={field} rows={3} required maxLength={3000} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Hi! What time do you open?" />}</label><button className={`${button} mt-4`} type="submit">{pending ? 'Generating…' : 'Generate reply preview'}</button></fieldset>
                {snapshot && <button type="button" disabled={pending} className="mt-3 min-h-11 text-sm font-medium text-slate-600 underline" onClick={() => run(async () => { const result = await setConversationStatus(id, snapshot.conversation.id, snapshot.conversation.status === 'open' ? 'closed' : 'open'); if (result.ok) adopt(result.data); else setError(result.error) })}>{snapshot.conversation.status === 'open' ? 'Close conversation' : 'Reopen conversation'}</button>}
              </form>
            </section>
            <section aria-labelledby="history-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="history-heading" className="text-xl font-semibold">Saved conversations</h2><button className={button} type="button" disabled={pending || !initial.storageAvailable} onClick={() => run(async () => { const result = await newConversation(id); if (result.ok) adopt(result.data); else setError(result.error) })}>New playground</button></div><p className="mt-2 text-xs leading-5 text-slate-500">New signed WhatsApp test texts with a sender ID appear here after page refresh. Older Phase 5A messages are not backfilled. Latest 30 conversations, with the latest 20 messages used as context.</p>{!threads.length ? <p className="mt-5 text-sm text-slate-600">No saved conversations yet.</p> : <ul className="mt-4 divide-y divide-slate-100">{threads.map((thread) => <li key={thread.id}><button type="button" disabled={pending} aria-pressed={snapshot?.conversation.id === thread.id} className="flex min-h-14 w-full flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-3 text-left text-sm hover:bg-slate-50 aria-pressed:bg-emerald-50" onClick={() => run(async () => { const result = await readConversation(id, thread.id); if (result.ok) { adopt(result.data); setInput('') } else setError(result.error) })}><span className="font-medium">{thread.title}</span><span className="text-xs text-slate-500">{thread.channel === 'playground' ? 'Playground' : 'WhatsApp test'} · {thread.status}</span></button></li>)}</ul>}</section>
          </div>
        </div>
      </div>
    </main>
  )
}

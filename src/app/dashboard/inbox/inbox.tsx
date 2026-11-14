'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { listInbox, loadInboxPanel, readInbox, loadInboxMessages, manageInbox, markInboxRead, generateInboxDraft, createManualInboxDraft, changeInboxDraft } from './actions'
import { runAutomation } from '../automation/actions'
import { inboxStatuses, mergeMessages, mergeConversations, type InboxDetail, type InboxStatus, type InboxDraft } from '@/utils/inbox/model'
import KnowledgePreviewPanel from '../agent/knowledge-preview'

type Panel = Awaited<ReturnType<typeof loadInboxPanel>>
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50 disabled:cursor-not-allowed'
const secondary = 'min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50'
const field = 'mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-emerald-700'
const labels = { open: 'Open', pending_human: 'Pending human', closed: 'Closed' }
function time(value: string | null) { return value ? new Date(value).toLocaleString('en', { timeZone: 'Asia/Baghdad', dateStyle: 'medium', timeStyle: 'short' }) : 'No messages' }

export default function Inbox({ initial, selected }: { initial: Panel; selected: InboxDetail | null }) {
  const [rows, setRows] = useState(initial.rows)
  const [next, setNext] = useState(initial.next)
  const [filter, setFilter] = useState('all')
  const [detail, setDetail] = useState(selected)
  const [status, setStatus] = useState<InboxStatus>(selected?.state.status ?? 'open')
  const [takeover, setTakeover] = useState(selected?.state.human_takeover ?? false)
  const [assignee, setAssignee] = useState(selected?.state.assigned_user_id ?? '')
  const [manual, setManual] = useState('')
  const [editing, setEditing] = useState<{ id: string; revision: number; content: string } | null>(null)
  const [mode, setMode] = useState<'demo' | 'openai'>('demo')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const workspace = initial.workspace.id
  const latest = detail?.messages.at(-1)
  const generationBlocked = takeover || status !== 'open' || !detail || detail.state.status !== 'open' || detail.state.human_takeover || !initial.agentEnabled || detail.drafts.some(draft => draft.source_position === latest?.position && draft.status !== 'discarded')
  const url = (id: string | null) => {
    const location = new URL(window.location.href)
    location.searchParams.set('workspace', workspace)
    if (id) location.searchParams.set('conversation', id); else location.searchParams.delete('conversation')
    window.history.replaceState(window.history.state, '', location)
  }
  const adopt = (value: InboxDetail) => {
    setDetail(value); setStatus(value.state.status); setTakeover(value.state.human_takeover); setAssignee(value.state.assigned_user_id ?? '')
    setEditing(null); setManual(''); url(value.conversation.id)
  }
  const run = (work: () => Promise<void>) => {
    setError(''); setNotice('')
    startTransition(async () => { try { await work() } catch { setError('Request failed. No sending was attempted. Refresh before retrying a write.') } })
  }
  const refreshList = async () => {
    const result = await listInbox(workspace, null, filter)
    if (result.ok) { setRows(result.data.rows); setNext(result.data.next) }
    else setError(result.error)
  }
  const apply = async (result: Awaited<ReturnType<typeof readInbox>>) => {
    if (!result.ok) { setError(result.error); return }
    adopt(result.data); setNotice(result.notice ?? 'Inbox refreshed. All drafts remain NOT SENT.')
    await refreshList()
  }
  const changeDraft = (draft: InboxDraft, operation: 'approve' | 'discard') => {
    if (!detail) return
    run(async () => apply(await changeInboxDraft(workspace, detail.conversation.id, draft.id, draft.revision, operation)))
  }
  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><Link href={`/dashboard?workspace=${encodeURIComponent(workspace)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">← Back to workspace</Link><p className="mt-2 text-xs font-semibold uppercase tracking-widest text-emerald-800">Wasla AI / WhatsApp test inbox</p><h1 dir="auto" className="mt-2 break-words text-3xl font-semibold">{initial.workspace.name}</h1><p className="mt-2 text-sm text-slate-600">Verified customer texts. Owner-reviewed local drafts. Times shown in Baghdad.</p></div><span className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-950">Sending disabled · approval never delivers</span></header>
      <p role="status" className="mb-3 min-h-6 text-sm text-emerald-800">{pending ? 'Working… Please wait.' : notice}</p>
      {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      <div aria-busy={pending} className="grid items-start gap-5 lg:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.5fr)]">
        <section aria-label="Conversation inbox" className={`${detail ? 'hidden lg:block' : ''} rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5`}>
          <h2 className="text-xl font-semibold">Conversations</h2><div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm font-medium">Status<select className={field} disabled={pending} value={filter} onChange={event => { const value = event.target.value; setFilter(value); run(async () => { const result = await listInbox(workspace, null, value); if (result.ok) { setRows(result.data.rows); setNext(result.data.next) } else setError(result.error) }) }}><option value="all">All statuses</option>{inboxStatuses.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label><button type="button" disabled={pending} className={secondary} onClick={() => run(refreshList)}>Refresh list</button></div>
          {!rows.length && <p className="mt-6 text-sm leading-6 text-slate-600">No WhatsApp test conversations match this view. Only new signature-verified test texts with a sender identifier create customer threads.</p>}
          <ul className="mt-4 divide-y divide-slate-100">{rows.map(row => <li key={row.id}><button type="button" disabled={pending} aria-pressed={detail?.conversation.id === row.id} className="w-full rounded-xl p-3 text-left hover:bg-slate-50 aria-pressed:bg-emerald-50 disabled:opacity-50" onClick={() => run(async () => { const result = await readInbox(workspace, row.id); if (result.ok) adopt(result.data); else setError(result.error) })}><div className="flex flex-wrap justify-between gap-2"><span dir="ltr" className="break-all font-semibold">{row.customer_wa_id}</span>{row.unread_count > 0 && <span className="rounded-full bg-emerald-800 px-2 py-1 text-xs font-semibold text-white">{row.unread_count} unread</span>}</div><p className="mt-2 text-xs text-slate-500">{labels[row.status]}{row.human_takeover ? ' · Human control' : ''}</p><p className="mt-1 text-xs text-slate-500">{row.assigned_user_id ? `Assigned · ${row.assigned_user_id.slice(-8)}` : 'Unassigned'}</p><p dir="auto" className="mt-2 line-clamp-2 break-words text-sm text-slate-700">{row.recent_message ?? 'No verified text yet.'}</p><p className="mt-2 text-xs text-slate-500"><time dateTime={row.latest_received_at ?? undefined}>{time(row.latest_received_at)}</time></p><p className="mt-1 break-all text-xs text-slate-400">Connection {row.connection_id}</p></button></li>)}</ul>
          {next && <button type="button" className={`${secondary} mt-4 w-full`} disabled={pending} onClick={() => run(async () => { const result = await listInbox(workspace, next, filter); if (result.ok) { setRows(previous => mergeConversations(previous, result.data.rows)); setNext(result.data.next) } else setError(result.error) })}>Load more conversations</button>}
        </section>
        {!detail ? <section className="hidden rounded-2xl border border-slate-200 bg-white p-10 text-center lg:block"><h2 className="text-xl font-semibold">Choose a customer conversation</h2><p className="mt-3 text-sm leading-6 text-slate-600">Review the verified history, manage human control, and prepare an unsent reply.</p></section> : <section aria-label="Selected conversation" className="min-w-0 space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={pending} className={`${secondary} lg:hidden`} onClick={() => { setDetail(null); setEditing(null); setManual(''); url(null) }}>← Conversations</button><h2 dir="ltr" className="break-all text-xl font-semibold">Customer {detail.conversation.customer_wa_id}</h2><button type="button" disabled={pending} className={secondary} onClick={() => run(async () => apply(await readInbox(workspace, detail.conversation.id)))}>Refresh conversation</button></div><p className="mt-2 break-all text-xs text-slate-500">Test connection {detail.conversation.connection_id}</p>
            <form className="mt-5" onSubmit={event => { event.preventDefault(); run(async () => apply(await manageInbox(workspace, detail.conversation.id, { status, human_takeover: takeover, assigned_user_id: assignee || null, revision: detail.state.revision }))) }}><fieldset disabled={pending} className="grid items-end gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Conversation status<select className={field} value={status} onChange={event => { const value = event.target.value as InboxStatus; setStatus(value); if (value !== 'open') setTakeover(true) }}>{inboxStatuses.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label><label className="text-sm font-medium">Assigned workspace member<select className={field} value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">Unassigned</option>{assignee && !initial.members.some(member => member.user_id === assignee) && <option value={assignee}>Assigned member · {assignee}</option>}{initial.members.map(member => <option key={member.user_id} value={member.user_id}>{member.role} · {member.user_id}</option>)}</select></label><label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input className="size-5 accent-emerald-800" type="checkbox" checked={takeover} onChange={event => setTakeover(event.target.checked)} />Human takeover — block AI generation</label><button type="submit" className={button}>Save management</button></fieldset></form>
            <p className="mt-3 text-xs leading-6 text-slate-500">Reopen by selecting Open. To resume generation, explicitly release takeover too. Only the workspace owner can manage this inbox.</p>
          </div>
          <section aria-labelledby="customer-history-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="customer-history-heading" className="text-lg font-semibold">Verified customer history</h2><button type="button" className={secondary} disabled={pending || !latest} onClick={() => latest && run(async () => apply(await markInboxRead(workspace, detail.conversation.id, latest.position)))}>Mark visible messages read</button></div>
            {detail.before && <button type="button" disabled={pending} className={`${secondary} mt-4 w-full`} onClick={() => run(async () => { const result = await loadInboxMessages(workspace, detail.conversation.id, detail.before); if (result.ok) setDetail(previous => previous ? { ...previous, messages: mergeMessages(result.data.messages, previous.messages), before: result.data.before } : previous); else setError(result.error) })}>Load earlier messages</button>}
            <div role="log" aria-label="Verified inbound messages" className="mt-5 max-h-[32rem] space-y-3 overflow-y-auto">{!detail.messages.length && <p className="py-8 text-center text-sm text-slate-600">No verified inbound text is available for this conversation.</p>}{detail.messages.map(message => <article key={message.id} className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-emerald-800">Customer · verified inbound</p><p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{message.content}</p><time dateTime={message.received_at} className="mt-2 block text-xs text-slate-500">{time(message.received_at)}</time></article>)}</div>
          </section>
          <section aria-labelledby="draft-composer-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 id="draft-composer-heading" className="text-lg font-semibold">Prepare a reply — NOT SENT</h2><p className="mt-2 text-sm leading-6 text-slate-600">Suggestions use the latest verified text and bounded customer history. There is no automatic delivery.</p>
            {(detail.state.human_takeover || detail.state.status === 'pending_human') && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Human control is active. AI generation is blocked; an owner can still write and review manual drafts.</p>}
            {!initial.agentEnabled && <p className="mt-3 text-sm text-slate-600">Enable previews in <Link className="font-semibold text-emerald-800 underline" href={`/dashboard/agent?workspace=${encodeURIComponent(workspace)}`}>Agent Studio</Link> to generate suggestions.</p>}
            <div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm font-medium">Suggestion provider<select className={field} value={mode} disabled={pending} onChange={event => setMode(event.target.value as 'demo' | 'openai')}><option value="demo">Simulated example · no model calls</option><option value="openai" disabled={!initial.openAIAvailable}>OpenAI preview{!initial.openAIAvailable ? ' — unavailable' : ''}</option></select></label><button type="button" disabled={pending || generationBlocked || !latest} className={button} onClick={() => run(async () => apply(await generateInboxDraft(workspace, detail.conversation.id, mode)))}>Generate suggested draft</button></div>
            <form className="mt-5" onSubmit={event => { event.preventDefault(); run(async () => apply(await createManualInboxDraft(workspace, detail.conversation.id, manual, latest?.position ?? 0))) }}><fieldset disabled={pending || detail.state.status === 'closed' || !latest}><label className="block text-sm font-medium">Manual reply draft<textarea dir="auto" required maxLength={6000} rows={4} className={field} value={manual} onChange={event => setManual(event.target.value)} placeholder="Write a reply for local review. Nothing will be delivered." /></label><button type="submit" className={`${secondary} mt-3`}>Save manual draft</button></fieldset></form>
          </section>
          <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Draft automation · no delivery</h2><p className="mt-2 text-sm">Process the latest verified text using workspace automation preferences. One automation draft per source; human control blocks generation.</p><button type="button" disabled={pending || takeover || status !== 'open' || !latest || detail.state.human_takeover || detail.state.status !== 'open'} className={button} onClick={() => run(async () => apply(await runAutomation(workspace, detail.conversation.id)))}>Run draft-only automation</button><Link href={`/dashboard/automation?workspace=${workspace}`} className="ml-4 inline-flex min-h-11 items-center underline">Automation preferences</Link></div>
          <section aria-labelledby="local-drafts-heading" className="space-y-4"><h2 id="local-drafts-heading" className="text-xl font-semibold">Local drafts · latest 20</h2>{!detail.drafts.length && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No local inbox drafts yet. Generate a simulated suggestion or write one manually. Older Studio drafts remain in Agent Studio.</p>}{detail.drafts.map(draft => {
            const stale = draft.source_position !== latest?.position
            return <article key={draft.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">{draft.provider === 'demo' ? 'Simulated example' : draft.provider === 'openai' ? 'AI draft' : 'Manual draft'}{draft.edited ? ' · edited' : ''}</p><span className="rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">{draft.status === 'approved' ? 'Approved locally' : draft.status === 'discarded' ? 'Discarded' : 'Needs review'} · NOT SENT</span></div><p className="mt-2 text-xs text-slate-500">{time(draft.created_at)}{draft.approved_at ? ` · Local approval ${time(draft.approved_at)}` : ''}</p>{stale && <p role="status" className="mt-3 text-sm text-amber-900">A newer customer text exists. This draft cannot be approved; discard it and prepare a current reply.</p>}
              {editing?.id === draft.id ? <form className="mt-4" onSubmit={event => { event.preventDefault(); run(async () => apply(await changeInboxDraft(workspace, detail.conversation.id, draft.id, editing.revision, 'edit', editing.content))) }}><label className="block text-sm font-medium">Edit unsent draft<textarea dir="auto" required maxLength={6000} rows={5} className={field} disabled={pending} value={editing.content} onChange={event => setEditing({ ...editing, content: event.target.value })} /></label><div className="mt-3 flex gap-3"><button type="submit" disabled={pending} className={button}>Save edits and require review</button><button type="button" disabled={pending} className={secondary} onClick={() => setEditing(null)}>Cancel edit</button></div></form> : <p dir="auto" className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">{draft.content}</p>}
              {!editing && draft.status !== 'discarded' && <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={pending || detail.state.status === 'closed'} className={secondary} onClick={() => setEditing({ id: draft.id, revision: draft.revision, content: draft.content })}>Edit draft</button><button type="button" disabled={pending || stale || draft.status !== 'draft' || detail.state.status === 'closed'} className={button} onClick={() => changeDraft(draft, 'approve')}>Approve locally · do not send</button><button type="button" disabled={pending} className={secondary} onClick={() => changeDraft(draft, 'discard')}>Discard draft</button></div>}
              {draft.knowledge_refs.length > 0 && <details className="mt-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-emerald-800">Review {draft.knowledge_refs.length} saved knowledge references</summary><KnowledgePreviewPanel headingId={`draft-knowledge-${draft.id}`} preview={{ available: true, entries: draft.knowledge_refs, historyUsed: draft.knowledge_refs.some(ref => ref.reason === 'history'), historyMessages: draft.context_count }} /></details>}
            </article>
          })}</section>
        </section>}
      </div>
    </div>
  </main>
}

import { Suspense } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { loadInboxPanel, readInbox } from './actions'
import Inbox from './inbox'

type Search = Promise<{ [key: string]: string | string[] | undefined }>
async function InboxContent({ searchParams }: { searchParams: Search }) {
  await connection()
  const params = await searchParams
  if (typeof params.workspace !== 'string') return <p role="alert" className="p-8">Choose a workspace from the <Link href="/dashboard" className="underline">dashboard</Link>.</p>
  let panel: Awaited<ReturnType<typeof loadInboxPanel>> | undefined
  let selected: Awaited<ReturnType<typeof readInbox>> | undefined
  try {
    panel = await loadInboxPanel(params.workspace)
    if (params.conversation !== undefined) selected = await readInbox(params.workspace, typeof params.conversation === 'string' ? params.conversation : '')
  } catch { /* Safe unavailable state. */ }
  if (!panel || (selected && !selected.ok)) return <main className="min-h-screen bg-slate-50 p-8 text-slate-950"><div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-semibold">Inbox unavailable</h1><p role="alert" className="mt-4 leading-7">Owner access and Phase 7A storage are required. Check the workspace, selected conversation, and the separately reviewed migration status.</p><Link href="/dashboard" className="mt-5 inline-flex min-h-11 items-center font-semibold text-emerald-800">Back to dashboard</Link></div></main>
  return <Inbox key={`${panel.workspace.id}:${selected?.ok ? selected.data.conversation.id : 'list'}`} initial={panel} selected={selected?.ok ? selected.data : null} />
}
export default function InboxPage({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<p role="status" className="p-12 text-center">Loading owner-only WhatsApp inbox…</p>}><InboxContent searchParams={searchParams} /></Suspense>
}

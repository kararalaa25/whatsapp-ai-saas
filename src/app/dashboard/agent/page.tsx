import { Suspense } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { loadAgentPanel } from './actions'
import AgentStudio from './studio'

type Search = Promise<{ [key: string]: string | string[] | undefined }>

async function AgentContent({ searchParams }: { searchParams: Search }) {
  await connection()
  const { workspace, conversation } = await searchParams
  if (typeof workspace !== 'string') return <p role="alert" className="p-8">Choose a workspace from the <Link href="/dashboard" className="underline">dashboard</Link> first.</p>
  let panel: Awaited<ReturnType<typeof loadAgentPanel>> | undefined
  try { panel = await loadAgentPanel(workspace, typeof conversation === 'string' ? conversation : conversation === undefined ? undefined : '') } catch { /* Render a safe owner-access state below. */ }
  if (!panel) return <main className="min-h-screen bg-slate-50 p-8 text-slate-950"><div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-semibold">Agent studio unavailable</h1><p role="alert" className="mt-4 text-sm leading-6">Only the workspace owner can configure agents and access test conversations. Check your session, workspace access, and selected conversation.</p><Link href="/dashboard" className="mt-6 inline-flex min-h-11 items-center font-semibold text-emerald-800">Back to dashboard</Link></div></main>
  return <AgentStudio key={`${panel.workspace.id}:${panel.snapshot?.conversation.id ?? 'temporary'}`} initial={panel} />
}

export default function AgentPage({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<p role="status" className="p-12 text-center">Checking owner access and loading agent studio…</p>}><AgentContent searchParams={searchParams} /></Suspense>
}

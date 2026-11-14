import { Suspense } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { loadKnowledgePanel } from './actions'
import KnowledgeManager from './manager'

type Search = Promise<{ [key: string]: string | string[] | undefined }>
async function KnowledgeContent({ searchParams }: { searchParams: Search }) {
  await connection()
  const { workspace } = await searchParams
  if (typeof workspace !== 'string') return <p role="alert" className="p-8">Choose a workspace from the <Link className="underline" href="/dashboard">dashboard</Link>.</p>
  let panel: Awaited<ReturnType<typeof loadKnowledgePanel>> | undefined
  try { panel = await loadKnowledgePanel(workspace) } catch { /* Safe state without tenant details. */ }
  if (!panel) return <main className="min-h-screen bg-slate-50 p-8 text-slate-950"><div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-semibold">Knowledge base unavailable</h1><p role="alert" className="mt-4 leading-7">Owner access is required. Check your session and workspace access. Knowledge storage must also be available before you can manage entries.</p><Link href="/dashboard" className="mt-6 inline-flex min-h-11 items-center font-semibold text-emerald-800">Back to dashboard</Link></div></main>
  return <KnowledgeManager key={panel.workspace.id} initial={panel} />
}
export default function KnowledgePage({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<p role="status" className="p-12 text-center">Loading business knowledge…</p>}><KnowledgeContent searchParams={searchParams} /></Suspense>
}

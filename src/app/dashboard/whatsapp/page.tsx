import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { loadWhatsAppWorkspace } from '@/utils/whatsapp/workspace'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

async function WhatsAppContent({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const params = await searchParams
  let state: Awaited<ReturnType<typeof loadWhatsAppWorkspace>>
  try {
    state = await loadWhatsAppWorkspace(await createClient(), params.workspace)
  } catch {
    state = { status: 'error' }
  }
  if (state.status === 'login') redirect('/login')
  if (state.status === 'onboarding') redirect('/onboarding')

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 font-sans text-slate-950 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">Back to workspaces</Link>
        <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-emerald-800">WhatsApp / Test environment</p>
        <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight">{state.status === 'ready' ? state.workspace.name : 'WhatsApp connection'}</h1>
        {state.status === 'unauthorized' ? (
          <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">This workspace is unavailable or you do not have access.</p>
        ) : state.status !== 'ready' ? (
          <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">Unable to load WhatsApp test data. Please try again later.</p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-600">Meta developer test numbers only. This integration receives messages; it does not send replies.</p>
            <section aria-labelledby="connection-heading" className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 id="connection-heading" className="text-xl font-semibold">Connection status</h2>
              {state.connections.length ? <ul className="mt-4 space-y-3">{state.connections.map((item) => (
                <li key={item.id} className="flex flex-wrap justify-between gap-3 rounded-lg bg-slate-50 p-4 text-sm">
                  <span>Test phone ID: {item.phone_number_id}</span>
                  <span className="font-medium text-emerald-800">{item.status === 'active' ? 'Configured for test ingestion' : 'Disabled'}</span>
                </li>
              ))}</ul> : <p className="mt-4 text-sm leading-6 text-slate-600">No test number is configured for this workspace. An administrator must verify and provision a Meta test-number mapping.</p>}
              <p className="mt-4 text-xs leading-5 text-slate-500">Configured status does not confirm Meta connectivity. A signed incoming test message verifies delivery.</p>
            </section>
            <section aria-labelledby="messages-heading" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 id="messages-heading" className="text-xl font-semibold">Received test messages</h2>
              <p className="mt-2 text-xs text-slate-500">Latest 50 messages. Refresh to check for new deliveries.</p>
              {state.messages.length ? <ul className="mt-5 divide-y divide-slate-100">{state.messages.map((item) => (
                <li key={item.id} className="py-4">
                  <time dateTime={item.received_at} className="text-xs text-slate-500">{new Date(item.received_at).toISOString()}</time>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.message_type === 'text' ? item.body : 'Non-text test message received. Media was not downloaded.'}</p>
                </li>
              ))}</ul> : <p className="mt-5 text-sm text-slate-600">No test messages received yet.</p>}
            </section>
          </>
        )}
      </div>
    </main>
  )
}

export default function WhatsAppPage({ searchParams }: { searchParams: SearchParams }) {
  return <Suspense fallback={<p role="status" className="px-6 py-12 text-center text-sm text-slate-600">Verifying workspace access and loading test messages…</p>}><WhatsAppContent searchParams={searchParams} /></Suspense>
}

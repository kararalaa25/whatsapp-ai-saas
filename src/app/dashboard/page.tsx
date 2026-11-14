import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { logout } from '@/app/logout/actions'
import { loadDashboardState, type DashboardState } from '@/utils/workspaces/access'

type DashboardSearchParams = Promise<{ [key: string]: string | string[] | undefined }>

async function signOut() {
  'use server'

  const result = await logout()
  if (result.error) {
    redirect('/dashboard?error=signout')
  }
}

const sections = [
  { title: 'Knowledge Base', description: 'Manage products, FAQs, and business information for this workspace.' },
  { title: 'WhatsApp', description: 'Connect and manage business WhatsApp accounts.' },
  { title: 'Conversations', description: 'Review verified WhatsApp texts, manage human control, and approve local unsent drafts.' },
  { title: 'AI Agents', description: 'Tools to configure and manage your AI assistants.' },
  { title: 'Customers', description: 'A dedicated space for customer relationships.' },
  { title: 'Settings', description: 'Controls for your platform preferences.' },
  { title: 'Automation', description: 'Owner-only draft automation preferences. Outbound replies remain unavailable.' },
]

async function AuthenticatedDashboard({ searchParams }: { searchParams: DashboardSearchParams }) {
  // Wait for the request outside the catch so Next.js rendering signals propagate.
  await connection()

  const params = await searchParams
  let state: DashboardState
  try {
    state = await loadDashboardState(await createClient(), params.workspace)
  } catch {
    state = { status: 'error' }
  }
  if (state.status === 'login') redirect('/login')
  if (state.status === 'onboarding') redirect('/onboarding')
  const showSignOutError = params.error === 'signout'
  const workspaces = 'workspaces' in state ? state.workspaces : []
  const selected = state.status === 'ready' ? state.selected : null

  // Authentication alone grants no tenant data access. Future queries require
  // explicit workspace authorization and Supabase RLS policies.
  return (
    <main className="min-h-screen flex-1 bg-slate-50 px-6 py-8 font-sans text-slate-950 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="border-b border-slate-200 pb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">WhatsApp AI / Dashboard</p>
            <form action={signOut}>
              <button type="submit" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 sm:w-auto">Sign Out</button>
            </form>
          </div>
          {showSignOutError && (
            <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">Unable to sign out. Please try again.</p>
          )}
          <h1 className="mt-4 break-words text-3xl font-semibold tracking-tight sm:text-4xl">{selected ? selected.name : 'Your business workspaces'}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Choose a business to manage its workspace. Business tools are coming soon.</p>
        </header>

        <section aria-labelledby="workspaces-heading" className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="workspaces-heading" className="text-xl font-semibold tracking-tight">Your workspaces</h2>
            <Link href="/onboarding" className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700">Create a workspace</Link>
          </div>
          {state.status === 'error' ? (
            <p role="alert" className="mt-4 text-sm text-red-800">Unable to verify your workspaces. No business has been selected. <Link href="/dashboard" className="underline underline-offset-4">Try again</Link>.</p>
          ) : (
            <>
              {state.status === 'unauthorized' && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800">This workspace is unavailable or you do not have access. Choose one of your workspaces below.</p>}
              <nav aria-label="Switch business workspace" className="mt-4 grid gap-3 sm:grid-cols-2">
                {workspaces.map((workspace) => (
                  <Link key={workspace.id} prefetch={false} href={`/dashboard?workspace=${encodeURIComponent(workspace.id)}`} aria-current={selected?.id === workspace.id ? 'page' : undefined} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium hover:border-emerald-700 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 aria-[current=page]:border-emerald-700 aria-[current=page]:bg-emerald-50">
                    <span className="min-w-0 break-words">{workspace.name}</span>
                    {selected?.id === workspace.id && <span className="text-xs text-emerald-800">Selected</span>}
                  </Link>
                ))}
              </nav>
            </>
          )}
        </section>

        {selected && <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {sections.map((section, index) => (
            <section key={section.title} aria-labelledby={`section-${index}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">{section.title === 'WhatsApp' ? 'Test environment' : section.title === 'AI Agents' ? 'Preview studio' : section.title === 'Conversations' ? 'Owner-only test inbox' : section.title === 'Knowledge Base' ? 'Owner management' : section.title === 'Automation' ? 'Draft only · delivery disabled' : 'Coming soon'}</span>
              <h2 id={`section-${index}`} className="mt-5 text-xl font-semibold tracking-tight">{section.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{section.description}</p>
              {section.title === 'Automation' && <Link prefetch={false} href={`/dashboard/automation?workspace=${encodeURIComponent(selected.id)}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800 underline">Configure draft automation</Link>}
              {section.title === 'WhatsApp' && <Link prefetch={false} href={`/dashboard/whatsapp?workspace=${encodeURIComponent(selected.id)}`} className="mt-3 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">View test connection and messages</Link>}
              {section.title === 'Conversations' && <Link prefetch={false} href={`/dashboard/inbox?workspace=${encodeURIComponent(selected.id)}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800 underline">Open WhatsApp conversation inbox</Link>}
              {section.title === 'Knowledge Base' && <Link prefetch={false} href={`/dashboard/knowledge?workspace=${encodeURIComponent(selected.id)}`} className="mt-3 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">Manage business knowledge</Link>}
              {section.title === 'AI Agents' && <Link prefetch={false} href={`/dashboard/agent?workspace=${encodeURIComponent(selected.id)}`} className="mt-3 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">Configure agent and test replies</Link>}
            </section>
          ))}
        </div>}

        <p className="mt-8 max-w-2xl text-sm leading-6 text-slate-500">{selected ? 'Business tools for the selected workspace are coming soon.' : 'Select an accessible workspace to continue.'}</p>
      </div>
    </main>
  )
}

export default function DashboardPage({ searchParams }: { searchParams: DashboardSearchParams }) {
  return (
    <Suspense fallback={<p role="status" className="px-6 py-12 text-center text-sm text-slate-600">Verifying your session…</p>}>
      <AuthenticatedDashboard searchParams={searchParams} />
    </Suspense>
  )
}

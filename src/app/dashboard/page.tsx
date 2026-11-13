import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { logout } from '@/app/logout/actions'

type DashboardSearchParams = Promise<{ [key: string]: string | string[] | undefined }>

async function signOut() {
  'use server'

  const result = await logout()
  if (result.error) {
    redirect('/dashboard?error=signout')
  }
}

const sections = [
  { title: 'WhatsApp Conversations', description: 'A place to manage customer conversations on WhatsApp.' },
  { title: 'AI Agents', description: 'Tools to configure and manage your AI assistants.' },
  { title: 'Customers', description: 'A dedicated space for customer relationships.' },
  { title: 'Settings', description: 'Controls for your platform preferences.' },
]

async function AuthenticatedDashboard({ searchParams }: { searchParams: DashboardSearchParams }) {
  // Wait for the request outside the catch so Next.js rendering signals propagate.
  await connection()

  let authenticated = false
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getClaims()
    authenticated = !error && typeof data?.claims?.sub === 'string' && data.claims.sub.length > 0
  } catch {
    authenticated = false
  }

  if (!authenticated) redirect('/login')

  const showSignOutError = (await searchParams).error === 'signout'

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
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Welcome to your dashboard</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Your starting point for AI-powered customer conversations. These tools are coming soon.</p>
        </header>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {sections.map((section, index) => (
            <section key={section.title} aria-labelledby={`section-${index}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">Coming soon</span>
              <h2 id={`section-${index}`} className="mt-5 text-xl font-semibold tracking-tight">{section.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{section.description}</p>
            </section>
          ))}
        </div>

        <p className="mt-8 max-w-2xl text-sm leading-6 text-slate-500">This is a preview of upcoming features. No workspace has been selected, and no business data is shown.</p>
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

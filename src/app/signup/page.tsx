import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { signup } from './actions'

type SignupSearchParams = Promise<{ [key: string]: string | string[] | undefined }>

async function SignupMessage({ searchParams }: { searchParams: SignupSearchParams }) {
  const { status } = await searchParams

  // Query markers select fixed presentation only; they never prove authentication.
  switch (status) {
    case 'error':
      return (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
          Unable to complete registration. Please check your details and try again.
        </p>
      )
    case 'check_email':
      return (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
          If confirmation is needed, check your email for the next steps. You can also try signing in.
        </p>
      )
    case 'authenticated':
      return (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
          <p>Registration completed. Continue to your dashboard when you are ready. A valid session is required to access it.</p>
          <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-sm font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700">Continue to dashboard</Link>
        </div>
      )
    default:
      return null
  }
}

export default function SignupPage({ searchParams }: { searchParams: SignupSearchParams }) {
  async function register(formData: FormData) {
    'use server'

    const result = await signup(formData)
    // All destinations and status markers are fixed; no form data enters the URL.
    switch (result.status) {
      case 'error':
        redirect('/signup?status=error')
      case 'check_email':
        redirect('/signup?status=check_email')
      case 'authenticated':
        redirect('/signup?status=authenticated')
    }
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col bg-slate-50 px-6 py-8 font-sans text-slate-950 sm:px-10">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-700 text-white" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" className="size-6" stroke="currentColor" strokeWidth="1.7">
            <path d="M20 11.5a8 8 0 0 1-8 8H4l1.5-4A8 8 0 1 1 20 11.5Z" strokeLinejoin="round" />
            <path d="M8 10h8M8 14h5" strokeLinecap="round" />
          </svg>
        </span>
        <span className="text-sm font-semibold tracking-tight">WhatsApp AI <span className="font-normal text-slate-500">/ Workspace</span></span>
      </header>

      <section aria-labelledby="signup-heading" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-16 sm:py-24">
        <div className="mb-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-800">Start your journey</p>
          <h1 id="signup-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">Create your account</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">Get started with AI-powered customer conversations. You can set up your workspace later.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <form action={register} aria-label="Create account" className="space-y-5">
            <Suspense fallback={null}>
              <SignupMessage searchParams={searchParams} />
            </Suspense>
            {[
              { id: 'full-name', name: 'fullName', label: 'Full name', type: 'text', autoComplete: 'name', placeholder: 'Your full name' },
              { id: 'email', name: 'email', label: 'Email address', type: 'email', autoComplete: 'email', placeholder: 'you@company.com' },
              { id: 'password', name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password', placeholder: 'Create a password' },
              { id: 'confirm-password', name: 'confirmPassword', label: 'Confirm password', type: 'password', autoComplete: 'new-password', placeholder: 'Re-enter your password' },
            ].map((field) => (
              <div key={field.id}>
                <label htmlFor={field.id} className="mb-2 block text-sm font-medium">{field.label}</label>
                <input id={field.id} name={field.name} type={field.type} autoComplete={field.autoComplete} required minLength={field.type === 'password' ? 8 : undefined} placeholder={field.placeholder} className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-base text-slate-950 placeholder:text-slate-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/25" />
              </div>
            ))}
            <button type="submit" className="min-h-12 w-full rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700">Create Account</button>
          </form>
          <div className="mt-6 border-t border-slate-100 pt-6 text-center text-sm text-slate-600">
            Already have an account?{' '}
            <Link href="/login" className="inline-flex min-h-11 items-center rounded-sm font-semibold text-emerald-800 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700">Sign in</Link>
          </div>
        </div>
        <p className="mt-6 text-center text-xs leading-5 text-slate-500">One workspace for your team, agents, and conversations.</p>
      </section>
      <footer className="text-center text-xs text-slate-500">WhatsApp AI Agent Platform</footer>
    </main>
  )
}

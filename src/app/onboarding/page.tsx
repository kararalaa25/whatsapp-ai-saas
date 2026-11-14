import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import WorkspaceForm from './workspace-form'

async function AuthenticatedOnboarding() {
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

  return (
    <main dir="rtl" lang="ar" className="flex min-h-screen flex-1 items-center justify-center bg-slate-50 px-6 py-12 font-sans text-slate-950">
      <section aria-labelledby="onboarding-heading" className="w-full max-w-md">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">وصلة / مساحة العمل</p>
        <h1 id="onboarding-heading" className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">جهّز مساحة أعمالك</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">ابدأ باسم نشاطك. بعد إنشاء المساحة، أضف المنتجات وساعات العمل وسياساتك ثم اضبط المساعد.</p>
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><WorkspaceForm /></div>
        <Link href="/dashboard" className="mt-4 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700">لوحة التحكم</Link>
      </section>
    </main>
  )
}

export default function OnboardingPage() {
  return <Suspense fallback={<p role="status" className="px-6 py-12 text-center text-sm text-slate-600">Verifying your session…</p>}><AuthenticatedOnboarding /></Suspense>
}

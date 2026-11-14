import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { login } from './actions'

type LoginSearchParams = Promise<{ [key: string]: string | string[] | undefined }>

async function LoginError({ searchParams }: { searchParams: LoginSearchParams }) {
  const params = await searchParams
  let message: string
  switch (params.error) {
    case 'signin':
      message = 'تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور وحاول مجدداً.'
      break
    case 'confirmation':
      message = 'تعذر تأكيد البريد أو انتهت صلاحية الرابط. حاول تسجيل الدخول أو اطلب رابط تأكيد جديداً.'
      break
    default:
      return null
  }

  return (
    <p id="login-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
      {message}
    </p>
  )
}

export default function LoginPage({ searchParams }: { searchParams: LoginSearchParams }) {
  async function signIn(formData: FormData) {
    'use server'

    const result = await login(formData)
    if (result?.error) {
      // Only a fixed error marker enters the URL; credentials stay in the POST body.
      redirect('/login?error=signin')
    }
  }

  return (
    <main dir="rtl" lang="ar" className="flex min-h-screen flex-1 flex-col bg-slate-50 px-6 py-8 font-sans text-slate-950 sm:px-10">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-700 text-white" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" className="size-6" stroke="currentColor" strokeWidth="1.7">
            <path d="M20 11.5a8 8 0 0 1-8 8H4l1.5-4A8 8 0 1 1 20 11.5Z" strokeLinejoin="round" />
            <path d="M8 10h8M8 14h5" strokeLinecap="round" />
          </svg>
        </span>
        <span className="text-sm font-semibold tracking-tight">Wasla AI <span className="font-normal text-slate-500">/ مساحة العمل</span></span>
      </header>

      <section aria-labelledby="login-heading" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-16 sm:py-24">
        <div className="mb-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-800">أهلاً بعودتك إلى وصلة</p>
          <h1 id="login-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">تسجيل الدخول</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">ادخل إلى مساحة عملك لإدارة معلومات أعمالك ومراجعة المحادثات والردود.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <form action={signIn} aria-label="Sign in" className="space-y-5">
            <Suspense fallback={null}>
              <LoginError searchParams={searchParams} />
            </Suspense>
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium">البريد الإلكتروني / Email</label>
              <input id="email" name="email" type="email" dir="ltr" autoComplete="email" required placeholder="you@company.com" className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-base text-slate-950 placeholder:text-slate-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/25" />
            </div>
            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium">كلمة المرور / Password</label>
              <input id="password" name="password" type="password" dir="ltr" autoComplete="current-password" required placeholder="أدخل كلمة المرور" className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-base text-slate-950 placeholder:text-slate-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/25" />
            </div>
            <button type="submit" className="min-h-12 w-full rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700">تسجيل الدخول</button>
          </form>
          <Link href="/forgot-password" className="mt-4 inline-flex min-h-11 items-center font-semibold text-emerald-800 underline">نسيت كلمة المرور؟ / Forgot password?</Link>
          <div className="mt-6 border-t border-slate-100 pt-6 text-center text-sm text-slate-600">
            ليس لديك حساب؟{' '}
            <Link href="/signup" className="inline-flex min-h-11 items-center rounded-sm font-semibold text-emerald-800 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700">إنشاء حساب</Link>
          </div>
        </div>
        <p className="mt-6 text-center text-xs leading-5 text-slate-500">مساحة واحدة لمعلومات أعمالك ومحادثاتك ومراجعة الردود.</p>
      </section>
      <footer className="text-center text-xs text-slate-500">وصلة · Wasla AI</footer>
    </main>
  )
}

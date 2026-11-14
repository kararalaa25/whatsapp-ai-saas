import Link from 'next/link'
import { connection } from 'next/server'
import PasswordForm from './password-form'

export type PasswordSearch = Promise<Record<string, string | string[] | undefined>>
export default async function PasswordPage({ mode, searchParams }: { mode: 'request' | 'update'; searchParams: PasswordSearch }) {
  await connection()
  const params = await searchParams
  const english = params.lang === 'en'
  const t = (ar: string, en: string) => english ? en : ar
  const path = mode === 'request' ? '/forgot-password' : '/reset-password'
  return <main lang={english ? 'en' : 'ar'} dir={english ? 'ltr' : 'rtl'} className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12 text-slate-950">
    <section className="w-full max-w-md space-y-6">
      <nav className="flex items-center justify-between"><Link href="/" className="text-xl font-bold text-emerald-800">وصلة · Wasla AI</Link><Link href={`${path}?lang=${english ? 'ar' : 'en'}`} className="min-h-11 py-2 underline">{english ? 'العربية' : 'English'}</Link></nav>
      <h1 className="text-3xl font-semibold">{mode === 'request' ? t('استعادة حسابك', 'Recover your account') : t('كلمة مرور جديدة', 'Choose a new password')}</h1>
      <p className="text-sm leading-7 text-slate-600">{mode === 'request' ? t('سنرسل خطوات الاستعادة إلى البريد المرتبط بحسابك.', 'Request recovery instructions for your account email.') : t('يلزم رابط استعادة صالح أو جلسة دخول تم التحقق منها.', 'A valid recovery link or verified signed-in session is required.')}</p>
      {params.error === 'recovery' && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm leading-7">{t('الرابط غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً.', 'This link is invalid or expired. Request a new link.')}</p>}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><PasswordForm key={`${mode}:${english}`} mode={mode} english={english} /></div>
    </section>
  </main>
}

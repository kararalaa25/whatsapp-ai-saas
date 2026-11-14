'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { requestPasswordReset, type PasswordState } from '@/app/forgot-password/actions'
import { updatePassword } from '@/app/reset-password/actions'

export default function PasswordForm({ mode, english = false }: { mode: 'request' | 'update'; english?: boolean }) {
  const [state, action, pending] = useActionState(mode === 'request' ? requestPasswordReset : updatePassword, { status: 'idle', message: '' } as PasswordState)
  const t = (ar: string, en: string) => english ? en : ar
  const messages: Record<string, string> = {
    email: t('أدخل عنوان بريد إلكتروني صحيحاً.', 'Enter a valid email address.'),
    sent: t('إذا كان الحساب مؤهلاً، ستصلك رسالة بخطوات الاستعادة. راجع البريد غير المرغوب فيه أيضاً.', 'If the account is eligible, you will receive recovery instructions. Also check spam.'),
    password: t('استخدم كلمة مرور من 8 إلى 128 حرفاً وتأكد من تطابق الكلمتين.', 'Use 8–128 characters and matching passwords.'),
    session: t('افتح رابط الاستعادة من بريدك أو سجّل الدخول أولاً.', 'Open your recovery email link or sign in first.'),
    unavailable: t('تعذر تأكيد التغيير. أعد فتح رابط الاستعادة أو حاول تسجيل الدخول.', 'The change could not be confirmed. Reopen your recovery link or try signing in.'),
    updated: t('تم تحديث كلمة المرور. سجّل الدخول مجدداً.', 'Password updated. Sign in again.'),
    signout: t('تم تحديث كلمة المرور، لكن لم يتأكد تسجيل الخروج. سجّل الخروج من لوحة التحكم.', 'Password updated, but sign-out could not be confirmed. Sign out from your dashboard.'),
  }
  const input = 'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-slate-950 focus:outline-2 focus:outline-offset-2 focus:outline-emerald-700'
  return <form action={action} aria-busy={pending} className="space-y-5">
    <fieldset disabled={pending || state.status === 'updated'} className="space-y-5">
      {mode === 'request' ? <label className="block space-y-2"><span>{t('البريد الإلكتروني', 'Email')}</span><input className={input} dir="ltr" name="email" type="email" autoComplete="email" maxLength={254} required /></label> : <>
        <label className="block space-y-2"><span>{t('كلمة المرور الجديدة', 'New password')}</span><input className={input} dir="ltr" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
        <label className="block space-y-2"><span>{t('تأكيد كلمة المرور', 'Confirm password')}</span><input className={input} dir="ltr" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
      </>}
      <button className="min-h-12 w-full rounded-xl bg-emerald-800 px-5 font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60" type="submit">{pending ? t('يرجى الانتظار…', 'Please wait…') : mode === 'request' ? t('إرسال رابط الاستعادة', 'Send recovery link') : t('تحديث كلمة المرور', 'Update password')}</button>
    </fieldset>
    {state.message && <p role={state.status === 'error' ? 'alert' : 'status'} className="rounded-xl bg-slate-100 p-4 text-sm leading-7">{messages[state.message] ?? messages.unavailable}</p>}
    <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-emerald-800 underline">{t('العودة لتسجيل الدخول', 'Back to sign in')}</Link>
    {state.message === 'signout' && <Link href="/dashboard" className="ms-4 inline-flex min-h-11 items-center underline">{t('لوحة التحكم', 'Dashboard')}</Link>}
  </form>
}

import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { logout } from '@/app/logout/actions'
import { loadDashboardState, type DashboardState } from '@/utils/workspaces/access'

type Search = Promise<Record<string, string | string[] | undefined>>
async function signOut() {
  'use server'
  const result = await logout()
  if (result.error) redirect('/dashboard?error=signout')
}
const tools = [
  { path: 'knowledge', ar: 'معلومات الأعمال', en: 'Business knowledge', detailAr: 'أضف منتجاتك وأسئلتك الشائعة وساعات العمل والسياسات.', detailEn: 'Manage products, FAQs, hours and business policies.' },
  { path: 'agent', ar: 'المساعد الذكي', en: 'AI assistant', detailAr: 'اضبط التعليمات واختبر ردوداً تستند إلى معلومات نشاطك.', detailEn: 'Configure instructions and test replies grounded in your knowledge.' },
  { path: 'inbox', ar: 'المحادثات', en: 'Conversations', detailAr: 'راجع الرسائل، استلم المحادثة بشرياً وجهّز مسودات الرد.', detailEn: 'Read customer texts, take human control and review reply drafts.' },
  { path: 'automation', ar: 'تجهيز الردود', en: 'Draft automation', detailAr: 'جهّز مسودات بموافقة المالك. الإرسال التلقائي غير مفعّل.', detailEn: 'Owner-operated draft preparation. Automatic delivery is disabled.' },
  { path: 'billing', ar: 'الاشتراك والاستخدام', en: 'Subscription & usage', detailAr: 'راجع التجربة وحدود خطتك. المدفوعات وتغيير الخطط غير مفعّلين.', detailEn: 'Review trial dates and limits. Payments and plan changes are unavailable.' },
  { path: 'intake', ar: 'الرسائل المحتفظ بها', en: 'Retained messages', detailAr: 'افحص الرسائل المؤجلة وحدود الاستيعاب وأعد معالجتها ضمن صلاحياتك.', detailEn: 'Inspect deferred intake and reconcile eligible retained messages.' },
]
async function AuthenticatedDashboard({ searchParams }: { searchParams: Search }) {
  await connection()
  const params = await searchParams
  const en = params.lang === 'en'
  const t = (ar: string, english: string) => en ? english : ar
  let state: DashboardState
  try { state = await loadDashboardState(await createClient(), params.workspace) } catch { state = { status: 'error' } }
  if (state.status === 'login') redirect('/login')
  if (state.status === 'onboarding') redirect('/onboarding')
  const workspaces = 'workspaces' in state ? state.workspaces : []
  const selected = state.status === 'ready' ? state.selected : null
  const suffix = selected ? `workspace=${encodeURIComponent(selected.id)}&` : ''
  const lang = en ? 'en' : 'ar'
  return <main lang={lang} dir={en ? 'ltr' : 'rtl'} className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 sm:px-10">
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="space-y-5 border-b border-slate-200 pb-7">
        <nav className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="text-xl font-bold text-emerald-800">وصلة · Wasla AI</Link>
          <div className="flex items-center gap-4"><Link href={`/dashboard?${suffix}lang=${en ? 'ar' : 'en'}`} className="min-h-11 py-2 underline">{en ? 'العربية' : 'English'}</Link><form action={signOut}><button className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-semibold hover:bg-slate-100">{t('تسجيل الخروج', 'Sign out')}</button></form></div>
        </nav>
        {params.error === 'signout' && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{t('تعذر تسجيل الخروج. حاول مجدداً.', 'Unable to sign out. Please try again.')}</p>}
        <h1 dir="auto" className="break-words text-3xl font-semibold sm:text-4xl">{selected?.name ?? t('مساحات أعمالك', 'Your workspaces')}</h1>
        <p className="max-w-2xl text-sm leading-7 text-slate-600">{t('معلومات نشاطك ومحادثاته واستخدامه في مساحة مستقلة. أدوات الإعداد وإدارة الردود متاحة لمالك مساحة العمل.', 'Keep business knowledge, conversations and usage in one workspace. Configuration and reply-management tools require workspace ownership.')}</p>
      </header>
      <section className="rounded-2xl border border-slate-200 bg-white p-6" aria-labelledby="workspace-heading">
        <div className="flex flex-wrap items-center justify-between gap-4"><h2 id="workspace-heading" className="text-lg font-semibold">{t('اختر مساحة العمل', 'Choose a workspace')}</h2><Link href="/onboarding" className="min-h-11 py-2 text-sm font-semibold text-emerald-800 underline">{t('إنشاء مساحة أخرى', 'Create another workspace')}</Link></div>
        {state.status === 'error' ? <p role="alert" className="mt-4 text-red-800">{t('تعذر تحميل مساحات العمل. أعد المحاولة.', 'Workspaces could not be loaded. Try again.')}</p> : <>
          {state.status === 'unauthorized' && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">{t('مساحة العمل غير متاحة أو لا تملك صلاحية الوصول إليها.', 'This workspace is unavailable or you do not have access.')}</p>}
          <nav aria-label={t('تبديل مساحة العمل', 'Switch workspace')} className="mt-4 grid gap-3 sm:grid-cols-2">{workspaces.map(w => <Link key={w.id} prefetch={false} href={`/dashboard?workspace=${encodeURIComponent(w.id)}&lang=${lang}`} aria-current={w.id === selected?.id ? 'page' : undefined} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 hover:border-emerald-700 aria-[current=page]:border-emerald-700 aria-[current=page]:bg-emerald-50"><span dir="auto" className="min-w-0 break-words">{w.name}</span>{w.id === selected?.id && <span className="text-xs font-semibold text-emerald-800">{t('الحالية', 'Selected')}</span>}</Link>)}</nav>
        </>}
      </section>
      {selected && <>
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-6" aria-labelledby="setup-heading"><h2 id="setup-heading" className="text-lg font-semibold">{t('جهّز نشاطك', 'Set up your business')}</h2><p className="mt-2 text-sm leading-7 text-slate-700">{t('ابدأ بمعلومات الأعمال، ثم اضبط المساعد واختبر الردود. ربط رقم واتساب تجريبي يحتاج تهيئة من المسؤول. لم يتم تفعيل الإرسال أو المدفوعات.', 'Start with business knowledge, configure your assistant, then test replies. A WhatsApp test-number mapping requires administrator setup. Sending and payments are disabled.')}</p><Link href={`/dashboard/whatsapp?workspace=${encodeURIComponent(selected.id)}`} className="mt-3 inline-flex min-h-11 items-center font-semibold text-emerald-800 underline">{t('عرض حالة اتصال واتساب', 'View WhatsApp connection status')}</Link></section>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{tools.map(tool => <section key={tool.path} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">{en ? tool.en : tool.ar}</h2><p className="mt-3 flex-1 text-sm leading-7 text-slate-600">{en ? tool.detailEn : tool.detailAr}</p><Link prefetch={false} href={`/dashboard/${tool.path}?workspace=${encodeURIComponent(selected.id)}&lang=${lang}`} className="mt-5 inline-flex min-h-11 items-center font-semibold text-emerald-800 underline">{t('فتح', 'Open')} {en ? tool.en : tool.ar}</Link></section>)}</div>
      </>}
    </div>
  </main>
}
export default function DashboardPage({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<p role="status" className="p-10">جارٍ التحقق من الجلسة / Verifying session…</p>}><AuthenticatedDashboard searchParams={searchParams} /></Suspense>
}

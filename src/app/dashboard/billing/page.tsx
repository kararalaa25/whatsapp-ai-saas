import { loadPlanReviews } from '@/app/dashboard/billing/actions'
import ManualPlanReview from '@/app/dashboard/billing/review'
import { CLOUD_INSTALLATION_APPROVED } from '@/utils/cloud/security'
import { Suspense } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { loadBillingPanel } from '@/utils/billing/access'
import { effectiveStatus, hasAccess, usageWarning } from '@/utils/billing/model'

type Search = Promise<Record<string, string | string[] | undefined>>
const labels: Record<string, [string, string]> = {
  ai_generations: ['AI provider reservations', 'حجوزات استخدام مزود الذكاء الاصطناعي'],
  whatsapp_conversations: ['New WhatsApp test conversations', 'محادثات واتساب التجريبية الجديدة'],
  cloud_conversations: ['New Cloud conversations', 'محادثات Cloud الجديدة'],
  audio_transcriptions: ['Voice transcription reservations', 'حجوزات تفريغ الرسائل الصوتية'],
  numbers: ['Connected numbers (including disabled)', 'الأرقام المتصلة بما فيها المعطلة'],
  products: ['Catalog entries', 'منتجات الكتالوج'], members: ['Team members', 'أعضاء الفريق'], faqs: ['FAQs', 'الأسئلة الشائعة'],
}
const statuses = { trialing: 'تجريبي', active: 'نشط', past_due: 'متأخر السداد', canceled: 'ملغي', expired: 'منتهي' }
async function BillingContent({ searchParams }: { searchParams: Search }) {
  await connection()
  const params = await searchParams
  const ar = params.lang === 'ar'
  const t = (en: string, arabic: string) => ar ? arabic : en
  let panel: Awaited<ReturnType<typeof loadBillingPanel>> | undefined
  try { if (typeof params.workspace === 'string') panel = await loadBillingPanel(await createClient(), params.workspace) } catch { /* Safe owner-only error. */ }
  const shell = 'mx-auto max-w-6xl space-y-8 px-5 py-10 text-slate-950 sm:px-10'
  if (!panel) return <main className={shell} dir={ar ? 'rtl' : 'ltr'} lang={ar ? 'ar' : 'en'}><h1 className="text-3xl font-semibold">{t('Subscription unavailable', 'الاشتراك غير متاح')}</h1><p role="alert">{t('Choose a workspace you own. Your session and owner access must be verified.', 'اختر مساحة عمل تملكها. يجب التحقق من الجلسة وصلاحية المالك.')}</p><Link href="/dashboard" className="underline">{t('Dashboard', 'لوحة التحكم')}</Link></main>
  let reviews: Awaited<ReturnType<typeof loadPlanReviews>> = []
  let reviewAvailable = CLOUD_INSTALLATION_APPROVED
  if (CLOUD_INSTALLATION_APPROVED) { try { reviews = await loadPlanReviews(panel.workspace.id) } catch { reviewAvailable = false } }
  const languageLink = `/dashboard/billing?workspace=${encodeURIComponent(panel.workspace.id)}&lang=${ar ? 'en' : 'ar'}`
  const date = (value: string) => new Intl.DateTimeFormat(ar ? 'ar-IQ' : 'en-GB', { dateStyle: 'medium', timeZone: 'Asia/Baghdad' }).format(new Date(value))
  return <main className={shell} dir={ar ? 'rtl' : 'ltr'} lang={ar ? 'ar' : 'en'}>
    <header className="space-y-4 border-b border-slate-200 pb-6"><nav className="flex flex-wrap justify-between gap-4"><Link href={`/dashboard?workspace=${encodeURIComponent(panel.workspace.id)}`} className="min-h-11 underline">{t('Dashboard', 'لوحة التحكم')}</Link><Link href={languageLink} className="min-h-11 underline" hrefLang={ar ? 'en' : 'ar'}>{ar ? 'English' : 'العربية'}</Link></nav><p className="break-words text-sm text-emerald-800">{panel.workspace.name}</p><h1 className="text-3xl font-semibold">{t('Subscription & usage', 'الاشتراك والاستخدام')}</h1><p className="rounded-xl bg-amber-50 p-4 text-amber-950">{t('Billing preview only. Payments and plan changes are unavailable. All prices and limits are provisional.', 'معاينة فقط. المدفوعات وتغيير الخطط غير متاحة. جميع الأسعار والحدود مبدئية.')}</p></header>
    {!panel.available ? <p role="status">{t('Subscription storage is unavailable. No plan or payment has been activated. Contact your administrator.', 'بيانات الاشتراك غير متاحة. لم يتم تفعيل أي خطة أو دفعة. تواصل مع المسؤول.')}</p> : (() => {
      const { subscription: s, plans, usage } = panel
      const current = plans.find(p => p.id === s.plan_id)
      const metrics = Object.entries(labels).filter(([key]) => !['cloud_conversations','audio_transcriptions'].includes(key) || Object.prototype.hasOwnProperty.call(current?.limits ?? {}, key))
      const status = effectiveStatus(s)
      const accessible = hasAccess(s)
      return <>
        <section className="rounded-2xl border border-slate-200 p-6" aria-labelledby="current-plan"><h2 id="current-plan" className="text-xl font-semibold">{t('Current plan', 'الخطة الحالية')}: {current ? ar ? current.name_ar : current.name_en : '—'}</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2"><div><dt>{t('Status', 'الحالة')}</dt><dd>{ar ? statuses[status] : status}</dd></div><div><dt>{t('Trial ends', 'نهاية التجربة')}</dt><dd>{date(s.trial_ends_at)}</dd></div><div><dt>{t('Access through', 'الوصول حتى')}</dt><dd>{date(s.status === 'past_due' && s.grace_ends_at ? s.grace_ends_at : s.period_ends_at)}</dd></div><div><dt>{t('Interval / currency', 'الفترة / العملة')}</dt><dd>{s.interval === 'annual' ? t('Annual', 'سنوي') : t('Monthly', 'شهري')} / {s.currency}</dd></div></dl>{!accessible && <p role="status" className="mt-4 text-amber-900">{t('New usage is blocked. Historical records are preserved.', 'الاستخدام الجديد متوقف. السجلات السابقة محفوظة.')}</p>}</section>
        <section aria-labelledby="usage"><h2 id="usage" className="text-xl font-semibold">{t('Usage & limits', 'الاستخدام والحدود')}</h2><p className="my-3 text-sm text-slate-600">{t('Monthly UTC metering', 'القياس الشهري بتوقيت UTC')}: {date(panel.period_start)} – {date(panel.period_end)}. {t('Simulations do not consume AI provider quota. Test conversations are labeled separately; no live WhatsApp usage is enabled.', 'المحاكاة لا تستهلك حصة مزود الذكاء الاصطناعي. المحادثات التجريبية منفصلة؛ الاستخدام الفعلي لواتساب غير مفعّل.')}</p><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(([metric, label]) => {
          const used = usage[metric === 'whatsapp_conversations' ? 'whatsapp_test_conversations' : metric === 'cloud_conversations' ? 'whatsapp_cloud_conversations' : metric] ?? 0
          const limit = accessible ? current?.limits[metric] ?? 0 : 0
          const warning = usageWarning(used, limit)
          return <div key={metric} className="rounded-xl border border-slate-200 p-5"><h3>{label[ar ? 1 : 0]}</h3><p className="my-2 text-2xl font-semibold">{used} / {limit}</p><p className={warning === 'normal' ? 'text-slate-600' : 'font-medium text-amber-900'}>{warning === 'blocked' ? t('Limit reached — additions blocked; history retained', 'تم بلوغ الحد — الإضافات متوقفة والسجل محفوظ') : warning === 'warning' ? t('Approaching limit', 'قرب بلوغ الحد') : t('Within limit', 'ضمن الحد')}</p></div>
        })}</div></section>
        <section aria-labelledby="plans"><h2 id="plans" className="text-xl font-semibold">{t('Monthly / annual comparison', 'مقارنة الخطط الشهرية والسنوية')}</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{['trial','starter','pro','business'].map(id => plans.find(p => p.id === id)).filter(p => p !== undefined).map(p => <article key={p.id} className="space-y-4 rounded-xl border border-slate-200 p-5"><h3 className="text-lg font-semibold">{ar ? p.name_ar : p.name_en}</h3><p>{p.trial_days ? t(`${p.trial_days} trial days`, `${p.trial_days} يوم تجريبي`) : t('Paid plan preview', 'معاينة خطة مدفوعة')}</p>{(['IQD','USD'] as const).map(currency => <dl key={currency} className="text-sm"><dt>{currency} · {t('Provisional', 'مبدئي')}</dt>{(['monthly','annual'] as const).map(interval => <div key={interval}><dt className="inline">{interval === 'monthly' ? t('Monthly', 'شهري') : t('Annual', 'سنوي')}: </dt><dd className="inline">{p.prices[currency][interval] === null ? t('Not configured', 'غير محدد') : new Intl.NumberFormat(ar ? 'ar-IQ' : 'en', { style: 'currency', currency }).format(p.prices[currency][interval]! / (currency === 'IQD' ? 1000 : 100))}</dd></div>)}</dl>)}<ul className="space-y-1 text-sm">{metrics.map(([key,label]) => <li key={key}>{label[ar ? 1 : 0]}: {p.limits[key] ?? 0}</li>)}<li>{p.features.automation ? t('Automation: simulated drafts only', 'الأتمتة: مسودات محاكاة فقط') : t('Automation: unavailable', 'الأتمتة: غير متاحة')}</li></ul><button disabled className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-500">{p.id === s.plan_id ? t('Current plan', 'الخطة الحالية') : t('Upgrade / downgrade preview', 'معاينة الترقية / التخفيض')}</button></article>)}</div></section>
        <ManualPlanReview workspaceId={panel.workspace.id} enabled={reviewAvailable} arabic={ar} requests={reviews} />
        <section className="rounded-xl border border-slate-200 p-6"><h2 className="text-xl font-semibold">{t('Billing history', 'سجل الفواتير')}</h2><p className="mt-3">{t('No billing history is available in this preview. No payment processing is enabled.', 'سجل الفواتير غير متاح في هذه المعاينة. معالجة المدفوعات غير مفعّلة.')}</p></section>
      </>
    })()}
  </main>
}
export default function BillingPage({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<p role="status" className="p-10">Loading / جارٍ التحميل…</p>}><BillingContent searchParams={searchParams} /></Suspense>
}

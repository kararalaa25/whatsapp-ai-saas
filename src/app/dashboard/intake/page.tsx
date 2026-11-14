import { Suspense } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { loadIntake, reconcileIntakeForm } from './actions'

type Search = Promise<Record<string, string | string[] | undefined>>
const reasons: Record<string, string> = {
  pending: 'Waiting for processing / بانتظار المعالجة',
  quota: 'Waiting for subscription eligibility / بانتظار أهلية الاشتراك',
  predecessor: 'Waiting for an earlier customer message / بانتظار رسالة سابقة من العميل',
  connection_disabled: 'Connection paused / الاتصال متوقف',
  processing_error: 'Processing needs another attempt / تحتاج المعالجة إلى محاولة أخرى',
  retry_exhausted: 'Administrator review required / يلزم فحص المسؤول',
}
async function IntakeContent({ searchParams }: { searchParams: Search }) {
  await connection()
  const params = await searchParams
  const offset = typeof params.offset === 'string' && /^\d{1,3}$/.test(params.offset) ? Number(params.offset) : params.offset === undefined ? 0 : -1
  let panel: Awaited<ReturnType<typeof loadIntake>> | undefined
  try { if (typeof params.workspace === 'string') panel = await loadIntake(params.workspace, offset) } catch { /* Owner-only safe error. */ }
  if (!panel) return <main className="p-8 text-slate-950"><h1 className="text-2xl font-semibold">Retained messages unavailable / الرسائل المحفوظة غير متاحة</h1><p role="alert" className="mt-4">Owner access and Phase 8 storage are required. / يتطلب صلاحية المالك وبيانات المرحلة الثامنة.</p><Link href="/dashboard" className="mt-4 inline-block underline">Dashboard / لوحة التحكم</Link></main>
  const { workspace, intake } = panel
  const base = `/dashboard/intake?workspace=${encodeURIComponent(workspace.id)}`
  return <main className="mx-auto max-w-4xl space-y-6 px-5 py-10 text-slate-950">
    <Link href={`/dashboard/inbox?workspace=${encodeURIComponent(workspace.id)}`} className="inline-flex min-h-11 items-center underline">Inbox / صندوق الوارد</Link>
    <header className="space-y-3"><p dir="auto">{workspace.name}</p><h1 className="text-3xl font-semibold">Retained inbound messages / الرسائل الواردة المحفوظة</h1><p>Verified messages waiting for inbox processing. Retention does not enable paid features. / رسائل موثقة بانتظار المعالجة، ولا يفعّل حفظها المزايا المدفوعة.</p></header>
    <p className="rounded-xl bg-amber-50 p-4">{intake.outstanding} / {intake.capacity} outstanding / قيد الانتظار. At capacity, new deferred events receive a retry response; processable events can still be accepted. / عند الامتلاء تُطلب إعادة محاولة الرسائل المؤجلة، وتستمر معالجة الرسائل المتاحة.</p>
    <form action={reconcileIntakeForm.bind(null, workspace.id)} className="space-y-3"><button type="submit" className="min-h-11 rounded-lg bg-emerald-800 px-5 py-2 text-white">Recheck up to 25 messages / إعادة فحص حتى ٢٥ رسالة</button><p className="text-sm text-slate-600">Once per minute; deferred events wait 5 minutes between attempts. Existing subscription limits still apply. No AI or sending. / مرة كل دقيقة، وتنتظر الرسائل المؤجلة ٥ دقائق بين المحاولات. تبقى حدود الاشتراك مطبقة دون ذكاء اصطناعي أو إرسال.</p></form>
    {params.result === 'checked' && <p role="status">Recheck completed. Messages may remain deferred until eligibility changes. / اكتملت إعادة الفحص وقد تبقى الرسائل مؤجلة حتى تتغير الأهلية.</p>}
    {params.result === 'unavailable' && <p role="alert">Recheck unavailable. Check owner access, cooldown, or storage. / إعادة الفحص غير متاحة؛ تحقق من الصلاحية أو مدة الانتظار أو التخزين.</p>}
    {!intake.rows.length && <p>No waiting messages on this page. / لا توجد رسائل انتظار في هذه الصفحة.</p>}
    <ul className="space-y-4">{intake.rows.map(row => <li key={row.inbound_id} className="space-y-2 rounded-xl border border-slate-200 p-5"><p className="text-sm">Customer ending / نهاية رقم العميل: {row.customer_suffix} · {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Baghdad' }).format(new Date(row.received_at))}</p><p dir="auto" className="whitespace-pre-wrap break-words">{row.body}</p><p className="text-sm text-slate-600">{reasons[row.reason] ?? reasons.pending} · Failures / الإخفاقات: {row.failures} / 5</p>{row.failures >= 5 && <p role="status">Administrator review required; message remains retained. / يلزم فحص المسؤول وتبقى الرسالة محفوظة.</p>}</li>)}</ul>
    <nav aria-label="Retained message pages" className="flex flex-wrap gap-6">{offset > 0 && <Link href={`${base}&offset=${Math.max(0,offset-25)}`} className="min-h-11 underline">Previous / السابق</Link>}{offset+25 < intake.outstanding && offset < 975 && <Link href={`${base}&offset=${offset+25}`} className="min-h-11 underline">Next / التالي</Link>}</nav>
  </main>
}
export default function IntakePage({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<p role="status" className="p-8">Loading retained messages / تحميل الرسائل المحفوظة…</p>}><IntakeContent searchParams={searchParams} /></Suspense>
}

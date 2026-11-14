import { Suspense } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { loadAutomation, saveAutomationForm } from './actions'

type Search = Promise<{ [key: string]: string | string[] | undefined }>
const field = 'mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-950'
async function Settings({ searchParams }: { searchParams: Search }) {
  await connection()
  const params = await searchParams
  let panel: Awaited<ReturnType<typeof loadAutomation>> | undefined
  try { if (typeof params.workspace === 'string') panel = await loadAutomation(params.workspace) } catch { /* Fail closed. */ }
  if (!panel) return <main className="p-8"><h1 className="text-2xl font-semibold">Automation unavailable</h1><p role="alert" className="mt-4">Select a workspace you own. Phase 7A and Phase 7B storage must be reviewed and applied separately.</p><Link href="/dashboard" className="mt-4 inline-flex min-h-11 items-center underline">Back to dashboard</Link></main>
  const { settings, workspace, audit } = panel
  const timeValue = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  const save = saveAutomationForm.bind(null, workspace.id, settings.revision)
  return <main className="min-h-screen bg-slate-50 p-6 text-slate-950 sm:p-10"><div className="mx-auto max-w-3xl space-y-6">
    <header><Link href={`/dashboard?workspace=${workspace.id}`} className="inline-flex min-h-11 items-center text-emerald-800 underline">Back to {workspace.name}</Link><h1 className="mt-4 text-3xl font-semibold">WhatsApp automation</h1><p className="mt-3 leading-7">Prepare local drafts for verified customer texts. An owner runs the draft engine from the inbox. Nothing is sent, queued for delivery, or delivered.</p></header>
    <aside className="rounded-xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold">Auto-reply · unavailable</h2><p className="mt-2">Outbound delivery is hard-disabled. Local approval never sends a message. This phase uses simulated grounded suggestions and makes no AI provider requests.</p><button disabled className="mt-3 min-h-11 rounded-lg border px-4 opacity-60">Auto-reply requires a future activation phase</button></aside>
    {params.result === 'saved' && <p role="status">Preferences saved. Existing in-flight automation generations will be rejected.</p>}
    {params.result === 'rejected' && <p role="alert">Preferences were not saved. Check values and owner access, or refresh after another edit.</p>}
    <form action={save} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      <label className="block font-medium">Mode<select name="mode" defaultValue={settings.mode} className={field}><option value="disabled">Disabled</option><option value="draft_only">Draft only · owner runs from inbox</option></select></label>
      <label className="block font-medium">Response language<select name="language" defaultValue={settings.language} className={field}><option value="auto">Match customer</option><option value="ar">Arabic</option><option value="en">English</option></select></label>
      <label className="block font-medium">Business rules<textarea name="business_rules" maxLength={2000} defaultValue={settings.business_rules} rows={5} className={field}/><span className="text-sm font-normal text-slate-600">Use the knowledge base for prices, stock, FAQs and policies. Rules cannot authorize sending or override grounding safeguards.</span></label>
      <fieldset className="space-y-4"><legend className="font-semibold">Working-hours preferences</legend>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="working_hours_enabled" defaultChecked={settings.working_hours_enabled}/>Restrict draft generation to these hours</label>
        <label className="block">IANA time zone<input name="timezone" maxLength={100} required defaultValue={settings.timezone} className={field}/></label>
        <fieldset><legend>Working days</legend><div className="flex flex-wrap gap-3">{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day, index) => <label key={day} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="working_days" value={index} defaultChecked={settings.working_days.includes(index)}/>{day}</label>)}</div></fieldset>
        <div className="grid gap-4 sm:grid-cols-2"><label>Start time<input name="start_time" type="time" required defaultValue={timeValue(settings.start_minute)} className={field}/></label><label>End time<input name="end_time" type="time" required defaultValue={timeValue(settings.end_minute)} className={field}/></label></div>
        <p className="text-sm text-slate-600">Same-day windows only; start included, end excluded. An end time of 00:00 means midnight at the end of the selected day. Human requests still go to local human review outside these hours. These preferences do not promise staff availability.</p>
      </fieldset>
      <button className="min-h-11 rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white">Save preferences</button>
    </form>
    <Link href={`/dashboard/inbox?workspace=${workspace.id}`} className="inline-flex min-h-11 items-center text-emerald-800 underline">Open inbox to process a verified customer text</Link>
    <section><h2 className="text-xl font-semibold">Recent automation audit</h2><p className="mt-2 text-sm text-slate-600">Latest 20 events. No customer text or contact data is included.</p><ul className="mt-3 space-y-2">{audit.map(event => <li key={event.id} className="rounded-lg border bg-white p-3">{event.event} · settings revision {event.settings_revision} · {event.created_at}</li>)}</ul>{audit.length === 0 && <p className="mt-3">No automation events yet.</p>}</section>
  </div></main>
}
export default function AutomationPage({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<p role="status" className="p-8">Loading owner automation preferences…</p>}><Settings searchParams={searchParams}/></Suspense>
}

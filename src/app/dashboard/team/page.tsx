import { Suspense } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { loadTeam } from './actions'
import MemberRoster from './roster'
import TeamManager from './manager'
async function Team({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 await connection();const params=await searchParams
 let panel:Awaited<ReturnType<typeof loadTeam>>|undefined
 try{if(typeof params.workspace==='string')panel=await loadTeam(params.workspace)}catch{/* Generic owner-only error. */}
 if(!panel)return <main className="p-8" dir="rtl"><h1>الفريق غير متاح</h1><p role="alert">اختر مساحة عمل تملكها وتحقق من جلسة الدخول.</p><Link href="/dashboard">لوحة التحكم</Link></main>
 return <main dir="rtl" lang="ar" className="mx-auto max-w-4xl space-y-7 px-5 py-10 text-slate-950"><Link href={`/dashboard?workspace=${encodeURIComponent(panel.workspace.id)}`} className="min-h-11 underline">لوحة التحكم</Link><h1 className="text-3xl font-semibold">فريق {panel.workspace.name}</h1><MemberRoster workspaceId={panel.workspace.id} members={panel.members} enabled={panel.available} />{!panel.available&&<p role="status" className="rounded-lg bg-amber-50 p-4">دعوات الفريق تنتظر مراجعة وتهيئة التخزين الجديدة. الأعضاء الحاليون محفوظون.</p>}<TeamManager workspaceId={panel.workspace.id} enabled={panel.available} invitations={panel.invitations} /></main>
}
export default function TeamPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){return <Suspense fallback={<p role="status" className="p-8">جارٍ التحميل…</p>}><Team searchParams={searchParams}/></Suspense>}

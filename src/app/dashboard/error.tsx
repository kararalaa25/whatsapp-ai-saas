'use client'

import Link from 'next/link'

export default function DashboardError({ retry }: { error: unknown; retry: () => void }) {
  return <main dir="rtl" lang="ar" className="mx-auto max-w-xl space-y-5 px-5 py-16 text-slate-950">
    <h1 className="text-2xl font-semibold">تعذر تحميل هذه الصفحة</h1>
    <p role="alert" className="leading-8 text-slate-600">أعد تحميل البيانات أو ارجع إلى مساحات عملك. إذا أجريت تغييراً، تحقق من حالته قبل تكراره.</p>
    <p lang="en" dir="ltr" className="text-sm text-slate-600">This page could not be loaded. Check the current state before repeating a change.</p>
    <button onClick={() => retry()} className="min-h-11 rounded-lg bg-emerald-800 px-5 font-semibold text-white">إعادة تحميل البيانات / Reload</button>
    <Link href="/dashboard" className="ms-4 inline-flex min-h-11 items-center underline">مساحات العمل / Workspaces</Link>
  </main>
}

'use client'

import { useActionState } from 'react'
import { createWorkspace } from './actions'

export default function WorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspace, { error: '' })

  return (
    <form action={action} aria-busy={pending} className="space-y-5">
      {state.error && <p id="workspace-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">{state.error}</p>}
      <fieldset disabled={pending} className="space-y-5">
        <div>
          <label htmlFor="business-name" className="mb-2 block text-sm font-medium">اسم النشاط / Business name</label>
          <input id="business-name" name="businessName" type="text" dir="auto" required autoComplete="organization" aria-describedby={state.error ? 'workspace-error' : 'workspace-hint'} placeholder="اسم المتجر أو النشاط" className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-base text-slate-950 placeholder:text-slate-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/25" />
          <p id="workspace-hint" className="mt-2 text-xs leading-5 text-slate-600">استخدم من حرف إلى 120 حرفاً. يمكنك إنشاء مساحات أخرى لاحقاً.</p>
        </div>
        <button type="submit" className="min-h-12 w-full rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 disabled:cursor-wait disabled:opacity-60">{pending ? 'جارٍ إنشاء مساحة العمل…' : 'إنشاء مساحة العمل'}</button>
      </fieldset>
      <p role="status" className="text-sm text-slate-600">{pending ? 'يرجى الانتظار أثناء إنشاء مساحة العمل.' : ''}</p>
    </form>
  )
}

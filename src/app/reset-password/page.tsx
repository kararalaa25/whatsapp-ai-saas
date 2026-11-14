import { Suspense } from 'react'
import PasswordPage, { type PasswordSearch } from '@/components/auth/password-page'
export default function ResetPassword({ searchParams }: { searchParams: PasswordSearch }) {
  return <Suspense fallback={<p role="status" className="p-8">جارٍ التحميل / Loading…</p>}><PasswordPage mode="update" searchParams={searchParams} /></Suspense>
}

'use server'

import { createClient } from '@/utils/supabase/server'
import { applicationOrigin } from '@/utils/auth/origin'

export type PasswordState = { status: 'idle' | 'sent' | 'error' | 'updated'; message: string }

export async function requestPasswordReset(_state: PasswordState, form: FormData): Promise<PasswordState> {
  const email = form.get('email')
  if (form.getAll('email').length !== 1 || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { status: 'error', message: 'email' }
  }
  // Same acknowledgment for existing/unknown accounts and provider failures.
  // Supabase Auth's configured email rate limits/CAPTCHA remain authoritative.
  try {
    const redirectTo = new URL('/auth/recovery', applicationOrigin()).toString()
    const client = await createClient()
    await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo })
  } catch { /* No account, transport or provider detail reaches the browser. */ }
  return { status: 'sent', message: 'sent' }
}

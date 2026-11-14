'use server'

import { createClient } from '@/utils/supabase/server'
import { applicationOrigin } from '@/utils/auth/origin'

export type SignupResult =
  | { status: 'error'; error: string }
  | { status: 'check_email' | 'authenticated'; message: string }

export async function signup(formData: FormData): Promise<SignupResult> {
  const fullNameValue = formData.get('fullName')
  const emailValue = formData.get('email')
  const password = formData.get('password')
  const confirmPassword = formData.get('confirmPassword')
  const errorResult: SignupResult = {
    status: 'error',
    error: 'Unable to complete registration. Please check your details and try again.',
  }
  const acknowledgmentResult: SignupResult = {
    status: 'check_email',
    message: 'If confirmation is needed, check your email for the next steps. You can also try signing in.',
  }

  if (
    typeof fullNameValue !== 'string' ||
    typeof emailValue !== 'string' ||
    typeof password !== 'string' ||
    typeof confirmPassword !== 'string'
  ) {
    return errorResult
  }

  const fullName = fullNameValue.trim()
  const email = emailValue.trim().toLowerCase()

  if (
    !fullName ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 8 ||
    !password.trim() ||
    password !== confirmPassword
  ) {
    return errorResult
  }

  try {
    const emailRedirectTo = new URL('/auth/callback', applicationOrigin()).toString()
    const supabase = await createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo, data: { full_name: fullName } },
    })

    if (error) {
      // Use the same acknowledgment as successful signups, with or without a session.
      if (error.code === 'user_already_exists' || error.code === 'email_exists') {
        return acknowledgmentResult
      }
      return errorResult
    }

    // Keep the existing result contract, but do not disclose session creation in
    // the result. The SSR client still persists any immediately issued session.
    // With confirmation disabled, observable session cookies can still disclose
    // account existence; neutral messages alone cannot eliminate that signal.
    return acknowledgmentResult
  } catch {
    return errorResult
  }
}

'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export async function login(formData: FormData) {
  const emailValue = formData.get('email')
  const password = formData.get('password')
  const errorResult = { error: 'Unable to sign in. Please check your email and password and try again.' }

  if (
    typeof emailValue !== 'string' ||
    !emailValue.trim() ||
    typeof password !== 'string' ||
    !password.trim()
  ) {
    return errorResult
  }

  const email = emailValue.trim().toLowerCase()

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      return errorResult
    }
  } catch {
    return errorResult
  }

  redirect('/dashboard')
}

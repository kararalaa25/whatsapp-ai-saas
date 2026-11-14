'use server'

import { createClient } from '@/utils/supabase/server'
import type { PasswordState } from '@/app/forgot-password/actions'

export async function updatePassword(_state: PasswordState, form: FormData): Promise<PasswordState> {
  const password = form.get('password')
  if (form.getAll('password').length !== 1 || form.getAll('confirmPassword').length !== 1 ||
      typeof password !== 'string' || password.length < 8 || password.length > 128 || !password.trim() ||
      password !== form.get('confirmPassword')) return { status: 'error', message: 'password' }
  try {
    const client = await createClient()
    // Validate the session with Auth, not an editable metadata claim or form ID.
    const { data: identity, error: authError } = await client.auth.getUser()
    if (authError || !identity.user) return { status: 'error', message: 'session' }
    const { data, error } = await client.auth.updateUser({ password })
    if (error || !data.user || data.user.id !== identity.user.id) return { status: 'error', message: 'unavailable' }
    try {
      const signedOut = await client.auth.signOut({ scope: 'global' })
      if (signedOut.error) return { status: 'updated', message: 'signout' }
    } catch { return { status: 'updated', message: 'signout' } }
    return { status: 'updated', message: 'updated' }
  } catch {
    return { status: 'error', message: 'unavailable' }
  }
}

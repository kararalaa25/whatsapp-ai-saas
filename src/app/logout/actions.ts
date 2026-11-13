'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export async function logout(): Promise<{ error: string }> {
  const errorResult = { error: 'Unable to sign out. Please try again.' }

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signOut({ scope: 'local' })

    if (error) {
      return errorResult
    }
  } catch {
    return errorResult
  }

  redirect('/login')
}

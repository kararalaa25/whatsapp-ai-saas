'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'

export type WorkspaceFormState = { error: string }

export async function createWorkspace(
  _previousState: WorkspaceFormState,
  formData: FormData
): Promise<WorkspaceFormState> {
  const values = formData.getAll('businessName')
  if (values.length !== 1 || typeof values[0] !== 'string') {
    return { error: 'Enter a business name.' }
  }

  // Match PostgreSQL btrim(text) and char_length, including Unicode code points.
  const name = values[0].replace(/^ +| +$/g, '')
  if (Array.from(name).length < 1 || Array.from(name).length > 120) {
    return { error: 'Business name must contain 1 to 120 characters, excluding surrounding spaces.' }
  }

  let createdWorkspaceId: string
  try {
    const supabase = await createClient()
    const { data: identity, error: authError } = await supabase.auth.getClaims()
    if (authError || !identity?.claims?.sub) {
      return { error: 'Your session could not be verified. Please sign in again.' }
    }

    // The database derives creator and owner from the caller's authenticated JWT.
    const { data, error } = await supabase.rpc('create_workspace', { name })
    if (error) {
      if (error.code === '22023' || error.code === '23514') {
        return { error: 'Business name must contain 1 to 120 characters, excluding surrounding spaces.' }
      }
      if (error.code === '28000' || error.code === '42501') {
        return { error: 'Workspace creation is not permitted. Please sign in again or contact support.' }
      }
      return { error: 'Workspace creation could not be confirmed. Check your dashboard before trying again.' }
    }
    if (typeof data !== 'string' || !data) {
      return { error: 'Workspace creation could not be confirmed. Check your dashboard before trying again.' }
    }
    createdWorkspaceId = data
  } catch {
    return { error: 'Workspace creation could not be confirmed. Check your dashboard before trying again.' }
  }

  revalidatePath('/dashboard')
  redirect(`/dashboard?workspace=${encodeURIComponent(createdWorkspaceId)}`)
}

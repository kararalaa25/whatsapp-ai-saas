'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { requireAgentOwner } from '@/utils/ai/access'
import { uuid } from '@/utils/inbox/model'
import { automationSchema } from '@/utils/automation/settings'
import { processAutomation, readAutomation } from '@/utils/automation/engine'
import { readInbox } from '../inbox/actions'

export async function loadAutomation(workspaceId: string) {
  uuid.parse(workspaceId)
  const client = await createClient()
  const workspace = await requireAgentOwner(client, workspaceId)
  const settings = await readAutomation(client, workspace.id)
  const { data, error } = await client.from('whatsapp_automation_audit')
    .select('id, event, settings_revision, created_at').eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20)
  if (error) throw Error('Automation audit unavailable')
  return { workspace, settings, audit: data ?? [] }
}
export async function saveAutomation(workspaceId: string, revision: number, raw: unknown) {
  try {
    uuid.parse(workspaceId); z.number().int().min(0).max(2147483647).parse(revision)
    const settings = automationSchema.parse(raw)
    const client = await createClient()
    const workspace = await requireAgentOwner(client, workspaceId)
    const { error } = await client.rpc('save_whatsapp_automation_settings', { p_workspace_id: workspace.id, p_revision: revision, p_settings: settings })
    if (error) throw Error('Save rejected')
    return { ok: true as const }
  } catch { return { ok: false as const, error: 'Settings were not saved. Check subscription entitlements, owner access, values, migration status, or refresh after another edit.' } }
}
export async function saveAutomationForm(workspaceId: string, revision: number, form: FormData) {
  const minute = (name: string) => {
    const value = form.get(name)
    if (typeof value !== 'string' || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) return NaN
    const [hour, minutes] = value.split(':').map(Number)
    return hour * 60 + minutes
  }
  const result = await saveAutomation(workspaceId, revision, {
    mode: form.get('mode'), language: form.get('language'), business_rules: form.get('business_rules'),
    working_hours_enabled: form.get('working_hours_enabled') === 'on', timezone: form.get('timezone'),
    working_days: form.getAll('working_days').map(Number), start_minute: minute('start_time'), end_minute: minute('end_time') === 0 ? 1440 : minute('end_time'),
  })
  redirect(`/dashboard/automation?workspace=${encodeURIComponent(workspaceId)}&result=${result.ok ? 'saved' : 'rejected'}`)
}
export async function runAutomation(workspaceId: string, conversationId: string) {
  try {
    const result = await processAutomation(await createClient(), workspaceId, conversationId, readInbox)
    const loaded = await readInbox(workspaceId, conversationId)
    if (!loaded.ok) return loaded
    return { ...loaded, notice: result.outcome === 'pending_human'
      ? 'Marked pending human locally. No transfer, notification or message was sent.'
      : 'Automation draft saved locally using the grounded simulator — NOT SENT. No provider call occurred.' }
  } catch { return { ok: false as const, error: 'Automation did not create a draft. Check subscription entitlements, draft-only mode, working hours, owner access, human control, agent settings, an existing run, or changed conversation. Failed reservations can be retried after 5 minutes (3 attempts maximum).' } }
}

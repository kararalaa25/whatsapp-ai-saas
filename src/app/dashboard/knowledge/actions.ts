'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { requireAgentOwner } from '@/utils/ai/access'
import { readKnowledge } from '@/utils/knowledge/access'
import { productSchema, faqSchema, informationSchema, kindSchema, type Kind } from '@/utils/knowledge/schema'

const uuid = z.string().uuid()
type Result = { ok: true; id: string } | { ok: false; error: string }
async function owner(workspaceId: string) {
  uuid.parse(workspaceId)
  const supabase = await createClient()
  const workspace = await requireAgentOwner(supabase, workspaceId)
  return { supabase, workspace }
}
export async function loadKnowledgePanel(workspaceId: string) {
  const { supabase, workspace } = await owner(workspaceId)
  const knowledge = await readKnowledge(supabase, workspace.id)
  return { workspace, ...knowledge }
}
export async function saveKnowledge(workspaceId: string, kind: Kind, id: string | null, raw: unknown): Promise<Result> {
  try {
    kindSchema.parse(kind)
    if (id !== null) uuid.parse(id)
    const schema = kind === 'product' ? productSchema : kind === 'faq' ? faqSchema : informationSchema
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') }
    const { supabase, workspace } = await owner(workspaceId)
    const { data, error } = await supabase.rpc('save_business_knowledge', {
      p_workspace_id: workspace.id, p_kind: kind, p_id: id, p_data: parsed.data,
    })
    if (error || !uuid.safeParse(data).success) return { ok: false, error: error?.code === '23505' ? 'That SKU or business topic already exists in this workspace.' : 'Could not save. Check owner access, field values, and workspace limits (500 products, 200 FAQs).' }
    revalidatePath('/dashboard/knowledge')
    return { ok: true, id: data as string }
  } catch { return { ok: false, error: 'Could not save. Check your session, workspace access, and selected item.' } }
}
export async function deleteKnowledge(workspaceId: string, kind: Kind, id: string): Promise<Result> {
  try {
    kindSchema.parse(kind); uuid.parse(id)
    const { supabase, workspace } = await owner(workspaceId)
    const { error } = await supabase.rpc('delete_business_knowledge', { p_workspace_id: workspace.id, p_kind: kind, p_id: id })
    if (error) return { ok: false, error: 'Could not delete. The item may be unavailable or access has changed.' }
    revalidatePath('/dashboard/knowledge')
    return { ok: true, id }
  } catch { return { ok: false, error: 'Could not delete. Check your session and workspace access.' } }
}

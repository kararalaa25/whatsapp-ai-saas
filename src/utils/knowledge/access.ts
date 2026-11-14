import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { requireAgentOwner } from '@/utils/ai/access'
import { productSchema, faqSchema, informationSchema, limits, type Knowledge } from './schema'

export async function readKnowledge(supabase: SupabaseClient, workspaceId: string): Promise<Knowledge> {
  const workspace = await requireAgentOwner(supabase, z.string().uuid().parse(workspaceId))
  const [products, faqs, information] = await Promise.all([
    supabase.from('business_products').select('id, name, description, category, price, currency, stock_status, sku, active, image_url').eq('workspace_id', workspace.id).order('id').limit(limits.products),
    supabase.from('business_faqs').select('id, question, answer, active').eq('workspace_id', workspace.id).order('id').limit(limits.faqs),
    supabase.from('business_information').select('id, topic, content').eq('workspace_id', workspace.id).order('id').limit(limits.information),
  ])
  if (products.error || faqs.error || information.error || !products.data || !faqs.data || !information.data) throw new Error('Knowledge unavailable')
  const id = { id: z.string().uuid() }
  return {
    products: z.array(productSchema.extend(id)).max(limits.products).parse(products.data),
    faqs: z.array(faqSchema.extend(id)).max(limits.faqs).parse(faqs.data),
    information: z.array(informationSchema.extend(id)).max(limits.information).parse(information.data),
  }
}

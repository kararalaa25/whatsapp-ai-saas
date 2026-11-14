import { z } from 'zod'

const text = (max: number) => z.string().trim().max(max).refine(value => !value.includes('\u0000'), 'NUL characters are not allowed')
export const stockStatuses = ['unknown', 'in_stock', 'out_of_stock', 'preorder'] as const
export const currencies = ['IQD', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'JOD', 'TRY'] as const
export const topics = ['opening_hours', 'delivery', 'payment_methods', 'returns', 'general'] as const
export const topicLabels: Record<typeof topics[number], string> = {
  opening_hours: 'Opening hours', delivery: 'Delivery', payment_methods: 'Payment methods', returns: 'Returns', general: 'General information',
}
// Metadata only: never fetched or rendered as an image. Restrict to public HTTPS
// domain names, without credentials, ports, IP literals or local-network names.
export function safeImageUrl(value: string) {
  try {
    const url = new URL(value)
    const authority = value.slice('https://'.length).split(/[/?#]/)[0]
    return authority.toLowerCase() === url.hostname && value.startsWith('https://') && url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname) && !/\s|[\\<>"']/.test(value)
  } catch { return false }
}
export const productSchema = z.object({
  name: text(160).min(1), description: text(3000), category: text(100),
  price: z.number().finite().min(0).max(999999999999.99).nullable()
    .refine(value => value === null || Number(value.toFixed(2)) === value, 'Use at most two decimal places'),
  currency: z.enum(currencies), stock_status: z.enum(stockStatuses), sku: text(80), active: z.boolean(),
  image_url: text(2048).refine(value => !value || safeImageUrl(value), 'Use a public HTTPS URL without credentials or a port'),
}).strict()
export const faqSchema = z.object({ question: text(300).min(1), answer: text(3000).min(1), active: z.boolean() }).strict()
export const informationSchema = z.object({ topic: z.enum(topics), content: text(4000).min(1) }).strict()
export const kindSchema = z.enum(['product', 'faq', 'information'])
export type Kind = z.infer<typeof kindSchema>
export type ProductInput = z.infer<typeof productSchema>
export type FAQInput = z.infer<typeof faqSchema>
export type InformationInput = z.infer<typeof informationSchema>
export type Product = ProductInput & { id: string }
export type FAQ = FAQInput & { id: string }
export type Information = InformationInput & { id: string }
export type Knowledge = { products: Product[]; faqs: FAQ[]; information: Information[] }
export const emptyProduct: ProductInput = { name: '', description: '', category: '', price: null, currency: 'IQD', stock_status: 'unknown', sku: '', active: true, image_url: '' }
export const limits = { products: 500, faqs: 200, information: 5 } as const
export function filterProducts(products: Product[], search: string, category: string) {
  const query = search.trim().normalize('NFKC').toLocaleLowerCase()
  return products.filter(product => (!category || product.category === category) &&
    [product.name, product.description, product.category, product.sku].join(' ').normalize('NFKC').toLocaleLowerCase().includes(query))
}

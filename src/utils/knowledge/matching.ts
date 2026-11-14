// Retrieval-only normalization. Never rewrite stored/displayed business facts.
export function normalize(value: string) {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا')
    .replace(/[ىی]/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه').replace(/[کگ]/g, 'ك').replace(/چ/g, 'ج')
}
export function words(value: string) { return normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [] }
const groups: Record<string, string[]> = {
  price: ['price', 'prices', 'cost', 'costs', 'much', 'سعر', 'سعره', 'سعرها', 'اسعار', 'السعر', 'ثمن', 'بكم', 'شكد', 'شقد', 'اشكد', 'بشكد', 'جم', 'شگد'],
  stock: ['stock', 'available', 'availability', 'unavailable', 'ماكو', 'نفذ', 'خلص', 'يوجد', 'تتوفر', 'متوفر', 'متوفره', 'موجود', 'موجوده', 'اكو', 'عدكم', 'عندكم', 'عندك', 'عدك', 'توفرون'],
  delivery: ['delivery', 'deliver', 'shipping', 'ship', 'shipment', 'postage', 'توصيل', 'توصلون', 'توصل', 'يوصل', 'يوصلني', 'شحن', 'التوصيل', 'دليفري'],
  payment: ['payment', 'payments', 'pay', 'cash', 'card', 'دفع', 'الدفع', 'نقد', 'كاش', 'بطاقه', 'فيزا'],
  returns: ['return', 'returns', 'refund', 'refunds', 'exchange', 'ترجيع', 'استرجاع', 'ارجاع', 'استبدال', 'ارجع', 'ارجعه', 'ارجعها', 'تبديل'],
  hours: ['hours', 'opening', 'open', 'close', 'schedule', 'وقت', 'ساعات', 'دوام', 'تفتحون', 'تسدون', 'تغلقون', 'فاتحين', 'مفتوح'],
  human: ['human', 'representative', 'agent', 'person', 'employee', 'staff', 'operator', 'support', 'موظف', 'موظفه', 'انسان', 'بشري', 'مسؤول', 'مسوول', 'احجي', 'احاچي', 'احچي'],
  contact: ['contact', 'address', 'location', 'business', 'information', 'معلومات', 'عنوان', 'مكان', 'موقع', 'اتصال', 'located', 'where', 'وين', 'وينكم', 'عنوانكم'],
  fragrance: ['perfume', 'perfumes', 'fragrance', 'fragrances', 'عطر', 'عطور', 'العطر', 'العطور', 'parfum', 'parfums', 'عطورات'],
  sample: ['sample', 'samples', 'tester', 'testers', 'عينه', 'عينات', 'تستر', 'تجربه'],
}
const aliases = new Map(Object.entries(groups).flatMap(([canonical, synonyms]) => synonyms.map(term => [normalize(term), canonical] as const)))
const ignored = new Set(words('the and for are you your what how can with this that have about please do does is it its a an to of me i want need still again now من في هل ما على عن الى كيف هذا هذي هاي هو هي اريد ممكن رجاء شنو شلون لي بيه بيها عندي بعد بعده بعدها هم زين تمام ماله مالها مالته مالتها مو'))
export const intentKeys = new Set(['price', 'stock', 'delivery', 'payment', 'returns', 'hours', 'human', 'contact'])
function forms(word: string) {
  const forms = [word]
  for (const prefix of ['وال', 'بال', 'لل', 'ال', 'و']) if (word.startsWith(prefix) && word.length - prefix.length >= 3) forms.push(word.slice(prefix.length))
  if (/^[a-z]{5,}s$/.test(word) && !word.endsWith('ss')) forms.push(word.slice(0, -1))
  return forms
}
export function terms(value: string) {
  return [...new Set(words(value).filter(word => word.length > 1 && word.length <= 64 && !ignored.has(word))
    .flatMap(word => {
      const variants = forms(word)
      const canonical = variants.map(form => aliases.get(form)).filter((term): term is string => !!term)
      return canonical.length ? canonical : variants
    }))].slice(0, 48)
}
export function intents(value: string) { return new Set(terms(value).filter(term => intentKeys.has(term))) }
// Conservative single edit or adjacent swap, used for product-name tokens of >=5 letters.
// No fuzzy prices, SKU numbers, policy text, or arbitrary semantic inference.
export function oneEdit(a: string, b: string) {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let left = 0; let right = 0; let edits = 0
  while (left < a.length && right < b.length) {
    if (a[left] === b[right]) { left++; right++; continue }
    if (a.length === b.length && a[left] === b[right + 1] && a[left + 1] === b[right] && a.slice(left + 2) === b.slice(right + 2)) return edits === 0
    if (++edits > 1) return false
    if (a.length >= b.length) left++
    if (b.length >= a.length) right++
  }
  return edits + (left < a.length || right < b.length ? 1 : 0) <= 1
}
const arabicLetters: Record<string, string> = {
  ا: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'g', ح: 'h', خ: 'kh', د: 'd', ذ: 'th', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'th', ع: 'a', غ: 'g', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', و: 'w', ي: 'y', پ: 'p', ڤ: 'v',
}
// A low-weight, cross-script consonant hint for catalog names, not translation.
// For example, سوفاج / Sauvage or لينوفو / Lenovo. Short signatures are ignored.
function signature(word: string) {
  return [...word].map(char => arabicLetters[char] ?? char).join('').replace(/v/g, 'f').replace(/p/g, 'b').replace(/j/g, 'g').replace(/[qc]/g, 'k').replace(/[aeiouyw]/g, '')
}
export function transliterated(a: string, b: string) {
  if (!/^[\p{L}]+$/u.test(a) || !/^[\p{L}]+$/u.test(b) || /[\u0600-\u06ff]/.test(a) === /[\u0600-\u06ff]/.test(b)) return false
  const first = signature(a); const second = signature(b)
  return first.length >= 3 && first === second
}

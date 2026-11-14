import 'server-only'

export function applicationOrigin() {
  const value = process.env.NEXT_PUBLIC_APP_URL
  if (!value || !/^https?:\/\/[^\s/@?#\\]+\/?$/i.test(value)) throw Error('Application origin unavailable')
  const url = new URL(value)
  const local = process.env.NODE_ENV === 'development' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw Error('Invalid application origin')
  return url.origin
}

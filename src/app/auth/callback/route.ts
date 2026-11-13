import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const code = params.get('code')
  let authenticated = false

  if (
    params.getAll('code').length === 1 &&
    code &&
    code.length <= 4096 &&
    !/[\s\u0000-\u001f\u007f]/.test(code) &&
    !params.has('error') &&
    !params.has('error_code')
  ) {
    try {
      const supabase = await createClient()
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      authenticated = !error && !!data.session && !!data.user
    } catch {
      authenticated = false
    }
  }

  // Use fresh, fixed paths so codes and other query parameters never carry over.
  const destination = new URL(authenticated ? '/dashboard' : '/login', request.url)
  if (!authenticated) destination.searchParams.set('error', 'confirmation')

  // Next.js Route Handlers merge the helper's mutable cookie-store writes into
  // this response, preserving the exchanged session through the redirect.
  const response = NextResponse.redirect(destination, 303)
  response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Expires', '0')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const code = params.get('code')
  const hash = params.get('token_hash')
  const bounded = (value: string | null) => !!value && value.length <= 4096 && !/[\s\u0000-\u001f\u007f]/.test(value)
  const pkce = params.getAll('code').length === 1 && bounded(code) && !params.has('token_hash') && !params.has('type')
  const otp = !params.has('code') && params.getAll('token_hash').length === 1 && bounded(hash) &&
    params.getAll('type').length === 1 && params.get('type') === 'recovery'
  let verified = false
  if ((pkce || otp) && !params.has('error') && !params.has('error_code')) {
    try {
      const client = await createClient()
      const { data, error } = pkce
        ? await client.auth.exchangeCodeForSession(code!)
        : await client.auth.verifyOtp({ token_hash: hash!, type: 'recovery' })
      verified = !error && !!data.session && !!data.user
    } catch { /* Fixed destination, no token/provider detail exposed. */ }
  }
  const response = NextResponse.redirect(new URL(verified ? '/reset-password' : '/forgot-password?error=recovery', request.url), 303)
  response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

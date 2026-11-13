import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const tokenHash = params.get('token_hash')
  const type = params.get('type')
  let verified = false

  if (
    params.getAll('token_hash').length === 1 &&
    params.getAll('type').length === 1 &&
    tokenHash &&
    tokenHash.length <= 4096 &&
    !/[\s\u0000-\u001f\u007f]/.test(tokenHash) &&
    type === 'signup'
  ) {
    try {
      const supabase = await createClient()
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      verified = !error && !!data.session && !!data.user
    } catch {
      verified = false
    }
  }

  // Construct a fresh URL so no OTP or user-supplied redirect parameters survive.
  const destination = new URL(verified ? '/dashboard' : '/login', request.url)
  if (!verified) destination.searchParams.set('error', 'confirmation')

  // The helper writes to Next.js's mutable cookie store. Route Handlers merge
  // those cookies into the returned response, including redirect responses.
  const response = NextResponse.redirect(destination, 303)
  response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Expires', '0')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

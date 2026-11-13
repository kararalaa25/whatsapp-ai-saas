import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // Meta authenticates this machine-to-machine endpoint with an app-secret HMAC,
  // not browser cookies. Do not refresh user sessions on webhook requests.
  if (request.nextUrl.pathname === '/api/webhooks/whatsapp') {
    return NextResponse.next()
  }
  const cookieResponse = NextResponse.next()
  const authHeaders = new Headers()

  let authenticated = false
  let verificationFailed = false
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet, headers) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value)
              cookieResponse.cookies.set(name, value, options)
            })
            Object.entries(headers).forEach(([name, value]) => {
              authHeaders.set(name, value)
            })
          },
        },
      }
    )

    const { data, error } = await supabase.auth.getClaims()
    authenticated = !error && typeof data?.claims?.sub === 'string' && data.claims.sub.length > 0
  } catch {
    // An unavailable auth service must not grant access or break public pages.
    verificationFailed = true
  }

  const pathname = request.nextUrl.pathname
  const isProtectedRoute =
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/onboarding' ||
    pathname.startsWith('/onboarding/')

  // Proxy authentication does not replace RLS or server-side authorization.
  let response: NextResponse
  if (isProtectedRoute && !authenticated) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    loginUrl.hash = ''
    response = NextResponse.redirect(loginUrl)
  } else {
    response = NextResponse.next({ request })
  }

  // Preserve refreshed cookies and SSR cache headers, including on redirects.
  cookieResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie)
  })
  authHeaders.forEach((value, name) => {
    response.headers.set(name, value)
  })

  if (verificationFailed || (isProtectedRoute && !authenticated)) {
    response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|bmp|tif|tiff)$).*)',
  ],
}

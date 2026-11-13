import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet, _cacheHeaders) {
          // Server Actions and Route Handlers can write cookies. Server
          // Components rely on Proxy refresh: if a write is still attempted
          // there, fail closed rather than hiding a persistence failure.
          // Next.js has no public API here to distinguish read-only contexts.
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })

          // SSR 0.12.7 also supplies response cache headers. This helper owns no
          // response, and next/headers exposes only read-only request headers.
          // The Proxy/Route Handler must apply cache controls to its response;
          // Server Actions receive Next.js's built-in no-store protection.
          // _cacheHeaders cannot be propagated through this client-only API.
        },
      },
    }
  )
}

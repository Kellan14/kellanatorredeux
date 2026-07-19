'use client'

import { supabase } from '@/lib/supabase'

/**
 * fetch() wrapper for client components that attaches the current Supabase
 * access token as `Authorization: Bearer <token>`, so server route handlers can
 * authenticate the request via lib/auth.ts. Use this for any call to a
 * mutating / auth-gated API route.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const headers = new Headers(init.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)

  return fetch(input, { ...init, headers })
}

/** Returns whether the current user is in the client-visible admin allowlist. */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  if (!user) return false

  const ids = (process.env.NEXT_PUBLIC_ADMIN_USER_IDS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  const emails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

  if (ids.includes(user.id.toLowerCase())) return true
  if (user.email && emails.includes(user.email.toLowerCase())) return true
  return false
}

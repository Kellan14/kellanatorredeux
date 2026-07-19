import { createClient, type User } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Server-side auth for API route handlers.
 *
 * This app authenticates on the client with the plain supabase-js client,
 * which stores the session in localStorage (not cookies). So route handlers
 * can't read a cookie session — instead the client sends its access token as
 * `Authorization: Bearer <token>` (see lib/auth-fetch.ts on the client) and we
 * validate it here with auth.getUser(token).
 */

/**
 * Parse and validate the bearer token on the request. Returns the authenticated
 * Supabase user, or null if there is no valid session.
 */
export async function getSessionUser(request: Request): Promise<User | null> {
  const authHeader = request.headers.get('authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const token = match[1].trim()
  if (!token) return null

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) return null
    return data.user
  } catch {
    return null
  }
}

/** True when the given user is in the admin allowlist (ADMIN_USER_IDS / ADMIN_EMAILS). */
export function isAdminUser(user: User | null): boolean {
  if (!user) return false
  const ids = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  const emails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

  if (ids.includes(user.id.toLowerCase())) return true
  if (user.email && emails.includes(user.email.toLowerCase())) return true
  return false
}

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse }

/**
 * Require an authenticated user. On failure returns a 401 response to return
 * directly from the route handler.
 *
 * Usage:
 *   const auth = await requireUser(request)
 *   if (!auth.ok) return auth.response
 *   const userId = auth.user.id
 */
export async function requireUser(request: Request): Promise<AuthResult> {
  const user = await getSessionUser(request)
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    }
  }
  return { ok: true, user }
}

/**
 * Require an authenticated user who is in the admin allowlist. Returns 401 when
 * not logged in, 403 when logged in but not an admin.
 */
export async function requireAdmin(request: Request): Promise<AuthResult> {
  const user = await getSessionUser(request)
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    }
  }
  if (!isAdminUser(user)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Admin access required' }, { status: 403 }),
    }
  }
  return { ok: true, user }
}

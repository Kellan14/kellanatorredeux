import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      // Log the OAuth login
      try {
        await supabase.from('login_history').insert({
          user_id: data.user.id,
          email: data.user.email,
          user_agent: request.headers.get('user-agent')
        })
      } catch (e) {
        console.error('Failed to log OAuth login:', e)
      }
    }
  }

  // Redirect to home page after login
  return NextResponse.redirect(new URL('/', request.url))
}

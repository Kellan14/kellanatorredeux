-- Security-advisor hardening (run in the Supabase SQL Editor).
--
-- Addresses the remaining, pre-existing advisories after RLS was enabled
-- (see scripts/enable-rls-policies.sql). Kept as a separate script because it
-- touches an auth trigger function and function privileges.
--
-- Safe because:
--   * player_games only reads `games`, which now has a public-read RLS policy,
--     so running the view as the caller (security_invoker) still works.
--   * handle_new_user stays SECURITY DEFINER (it must write public.profiles from
--     the auth.users signup trigger); only its search_path is pinned. Triggers
--     fire regardless of the caller's EXECUTE privilege, so revoking direct
--     REST/RPC execute does NOT affect signup.
--   * update_updated_at_column is a trigger-only helper; same reasoning.

-- 1. Run the view with the querying user's permissions, not the creator's.
ALTER VIEW public.player_games SET (security_invoker = true);

-- 2. Signup trigger: pin search_path (body unchanged).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'full_name',
    NOW(),
    NOW()
  );
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;

-- 3. updated_at trigger helper: pin search_path.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM public, anon, authenticated;

-- 4. NOT SQL-fixable: enable "Leaked password protection" in the dashboard →
--    Authentication → Providers/Policies → Password. (Checks new passwords
--    against HaveIBeenPwned.)

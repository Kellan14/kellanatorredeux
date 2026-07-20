-- Row Level Security for the 9 tables that had RLS disabled.
--
-- Access model (verified against the codebase):
--   * The browser never queries these tables directly — all access is in
--     app/api/** and lib/** (server-side).
--   * Reads of public league data go through the ANON key singleton
--     (lib/supabase.ts), so RLS applies and they need a SELECT policy.
--   * Every WRITE path uses the SERVICE ROLE key, which BYPASSES RLS — so no
--     anon/authenticated write policy is needed (or wanted).
--
-- Group A — public read, service-role write:
--   games, player_match_participation, teams, player_first_season,
--   custom_backglass_images, missing_machine_images
--     → anon + authenticated may SELECT; writes only via service role.
--
-- Group B — service-role only (no policy at all; anon/authenticated denied):
--   user_machine_inputs   (per-user private estimates; only read/written server-side w/ service role)
--   active_venue_overrides (admin config; service role only)
--   player_name_update_log (audit log; service role only)
--
-- Policies are dropped-then-created so this script is idempotent.

-- ── Group A ───────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'games',
    'player_match_participation',
    'teams',
    'player_first_season',
    'custom_backglass_images',
    'missing_machine_images'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Public read" ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY "Public read" ON public.%I FOR SELECT TO anon, authenticated USING (true);', t);
  END LOOP;
END $$;

-- ── Group B ───────────────────────────────────────────────────────────────
-- Enable RLS with no policies: anon/authenticated get nothing, the service
-- role (used by every server route that touches these) bypasses RLS.
ALTER TABLE public.user_machine_inputs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_venue_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_name_update_log ENABLE ROW LEVEL SECURITY;

-- Preserve complete review results so opening Options never needs a fresh scan.
ALTER TABLE public.player_name_issues ADD COLUMN IF NOT EXISTS keys jsonb;
ALTER TABLE public.player_name_issues ADD COLUMN IF NOT EXISTS canonical_key text;

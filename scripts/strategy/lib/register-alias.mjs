// Preloaded via `node --import`. Must run before any project module is
// evaluated: lib/supabase.ts builds its client at import time, so the env has
// to be in place first, and the TS sources need the resolution hooks.
import { register } from 'node:module'
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
register('./alias-hooks.mjs', import.meta.url)

import { supabase, fetchAllRecords } from '@/lib/supabase'
import { cache, TTL } from '@/lib/cache'

/**
 * Canonical list of player names used by every player picker in the app.
 *
 * Served from the pre-computed `cache_players` table (rebuilt by the weekly
 * sync-data cron and scripts/rebuild-caches.ts). Scanning the 66k-row games
 * table on every request took ~67 paginated round trips, which is why the
 * pickers used to sit empty for seconds.
 */

const CACHE_KEY = 'players:all'

// Helper to get canonical player name (removes " (sub)" suffix)
export function getCanonicalPlayerName(name: string | null): string | null {
  if (!name) return null
  return name.replace(/\s*\(sub\)\s*$/i, '').trim() || null
}

interface GamePlayerNames {
  player_1_name: string | null
  player_2_name: string | null
  player_3_name: string | null
  player_4_name: string | null
}

/** Fallback: derive the list straight from games (slow, only if the cache is empty). */
async function scanGamesForPlayerNames(): Promise<string[]> {
  // IMPORTANT: Must use .order('id') for consistent pagination
  const games = await fetchAllRecords<GamePlayerNames>(() =>
    supabase
      .from('games')
      .select('player_1_name, player_2_name, player_3_name, player_4_name')
      .gte('season', 2)
      .order('id', { ascending: true })
  )

  const playerSet = new Set<string>()
  for (const game of games) {
    for (const raw of [game.player_1_name, game.player_2_name, game.player_3_name, game.player_4_name]) {
      const canonical = getCanonicalPlayerName(raw)
      if (canonical) playerSet.add(canonical)
    }
  }
  return Array.from(playerSet)
}

export async function getAllPlayerNames(): Promise<string[]> {
  const cached = cache.get<string[]>(CACHE_KEY)
  if (cached) return cached

  let players: string[] = []

  try {
    const rows = await fetchAllRecords<{ player_name: string }>(() =>
      supabase
        .from('cache_players')
        .select('player_name')
        .order('player_name', { ascending: true })
    )
    players = rows.map(r => r.player_name).filter(Boolean)
  } catch (error) {
    console.error('[players] cache_players unavailable, falling back to games scan:', error)
  }

  if (players.length === 0) {
    players = await scanGamesForPlayerNames()
  }

  players.sort((a, b) => a.localeCompare(b))
  cache.set(CACHE_KEY, players, TTL.ONE_HOUR)
  return players
}

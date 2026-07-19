/**
 * Shared top-scores ranking so every reader (machine top-10 dialog, player
 * achievement card, machine detail view) ranks the same way and can't drift
 * apart. Works on rows read from cache_machine_top_scores or extracted live
 * from the games table.
 *
 * Dedup policy: collapse only rows that represent the *same physical score*
 * (same player + score + match + round) — this removes duplicates introduced
 * when a query spans multiple venue-name variations (e.g. "Ice Box" +
 * "Icebox"). It intentionally does NOT dedupe a player's several distinct
 * scores, so a strong player can legitimately hold multiple of the top 10.
 */

export interface RawScoreRow {
  player_name: string
  player_key?: string | null
  score: number | string
  venue?: string | null
  season?: number | null
  week?: number | null
  match_key?: string | null
  round_number?: number | null
}

export interface RankedScore {
  player: string
  playerKey: string
  score: number
  venue: string
  season: number | null
  week: number
  match: string
  round: number
  rank: number
}

export function rankTopScores(rows: RawScoreRow[], limit = 10): RankedScore[] {
  // Dedupe exact-duplicate physical scores.
  const seen = new Set<string>()
  const deduped: RawScoreRow[] = []
  for (const row of rows) {
    const key = `${row.player_key || `name:${row.player_name}`}|${Number(row.score)}|${row.match_key ?? ''}|${row.round_number ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(row)
  }

  // Sort by score descending.
  deduped.sort((a, b) => Number(b.score) - Number(a.score))

  const top = deduped.slice(0, limit)

  // Standard competition ranking: equal scores share a rank; the next distinct
  // score takes the rank of its position (so ranks can skip after a tie).
  const ranked: RankedScore[] = []
  let currentRank = 1
  for (let i = 0; i < top.length; i++) {
    if (i > 0 && Number(top[i].score) < Number(top[i - 1].score)) {
      currentRank = i + 1
    }
    ranked.push({
      player: top[i].player_name,
      playerKey: top[i].player_key || `name:${top[i].player_name}`,
      score: Number(top[i].score),
      venue: top[i].venue || '',
      season: top[i].season ?? null,
      week: top[i].week || 0,
      match: top[i].match_key || '',
      round: top[i].round_number || 0,
      rank: currentRank,
    })
  }
  return ranked
}

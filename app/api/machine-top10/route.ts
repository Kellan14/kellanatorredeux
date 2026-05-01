import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getMachineVariations, machineMappings } from '@/lib/machine-mappings'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getScoreLimits } from '@/lib/score-limits'

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const machineKey = searchParams.get('machine')
    const context = searchParams.get('context')
    const venue = searchParams.get('venue') || ''

    if (!machineKey || !context) {
      return NextResponse.json(
        { error: 'Machine and context parameters are required' },
        { status: 400 }
      )
    }

    // Determine season filter from context
    const isThisSeason = context.includes('this season')
    const currentSeason = 22

    // --- Try cache-first path ---
    const machineVariations = getMachineVariations(machineKey)
    const lowerVariations = machineVariations.map((v: string) => v.toLowerCase())
    const isVenueSpecific = venue && !context.includes('League-wide')
    const venueVariationsForCache = isVenueSpecific ? getVenueVariations(venue) : []

    {
      // Build cache query
      let cacheQuery = supabase
        .from('cache_machine_top_scores' as any)
        .select('*')
        .in('machine', lowerVariations)

      if (isThisSeason) {
        cacheQuery = cacheQuery.eq('season', currentSeason)
      } else {
        cacheQuery = cacheQuery.is('season', null) // null = all-time
      }

      if (isVenueSpecific) {
        cacheQuery = cacheQuery.in('venue', venueVariationsForCache)
      } else {
        cacheQuery = cacheQuery.is('venue', null) // null = league-wide
      }

      // No SQL .limit() here — venue-specific queries hit multiple venue
      // variations (e.g. "Ice Box" + "Icebox"), each storing its own top-10
      // with overlapping records. We need the full set so we can dedupe
      // and re-rank by score across them. Cached top-10 per variation is
      // tiny so pulling them all is cheap.
      const { data: cachedScores } = await cacheQuery as { data: any[] | null }

      if (cachedScores && cachedScores.length > 0) {
        // Dedupe on (player, score, match, round) so the same physical
        // score stored under two venue variations only counts once.
        const seen = new Set<string>()
        const deduped: any[] = []
        for (const row of cachedScores) {
          const key = `${row.player_name}|${row.score}|${row.match_key ?? ''}|${row.round_number ?? ''}`
          if (seen.has(key)) continue
          seen.add(key)
          deduped.push(row)
        }
        // Sort by score desc and assign clean ranks 1..N. Tie handling:
        // identical scores share a rank (the next rank skips appropriately).
        deduped.sort((a, b) => Number(b.score) - Number(a.score))
        const top10 = deduped.slice(0, 10)

        // Backfill actual per-score season for all-time bucket rows. The
        // cache row's `season` column is the bucket label (null = all-time)
        // — NOT the season the score was played in. To avoid showing "All-
        // time" where we should show the real season, look up each score's
        // match in the matches table and use its season. Single query for
        // all 10 records, runs only when at least one row has null season.
        const matchKeys = Array.from(
          new Set(top10.filter(r => r.season == null && r.match_key).map(r => r.match_key))
        ) as string[]
        const matchToSeason = new Map<string, number>()
        if (matchKeys.length > 0) {
          const { data: matchRows } = await supabase
            .from('matches')
            .select('match_key, season')
            .in('match_key', matchKeys) as { data: Array<{ match_key: string; season: number | null }> | null }
          for (const m of matchRows || []) {
            if (m.season != null) matchToSeason.set(m.match_key, m.season)
          }
        }

        const topScores = top10.map((row: any, idx: number, arr: any[]) => {
          let rank = 1
          for (let i = 0; i < idx; i++) {
            if (Number(arr[i].score) > Number(row.score)) rank = i + 2
          }
          // Prefer the cache's season when present (this-season buckets),
          // otherwise the looked-up actual season, otherwise null.
          const actualSeason = row.season ?? (row.match_key ? matchToSeason.get(row.match_key) ?? null : null)
          return {
            player: row.player_name,
            playerKey: row.player_key || `name:${row.player_name}`,
            score: Number(row.score),
            venue: row.venue || '',
            season: actualSeason,
            week: row.week || 0,
            match: row.match_key || '',
            round: row.round_number || 0,
            rank,
          }
        })

        return NextResponse.json({
          machine: machineKey,
          machineKey,
          context,
          topScores
        })
      }
    }

    // --- Fallback: full games scan ---
    // Get all machine name variations to query for (case-insensitive via ilike)
    const lowerMachineKey = machineKey.toLowerCase()
    console.log(`[machine-top10] Querying for machine "${machineKey}" with variations:`, machineVariations)
    console.log(`[machine-top10] Also using ilike for case-insensitive: ${lowerMachineKey}`)
    console.log(`[machine-top10] Season filter: isThisSeason=${isThisSeason}, range=${isThisSeason ? currentSeason : '2-22'}`)

    let games
    try {
      // Use fetchAllRecords with a query builder function for proper pagination
      // Query for ALL machine name variations (both short forms like "PULP" and long forms like "Pulp Fiction")
      games = await fetchAllRecords<{
        player_1_key: string | null
        player_1_name: string | null
        player_1_score: number | null
        player_2_key: string | null
        player_2_name: string | null
        player_2_score: number | null
        player_3_key: string | null
        player_3_name: string | null
        player_3_score: number | null
        player_4_key: string | null
        player_4_name: string | null
        player_4_score: number | null
        venue: string | null
        season: number | null
        week: number | null
        match_key: string | null
        round_number: number | null
      }>(() => {
        // Use .in() to match any of the machine name variations (case-sensitive)
        // This handles cases where DB has "PULP" in old seasons and "Pulp Fiction" in new seasons
        // getMachineVariations returns all case variations so .in() works correctly
        console.log(`[machine-top10] Searching for variations:`, machineVariations)

        let query = supabase
          .from('games')
          .select('player_1_key, player_1_name, player_1_score, player_2_key, player_2_name, player_2_score, player_3_key, player_3_name, player_3_score, player_4_key, player_4_name, player_4_score, venue, season, week, match_key, round_number')
          .in('machine', machineVariations)

        // Filter by season if "this season"
        if (isThisSeason) {
          query = query.eq('season', currentSeason)
        } else {
          // All time: all historical seasons (2-22)
          query = query.gte('season', 2).lte('season', 22)
        }

        // Filter by venue if context is venue-specific (not league-wide)
        // Use venue variations to handle inconsistent naming (e.g., "Ice Box" vs "Icebox")
        if (venue && !context.includes('League-wide')) {
          const venueVariations = getVenueVariations(venue)
          query = query.in('venue', venueVariations)
        }

        // IMPORTANT: Must use .order('id') for consistent pagination - without ordering,
        // PostgreSQL returns rows in arbitrary order that changes between pages
        return query.order('id', { ascending: true })
      })
    } catch (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Load score limits from database
    const scoreLimits = await getScoreLimits()

    // Helper to check if a score should be filtered out based on machine limits
    // Use standardized machine name to check limits
    const isScoreValid = (score: number): boolean => {
      const standardized = (machineMappings[machineKey.toLowerCase()] || machineKey).toLowerCase()
      const machineLimit = scoreLimits[standardized] || scoreLimits[machineKey.toLowerCase()]
      if (!machineLimit) return true
      return score <= machineLimit
    }

    // Extract all scores from games
    // Include playerKey to identify same player with different name variants (e.g., "Name" vs "Name (sub)")
    const scores: Array<{ player: string; playerKey: string; score: number; venue: string; season: number | null; week: number; match: string; round: number }> = []

    for (const game of games) {
      // Player 1
      if (game.player_1_name && game.player_1_score != null && isScoreValid(game.player_1_score)) {
        scores.push({
          player: game.player_1_name,
          playerKey: game.player_1_key || `name:${game.player_1_name}`,
          score: game.player_1_score,
          venue: game.venue || '',
          season: game.season ?? null,
          week: game.week || 0,
          match: game.match_key || '',
          round: game.round_number || 0
        })
      }
      // Player 2
      if (game.player_2_name && game.player_2_score != null && isScoreValid(game.player_2_score)) {
        scores.push({
          player: game.player_2_name,
          playerKey: game.player_2_key || `name:${game.player_2_name}`,
          score: game.player_2_score,
          venue: game.venue || '',
          season: game.season ?? null,
          week: game.week || 0,
          match: game.match_key || '',
          round: game.round_number || 0
        })
      }
      // Player 3
      if (game.player_3_name && game.player_3_score != null && isScoreValid(game.player_3_score)) {
        scores.push({
          player: game.player_3_name,
          playerKey: game.player_3_key || `name:${game.player_3_name}`,
          score: game.player_3_score,
          venue: game.venue || '',
          season: game.season ?? null,
          week: game.week || 0,
          match: game.match_key || '',
          round: game.round_number || 0
        })
      }
      // Player 4
      if (game.player_4_name && game.player_4_score != null && isScoreValid(game.player_4_score)) {
        scores.push({
          player: game.player_4_name,
          playerKey: game.player_4_key || `name:${game.player_4_name}`,
          score: game.player_4_score,
          venue: game.venue || '',
          season: game.season ?? null,
          week: game.week || 0,
          match: game.match_key || '',
          round: game.round_number || 0
        })
      }
    }

    // Sort by score descending
    const sortedScores = scores.sort((a, b) => b.score - a.score)

    // Assign ranks handling ties correctly
    // playerKey is used to identify same player with different name variants (e.g., "Name" vs "Name (sub)")
    const rankedScores: Array<{ player: string; playerKey: string; score: number; venue: string; season: number | null; week: number; match: string; round: number; rank: number }> = []
    let currentRank = 1

    for (let i = 0; i < sortedScores.length; i++) {
      // If this score is different from the previous score, update the rank
      if (i > 0 && sortedScores[i].score < sortedScores[i - 1].score) {
        currentRank = i + 1
      }

      rankedScores.push({
        ...sortedScores[i],
        rank: currentRank
      })
    }

    // Take top 10 after ranking
    const topScores = rankedScores.slice(0, 10)

    return NextResponse.json({
      machine: machineKey,
      machineKey,
      context,
      topScores
    })
  } catch (error) {
    console.error('Error fetching top 10:', error)
    return NextResponse.json(
      { error: 'Failed to fetch top 10' },
      { status: 500 }
    )
  }
}

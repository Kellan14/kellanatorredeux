import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getScoreLimits } from '@/lib/score-limits'
import { rankTopScores } from '@/lib/top-scores'

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
    // Read currentSeason from data so the route doesn't drift past 22.
    let currentSeason = 22
    try {
      const { data: maxSeasonRow } = await supabase
        .from('matches')
        .select('season')
        .order('season', { ascending: false })
        .limit(1)
        .single<{ season: number }>()
      if (maxSeasonRow?.season) currentSeason = maxSeasonRow.season
    } catch { /* keep fallback */ }

    // --- Cache-first path ---
    // cache_machine_top_scores is now rebuilt honestly every night from the
    // full game history (per (machine, venue, season) plus all-venues and
    // all-time buckets), so the dialog and the achievement card read the same
    // source and can't drift apart. Falls through to the live scan below when
    // the cache has no rows for this bucket.
    // machineKey is a canon key, matching what games and the cache both store.
    const lowerMachineKey = machineKey.toLowerCase()
    const isVenueSpecific = venue && !context.includes('League-wide')
    const venueVariationsForCache = isVenueSpecific ? getVenueVariations(venue) : []

    {
      // Build cache query
      let cacheQuery = supabase
        .from('cache_machine_top_scores' as any)
        .select('*')
        .eq('machine', lowerMachineKey)

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
        const ranked = rankTopScores(cachedScores)

        // Backfill actual per-score season for all-time bucket rows. The
        // cache row's `season` column is the bucket label (null = all-time)
        // — NOT the season the score was played in. To avoid showing "All-
        // time" where we should show the real season, look up each score's
        // match in the matches table and use its season. Single query for
        // all records, runs only when at least one row has null season.
        const matchKeys = Array.from(
          new Set(ranked.filter(r => r.season == null && r.match).map(r => r.match))
        )
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

        const topScores = ranked.map(row => ({
          ...row,
          season: row.season ?? (row.match ? matchToSeason.get(row.match) ?? null : null),
        }))

        return NextResponse.json({
          machine: machineKey,
          machineKey,
          context,
          topScores
        })
      }
    }

    // --- Fallback: full games scan ---
    console.log(`[machine-top10] Querying for machine "${machineKey}"`)
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

        let query = supabase
          .from('games')
          .select('player_1_key, player_1_name, player_1_score, player_2_key, player_2_name, player_2_score, player_3_key, player_3_name, player_3_score, player_4_key, player_4_name, player_4_score, venue, season, week, match_key, round_number')
          .eq('machine', machineKey)

        // Filter by season if "this season"
        if (isThisSeason) {
          query = query.eq('season', currentSeason)
        } else {
          // All time: every season we have data for
          query = query.gte('season', 2).lte('season', currentSeason)
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
      const standardized = machineKey.toLowerCase()
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

    // Rank via the shared helper so the live fallback matches the cache path.
    const topScores = rankTopScores(scores.map(s => ({
      player_name: s.player,
      player_key: s.playerKey,
      score: s.score,
      venue: s.venue,
      season: s.season,
      week: s.week,
      match_key: s.match,
      round_number: s.round,
    })))

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

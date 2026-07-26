import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getTeamRoster } from '@/lib/team-roster'
import { aggregateAvg, type AvgMethod } from '@/lib/strategy/stats-calculator'

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const venue = searchParams.get('venue')
    const opponent = searchParams.get('opponent')
    const teamName = searchParams.get('teamName') || 'The Wrecking Crew'
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')
    const teamVenueSpecific = searchParams.get('teamVenueSpecific') === 'true'
    const twcVenueSpecific = searchParams.get('twcVenueSpecific') === 'true'
    const venueWeightParam = parseFloat(searchParams.get('venueWeight') || '0.7')
    const vw = Math.max(0, Math.min(1, venueWeightParam))
    // When true (the strategy page's default), pctOfVenue is computed
    // per-game-normalized (each score is judged against the venue avg
    // for THE venue it was played at, then averaged across games). When
    // false, the legacy venueWeight blend is used. The toggle is in the
    // strategy page's slider panel.
    const usePerGameNormalized = searchParams.get('usePerGameNormalized') !== 'false'
    const opponentPlayersParam = searchParams.get('opponentPlayers')
    const opponentPlayersList = opponentPlayersParam ? opponentPlayersParam.split(',').filter(Boolean) : []

    // Aggregation method for team-machine averages and venue baselines.
    // 'mean' (default) keeps the existing fast cache path. 'median'/'trimmed'
    // forces cache-bypass since cache rows are sums and can't reconstruct
    // per-game distributions. The per-game-normalized branch (PGN below) is
    // sum-based and remains mean-only — switching it would require keeping
    // per-(machine, venue) score arrays, which is a separate refactor.
    const avgMethodParam = searchParams.get('avgMethod')
    const avgMethod: AvgMethod =
      avgMethodParam === 'median' || avgMethodParam === 'trimmed' ? avgMethodParam : 'mean'
    const trimPct = parseFloat(searchParams.get('trimPct') || '0.1')

    if (!venue || !opponent) {
      return NextResponse.json(
        { error: 'Venue and opponent are required' },
        { status: 400 }
      )
    }

    // Use machines passed from client (sourced from venues.json with overrides already applied)
    const machinesParam = searchParams.get('machines')
    const machinesAtVenue = machinesParam ? machinesParam.split(',') : []
    if (machinesAtVenue.length === 0) {
      return NextResponse.json({ error: 'No machines provided' }, { status: 400 })
    }

    // Build a lookup from any variation of a machine name to its canonical (venues.json) name
    const machineVariationToCanonical = new Map<string, string>()
    for (const machine of machinesAtVenue) {
      machineVariationToCanonical.set(machine, machine)
    }
    const allMachineVariations = new Set(machineVariationToCanonical.keys())

    const venueVariations = getVenueVariations(venue)

    // Resolve team keys
    const { data: teamsData } = await supabase
      .from('teams')
      .select('team_key, team_name')

    const teamNameMap: Record<string, string> = {}
    const teamKeyMap: Record<string, string> = {}
    ;(teamsData || []).forEach((t: any) => {
      teamNameMap[t.team_key] = t.team_name
      teamKeyMap[t.team_name] = t.team_key
    })

    const twcTeamKey = teamKeyMap[teamName]
    const opponentTeamKey = teamKeyMap[opponent]

    // --- Try cache-first path (when no opponentPlayers filter) ---
    let venueStats: Map<string, { twcTotal: number; twcCount: number; oppTotal: number; oppCount: number }> = new Map()
    let nonVenueStats: Map<string, { twcTotal: number; twcCount: number; oppTotal: number; oppCount: number }> = new Map()
    // Per-game score arrays, populated only on the non-cache path when
    // avgMethod is non-default. Used by blendAvg for median/trimmed.
    const venueScoresMap: Map<string, { twcScores: number[]; oppScores: number[] }> = new Map()
    const nonVenueScoresMap: Map<string, { twcScores: number[]; oppScores: number[] }> = new Map()
    let venueGames: any[] = [] // still needed for venue baseline + top players
    let gamesData: any[] = []
    let usedCache = false

    // Per-(machine, venue) buckets used by the per-game-normalized branch.
    // Keys: canonical machine name. Inner keys: venue string from the cache /
    // games table. Populated by both code paths so the per-game-normalized
    // pctOfVenue calc can sum (team_total_v / venueAvg_v) across venues.
    type PerVenueTeam = { twcTotal: number; twcCount: number; oppTotal: number; oppCount: number }
    const perVenueTeamStats = new Map<string, Map<string, PerVenueTeam>>()
    const perVenueBaseline = new Map<string, Map<string, { total: number; count: number }>>()
    const addPerVenueTeam = (machine: string, venue: string, side: 'twc' | 'opp', total: number, count: number) => {
      if (!perVenueTeamStats.has(machine)) perVenueTeamStats.set(machine, new Map())
      const inner = perVenueTeamStats.get(machine)!
      const existing = inner.get(venue) || { twcTotal: 0, twcCount: 0, oppTotal: 0, oppCount: 0 }
      if (side === 'twc') { existing.twcTotal += total; existing.twcCount += count }
      else { existing.oppTotal += total; existing.oppCount += count }
      inner.set(venue, existing)
    }
    const addPerVenueBaseline = (machine: string, venue: string, total: number, count: number) => {
      if (!perVenueBaseline.has(machine)) perVenueBaseline.set(machine, new Map())
      const inner = perVenueBaseline.get(machine)!
      const existing = inner.get(venue) || { total: 0, count: 0 }
      existing.total += total
      existing.count += count
      inner.set(venue, existing)
    }

    // Cache rows store sums only — they can't yield medians/trimmed means.
    // Skip the cache read for non-mean methods so the non-cache path runs and
    // we can keep per-game arrays for proper aggregation.
    const canUseCache = avgMethod === 'mean'
    if (canUseCache && opponentPlayersList.length === 0 && twcTeamKey && opponentTeamKey) {
      // Try reading from cache_team_machine_stats
      const { data: cacheData } = await supabase
        .from('cache_team_machine_stats' as any)
        .select('*')
        .in('team_key', [twcTeamKey, opponentTeamKey])
        .gte('season_start', seasonStart)
        .lte('season_end', seasonEnd) as { data: any[] | null }

      if (cacheData && cacheData.length > 0) {
        usedCache = true

        // Build venueStats and nonVenueStats from cache rows
        for (const row of cacheData) {
          // Map cache machine name to canonical venue machine name
          const canonical = machineVariationToCanonical.get(row.machine)
          if (!canonical) continue

          const isVenueRow = row.venue !== null && venueVariations.includes(row.venue)
          const isAllVenuesRow = row.venue === null

          // Venue-specific row
          if (isVenueRow) {
            if (!venueStats.has(canonical)) {
              venueStats.set(canonical, { twcTotal: 0, twcCount: 0, oppTotal: 0, oppCount: 0 })
            }
            const ms = venueStats.get(canonical)!
            if (row.team_key === twcTeamKey) {
              ms.twcTotal += Number(row.total_score); ms.twcCount += row.game_count
            } else if (row.team_key === opponentTeamKey) {
              ms.oppTotal += Number(row.total_score); ms.oppCount += row.game_count
            }
          }

          // Per-venue bucket for the per-game-normalized branch. Skip the
          // venue=NULL rollup row (it's a sum across venues, not a venue
          // we can normalize against on its own).
          if (row.venue) {
            const side = row.team_key === twcTeamKey ? 'twc'
              : row.team_key === opponentTeamKey ? 'opp'
              : null
            if (side) addPerVenueTeam(canonical, row.venue, side, Number(row.total_score), row.game_count)
          }

          // All-venues row → non-venue = allVenues minus venue
          if (isAllVenuesRow) {
            if (!nonVenueStats.has(canonical)) {
              nonVenueStats.set(canonical, { twcTotal: 0, twcCount: 0, oppTotal: 0, oppCount: 0 })
            }
            const ms = nonVenueStats.get(canonical)!
            // All-venues includes venue games, so we subtract venue stats later
            if (row.team_key === twcTeamKey) {
              ms.twcTotal += Number(row.total_score); ms.twcCount += row.game_count
            } else if (row.team_key === opponentTeamKey) {
              ms.oppTotal += Number(row.total_score); ms.oppCount += row.game_count
            }
          }
        }

        // nonVenueStats currently has ALL venues. Subtract venue-specific to get non-venue only.
        for (const [machine, nvs] of Array.from(nonVenueStats.entries())) {
          const vs = venueStats.get(machine)
          if (vs) {
            nvs.twcTotal -= vs.twcTotal; nvs.twcCount -= vs.twcCount
            nvs.oppTotal -= vs.oppTotal; nvs.oppCount -= vs.oppCount
          }
        }
      }
    }

    // Populate per-(machine, venue) baselines from cache_team_machine_stats
    // for every venue we have team data in. Needed by the per-game-normalized
    // branch — sums across all teams give us the venue avg per machine per
    // venue. Cache path only; the fallback path below builds baselines from
    // gamesData directly.
    if (usedCache && usePerGameNormalized) {
      const allMachineKeys = Array.from(machineVariationToCanonical.keys())
      const venuesWeNeed = new Set<string>()
      for (const inner of Array.from(perVenueTeamStats.values())) {
        for (const v of Array.from(inner.keys())) venuesWeNeed.add(v)
      }
      if (venuesWeNeed.size > 0) {
        const { data: baselineRows } = await supabase
          .from('cache_team_machine_stats' as any)
          .select('machine, venue, total_score, game_count')
          .in('machine', allMachineKeys)
          .in('venue', Array.from(venuesWeNeed))
          .gte('season_start', seasonStart)
          .lte('season_end', seasonEnd) as { data: any[] | null }
        for (const r of baselineRows || []) {
          if (!r.venue) continue
          const canonical = machineVariationToCanonical.get(r.machine)
          if (!canonical) continue
          addPerVenueBaseline(canonical, r.venue, Number(r.total_score), Number(r.game_count))
        }
      }
    }

    if (!usedCache) {
      // Fallback: full games scan (original approach)
      try {
        gamesData = await fetchAllRecords<any>(
          () => supabase
            .from('games')
            .select('*')
            .gte('season', seasonStart)
            .lte('season', seasonEnd)
            .order('id', { ascending: true })
        )
      } catch (error) {
        console.error('Error fetching games:', error)
        return NextResponse.json({ error: 'Database error' }, { status: 500 })
      }

      for (const game of gamesData) {
        const canonical = machineVariationToCanonical.get(game.machine)
        if (!canonical) continue
        game.machine = canonical
        const isVenue = venueVariations.includes(game.venue)
        if (isVenue) {
          venueGames.push(game)
        }
      }

      type TeamMachineStatsMap = Map<string, { twcTotal: number; twcCount: number; oppTotal: number; oppCount: number }>

      type TeamMachineScoresMap = Map<string, { twcScores: number[]; oppScores: number[] }>
      const buildTeamStats = (games: any[], scoresOut?: TeamMachineScoresMap): TeamMachineStatsMap => {
        const stats: TeamMachineStatsMap = new Map()
        for (const game of games) {
          if (!stats.has(game.machine)) {
            stats.set(game.machine, { twcTotal: 0, twcCount: 0, oppTotal: 0, oppCount: 0 })
          }
          const ms = stats.get(game.machine)!
          let scores: { twcScores: number[]; oppScores: number[] } | undefined
          if (scoresOut) {
            if (!scoresOut.has(game.machine)) {
              scoresOut.set(game.machine, { twcScores: [], oppScores: [] })
            }
            scores = scoresOut.get(game.machine)!
          }
          for (let i = 1; i <= 4; i++) {
            const teamKey = game[`player_${i}_team`]
            const score = game[`player_${i}_score`]
            const playerName = game[`player_${i}_name`]
            const teamDisplayName = teamNameMap[teamKey]
            if (!score || !teamDisplayName) continue
            if (teamDisplayName === teamName) {
              ms.twcTotal += score; ms.twcCount++
              if (scores) scores.twcScores.push(score)
            }
            else if (teamDisplayName === opponent) {
              if (opponentPlayersList.length === 0 || opponentPlayersList.includes(playerName)) {
                ms.oppTotal += score; ms.oppCount++
                if (scores) scores.oppScores.push(score)
              }
            }
          }
        }
        return stats
      }

      const allGamesNormalized = gamesData.filter((g: any) => machineVariationToCanonical.has(g.machine))
      const nonVenueGames = allGamesNormalized.filter((g: any) => !venueVariations.includes(g.venue))

      const collectScores = avgMethod !== 'mean'
      venueStats = buildTeamStats(venueGames, collectScores ? venueScoresMap : undefined)
      nonVenueStats = buildTeamStats(nonVenueGames, collectScores ? nonVenueScoresMap : undefined)

      // Per-(machine, venue) bucketing for the per-game-normalized branch.
      if (usePerGameNormalized) {
        for (const game of allGamesNormalized) {
          const v = game.venue
          if (!v) continue
          for (let i = 1; i <= 4; i++) {
            const teamKey = game[`player_${i}_team`]
            const score = game[`player_${i}_score`]
            const playerName = game[`player_${i}_name`]
            if (!score) continue
            // Team scores
            const teamDisplayName = teamNameMap[teamKey]
            if (teamDisplayName === teamName) {
              addPerVenueTeam(game.machine, v, 'twc', score, 1)
            } else if (teamDisplayName === opponent) {
              if (opponentPlayersList.length === 0 || opponentPlayersList.includes(playerName)) {
                addPerVenueTeam(game.machine, v, 'opp', score, 1)
              }
            }
            // Venue baseline includes every player's score
            addPerVenueBaseline(game.machine, v, score, 1)
          }
        }
      }
    }

    // Blend function for a team's average on a machine. When per-game score
    // arrays are available (non-cache path with avgMethod != mean), aggregate
    // them via the chosen method; otherwise fall back to total/count.
    const blendAvg = (
      venueTotal: number, venueCount: number,
      nonVenueTotal: number, nonVenueCount: number,
      isVenueSpecific: boolean, weight: number,
      venueScores?: number[], nonVenueScores?: number[]
    ): { avg: number; count: number; source: string } => {
      const useArrays = avgMethod !== 'mean' && (venueScores || nonVenueScores)
      const vAvg = useArrays
        ? (venueScores && venueScores.length > 0 ? aggregateAvg(venueScores, avgMethod, trimPct) : null)
        : (venueCount > 0 ? venueTotal / venueCount : null)
      const nvAvg = useArrays
        ? (nonVenueScores && nonVenueScores.length > 0 ? aggregateAvg(nonVenueScores, avgMethod, trimPct) : null)
        : (nonVenueCount > 0 ? nonVenueTotal / nonVenueCount : null)

      // If venue-specific is checked, only use venue data
      if (isVenueSpecific) {
        return { avg: vAvg ?? 0, count: venueCount, source: vAvg !== null ? 'venue' : 'none' }
      }

      // Otherwise blend
      if (vAvg !== null && nvAvg !== null) {
        return { avg: vAvg * weight + nvAvg * (1 - weight), count: venueCount + nonVenueCount, source: 'blended' }
      } else if (vAvg !== null) {
        return { avg: vAvg, count: venueCount, source: 'venue' }
      } else if (nvAvg !== null) {
        return { avg: nvAvg, count: nonVenueCount, source: 'all' }
      }
      return { avg: 0, count: 0, source: 'none' }
    }

    // Pre-fetch venue baselines and top players from cache if using cache path
    let venueBaselineMap: Record<string, { total: number; count: number }> = {}
    let topPlayersMap: Record<string, string[]> = {}

    if (usedCache && twcTeamKey) {
      // Batch-fetch ALL venue baseline data for all machines at once
      const allMachineKeys = Array.from(machineVariationToCanonical.keys())
      const { data: allVenueRows } = await supabase
        .from('cache_team_machine_stats' as any)
        .select('machine, total_score, game_count, venue')
        .in('machine', allMachineKeys)
        .gte('season_start', seasonStart)
        .lte('season_end', seasonEnd)
        .not('venue', 'is', null) as { data: any[] | null }

      if (allVenueRows) {
        for (const r of allVenueRows) {
          if (!r.venue || !venueVariations.includes(r.venue)) continue
          const canonical = machineVariationToCanonical.get(r.machine)
          if (!canonical) continue
          if (!venueBaselineMap[canonical]) venueBaselineMap[canonical] = { total: 0, count: 0 }
          venueBaselineMap[canonical].total += Number(r.total_score)
          venueBaselineMap[canonical].count += r.game_count
        }
      }

      // Batch-fetch top TWC players per machine from player cache
      const venueFilterQuery = twcVenueSpecific
        ? supabase.from('cache_player_machine_stats' as any).select('player_name, machine, avg_score, game_count, venue')
            .in('machine', allMachineKeys)
            .eq('team_key', twcTeamKey)
            .gte('season_start', seasonStart)
            .lte('season_end', seasonEnd)
            .in('venue', venueVariations)
        : supabase.from('cache_player_machine_stats' as any).select('player_name, machine, avg_score, game_count, venue')
            .in('machine', allMachineKeys)
            .eq('team_key', twcTeamKey)
            .gte('season_start', seasonStart)
            .lte('season_end', seasonEnd)
            .is('venue', null)

      const { data: playerRows } = await venueFilterQuery as { data: any[] | null }
      if (playerRows) {
        // Group by canonical machine, pick top 3 per machine
        const byMachine = new Map<string, { player: string; avg: number }[]>()
        for (const r of playerRows) {
          const canonical = machineVariationToCanonical.get(r.machine)
          if (!canonical) continue
          if (!byMachine.has(canonical)) byMachine.set(canonical, [])
          byMachine.get(canonical)!.push({ player: r.player_name, avg: Number(r.avg_score) })
        }
        for (const [machine, players] of Array.from(byMachine.entries())) {
          // Dedupe by player name, keep highest avg
          const deduped = new Map<string, number>()
          for (const p of players) {
            if (!deduped.has(p.player) || p.avg > deduped.get(p.player)!) {
              deduped.set(p.player, p.avg)
            }
          }
          topPlayersMap[machine] = Array.from(deduped.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name]) => name)
        }
      }
    }

    // Calculate advantages using blended scores
    const advantages = machinesAtVenue.map((machine) => {
      const vs = venueStats.get(machine) || { twcTotal: 0, twcCount: 0, oppTotal: 0, oppCount: 0 }
      const nvs = nonVenueStats.get(machine) || { twcTotal: 0, twcCount: 0, oppTotal: 0, oppCount: 0 }

      const vScores = venueScoresMap.get(machine)
      const nvScores = nonVenueScoresMap.get(machine)
      const twc = blendAvg(vs.twcTotal, vs.twcCount, nvs.twcTotal, nvs.twcCount, twcVenueSpecific, vw, vScores?.twcScores, nvScores?.twcScores)
      const opp = blendAvg(vs.oppTotal, vs.oppCount, nvs.oppTotal, nvs.oppCount, teamVenueSpecific, vw, vScores?.oppScores, nvScores?.oppScores)

      const twcAvg = twc.avg
      const oppAvg = opp.avg
      const advantage = twcAvg - oppAvg
      const advantagePct = oppAvg > 0 ? (advantage / oppAvg) * 100 : 0

      // Get venue average baseline for % of venue calculations
      let venueAvg = 0
      if (usedCache) {
        const baseline = venueBaselineMap[machine]
        venueAvg = baseline && baseline.count > 0 ? baseline.total / baseline.count : 0
      } else {
        const venueScores: number[] = []
        for (const game of venueGames) {
          if (game.machine !== machine) continue
          for (let i = 1; i <= 4; i++) {
            const score = game[`player_${i}_score`]
            if (score) venueScores.push(score)
          }
        }
        venueAvg = aggregateAvg(venueScores, avgMethod, trimPct)
      }

      // % of venue: if no venue baseline, use raw averages comparison instead
      let twcPctOfVenue: number
      let opponentPctOfVenue: number
      let statisticalAdvantage: number

      if (usePerGameNormalized) {
        // Per-game normalization: every (machine, venue) bucket is judged
        // against THAT venue's avg, then summed across venues. Equivalent
        // to twcAvg/venueAvg when the team has data only at the selected
        // venue; differs (correctly) when scope spans multiple venues.
        const computeSidePct = (side: 'twc' | 'opp', isVenueSpecific: boolean): number => {
          const inner = perVenueTeamStats.get(machine)
          if (!inner) return 0
          let sumPct = 0
          let games = 0
          for (const [venueKey, stats] of Array.from(inner.entries())) {
            if (isVenueSpecific && !venueVariations.includes(venueKey)) continue
            const total = side === 'twc' ? stats.twcTotal : stats.oppTotal
            const count = side === 'twc' ? stats.twcCount : stats.oppCount
            if (count <= 0) continue
            const baseline = perVenueBaseline.get(machine)?.get(venueKey)
            const venueAvgV = baseline && baseline.count > 0 ? baseline.total / baseline.count : 0
            if (venueAvgV <= 0) continue
            sumPct += (total / venueAvgV) * 100
            games += count
          }
          return games > 0 ? sumPct / games : 0
        }
        twcPctOfVenue = computeSidePct('twc', twcVenueSpecific)
        opponentPctOfVenue = computeSidePct('opp', teamVenueSpecific)
        statisticalAdvantage = twcPctOfVenue - opponentPctOfVenue
      } else if (venueAvg > 0) {
        twcPctOfVenue = (twcAvg / venueAvg) * 100
        opponentPctOfVenue = (oppAvg / venueAvg) * 100
        statisticalAdvantage = twcPctOfVenue - opponentPctOfVenue
      } else {
        // No venue baseline — compare raw averages directly as a percentage difference
        // Normalize around 100% so the composite score formula still works
        const maxAvg = Math.max(twcAvg, oppAvg, 1)
        twcPctOfVenue = (twcAvg / maxAvg) * 100
        opponentPctOfVenue = (oppAvg / maxAvg) * 100
        statisticalAdvantage = twcPctOfVenue - opponentPctOfVenue
      }

      const experienceAdvantage = twc.count - opp.count

      let advantageLevel = 'Low'
      if (statisticalAdvantage > 10 || experienceAdvantage > 10) {
        advantageLevel = 'High'
      } else if (statisticalAdvantage > 5 || experienceAdvantage > 5) {
        advantageLevel = 'Medium'
      }

      // Get top TWC players for this machine (respecting venue-specific flag)
      let topTwcPlayers: string[] = []
      if (usedCache && topPlayersMap[machine]) {
        topTwcPlayers = topPlayersMap[machine]
      } else if (!usedCache) {
        const playerScores = new Map<string, number[]>()
        for (const game of gamesData) {
          if (game.machine !== machine) continue
          if (twcVenueSpecific && !venueVariations.includes(game.venue)) continue

          for (let i = 1; i <= 4; i++) {
            const teamKey = game[`player_${i}_team`]
            const player = game[`player_${i}_name`]
            const score = game[`player_${i}_score`]
            const teamDisplayName = teamNameMap[teamKey]

            if (teamDisplayName === teamName && player && score) {
              if (!playerScores.has(player)) playerScores.set(player, [])
              playerScores.get(player)!.push(score)
            }
          }
        }

        const playerAvgs = Array.from(playerScores.entries()).map(([player, scores]) => ({
          player,
          avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
          count: scores.length
        })).sort((a, b) => b.avgScore - a.avgScore)

        topTwcPlayers = playerAvgs.slice(0, 3).map(p => p.player)
      }

      const compositeScore = statisticalAdvantage + (experienceAdvantage * 0.5)

      return {
        machine,
        compositeScore,
        twcPctOfVenue,
        opponentPctOfVenue,
        statisticalAdvantage,
        experienceAdvantage,
        advantageLevel,
        topTwcPlayers,
        twcAverage: twcAvg,
        twcTimesPlayed: twc.count,
        opponentAverage: oppAvg,
        opponentTimesPlayed: opp.count,
        advantage,
        advantagePct,
        twcPlays: twc.count,
        twcDataSource: twc.source,
        oppDataSource: opp.source
      }
    })
    .filter(a => a.twcPctOfVenue > 0 || a.opponentPctOfVenue > 0) // exclude machines with zero data for both
    .sort((a, b) => b.compositeScore - a.compositeScore)

    // Get TWC roster + subs from player_match_participation (no hard-coded seasons).
    const twcRoster = await getTeamRoster(twcTeamKey)
    const allTwcPlayers = [...twcRoster.rosterPlayers, ...twcRoster.subPlayers]

    return NextResponse.json({
      advantages,
      players: allTwcPlayers,
      rosterPlayers: twcRoster.rosterPlayers,
      subPlayers: twcRoster.subPlayers,
      subPlayerLastSeen: twcRoster.subPlayerLastSeen,
      currentSeason: twcRoster.currentSeason,
      venue,
      opponent,
      teamName
    })
  } catch (error) {
    console.error('Error calculating machine advantages:', error)
    return NextResponse.json(
      { error: 'Failed to calculate machine advantages' },
      { status: 500 }
    )
  }
}

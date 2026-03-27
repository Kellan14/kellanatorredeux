import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getAllMachineVariations, machineMappings } from '@/lib/machine-mappings'

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
    const opponentPlayersParam = searchParams.get('opponentPlayers')
    const opponentPlayersList = opponentPlayersParam ? opponentPlayersParam.split(',').filter(Boolean) : []

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
      for (const variation of getAllMachineVariations([machine])) {
        machineVariationToCanonical.set(variation, machine)
      }
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
    let venueGames: any[] = [] // still needed for venue baseline + top players
    let gamesData: any[] = []
    let usedCache = false

    if (opponentPlayersList.length === 0 && twcTeamKey && opponentTeamKey) {
      // Try reading from cache_team_machine_stats
      const { data: cacheData } = await supabase
        .from('cache_team_machine_stats' as any)
        .select('*')
        .in('team_key', [twcTeamKey, opponentTeamKey])
        .eq('season_start', seasonStart)
        .eq('season_end', seasonEnd) as { data: any[] | null }

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

      const buildTeamStats = (games: any[]): TeamMachineStatsMap => {
        const stats: TeamMachineStatsMap = new Map()
        for (const game of games) {
          if (!stats.has(game.machine)) {
            stats.set(game.machine, { twcTotal: 0, twcCount: 0, oppTotal: 0, oppCount: 0 })
          }
          const ms = stats.get(game.machine)!
          for (let i = 1; i <= 4; i++) {
            const teamKey = game[`player_${i}_team`]
            const score = game[`player_${i}_score`]
            const playerName = game[`player_${i}_name`]
            const teamDisplayName = teamNameMap[teamKey]
            if (!score || !teamDisplayName) continue
            if (teamDisplayName === teamName) { ms.twcTotal += score; ms.twcCount++ }
            else if (teamDisplayName === opponent) {
              if (opponentPlayersList.length === 0 || opponentPlayersList.includes(playerName)) {
                ms.oppTotal += score; ms.oppCount++
              }
            }
          }
        }
        return stats
      }

      const allGamesNormalized = gamesData.filter((g: any) => machineVariationToCanonical.has(g.machine))
      const nonVenueGames = allGamesNormalized.filter((g: any) => !venueVariations.includes(g.venue))

      venueStats = buildTeamStats(venueGames)
      nonVenueStats = buildTeamStats(nonVenueGames)
    }

    // Blend function for a team's average on a machine
    const blendAvg = (
      venueTotal: number, venueCount: number,
      nonVenueTotal: number, nonVenueCount: number,
      isVenueSpecific: boolean, weight: number
    ): { avg: number; count: number; source: string } => {
      const vAvg = venueCount > 0 ? venueTotal / venueCount : null
      const nvAvg = nonVenueCount > 0 ? nonVenueTotal / nonVenueCount : null

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
        .eq('season_start', seasonStart)
        .eq('season_end', seasonEnd)
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
            .eq('season_start', seasonStart)
            .eq('season_end', seasonEnd)
            .in('venue', venueVariations)
        : supabase.from('cache_player_machine_stats' as any).select('player_name, machine, avg_score, game_count, venue')
            .in('machine', allMachineKeys)
            .eq('team_key', twcTeamKey)
            .eq('season_start', seasonStart)
            .eq('season_end', seasonEnd)
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

      const twc = blendAvg(vs.twcTotal, vs.twcCount, nvs.twcTotal, nvs.twcCount, twcVenueSpecific, vw)
      const opp = blendAvg(vs.oppTotal, vs.oppCount, nvs.oppTotal, nvs.oppCount, teamVenueSpecific, vw)

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
        venueAvg = venueScores.length > 0 ? venueScores.reduce((a, b) => a + b, 0) / venueScores.length : 0
      }

      // % of venue: if no venue baseline, use raw averages comparison instead
      let twcPctOfVenue: number
      let opponentPctOfVenue: number
      let statisticalAdvantage: number

      if (venueAvg > 0) {
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

    // Get TWC players from player_match_participation table
    // Get season 22 players (current roster)
    const { data: season22Data } = await supabase
      .from('player_match_participation')
      .select('player_name, is_sub')
      .eq('season', 22)
      .eq('team', twcTeamKey) as { data: { player_name: string; is_sub: boolean }[] | null }

    const season22Players = new Set<string>()
    const season22Subs = new Set<string>()

    for (const row of (season22Data || [])) {
      const name = (row.player_name || '').trim()
      if (!name) continue
      if (row.is_sub) {
        season22Subs.add(name)
      } else {
        season22Players.add(name)
      }
    }

    // Roster takes priority — remove from subs if they're on the roster
    Array.from(season22Players).forEach(player => season22Subs.delete(player))

    const rosterPlayers = Array.from(season22Players).sort()

    // Start with actual season 22 subs (players marked as is_sub = true)
    const subPlayers = new Set<string>(season22Subs)

    // Also add players from seasons 20-21 who didn't play in season 22
    const { data: oldSeasonsData } = await supabase
      .from('player_match_participation')
      .select('player_name')
      .in('season', [20, 21])
      .eq('team', twcTeamKey) as { data: { player_name: string }[] | null }

    for (const row of (oldSeasonsData || [])) {
      const name = (row.player_name || '').trim()
      if (!name) continue
      // Only add if not in current roster and not already in subs
      if (!season22Players.has(name) && !subPlayers.has(name)) {
        subPlayers.add(name)
      }
    }

    const subPlayersList = Array.from(subPlayers).sort()
    const allTwcPlayers = [...rosterPlayers, ...subPlayersList]

    return NextResponse.json({
      advantages,
      players: allTwcPlayers,
      rosterPlayers: rosterPlayers,
      subPlayers: subPlayersList,
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

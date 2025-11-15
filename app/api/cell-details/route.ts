import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const machine = searchParams.get('machine')
    const column = searchParams.get('column')
    const venue = searchParams.get('venue')
    const team = searchParams.get('team')
    const twcTeam = searchParams.get('twcTeam') || 'The Wrecking Crew'
    const seasonStart = parseInt(searchParams.get('seasonStart') || '1')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '999')
    const teamVenueSpecific = searchParams.get('teamVenueSpecific') === 'true'
    const twcVenueSpecific = searchParams.get('twcVenueSpecific') === 'true'

    if (!machine || !column) {
      return NextResponse.json(
        { error: 'Machine and column are required' },
        { status: 400 }
      )
    }

    console.log('Cell details request:', { machine, column, team, twcTeam, venue, seasonStart, seasonEnd, teamVenueSpecific, twcVenueSpecific })

    // Read match files directly from filesystem
    const allData: any[] = []

    for (let season = seasonStart; season <= seasonEnd; season++) {
      const seasonDir = path.join(process.cwd(), 'mnp-data-archive', `season-${season}`, 'matches')

      if (!fs.existsSync(seasonDir)) {
        console.log(`Season ${season} directory not found, skipping`)
        continue
      }

      const files = fs.readdirSync(seasonDir)

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const filePath = path.join(seasonDir, file)
        const fileContent = fs.readFileSync(filePath, 'utf-8')
        const matchData = JSON.parse(fileContent)

        // Check if match is at the venue
        const matchVenue = matchData.venue?.name || ''
        const isAtVenue = matchVenue.toLowerCase() === venue?.toLowerCase()

        // Process each match to extract player scores
        const rounds = matchData.rounds || []
        for (const round of rounds) {
          const games = round.games || []
          for (const game of games) {
            if (!game.machine || game.machine.toLowerCase() !== machine.toLowerCase()) continue

            // Extract players from each position
            for (let i = 1; i <= 4; i++) {
              const playerKey = game[`player_${i}`]
              const score = game[`score_${i}`]
              const points = game[`points_${i}`]

              if (!playerKey || score === undefined) continue

              // Find player name from lineup
              let playerName = 'Unknown'
              let playerTeam = ''
              let isRoster = false

              // Check home lineup
              if (matchData.home?.lineup) {
                const player = matchData.home.lineup.find((p: any) => p.key === playerKey)
                if (player) {
                  playerName = player.name
                  playerTeam = matchData.home.name
                  isRoster = !player.sub
                }
              }

              // Check away lineup
              if (!playerName || playerName === 'Unknown') {
                if (matchData.away?.lineup) {
                  const player = matchData.away.lineup.find((p: any) => p.key === playerKey)
                  if (player) {
                    playerName = player.name
                    playerTeam = matchData.away.name
                    isRoster = !player.sub
                  }
                }
              }

              // Filter based on venue-specific settings
              let includeData = false

              if (playerTeam.toLowerCase() === twcTeam.toLowerCase()) {
                // TWC data: include if venue-specific and at venue, OR not venue-specific
                includeData = (twcVenueSpecific && isAtVenue) || !twcVenueSpecific
              } else if (playerTeam.toLowerCase() === team?.toLowerCase()) {
                // Opponent data: include if venue-specific and at venue, OR not venue-specific
                includeData = (teamVenueSpecific && isAtVenue) || !teamVenueSpecific
              } else {
                // Other teams: always include (for venue average)
                includeData = true
              }

              if (includeData) {
                allData.push({
                  player_name: playerName,
                  score: score,
                  machine: game.machine,
                  match: matchData.name || file.replace('.json', ''),
                  round: round.n,
                  season: season,
                  venue: matchData.venue?.name || venue,
                  team: playerTeam,
                  is_roster_player: isRoster,
                  points: points || 0,
                  is_pick: false, // TODO: determine if this was a pick
                  is_pick_twc: false,
                })
              }
            }
          }
        }
      }
    }

    console.log('Total data rows:', allData.length)

    // Filter data based on column type
    let filteredData = allData.filter(row =>
      row.machine.toLowerCase() === machine.toLowerCase()
    )

    console.log('After machine filter:', filteredData.length)

    // Apply column-specific filters
    if (column.includes('Team') && !column.includes('TWC')) {
      // Team-specific columns
      console.log('Filtering for team:', team)
      filteredData = filteredData.filter(row =>
        row.team.trim().toLowerCase() === team.trim().toLowerCase() &&
        row.is_roster_player === true
      )
      console.log('After team filter:', filteredData.length)
    } else if (column.includes('TWC')) {
      // TWC-specific columns
      console.log('Filtering for TWC:', twcTeam)
      filteredData = filteredData.filter(row =>
        row.team.trim().toLowerCase() === twcTeam.trim().toLowerCase() &&
        row.is_roster_player === true
      )
      console.log('After TWC filter:', filteredData.length)
    } else if (column.includes('Venue')) {
      // Venue average - all teams at this venue
      console.log('Filtering for venue:', venue)
      filteredData = filteredData.filter(row =>
        row.venue.trim().toLowerCase() === venue.trim().toLowerCase()
      )
      console.log('After venue filter:', filteredData.length)
    } else if (column.includes('%')) {
      // Percentage columns - need to determine which team
      if (column.includes('TWC')) {
        filteredData = filteredData.filter(row =>
          row.team.trim().toLowerCase() === twcTeam.trim().toLowerCase() &&
          row.is_roster_player === true
        )
      } else {
        filteredData = filteredData.filter(row =>
          row.team.trim().toLowerCase() === team.trim().toLowerCase() &&
          row.is_roster_player === true
        )
      }
      console.log('After % filter:', filteredData.length)
    }

    // For "Times Picked" columns, further filter by is_pick
    if (column.includes('Picked') && !column.includes('TWC')) {
      filteredData = filteredData.filter(row => row.is_pick === true)
    } else if (column.includes('TWC') && column.includes('Picked')) {
      filteredData = filteredData.filter(row => row.is_pick_twc === true)
    }

    // Format the data for display
    const details = filteredData.map(row => ({
      player: row.player_name,
      score: row.score,
      match: row.match,
      round: row.round,
      season: row.season,
      venue: row.venue,
      team: row.team,
      points: row.points || 0,
      isPick: row.is_pick,
    }))

    // Calculate summary stats
    let summary = ''
    if (column.includes('Average')) {
      const avgScore = details.length > 0
        ? details.reduce((sum, d) => sum + d.score, 0) / details.length
        : 0
      summary = `${column}: ${Math.round(avgScore).toLocaleString()} (based on ${details.length} scores)`
    } else if (column.includes('Times')) {
      // Count unique games (match + round combinations)
      const uniqueGames = new Set(details.map(d => `${d.match}-${d.round}`))
      summary = `${column}: ${uniqueGames.size.toLocaleString()}`
    } else if (column.includes('%')) {
      const avgScore = details.length > 0
        ? details.reduce((sum, d) => sum + d.score, 0) / details.length
        : 0
      summary = `${column}: ${Math.round(avgScore).toLocaleString()} (from ${details.length} scores)`
    } else if (column.includes('POPS')) {
      // Group by match+round to get unique games
      const gameMap = new Map<string, {points: number, maxPoints: number}>()
      filteredData.forEach(row => {
        const key = `${row.match}-${row.round}`
        if (!gameMap.has(key)) {
          gameMap.set(key, {
            points: row.team_points || 0,
            maxPoints: row.round_points || 0
          })
        }
      })

      const totalPoints = Array.from(gameMap.values()).reduce((sum, g) => sum + g.points, 0)
      const totalPossible = Array.from(gameMap.values()).reduce((sum, g) => sum + g.maxPoints, 0)
      const popsValue = totalPossible > 0 ? (totalPoints / totalPossible) * 100 : 0

      summary = `${column}: ${popsValue.toFixed(1)}% (${totalPoints}/${totalPossible} points from ${gameMap.size} games)`
    } else {
      summary = `Details for ${column}: ${machine}`
    }

    return NextResponse.json({
      machine,
      column,
      summary,
      details,
      count: details.length
    })
  } catch (error) {
    console.error('Error fetching cell details:', error)
    return NextResponse.json(
      { error: 'Failed to fetch cell details' },
      { status: 500 }
    )
  }
}

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { getMachinesData } from '@/lib/data-loader'

// API to get top 3 scores for a machine
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(request: Request) {
  try {
    const machinesData = getMachinesData()
    const { searchParams } = new URL(request.url)
    const machineName = searchParams.get('machine')
    const currentSeason = 22 // Update this as needed

    if (!machineName) {
      return NextResponse.json(
        { error: 'Machine parameter is required' },
        { status: 400 }
      )
    }

    // Find the machine key from the machine name
    const machineEntry = Object.values(machinesData).find(
      (m: any) => m.name === machineName
    )

    if (!machineEntry) {
      console.log('Machine not found in machines.json:', machineName)
      return NextResponse.json({ topSeasonScores: [], topAllTimeScores: [] })
    }

    const machineKey = (machineEntry as any).key
    console.log('Fetching top scores for machine:', machineName, '(key:', machineKey, ')')

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get scores from match data (JSON files)
    const allScores: any[] = []
    const seasonScores: any[] = []

    // Search through seasons 20-22
    for (let season = 20; season <= 22; season++) {
      const seasonDir = path.join(process.cwd(), 'public', 'mnp-data-archive', `season-${season}`, 'matches')

      console.log(`Checking season ${season} at:`, seasonDir)

      if (!fs.existsSync(seasonDir)) {
        console.log(`Season ${season} directory not found`)
        continue
      }

      const files = fs.readdirSync(seasonDir)

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const matchData = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'))
        const matchVenue = matchData.venue?.name || ''

        const rounds = matchData.rounds || []
        for (const round of rounds) {
          const games = round.games || []
          for (const game of games) {
            if (game.machine !== machineKey) continue

            // Check all player positions
            for (let i = 1; i <= 4; i++) {
              const playerKey = game[`player_${i}`]
              const score = game[`score_${i}`]

              if (!playerKey || score === undefined) continue

              // Find player name
              let playerName = ''

              if (matchData.home?.lineup) {
                const p = matchData.home.lineup.find((pl: any) => pl.key === playerKey)
                if (p) playerName = p.name
              }

              if (!playerName && matchData.away?.lineup) {
                const p = matchData.away.lineup.find((pl: any) => pl.key === playerKey)
                if (p) playerName = p.name
              }

              if (playerName) {
                const scoreEntry = {
                  player: playerName,
                  score,
                  venue: matchVenue,
                  season,
                  source: 'match'
                }

                allScores.push(scoreEntry)
                if (season === currentSeason) {
                  seasonScores.push(scoreEntry)
                }
              }
            }
          }
        }
      }
    }

    // NOTE: User-submitted scores are NOT included in Top 3 calculations
    // Only match data from league games is used

    // Sort and get top 3
    const topSeasonScores = seasonScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    const topAllTimeScores = allScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    console.log(`Found ${allScores.length} total scores, ${seasonScores.length} this season`)
    console.log('Top season scores:', topSeasonScores)
    console.log('Top all-time scores:', topAllTimeScores)

    return NextResponse.json({
      topSeasonScores,
      topAllTimeScores
    })
  } catch (error) {
    console.error('Error fetching top scores:', error)
    return NextResponse.json(
      { error: 'Failed to fetch top scores' },
      { status: 500 }
    )
  }
}

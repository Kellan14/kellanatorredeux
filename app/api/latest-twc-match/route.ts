import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  try {
    const matchesDir = path.join(process.cwd(), 'public', 'mnp-data-archive', 'season-22', 'matches')
    const files = fs.readdirSync(matchesDir)

    // Filter for TWC matches and parse their data
    const twcMatches: Array<{ filename: string; week: number; data: any }> = []

    for (const file of files) {
      if (file.includes('TWC') && file.endsWith('.json')) {
        const filePath = path.join(matchesDir, file)
        const fileContent = fs.readFileSync(filePath, 'utf-8')
        const matchData = JSON.parse(fileContent)

        // Extract week number from match data
        const weekNum = parseInt(matchData.week || '0', 10)
        twcMatches.push({
          filename: file,
          week: weekNum,
          data: matchData
        })
      }
    }

    // Sort by week number descending (most recent first)
    twcMatches.sort((a, b) => b.week - a.week)

    // Get the most recent match (regardless of state)
    if (twcMatches.length > 0) {
      const matchData = twcMatches[0].data

      // Determine opponent - TWC could be home or away
      let opponent = ''
      if (matchData.home && matchData.home.key === 'TWC') {
        opponent = matchData.away.name
      } else if (matchData.away && matchData.away.key === 'TWC') {
        opponent = matchData.home.name
      }

      return NextResponse.json({
        venue: matchData.venue.name,
        opponent: opponent,
        matchKey: matchData.key,
        week: matchData.week,
        state: matchData.state
      })
    }

    // Fallback to GPA and first non-TWC team if no match found
    return NextResponse.json({
      venue: 'Georgetown Pizza and Arcade',
      opponent: null,
      matchKey: null
    })
  } catch (error) {
    console.error('Error finding latest TWC match:', error)
    return NextResponse.json(
      { error: 'Failed to find latest match' },
      { status: 500 }
    )
  }
}

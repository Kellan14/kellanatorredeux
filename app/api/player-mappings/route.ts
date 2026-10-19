import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { unstable_cache, revalidateTag } from 'next/cache'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Helper to get canonical player name (removes " (sub)" suffix)
function getCanonicalPlayerName(name: string | null): string | null {
  if (!name) return null
  return name.replace(/\s*\(sub\)\s*$/i, '').trim()
}

// Helper function to get all unique players from database (both tables)
async function getAllPlayers(): Promise<string[]> {
  try {
    const uniquePlayers = new Set<string>()

    // Fetch from player_match_participation
    const participationData = await fetchAllRecords<{ player_name: string }>(
      () => supabase
        .from('player_match_participation')
        .select('player_name')
        .not('player_name', 'is', null)
        .order('id', { ascending: true })
    )
    participationData?.forEach((row) => {
      if (row.player_name) {
        uniquePlayers.add(row.player_name)
      }
    })

    // Also fetch from games table to get players that might only exist there
    const gamesData = await fetchAllRecords<{
      player_1_name: string | null
      player_2_name: string | null
      player_3_name: string | null
      player_4_name: string | null
    }>(
      () => supabase
        .from('games')
        .select('player_1_name, player_2_name, player_3_name, player_4_name')
        .gte('season', 2)
        .order('id', { ascending: true })
    )
    gamesData?.forEach((row) => {
      // Use canonical names (remove " (sub)" suffix)
      const canonical1 = getCanonicalPlayerName(row.player_1_name)
      const canonical2 = getCanonicalPlayerName(row.player_2_name)
      const canonical3 = getCanonicalPlayerName(row.player_3_name)
      const canonical4 = getCanonicalPlayerName(row.player_4_name)
      if (canonical1) uniquePlayers.add(canonical1)
      if (canonical2) uniquePlayers.add(canonical2)
      if (canonical3) uniquePlayers.add(canonical3)
      if (canonical4) uniquePlayers.add(canonical4)
    })

    return Array.from(uniquePlayers).sort()
  } catch (error) {
    console.error('Error getting all players:', error)
    throw error
  }
}

// GET - Fetch all available players from the database
// Note: Mappings are stored client-side in localStorage
const cachedPlayers = unstable_cache(getAllPlayers, ['standardize-player-directory-v1'], {
  revalidate: 3600,
  tags: ['standardize-player-directory'],
})

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get('refresh') === 'true') {
      revalidateTag('standardize-player-directory', { expire: 0 })
    }
    const allPlayers = await cachedPlayers()

    return NextResponse.json({
      allPlayers,
      count: allPlayers.length,
      note: 'Player directory is cached for one hour; name mappings live in the database.'
    })
  } catch (error) {
    console.error('Error in GET /api/player-mappings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch players' },
      { status: 500 }
    )
  }
}

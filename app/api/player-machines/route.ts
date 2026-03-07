import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { machineMappings } from '@/lib/machine-mappings'
import { fetchAllRecords } from '@/lib/supabase'

// Standardize machine name to its canonical form (DB value)
function standardizeMachineName(machineName: string): string {
  if (!machineName) return machineName
  const normalized = machineName.toLowerCase().trim()
  // Check if there's a mapping to a canonical name
  const mapped = machineMappings[normalized] || machineMappings[machineName]
  return mapped || machineName
}

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Returns the list of machines a player has scores for
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')

    if (!player) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get player name mappings to find all aliases for this player
    const { data: mappingsData } = await supabase
      .from('player_name_mappings')
      .select('alias, canonical_name')

    // Build a set of all names that map to this player (including the player name itself)
    const playerNames = new Set<string>([player])

    // If this player is a canonical name, add all their aliases
    for (const mapping of mappingsData || []) {
      if (mapping.canonical_name === player) {
        playerNames.add(mapping.alias)
      }
      // If this player is an alias, add the canonical name and other aliases
      if (mapping.alias === player) {
        playerNames.add(mapping.canonical_name)
        // Find other aliases for this canonical name
        for (const m of mappingsData || []) {
          if (m.canonical_name === mapping.canonical_name) {
            playerNames.add(m.alias)
          }
        }
      }
    }

    // Get all games using pagination with ORDER BY id to avoid missing data
    const gamesData = await fetchAllRecords<any>(() =>
      supabase
        .from('games')
        .select('id, machine, player_1_name, player_2_name, player_3_name, player_4_name')
        .order('id', { ascending: true })
    )

    // Collect unique machines the player has played
    const machineSet = new Set<string>()

    for (const game of gamesData || []) {
      // Check if any of the player's names (including aliases) played this game
      const gamePlayerNames = [
        game.player_1_name,
        game.player_2_name,
        game.player_3_name,
        game.player_4_name
      ].filter(Boolean)

      const playerNamesArray = Array.from(playerNames)
      const playerPlayed = gamePlayerNames.some(name => {
        // Direct match
        if (playerNames.has(name)) return true
        // Check for "(sub)" suffix matches
        for (const pName of playerNamesArray) {
          if (name === `${pName} (sub)` || name.startsWith(`${pName} (sub)`)) {
            return true
          }
        }
        return false
      })

      if (playerPlayed && game.machine) {
        // Standardize machine name for display
        const standardized = standardizeMachineName(game.machine)
        machineSet.add(standardized)
      }
    }

    // Convert to sorted array
    const machines = Array.from(machineSet).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    )

    return NextResponse.json({
      player,
      machines,
      count: machines.length
    })
  } catch (error) {
    console.error('[player-machines] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

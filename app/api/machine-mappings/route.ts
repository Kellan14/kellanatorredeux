import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { machineMappings } from '@/lib/machine-mappings'

export const dynamic = 'force-dynamic'

// Helper function to get all unique machines from database
async function getAllMachines(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('games')
      .select('machine')
      .not('machine', 'is', null)

    if (error) {
      console.error('Error fetching machines:', error)
      return []
    }

    const uniqueMachines = new Set<string>()
    data?.forEach((game: { machine: string }) => {
      if (game.machine) {
        uniqueMachines.add(game.machine)
      }
    })

    return Array.from(uniqueMachines).sort()
  } catch (error) {
    console.error('Error getting all machines:', error)
    return []
  }
}

// GET - Fetch all machine mappings and available machines
// Machine mappings are now defined in lib/machine-mappings.ts (single source of truth)
export async function GET() {
  try {
    const allMachines = await getAllMachines()

    return NextResponse.json({
      mappings: machineMappings,
      allMachines,
      count: Object.keys(machineMappings).length,
      note: 'Mappings are defined in lib/machine-mappings.ts. Edit that file to update mappings.'
    })
  } catch (error) {
    console.error('Error in GET /api/machine-mappings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch machine mappings' },
      { status: 500 }
    )
  }
}

// POST, PUT, DELETE - No longer supported since mappings are in TypeScript file
export async function POST() {
  return NextResponse.json(
    { error: 'Machine mappings are now defined in lib/machine-mappings.ts. Edit that file directly to add new mappings.' },
    { status: 405 }
  )
}

export async function PUT() {
  return NextResponse.json(
    { error: 'Machine mappings are now defined in lib/machine-mappings.ts. Edit that file directly to update mappings.' },
    { status: 405 }
  )
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'Machine mappings are now defined in lib/machine-mappings.ts. Edit that file directly to delete mappings.' },
    { status: 405 }
  )
}

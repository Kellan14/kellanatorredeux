import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const MACHINE_MAPPING_FILE = path.join(process.cwd(), 'public', 'machine_mapping.json')

// Helper function to load machine mappings from file
function loadMachineMappings(): Record<string, string> {
  try {
    if (fs.existsSync(MACHINE_MAPPING_FILE)) {
      const data = fs.readFileSync(MACHINE_MAPPING_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('Error loading machine mappings:', error)
  }
  return {}
}

// Helper function to save machine mappings to file
function saveMachineMappings(mappings: Record<string, string>): void {
  try {
    fs.writeFileSync(MACHINE_MAPPING_FILE, JSON.stringify(mappings, null, 2), 'utf-8')
  } catch (error) {
    console.error('Error saving machine mappings:', error)
    throw new Error('Failed to save machine mappings')
  }
}

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
export async function GET() {
  try {
    const mappings = loadMachineMappings()
    const allMachines = await getAllMachines()

    return NextResponse.json({
      mappings,
      allMachines,
      count: Object.keys(mappings).length
    })
  } catch (error) {
    console.error('Error in GET /api/machine-mappings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch machine mappings' },
      { status: 500 }
    )
  }
}

// POST - Add a new machine mapping
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { alias, standardized } = body

    if (!alias || !standardized) {
      return NextResponse.json(
        { error: 'Both alias and standardized name are required' },
        { status: 400 }
      )
    }

    const mappings = loadMachineMappings()
    mappings[alias] = standardized
    saveMachineMappings(mappings)

    return NextResponse.json({
      success: true,
      mappings,
      message: `Added mapping: ${alias} → ${standardized}`
    })
  } catch (error) {
    console.error('Error in POST /api/machine-mappings:', error)
    return NextResponse.json(
      { error: 'Failed to add machine mapping' },
      { status: 500 }
    )
  }
}

// PUT - Update an existing machine mapping
export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { alias, standardized } = body

    if (!alias || !standardized) {
      return NextResponse.json(
        { error: 'Both alias and standardized name are required' },
        { status: 400 }
      )
    }

    const mappings = loadMachineMappings()

    if (!(alias in mappings)) {
      return NextResponse.json(
        { error: `Mapping for '${alias}' not found` },
        { status: 404 }
      )
    }

    mappings[alias] = standardized
    saveMachineMappings(mappings)

    return NextResponse.json({
      success: true,
      mappings,
      message: `Updated mapping: ${alias} → ${standardized}`
    })
  } catch (error) {
    console.error('Error in PUT /api/machine-mappings:', error)
    return NextResponse.json(
      { error: 'Failed to update machine mapping' },
      { status: 500 }
    )
  }
}

// DELETE - Remove a machine mapping
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const alias = searchParams.get('alias')

    if (!alias) {
      return NextResponse.json(
        { error: 'Alias parameter is required' },
        { status: 400 }
      )
    }

    const mappings = loadMachineMappings()

    if (!(alias in mappings)) {
      return NextResponse.json(
        { error: `Mapping for '${alias}' not found` },
        { status: 404 }
      )
    }

    delete mappings[alias]
    saveMachineMappings(mappings)

    return NextResponse.json({
      success: true,
      mappings,
      message: `Deleted mapping for '${alias}'`
    })
  } catch (error) {
    console.error('Error in DELETE /api/machine-mappings:', error)
    return NextResponse.json(
      { error: 'Failed to delete machine mapping' },
      { status: 500 }
    )
  }
}

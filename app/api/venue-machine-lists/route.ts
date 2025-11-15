import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const VENUE_MACHINE_LISTS_PATH = path.join(process.cwd(), 'venue_machine_lists.json')

export interface VenueMachineList {
  included?: string[]
  excluded?: string[]
}

export interface VenueMachineLists {
  [venueName: string]: VenueMachineList
}

// GET: Read venue machine lists
export async function GET() {
  try {
    const fileContent = fs.readFileSync(VENUE_MACHINE_LISTS_PATH, 'utf-8')
    const lists: VenueMachineLists = JSON.parse(fileContent)

    return NextResponse.json({ lists })
  } catch (error) {
    console.error('Error reading venue machine lists:', error)
    return NextResponse.json({ lists: {} })
  }
}

// POST: Update venue machine lists
export async function POST(request: Request) {
  try {
    const { venueName, included, excluded } = await request.json()

    if (!venueName) {
      return NextResponse.json(
        { error: 'Venue name is required' },
        { status: 400 }
      )
    }

    // Read current lists
    let lists: VenueMachineLists = {}
    try {
      const fileContent = fs.readFileSync(VENUE_MACHINE_LISTS_PATH, 'utf-8')
      lists = JSON.parse(fileContent)
    } catch (error) {
      // File doesn't exist or is invalid, start with empty object
      lists = {}
    }

    // Normalize venue name (lowercase for consistency)
    const normalizedVenueName = venueName.toLowerCase()

    // Update the lists for this venue
    lists[normalizedVenueName] = {
      included: included || [],
      excluded: excluded || []
    }

    // Remove empty entries
    if (lists[normalizedVenueName].included!.length === 0 &&
        lists[normalizedVenueName].excluded!.length === 0) {
      delete lists[normalizedVenueName]
    }

    // Write back to file
    fs.writeFileSync(
      VENUE_MACHINE_LISTS_PATH,
      JSON.stringify(lists, null, 2),
      'utf-8'
    )

    return NextResponse.json({ success: true, lists })
  } catch (error) {
    console.error('Error updating venue machine lists:', error)
    return NextResponse.json(
      { error: 'Failed to update venue machine lists' },
      { status: 500 }
    )
  }
}

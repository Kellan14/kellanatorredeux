import { NextResponse } from 'next/server'

export interface VenueMachineList {
  included?: string[]
  excluded?: string[]
}

export interface VenueMachineLists {
  [venueName: string]: VenueMachineList
}

export async function GET() {
  try {
    return NextResponse.json({
      lists: {},
      message: 'Feature temporarily disabled - GitHub data fetching in progress'
    })
  } catch (error) {
    console.error('Error reading venue machine lists:', error)
    return NextResponse.json({ lists: {} })
  }
}

export async function POST(request: Request) {
  try {
    const { venueName, included, excluded } = await request.json()

    if (!venueName) {
      return NextResponse.json(
        { error: 'Venue name is required' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      lists: {},
      message: 'Feature temporarily disabled - GitHub data fetching in progress'
    })
  } catch (error) {
    console.error('Error updating venue machine lists:', error)
    return NextResponse.json(
      { error: 'Failed to update venue machine lists' },
      { status: 500 }
    )
  }
}

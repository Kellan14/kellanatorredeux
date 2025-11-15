import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const uid = searchParams.get('uid')

    if (!uid) {
      return NextResponse.json(
        { error: 'UID is required' },
        { status: 400 }
      )
    }

    const mappingsPath = path.join(process.cwd(), 'player-mappings.json')
    const fileContent = fs.readFileSync(mappingsPath, 'utf-8')
    const mappings = JSON.parse(fileContent)

    const playerData = mappings[uid]

    if (!playerData) {
      return NextResponse.json(
        { error: 'Player mapping not found for this UID' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      uid: uid,
      name: playerData.name,
      team: playerData.team
    })
  } catch (error) {
    console.error('Error fetching player mapping:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player mapping' },
      { status: 500 }
    )
  }
}

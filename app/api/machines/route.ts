import { NextResponse } from 'next/server'
import { getMachinesData } from '@/lib/data-loader'

export async function GET() {
  try {
    const machinesData = getMachinesData()
    return NextResponse.json(machinesData)
  } catch (error) {
    console.error('Error loading machines data:', error)
    return NextResponse.json(
      { error: 'Failed to load machines data' },
      { status: 500 }
    )
  }
}

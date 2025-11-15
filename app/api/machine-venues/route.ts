import { NextResponse } from 'next/server'
import machinesData from '@/mnp-data-archive/machines.json'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const machineName = searchParams.get('machine')

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
      return NextResponse.json({ venues: [] })
    }

    const machineKey = (machineEntry as any).key
    console.log('Finding venues for machine:', machineName, '(key:', machineKey, ')')

    // Get all venues and their machines
    const venuesResponse = await fetch(`${request.url.split('/api')[0]}/api/venues`)
    if (!venuesResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch venues' },
        { status: 500 }
      )
    }

    const venuesData = await venuesResponse.json()
    const venues: string[] = []

    // Find venues that have this machine (using machine key)
    venuesData.venues.forEach((venue: any) => {
      if (venue.machines && venue.machines.includes(machineKey)) {
        venues.push(venue.name)
      }
    })

    console.log(`Found ${venues.length} venues with ${machineName}`)

    return NextResponse.json({ venues })
  } catch (error) {
    console.error('Error fetching machine venues:', error)
    return NextResponse.json(
      { error: 'Failed to fetch venues' },
      { status: 500 }
    )
  }
}

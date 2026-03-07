import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Machine mapping for image paths (same as machine_mapping.json)
const machineMapping: Record<string, string> = {
  "future spa": "FutureSpa",
  "hotdoggin'": "Hotdoggin_",
  "hotdoggin": "Hotdoggin_",
  "funhouse rudy's nightmare": "FHRN",
  "fhrn": "FHRN",
  "attack from mars": "AFM",
  "afm": "AFM",
  "pulp": "PULP",
  "pulp fiction": "PULP",
  "bksor": "BKSoR",
  "black knight sword of rage": "BKSoR",
  "james bond": "007",
  "james bond 007": "007",
  "lights camera action": "LCA",
  "banzairun": "BanzaiRun",
  "banzai run": "BanzaiRun",
  "party animals": "party animal",
  "mandolorian": "Mandalorian",
  "mandalorian": "Mandalorian",
  "the mandalorian (premium)": "Mandalorian",
  "bobby orr power player": "BOPP",
  "bopp": "BOPP",
  "dp": "DP",
  "deadpool": "DP",
  "ej": "EJ",
  "elton john": "EJ",
  "br": "BR",
  "buck rogers": "BR",
  "ebb": "EBB",
  "eight ball beyond": "EBB",
  "godzilla (stern)": "Godzilla",
  "godzilla": "Godzilla",
  "guardians of the galaxy": "Guardians",
  "guardians": "Guardians",
  "scooby doo": "SD",
  "scooby-doo": "SD",
  "sd": "SD",
  "venom (r)": "VEN",
  "venom left": "VEN",
  "venom right": "VEN",
  "venom": "VEN",
  "ven": "VEN",
  "sdnd": "SDND",
  "dnd": "SDND",
  "dungeons and dragons": "SDND",
  "dungeons and dragons (stern)": "SDND",
  "jurassic": "SternPark",
  "jurassic park": "SternPark",
  "stern jurassic park": "SternPark",
  "ghost": "Ghost",
  "ghostbusters": "Ghost",
  "jw": "JW",
  "john wick": "JW",
  "foo fighters": "FOO",
  "foo": "FOO",
  "batman dark knight": "BDK",
  "bdk": "BDK",
  "batman data east": "BatmanDE",
  "batman (data east)": "BatmanDE",
  "getaway": "HS2TheGetaway",
  "hs2 the getaway": "HS2TheGetaway",
  "the getaway": "HS2TheGetaway",
  "nightrider": "NR",
  "nr": "NR",
  "night rider": "NR",
  "uxmen": "UXMEN",
  "uncanny x-men": "UXMEN"
}

function getMappedImageKey(machineKey: string, machineName: string): string {
  // Check machine name first
  const nameNormalized = machineName.toLowerCase().trim()
  if (machineMapping[nameNormalized]) {
    return machineMapping[nameNormalized]
  }

  // Check machine key
  const keyNormalized = machineKey.toLowerCase().trim()
  if (machineMapping[keyNormalized]) {
    return machineMapping[keyNormalized]
  }

  // Return original key
  return machineKey
}

export async function GET(request: Request) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow in development or if no cron secret is set
    if (process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey)
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://kellanator.vercel.app'

    // Fetch all machines
    const machinesResponse = await fetch(`${baseUrl}/api/machines`)
    if (!machinesResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch machines' }, { status: 500 })
    }
    const machinesData = await machinesResponse.json()

    const machines = Object.values(machinesData) as Array<{ key: string; name: string }>
    const missingMachines: Array<{ key: string; name: string; checked_at: string }> = []

    // Check each machine for missing thumbnail
    for (const machine of machines) {
      const imageKey = getMappedImageKey(machine.key, machine.name)
      const thumbnailUrl = `${baseUrl}/opdb_backglass_images/thumbnails/${imageKey}.jpg`

      try {
        const response = await fetch(thumbnailUrl, { method: 'HEAD' })
        if (!response.ok) {
          missingMachines.push({
            key: machine.key,
            name: machine.name,
            checked_at: new Date().toISOString()
          })
        }
      } catch {
        missingMachines.push({
          key: machine.key,
          name: machine.name,
          checked_at: new Date().toISOString()
        })
      }
    }

    // Clear existing missing images and insert new ones
    await supabase.from('missing_machine_images').delete().neq('key', '')

    if (missingMachines.length > 0) {
      const { error } = await supabase.from('missing_machine_images').insert(missingMachines)
      if (error) {
        console.error('Error inserting missing images:', error)
      }
    }

    return NextResponse.json({
      success: true,
      totalMachines: machines.length,
      missingCount: missingMachines.length,
      missing: missingMachines.map(m => m.name)
    })
  } catch (error) {
    console.error('Error checking missing images:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

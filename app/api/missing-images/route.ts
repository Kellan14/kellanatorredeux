import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Machine mapping for image paths
const machineMapping: Record<string, string> = {
  "future spa": "FutureSpa",
  "hotdoggin'": "Hotdoggin_",
  "hotdoggin": "Hotdoggin_",
}

function getMappedImageKey(machineKey: string, machineName: string): string {
  const nameNormalized = machineName.toLowerCase().trim()
  if (machineMapping[nameNormalized]) {
    return machineMapping[nameNormalized]
  }
  const keyNormalized = machineKey.toLowerCase().trim()
  if (machineMapping[keyNormalized]) {
    return machineMapping[keyNormalized]
  }
  return machineKey
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const refresh = searchParams.get('refresh') === 'true'

  try {
    const supabase = createClient(supabaseUrl, supabaseKey)

    // If not refreshing, try to get cached data
    if (!refresh) {
      const { data, error } = await supabase
        .from('missing_machine_images')
        .select('key, name, checked_at')
        .order('name')

      if (!error && data && data.length > 0) {
        const lastChecked = data[0].checked_at
        return NextResponse.json({
          machines: data.map(m => ({ key: m.key, name: m.name })),
          lastChecked
        })
      }
    }

    // Get base URL - use the production URL
    const baseUrl = 'https://kellanator.vercel.app'

    // Fetch the thumbnail list (generated at build time)
    let existingThumbnails: Set<string> = new Set()
    try {
      const listResponse = await fetch(`${baseUrl}/thumbnail-list.txt`)
      if (listResponse.ok) {
        const listText = await listResponse.text()
        existingThumbnails = new Set(listText.trim().split('\n').filter(Boolean))
      }
    } catch (e) {
      console.error('Error fetching thumbnail list:', e)
    }

    // Also check for custom images in Supabase
    const { data: customImages } = await supabase
      .from('custom_backglass_images')
      .select('machine_key, image_type')
      .eq('image_type', 'thumbnail')

    const customThumbnails = new Set((customImages || []).map(c => c.machine_key))

    // Fetch all machines
    const machinesResponse = await fetch(`${baseUrl}/api/machines`)
    const machinesData = await machinesResponse.json()

    const machines = Object.values(machinesData) as Array<{ key: string; name: string }>
    const missingMachines: Array<{ key: string; name: string }> = []

    for (const machine of machines) {
      const imageKey = getMappedImageKey(machine.key, machine.name)

      // Check if exists in local files OR in custom uploads
      if (!existingThumbnails.has(imageKey) && !customThumbnails.has(machine.key)) {
        missingMachines.push({ key: machine.key, name: machine.name })
      }
    }

    // Update cache in database
    await supabase.from('missing_machine_images').delete().neq('key', '')
    if (missingMachines.length > 0) {
      await supabase.from('missing_machine_images').insert(
        missingMachines.map(m => ({
          key: m.key,
          name: m.name,
          checked_at: new Date().toISOString()
        }))
      )
    }

    return NextResponse.json({
      machines: missingMachines,
      lastChecked: new Date().toISOString()
    })
  } catch (error) {
    console.error('Error checking missing images:', error)
    return NextResponse.json({
      machines: [],
      lastChecked: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

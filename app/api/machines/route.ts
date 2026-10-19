import { NextResponse } from 'next/server'
import { getMachinesData } from '@/lib/data-loader'
import { createClient } from '@supabase/supabase-js'
import { getMachineCanon, resolveWithIndex } from '@/lib/machines-canon'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function GET() {
  try {
    const [canon, archive] = await Promise.all([
      getMachineCanon().catch(() => null),
      getMachinesData().catch(() => null),
    ])
    if (!canon && !archive) throw new Error('Machine data is unavailable')
    const machinesData: Record<string, any> = {}
    // Keep newly published machines visible while their canon import is pending.
    for (const machine of Object.values(archive || {}) as any[]) {
      const key = (canon && resolveWithIndex(canon, machine.key)) || machine.key
      machinesData[key] = { ...machine, key }
    }
    for (const machine of Array.from(canon?.byKey.values() || [])) {
      if (!machine.active) { delete machinesData[machine.key]; continue }
      machinesData[machine.key] = { ...machinesData[machine.key], key: machine.key, name: machine.displayName }
    }

    // Fetch custom image URLs from Supabase
    try {
      const supabase = createClient(supabaseUrl, supabaseKey)
      const { data: customImages } = await supabase
        .from('custom_backglass_images')
        .select('machine_key, image_type, public_url')

      if (customImages && customImages.length > 0) {
        // Create a map for quick lookup
        const customImageMap: Record<
          string,
          { full?: string; thumbnail?: string }
        > = {}
        for (const img of customImages) {
          if (!customImageMap[img.machine_key]) {
            customImageMap[img.machine_key] = {}
          }
          if (img.image_type === 'full') {
            customImageMap[img.machine_key].full = img.public_url
          } else if (img.image_type === 'thumbnail') {
            customImageMap[img.machine_key].thumbnail = img.public_url
          }
        }

        // Add custom image URLs to machine data
        for (const machineKey of Object.keys(machinesData)) {
          if (machineKey in customImageMap) {
            const imgs: { full?: string; thumbnail?: string } =
              customImageMap[machineKey]!
            if (imgs.full) {
              ;(machinesData as any)[machineKey].customImage = imgs.full
            }
            if (imgs.thumbnail) {
              ;(machinesData as any)[machineKey].customThumbnail =
                imgs.thumbnail
            }
          }
        }
      }
    } catch (e) {
      // Ignore errors fetching custom images, just use defaults
    }

    return NextResponse.json(machinesData)
  } catch (error) {
    console.error('Error loading machines data:', error)
    return NextResponse.json(
      { error: 'Failed to load machines data' },
      { status: 500 },
    )
  }
}

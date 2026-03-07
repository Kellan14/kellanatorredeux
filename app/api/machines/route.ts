import { NextResponse } from 'next/server'
import { getMachinesData } from '@/lib/data-loader'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function GET() {
  try {
    const machinesData = await getMachinesData()

    // Fetch custom image URLs from Supabase
    try {
      const supabase = createClient(supabaseUrl, supabaseKey)
      const { data: customImages } = await supabase
        .from('custom_backglass_images')
        .select('machine_key, image_type, public_url')

      if (customImages && customImages.length > 0) {
        // Create a map for quick lookup
        const customImageMap: Record<string, { full?: string; thumbnail?: string }> = {}
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
            const imgs: { full?: string; thumbnail?: string } = customImageMap[machineKey]!
            if (imgs.full) {
              (machinesData as any)[machineKey].customImage = imgs.full
            }
            if (imgs.thumbnail) {
              (machinesData as any)[machineKey].customThumbnail = imgs.thumbnail
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
      { status: 500 }
    )
  }
}

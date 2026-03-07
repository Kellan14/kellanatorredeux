import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST - Update player names in the database based on mappings
export async function POST(request: Request) {
  try {
    const { mappings } = await request.json()

    if (!mappings || typeof mappings !== 'object') {
      return NextResponse.json(
        { error: 'mappings object is required' },
        { status: 400 }
      )
    }

    const results: { alias: string; canonical: string; updated: number }[] = []
    let totalUpdated = 0

    // Process each mapping
    for (const [alias, canonical] of Object.entries(mappings)) {
      if (typeof canonical !== 'string') continue

      let mappingTotal = 0

      // Update player_match_participation table
      const { data: pmpData, error: pmpError } = await supabase
        .from('player_match_participation')
        // @ts-ignore - Supabase typing issue with update
        .update({ player_name: canonical })
        .eq('player_name', alias)
        .select('id')

      if (pmpError) {
        console.error(`Error updating player_match_participation ${alias} to ${canonical}:`, pmpError)
      } else {
        mappingTotal += pmpData?.length || 0
      }

      // Update games table - player_1_name
      const { data: g1Data } = await supabase
        .from('games')
        // @ts-ignore - Supabase typing issue with update
        .update({ player_1_name: canonical })
        .eq('player_1_name', alias)
        .select('id')
      mappingTotal += g1Data?.length || 0

      // Update games table - player_2_name
      const { data: g2Data } = await supabase
        .from('games')
        // @ts-ignore - Supabase typing issue with update
        .update({ player_2_name: canonical })
        .eq('player_2_name', alias)
        .select('id')
      mappingTotal += g2Data?.length || 0

      // Update games table - player_3_name
      const { data: g3Data } = await supabase
        .from('games')
        // @ts-ignore - Supabase typing issue with update
        .update({ player_3_name: canonical })
        .eq('player_3_name', alias)
        .select('id')
      mappingTotal += g3Data?.length || 0

      // Update games table - player_4_name
      const { data: g4Data } = await supabase
        .from('games')
        // @ts-ignore - Supabase typing issue with update
        .update({ player_4_name: canonical })
        .eq('player_4_name', alias)
        .select('id')
      mappingTotal += g4Data?.length || 0

      // Update player_stats table
      const { data: psData } = await supabase
        .from('player_stats')
        // @ts-ignore - Supabase typing issue with update
        .update({ player_name: canonical })
        .eq('player_name', alias)
        .select('id')
      mappingTotal += psData?.length || 0

      results.push({ alias, canonical, updated: mappingTotal })
      totalUpdated += mappingTotal

      // Log the update if any records were changed
      if (mappingTotal > 0) {
        await supabase
          .from('player_name_update_log')
          // @ts-ignore - Supabase typing issue with insert
          .insert({
            old_name: alias,
            new_name: canonical,
            records_updated: mappingTotal,
          })
      }
    }

    return NextResponse.json({
      success: true,
      totalUpdated,
      results,
      message: `Updated ${totalUpdated} records across ${results.length} mappings`
    })
  } catch (error) {
    console.error('Error in POST /api/update-player-names:', error)
    return NextResponse.json(
      { error: 'Failed to update player names' },
      { status: 500 }
    )
  }
}

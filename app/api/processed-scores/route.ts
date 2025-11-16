import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { processMNPMatchData, type MNPMatch, type ProcessedScore } from '@/lib/tournament-data';

export const dynamic = 'force-dynamic';

// Cache for 1 hour since match data updates weekly
export const revalidate = 3600;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const seasons = searchParams.get('seasons');

  console.log('[processed-scores] Seasons requested:', seasons);

  if (!seasons) {
    return NextResponse.json({ error: 'Seasons parameter required' }, { status: 400 });
  }

  try {
    // Parse seasons parameter (e.g., "20,21,22")
    const seasonList = seasons.split(',').map(s => parseInt(s.trim()));
    console.log('[processed-scores] Season list:', seasonList);

    // Query matches from Supabase
    const { data: matchRows, error } = await supabase
      .from('matches')
      .select('*')
      .in('season', seasonList)
      .order('season', { ascending: false })
      .order('week', { ascending: false });

    console.log('[processed-scores] Query result:', {
      rowCount: matchRows?.length,
      error: error?.message,
      firstRow: matchRows && matchRows.length > 0 ? {
        id: (matchRows[0] as any).id,
        season: (matchRows[0] as any).season,
        hasData: !!(matchRows[0] as any).data
      } : null
    });

    if (error) {
      console.error('[processed-scores] Database error:', error);
      return NextResponse.json(
        { error: 'Failed to load match data', details: error.message },
        { status: 500 }
      );
    }

    if (!matchRows || matchRows.length === 0) {
      console.log('[processed-scores] No matches found for seasons:', seasonList);
      return NextResponse.json({
        error: 'No matches found',
        seasons: seasonList,
        message: 'Check if data exists in database for these seasons'
      }, { status: 404 });
    }

    // Extract the nested 'data' property from each database row
    const matches: MNPMatch[] = matchRows
      .map((m: any) => m.data)
      .filter((d: any) => d);

    console.log('[processed-scores] Extracted matches:', matches.length);

    // Process matches into flat scores on the server
    const processedScores = processMNPMatchData(matches);

    console.log('[processed-scores] Processed scores:', processedScores.length);

    return NextResponse.json({
      scores: processedScores,
      count: processedScores.length,
      matchCount: matches.length
    });
  } catch (error) {
    console.error('[processed-scores] Error processing match data:', error);
    return NextResponse.json(
      { error: 'Failed to process match data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { supabase, fetchAllRecords } from '@/lib/supabase';
import { gamesToProcessedScores, buildTeamNameMap } from '@/lib/game-scores';

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

    // Query games table directly for much faster performance with pagination
    let gamesData
    try {
      gamesData = await fetchAllRecords(
        () => supabase
          .from('games')
          .select('*')
          .in('season', seasonList)
          .order('season', { ascending: false })
          .order('week', { ascending: false })
          .order('id', { ascending: true }) // Unique key ensures consistent pagination
      )
    } catch (error) {
      console.error('[processed-scores] Database error:', error)
      return NextResponse.json(
        { error: 'Failed to load games data', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      )
    }

    console.log('[processed-scores] Query result:', {
      rowCount: gamesData?.length
    });

    if (!gamesData || gamesData.length === 0) {
      console.log('[processed-scores] No games found for seasons:', seasonList);
      return NextResponse.json({
        error: 'No games found',
        seasons: seasonList,
        message: 'Check if data exists in database for these seasons'
      }, { status: 404 });
    }

    // Build team_key -> team_name map, then flatten games to ProcessedScore
    // rows via the shared transform (keeps pick/venue/game_number logic in sync
    // with the other stats routes).
    const teamNameMap = await buildTeamNameMap(supabase, gamesData);
    const processedScores = gamesToProcessedScores(gamesData, teamNameMap);

    console.log('[processed-scores] Processed scores from games table:', processedScores.length);

    return NextResponse.json({
      scores: processedScores,
      count: processedScores.length,
      gameCount: gamesData.length
    });
  } catch (error) {
    console.error('[processed-scores] Error processing match data:', error);
    return NextResponse.json(
      { error: 'Failed to process match data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

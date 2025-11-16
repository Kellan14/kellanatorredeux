import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { type ProcessedScore } from '@/lib/tournament-data';

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

    // Query games table directly for much faster performance
    const { data: gamesData, error } = await supabase
      .from('games')
      .select('*')
      .in('season', seasonList)
      .order('season', { ascending: false })
      .order('week', { ascending: false });

    console.log('[processed-scores] Query result:', {
      rowCount: gamesData?.length,
      error: error?.message
    });

    if (error) {
      console.error('[processed-scores] Database error:', error);
      return NextResponse.json(
        { error: 'Failed to load games data', details: error.message },
        { status: 500 }
      );
    }

    if (!gamesData || gamesData.length === 0) {
      console.log('[processed-scores] No games found for seasons:', seasonList);
      return NextResponse.json({
        error: 'No games found',
        seasons: seasonList,
        message: 'Check if data exists in database for these seasons'
      }, { status: 404 });
    }

    // Transform games data to ProcessedScore format
    // After running the migration, all team data is denormalized in the games table
    const processedScores: ProcessedScore[] = [];

    gamesData.forEach((game: any) => {
      // Process each player position (1-4)
      for (let i = 1; i <= 4; i++) {
        const playerKey = game[`player_${i}_key`];
        const playerName = game[`player_${i}_name`];
        const score = game[`player_${i}_score`];
        const points = game[`player_${i}_points`];
        const team = game[`player_${i}_team`];

        if (!playerKey || score === null || score === undefined) continue;

        // Calculate is_pick: home team picks odd rounds, away team picks even rounds
        const isHomeTeam = team === game.home_team;
        const isPick = game.round_number % 2 === 1 ? isHomeTeam : !isHomeTeam;

        processedScores.push({
          season: game.season || 0,
          week: game.week,
          match: game.match_key,
          round: game.round_number,
          venue: game.venue || '',
          machine: (game.machine || '').toLowerCase(),
          player_name: playerName || 'Unknown',
          team: team || '',
          team_name: team || '', // Team key is used as name for now
          score: score,
          points: points || 0,
          is_pick: isPick,
          is_roster_player: true
        });
      }
    });

    console.log('[processed-scores] Processed scores:', processedScores.length);

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

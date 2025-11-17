import { NextRequest, NextResponse } from 'next/server';
import { supabase, fetchAllRecords } from '@/lib/supabase';
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

    // Query games table directly for much faster performance with pagination
    let gamesData
    try {
      gamesData = await fetchAllRecords(
        supabase
          .from('games')
          .select('*')
          .in('season', seasonList)
          .order('season', { ascending: false })
          .order('week', { ascending: false })
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

    // Build a map of team_key -> team_name from teams table
    const teamKeys = new Set<string>();
    gamesData.forEach((game: any) => {
      for (let i = 1; i <= 4; i++) {
        const team = game[`player_${i}_team`];
        if (team) teamKeys.add(team);
      }
      if (game.home_team) teamKeys.add(game.home_team);
      if (game.away_team) teamKeys.add(game.away_team);
    });

    const { data: teamsData } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .in('team_key', Array.from(teamKeys));

    const teamNameMap: Record<string, string> = {};
    (teamsData || []).forEach((team: any) => {
      teamNameMap[team.team_key] = team.team_name;
    });

    console.log('[processed-scores] Team name map:', teamNameMap);

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
        const teamKey = game[`player_${i}_team`];

        if (!playerKey || score === null || score === undefined) continue;

        // Calculate is_pick: home team picks odd rounds, away team picks even rounds
        const isHomeTeam = teamKey === game.home_team;
        const isPick = game.round_number % 2 === 1 ? isHomeTeam : !isHomeTeam;

        processedScores.push({
          season: game.season || 0,
          week: game.week,
          match: game.match_key,
          round: game.round_number,
          venue: game.venue || '',
          machine: (game.machine || '').toLowerCase(),
          player_name: playerName || 'Unknown',
          team: teamKey || '',
          team_name: teamNameMap[teamKey] || teamKey || '', // Use actual team name from teams table
          score: score,
          points: points || 0,
          is_pick: isPick,
          is_roster_player: true
        });
      }
    });

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

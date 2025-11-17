import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Cache for 1 hour since match data updates weekly
export const revalidate = 3600;

/**
 * Cell details API - returns individual scores for a machine/column combination
 * Used when clicking on cells in the statistics table
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const machine = searchParams.get('machine');
    const column = searchParams.get('column');
    const venue = searchParams.get('venue');
    const team = searchParams.get('team');
    const twcTeam = searchParams.get('twcTeam') || 'The Wrecking Crew';
    const seasonStart = parseInt(searchParams.get('seasonStart') || '1');
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '999');

    console.log('[cell-details] Request params:', {
      machine,
      column,
      venue,
      team,
      twcTeam,
      seasonStart,
      seasonEnd
    });

    if (!machine || !column || !venue) {
      return NextResponse.json(
        { error: 'Machine, column, and venue are required' },
        { status: 400 }
      );
    }

    // Determine which team to filter by based on the column
    const isTWCColumn = column.toLowerCase().includes('twc');
    const targetTeam = isTWCColumn ? twcTeam : team;

    console.log('[cell-details] Target team:', targetTeam, 'isTWCColumn:', isTWCColumn);

    // Query games from Supabase for the specified machine, venue, and seasons
    const { data: gamesData, error } = await supabase
      .from('games')
      .select('*')
      .gte('season', seasonStart)
      .lte('season', seasonEnd)
      .eq('venue', venue)
      .ilike('machine', machine);

    if (error) {
      console.error('[cell-details] Database error:', error);
      return NextResponse.json(
        { error: 'Failed to load game data', details: error.message },
        { status: 500 }
      );
    }

    if (!gamesData || gamesData.length === 0) {
      return NextResponse.json({
        machine,
        column,
        summary: `No data found for ${machine} at ${venue}`,
        details: [],
        count: 0
      });
    }

    // Build team name map
    const teamKeys = new Set<string>();
    gamesData.forEach((game: any) => {
      for (let i = 1; i <= 4; i++) {
        const teamKey = game[`player_${i}_team`];
        if (teamKey) teamKeys.add(teamKey);
      }
      if (game.home_team) teamKeys.add(game.home_team);
      if (game.away_team) teamKeys.add(game.away_team);
    });

    const { data: teamsData } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .in('team_key', Array.from(teamKeys));

    const teamNameMap: Record<string, string> = {};
    (teamsData || []).forEach((t: any) => {
      teamNameMap[t.team_key] = t.team_name;
    });

    // Extract individual scores for the target team
    interface ScoreDetail {
      season: number;
      week: number;
      match: string;
      round: number;
      player: string;
      team: string;
      score: number;
      points: number;
      isPick: boolean;
      opponent?: string;
      opponentScore?: number;
    }

    const details: ScoreDetail[] = [];

    gamesData.forEach((game: any) => {
      for (let i = 1; i <= 4; i++) {
        const playerName = game[`player_${i}_name`];
        const score = game[`player_${i}_score`];
        const points = game[`player_${i}_points`];
        const teamKey = game[`player_${i}_team`];
        const teamName = teamNameMap[teamKey] || teamKey;

        if (!playerName || score === null || score === undefined) continue;

        // Only include scores from the target team
        if (!targetTeam || teamName.toLowerCase() !== targetTeam.toLowerCase()) {
          continue;
        }

        // Calculate is_pick
        const isHomeTeam = teamKey === game.home_team;
        const isPick = game.round_number % 2 === 1 ? isHomeTeam : !isHomeTeam;

        // Find opponent score in same round
        let opponent = '';
        let opponentScore = 0;
        for (let j = 1; j <= 4; j++) {
          if (j !== i) {
            const oppTeamKey = game[`player_${j}_team`];
            const oppTeamName = teamNameMap[oppTeamKey] || oppTeamKey;
            if (oppTeamName !== teamName) {
              opponent = game[`player_${j}_name`] || '';
              opponentScore = game[`player_${j}_score`] || 0;
              break;
            }
          }
        }

        details.push({
          season: game.season || 0,
          week: game.week,
          match: game.match_key,
          round: game.round_number,
          player: playerName,
          team: teamName,
          score: score,
          points: points || 0,
          isPick: isPick,
          opponent: opponent || undefined,
          opponentScore: opponent ? opponentScore : undefined
        });
      }
    });

    // Calculate summary statistics
    const scores = details.map(d => d.score);
    const average = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;
    const highest = scores.length > 0 ? Math.max(...scores) : 0;
    const lowest = scores.length > 0 ? Math.min(...scores) : 0;

    console.log('[cell-details] Returning', details.length, 'scores for', targetTeam);

    return NextResponse.json({
      machine,
      column,
      team: targetTeam,
      venue,
      summary: `${details.length} scores - Avg: ${Math.round(average).toLocaleString()}, High: ${highest.toLocaleString()}, Low: ${lowest.toLocaleString()}`,
      stats: {
        count: details.length,
        average: average,
        highest: highest,
        lowest: lowest
      },
      details: details,
      count: details.length
    });
  } catch (error) {
    console.error('[cell-details] Error fetching cell details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cell details', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

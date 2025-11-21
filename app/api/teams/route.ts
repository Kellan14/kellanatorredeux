export const dynamic = 'force-dynamic';

// API route to get unique teams from Supabase
import { NextRequest, NextResponse } from 'next/server';
import { supabase, fetchAllRecords } from '@/lib/supabase';

// Cache for 24 hours since teams rarely change
export const revalidate = 86400

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const season = searchParams.get('season') || '22';

  try {
    // Query teams table directly - much simpler and faster!
    const { data: teamsData, error: teamsError } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .eq('active', true)
      .order('team_name')
      .returns<Array<{ team_key: string; team_name: string }>>();

    if (teamsError) {
      console.error('Database error:', teamsError);
      return NextResponse.json(
        { error: 'Failed to load teams', details: teamsError.message },
        { status: 500 }
      );
    }

    // Filter teams that played OR have lineups in this season
    // Check both games table (completed matches) and player_match_participation (all matches including upcoming)
    let gamesData
    let gamesError
    try {
      gamesData = await fetchAllRecords<{ home_team: string | null; away_team: string | null }>(
        () => supabase
          .from('games')
          .select('home_team, away_team')
          .eq('season', parseInt(season))
      )
    } catch (error) {
      console.error('Error fetching games:', error)
      gamesError = error
    }

    const { data: participationData, error: participationError } = await supabase
      .from('player_match_participation')
      .select('team')
      .eq('season', parseInt(season))
      .returns<Array<{ team: string }>>();

    if (gamesError && participationError) {
      console.error('Database errors:', { gamesError, participationError });
      // Return all teams if we can't filter by season
      const teams = (teamsData || []).map(t => ({ key: t.team_key, name: t.team_name }));
      return NextResponse.json({ teams });
    }

    // Collect team keys that played or have lineups in this season
    const seasonTeamKeys = new Set<string>();

    // Add teams from games (completed matches)
    for (const game of gamesData || []) {
      if (game.home_team) seasonTeamKeys.add(game.home_team);
      if (game.away_team) seasonTeamKeys.add(game.away_team);
    }

    // Add teams from player participation (includes upcoming matches)
    for (const p of participationData || []) {
      if (p.team) seasonTeamKeys.add(p.team);
    }

    // Filter teams to only those that played in this season
    const teams = (teamsData || [])
      .filter(t => seasonTeamKeys.has(t.team_key))
      .map(t => ({ key: t.team_key, name: t.team_name }));

    return NextResponse.json({ teams });
  } catch (error) {
    console.error('Error loading teams:', error);
    return NextResponse.json(
      { error: 'Failed to load teams', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

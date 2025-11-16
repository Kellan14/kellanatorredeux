export const dynamic = 'force-dynamic';

// API route to get unique teams from Supabase
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
      .order('team_name');

    if (teamsError) {
      console.error('Database error:', teamsError);
      return NextResponse.json(
        { error: 'Failed to load teams', details: teamsError.message },
        { status: 500 }
      );
    }

    // Filter teams that actually played in this season by checking games table
    const { data: gamesData, error: gamesError } = await supabase
      .from('games')
      .select('home_team, away_team')
      .eq('season', parseInt(season))
      .limit(100); // Sample to find all teams in this season

    if (gamesError) {
      console.error('Database error checking season teams:', gamesError);
      // Return all teams if we can't filter by season
      const teams = (teamsData || []).map(t => ({ key: t.team_key, name: t.team_name }));
      return NextResponse.json({ teams });
    }

    // Collect team keys that played in this season
    const seasonTeamKeys = new Set<string>();
    for (const game of (gamesData as any[]) || []) {
      if (game.home_team) seasonTeamKeys.add(game.home_team);
      if (game.away_team) seasonTeamKeys.add(game.away_team);
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

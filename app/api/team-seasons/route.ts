import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Returns the distinct seasons a team has played in, sorted ascending.
 * Query param: team (team name, e.g. "Bad Cats")
 */
export async function GET(request: NextRequest) {
  try {
    const team = request.nextUrl.searchParams.get('team');
    if (!team) {
      return NextResponse.json({ error: 'team is required' }, { status: 400 });
    }

    // Resolve team name to team key
    const { data: teamData } = await supabase
      .from('teams')
      .select('team_key')
      .ilike('team_name', team)
      .limit(1) as { data: { team_key: string }[] | null };

    const teamKey = teamData?.[0]?.team_key;
    if (!teamKey) {
      return NextResponse.json({ seasons: [] });
    }

    // Get distinct seasons from player_match_participation
    const { data: pmpData } = await supabase
      .from('player_match_participation')
      .select('season')
      .eq('team', teamKey);

    const seasons = new Set<number>();
    (pmpData || []).forEach((row: any) => {
      if (row.season != null) seasons.add(row.season);
    });

    // Also check games table for broader coverage
    const { data: gamesData } = await supabase
      .from('games')
      .select('season, home_team, away_team');

    (gamesData || []).forEach((game: any) => {
      if (game.home_team === teamKey || game.away_team === teamKey) {
        if (game.season != null) seasons.add(game.season);
      }
    });

    const sorted = Array.from(seasons).sort((a, b) => a - b);
    return NextResponse.json({ seasons: sorted });
  } catch (error) {
    console.error('[team-seasons] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch team seasons' }, { status: 500 });
  }
}

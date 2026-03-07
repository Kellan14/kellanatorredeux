import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Returns all players who have ever played for a team (roster + subs + historical)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const team = searchParams.get('team');

    if (!team) {
      return NextResponse.json(
        { error: 'team parameter is required' },
        { status: 400 }
      );
    }

    // Get team key
    const { data: teamData } = await supabase
      .from('teams')
      .select('team_key')
      .or(`team_key.eq.${team},team_name.ilike.${team}`)
      .limit(1) as { data: { team_key: string }[] | null };

    const teamKey = teamData?.[0]?.team_key || team;

    // Get all unique players from player_match_participation
    const { data: participationData } = await supabase
      .from('player_match_participation')
      .select('player_name, is_sub, season')
      .eq('team', teamKey) as { data: { player_name: string; is_sub: boolean; season: number }[] | null };

    // Build unique player list with metadata
    const playerMap = new Map<string, { name: string; isSub: boolean; seasons: number[] }>();

    (participationData || []).forEach(row => {
      const existing = playerMap.get(row.player_name);
      if (!existing) {
        playerMap.set(row.player_name, {
          name: row.player_name,
          isSub: row.is_sub,
          seasons: [row.season]
        });
      } else {
        if (!existing.seasons.includes(row.season)) {
          existing.seasons.push(row.season);
        }
        // If ever not a sub, mark as not a sub
        if (!row.is_sub) {
          existing.isSub = false;
        }
      }
    });

    const players = Array.from(playerMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return NextResponse.json({
      players,
      teamKey
    });
  } catch (error) {
    console.error('[team-all-players] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team players' },
      { status: 500 }
    );
  }
}

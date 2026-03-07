import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Searches all player names in the database
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';

    if (query.length < 2) {
      return NextResponse.json({ players: [] });
    }

    // Search player_match_participation for unique player names matching query
    const { data } = await supabase
      .from('player_match_participation')
      .select('player_name')
      .ilike('player_name', `%${query}%`)
      .limit(100) as { data: { player_name: string }[] | null };

    // Get unique names
    const uniqueNames = Array.from(new Set((data || []).map(d => d.player_name)));
    uniqueNames.sort((a, b) => a.localeCompare(b));

    return NextResponse.json({
      players: uniqueNames.slice(0, 20) // Limit to 20 results
    });
  } catch (error) {
    console.error('[search-players] Error:', error);
    return NextResponse.json(
      { error: 'Failed to search players' },
      { status: 500 }
    );
  }
}

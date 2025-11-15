// API route to get unique teams from Supabase
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const season = searchParams.get('season') || '22';

  try {
    // Query matches from Supabase for this season
    const { data: matches, error } = await supabase
      .from('matches')
      .select('data')
      .eq('season', parseInt(season))
      .limit(50); // Get first 50 matches to find all teams

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to load teams', details: error.message },
        { status: 500 }
      );
    }

    // Extract unique teams from match data
    const teamMap = new Map<string, string>();

    for (const match of (matches as any[]) || []) {
      if (match.data?.home?.key && match.data?.home?.name) {
        teamMap.set(match.data.home.key, match.data.home.name);
      }
      if (match.data?.away?.key && match.data?.away?.name) {
        teamMap.set(match.data.away.key, match.data.away.name);
      }
    }

    const teams = Array.from(teamMap.entries())
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ teams });
  } catch (error) {
    console.error('Error loading teams:', error);
    return NextResponse.json(
      { error: 'Failed to load teams', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// API route to get unique teams from MNP data
import { NextRequest, NextResponse } from 'next/server';
import { fetchMNPData } from '@/lib/fetch-mnp-data';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const season = searchParams.get('season') || '23';

  try {
    // Fetch teams from a sample of match files
    const teamMap = new Map<string, string>();

    // Check first few weeks to get team list
    for (let week = 1; week <= 3; week++) {
      try {
        // Try different team combinations for each week
        const teamCodes = ['TWC', 'BOC', 'CPO', 'DSV', 'DTP', 'LAS', 'NLT', 'OLD', 'PGN', 'RMS', 'SHK', 'SSS'];

        for (const team of teamCodes) {
          try {
            const matchData = await fetchMNPData(`season-${season}/matches/mnp-${season}-${week}-${team}.json`);

            if (matchData.home?.key && matchData.home?.name) {
              teamMap.set(matchData.home.key, matchData.home.name);
            }
            if (matchData.away?.key && matchData.away?.name) {
              teamMap.set(matchData.away.key, matchData.away.name);
            }

            break; // Found a match for this week, move to next
          } catch {
            continue;
          }
        }
      } catch {
        continue;
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

export const dynamic = 'force-dynamic';

// API route to serve venue data from mnp-data-archive
import { NextResponse } from 'next/server';
import { fetchMNPData } from '@/lib/fetch-mnp-data';
import { supabase, fetchAllRecords } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const season = searchParams.get('season');

    const venuesObj = await fetchMNPData('venues.json');

    // Convert to array and sort by name
    let venues = Object.values(venuesObj)
      .filter((v: any) => v.name !== 'No Available Venue') // Filter out NAV
      .map((v: any) => ({
        key: v.key,
        name: v.name,
        address: v.address || '',
        neighborhood: v.neighborhood || '',
        machines: v.machines || []
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    // If season is specified, filter venues to only those with scores in that season
    if (season) {
      const seasonNum = parseInt(season);

      // Query games table to find venues that have games in the specified season
      const gamesData = await fetchAllRecords<{
        venue: string | null;
        season: number;
      }>(
        () => supabase
          .from('games')
          .select('venue, season')
          .eq('season', seasonNum)
      );

      // Get unique venue names from games
      const activeVenues = new Set<string>();
      if (gamesData && gamesData.length > 0) {
        gamesData.forEach(game => {
          if (game.venue) {
            activeVenues.add(game.venue);
          }
        });
      }

      // Filter venues to only those with games in the specified season
      venues = venues.filter(v => activeVenues.has(v.name));
    }

    return NextResponse.json({ venues });
  } catch (error) {
    console.error('Error loading venues data:', error);
    return NextResponse.json(
      { error: 'Failed to load venues data' },
      { status: 500 }
    );
  }
}

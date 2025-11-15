import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Cache for 1 hour since match data updates weekly
export const revalidate = 3600;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const seasons = searchParams.get('seasons');

  if (!seasons) {
    return NextResponse.json({ error: 'Seasons parameter required' }, { status: 400 });
  }

  try {
    // Parse seasons parameter (e.g., "20,21,22")
    const seasonList = seasons.split(',').map(s => parseInt(s.trim()));

    // Query matches from Supabase
    const { data: matches, error } = await supabase
      .from('matches')
      .select('*')
      .in('season', seasonList)
      .order('season', { ascending: false })
      .order('week', { ascending: false });

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to load match data', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      matches: matches || [],
      count: (matches || []).length
    });
  } catch (error) {
    console.error('Error loading match data:', error);
    return NextResponse.json(
      { error: 'Failed to load match data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  try {
    // Get distinct seasons from matches table
    const { data, error } = await supabase
      .from('matches')
      .select('season')
      .order('season', { ascending: false });

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ seasons: [] }, { status: 500 });
    }

    // Get unique seasons
    const seasons = Array.from(new Set((data || []).map((m: any) => m.season)));

    return NextResponse.json({ seasons });
  } catch (error) {
    console.error('Error reading seasons:', error);
    return NextResponse.json({ seasons: [] }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const seasons = searchParams.get('seasons');

  if (!seasons) {
    return NextResponse.json({ error: 'Seasons parameter required' }, { status: 400 });
  }

  try {
    return NextResponse.json({
      matches: [],
      count: 0,
      message: 'Feature temporarily disabled - GitHub data fetching in progress'
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
    return NextResponse.json({
      seasons: [],
      message: 'Feature temporarily disabled - GitHub data fetching in progress'
    });
  } catch (error) {
    console.error('Error reading seasons:', error);
    return NextResponse.json({ seasons: [] }, { status: 500 });
  }
}

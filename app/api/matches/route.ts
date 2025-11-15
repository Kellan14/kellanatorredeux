// API route to serve MNP match data from mnp-data-archive
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const seasons = searchParams.get('seasons'); // e.g., "20,21,22"

  if (!seasons) {
    return NextResponse.json({ error: 'Seasons parameter required' }, { status: 400 });
  }

  try {
    const seasonNumbers = seasons.split(',').map(s => parseInt(s.trim()));
    const allMatches: any[] = [];

    // Path to mnp-data-archive directory
    const repoDir = path.join(process.cwd(), 'public', 'mnp-data-archive');

    // Load matches from each season
    for (const season of seasonNumbers) {
      const seasonDir = path.join(repoDir, `season-${season}`, 'matches');

      try {
        const files = await fs.readdir(seasonDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        // Load each match file
        for (const file of jsonFiles) {
          const filePath = path.join(seasonDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const matchData = JSON.parse(content);

          // Add season number to the match data
          matchData.season = season;
          allMatches.push(matchData);
        }
      } catch (error) {
        console.warn(`No data found for season ${season}:`, error);
      }
    }

    return NextResponse.json({ matches: allMatches, count: allMatches.length });
  } catch (error) {
    console.error('Error loading match data:', error);
    return NextResponse.json(
      { error: 'Failed to load match data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Get available seasons
export async function OPTIONS() {
  try {
    const repoDir = path.join(process.cwd(), 'public', 'mnp-data-archive');
    const entries = await fs.readdir(repoDir);

    const seasons = entries
      .filter(entry => entry.startsWith('season-'))
      .map(entry => parseInt(entry.replace('season-', '')))
      .filter(num => !isNaN(num))
      .sort((a, b) => a - b);

    return NextResponse.json({ seasons });
  } catch (error) {
    console.error('Error reading seasons:', error);
    return NextResponse.json({ seasons: [] }, { status: 500 });
  }
}

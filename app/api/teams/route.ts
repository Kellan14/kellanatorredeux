// API route to get unique teams from MNP data
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const season = searchParams.get('season') || '22'; // Default to latest season

  try {
    const repoDir = path.join(process.cwd(), 'public', 'mnp-data-archive');
    const seasonDir = path.join(repoDir, `season-${season}`, 'matches');

    // Scan JSON files to get team names
    const teamMap = new Map<string, string>();
    const files = await fs.readdir(seasonDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    // Sample files to get all unique teams (check every 5th file for efficiency)
    const sampleFiles = jsonFiles.filter((_, i) => i % 5 === 0 || i < 20);

    for (const file of sampleFiles) {
      try {
        const filePath = path.join(seasonDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const matchData = JSON.parse(content);

        // Add home and away teams
        if (matchData.home?.key && matchData.home?.name) {
          teamMap.set(matchData.home.key, matchData.home.name);
        }
        if (matchData.away?.key && matchData.away?.name) {
          teamMap.set(matchData.away.key, matchData.away.name);
        }
      } catch (err) {
        // Skip files with errors
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

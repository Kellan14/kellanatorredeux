// API route to serve venue data from mnp-data-archive
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'public', 'mnp-data-archive', 'venues.json');
    const content = await fs.readFile(filePath, 'utf-8');
    const venuesObj = JSON.parse(content);

    // Convert to array and sort by name
    const venues = Object.values(venuesObj)
      .filter((v: any) => v.name !== 'No Available Venue') // Filter out NAV
      .map((v: any) => ({
        key: v.key,
        name: v.name,
        address: v.address || '',
        neighborhood: v.neighborhood || '',
        machines: v.machines || []
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    return NextResponse.json({ venues });
  } catch (error) {
    console.error('Error loading venues data:', error);
    return NextResponse.json(
      { error: 'Failed to load venues data' },
      { status: 500 }
    );
  }
}

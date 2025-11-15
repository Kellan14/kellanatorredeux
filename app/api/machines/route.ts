// API route to serve machine data from mnp-data-archive
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'mnp-data-archive', 'machines.json');
    const content = await fs.readFile(filePath, 'utf-8');
    const machines = JSON.parse(content);

    return NextResponse.json(machines);
  } catch (error) {
    console.error('Error loading machines data:', error);
    return NextResponse.json(
      { error: 'Failed to load machines data' },
      { status: 500 }
    );
  }
}

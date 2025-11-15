import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Scrape the MNP schedule page
    const response = await fetch('https://mondaynightpinball.com/schedule', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TWC Stats Bot/1.0)'
      }
    })

    if (!response.ok) {
      throw new Error('Failed to fetch schedule')
    }

    const html = await response.text()
    
    // Parse the HTML to find TWC's next match
    // This is a simplified parser - in production you'd use cheerio or similar
    const twcPattern = /The Wrecking Crew\s+vs\s+([^<]+)/i
    const datePattern = /(\w+day,\s+\w+\s+\d+,\s+\d{4})/i
    
    const match = html.match(twcPattern)
    const dateMatch = html.match(datePattern)
    
    let opponent = 'Schedule TBD'
    let matchDate = ''
    let venue = 'Georgetown Pizza and Arcade' // Default venue
    
    if (match && match[1]) {
      opponent = match[1].trim()
    }
    
    if (dateMatch && dateMatch[1]) {
      matchDate = dateMatch[1]
    }

    // For now, return placeholder data
    // In production, you'd properly parse the HTML
    return NextResponse.json({
      opponent: opponent || 'Scared Stiff Competition',
      date: matchDate || 'Monday, Nov 18, 2025',
      venue: venue,
      week: 10,
      season: 23
    })

  } catch (error) {
    console.error('Error fetching MNP schedule:', error)
    
    // Return fallback data
    return NextResponse.json({
      opponent: 'Check MNP Website',
      date: 'TBD',
      venue: 'Georgetown Pizza and Arcade',
      week: 0,
      season: 23
    })
  }
}

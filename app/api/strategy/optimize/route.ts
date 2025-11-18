import { NextRequest, NextResponse } from 'next/server'
import { LineupOptimizer } from '@/lib/strategy/optimizer'
import { getCached } from '@/lib/utils/cache'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      format,
      playerNames,
      machines,
      seasonStart = 20,
      seasonEnd = 22,
      useCache = true
    } = body

    // Validate inputs
    if (!format || !playerNames || !machines) {
      return NextResponse.json(
        { error: 'Missing required fields: format, playerNames, machines' },
        { status: 400 }
      )
    }

    if (!['7x7', '4x2'].includes(format)) {
      return NextResponse.json(
        { error: 'Format must be either "7x7" or "4x2"' },
        { status: 400 }
      )
    }

    if (format === '7x7') {
      if (playerNames.length !== 7 || machines.length !== 7) {
        return NextResponse.json(
          { error: '7x7 format requires exactly 7 players and 7 machines' },
          { status: 400 }
        )
      }
    } else if (format === '4x2') {
      if (playerNames.length !== 8 || machines.length !== 4) {
        return NextResponse.json(
          { error: '4x2 format requires exactly 8 players and 4 machines' },
          { status: 400 }
        )
      }
    }

    const optimizer = new LineupOptimizer()

    // Create cache key from sorted names to ensure consistency
    const sortedPlayerNames = [...playerNames].sort()
    const sortedMachines = [...machines].sort()
    const cacheKey = `optimize_${format}_s${seasonStart}-${seasonEnd}_${sortedPlayerNames.join('_')}_${sortedMachines.join('_')}`

    const result = useCache
      ? await getCached(
          cacheKey,
          async () => {
            if (format === '7x7') {
              return await optimizer.optimize7x7(playerNames, machines, seasonStart, seasonEnd)
            } else {
              return await optimizer.optimize4x2(playerNames, machines, seasonStart, seasonEnd)
            }
          },
          { ttl: 300, cacheType: 'optimization' } // 5 minute cache
        )
      : format === '7x7'
      ? await optimizer.optimize7x7(playerNames, machines, seasonStart, seasonEnd)
      : await optimizer.optimize4x2(playerNames, machines, seasonStart, seasonEnd)

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Optimization error:', error)
    return NextResponse.json(
      {
        error: error.message || 'Optimization failed',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}

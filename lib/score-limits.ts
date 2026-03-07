import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Cache for score limits to avoid hitting DB on every request
let cachedLimits: Record<string, number> | null = null
let cacheTimestamp: number = 0
const CACHE_TTL = 60000 // 1 minute cache

/**
 * Fetch score limits from database with caching
 */
export async function getScoreLimits(): Promise<Record<string, number>> {
  // Return cached value if still valid
  if (cachedLimits && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    return cachedLimits
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data, error } = await supabase
      .from('score_limits')
      .select('machine, max_score')

    if (error) {
      console.error('[score-limits] Error fetching from DB:', error)
      // Return cached value or empty object on error
      return cachedLimits || {}
    }

    // Convert to {machine: max_score} format
    const limits: Record<string, number> = {}
    for (const row of data || []) {
      limits[row.machine.toLowerCase()] = row.max_score
    }

    // Update cache
    cachedLimits = limits
    cacheTimestamp = Date.now()

    return limits
  } catch (error) {
    console.error('[score-limits] Error:', error)
    return cachedLimits || {}
  }
}

/**
 * Check if a score is valid (under the limit) for a machine
 */
export function isScoreValid(machine: string, score: number, limits: Record<string, number>): boolean {
  const machineLimit = limits[machine.toLowerCase()]
  if (!machineLimit) return true // No limit set
  return score <= machineLimit
}

/**
 * Clear the cache (call after updating limits)
 */
export function clearScoreLimitsCache(): void {
  cachedLimits = null
  cacheTimestamp = 0
}

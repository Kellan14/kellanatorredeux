import { createClient } from '@supabase/supabase-js'
import venueMachineListsFallback from '../venue_machine_lists.json'

export interface VenueMachineList {
  included?: string[]
  excluded?: string[]
}

// In-memory cache for DB overrides
let cachedOverrides: Record<string, VenueMachineList> | null = null
let cacheTimestamp = 0
const CACHE_TTL = 60000 // 1 minute

async function loadOverridesFromDB(): Promise<Record<string, VenueMachineList>> {
  if (cachedOverrides && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    return cachedOverrides
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data, error } = await supabase
      .from('venue_machine_lists')
      .select('venue_name, included, excluded')

    if (error || !data) {
      // Fall back to JSON file
      return venueMachineListsFallback as Record<string, VenueMachineList>
    }

    const lists: Record<string, VenueMachineList> = {}
    for (const row of data) {
      lists[(row as any).venue_name.toLowerCase()] = {
        included: (row as any).included || [],
        excluded: (row as any).excluded || []
      }
    }

    cachedOverrides = lists
    cacheTimestamp = Date.now()
    return lists
  } catch {
    return venueMachineListsFallback as Record<string, VenueMachineList>
  }
}

function applyOverrides(
  baseMachines: string[],
  overrides: VenueMachineList | undefined
): string[] {
  if (!overrides) return baseMachines

  let machines = [...baseMachines]

  if (overrides.excluded && overrides.excluded.length > 0) {
    machines = machines.filter(machine => {
      const machineLower = machine.toLowerCase()
      return !overrides.excluded!.some(excluded => excluded.toLowerCase() === machineLower)
    })
  }

  if (overrides.included && overrides.included.length > 0) {
    for (const includedMachine of overrides.included) {
      const includedLower = includedMachine.toLowerCase()
      const alreadyIncluded = machines.some(m => m.toLowerCase() === includedLower)
      if (!alreadyIncluded) {
        machines.push(includedMachine)
      }
    }
  }

  return machines
}

/**
 * Applies venue-specific machine list overrides (async, reads from DB)
 */
export async function applyVenueMachineListOverrides(
  venueName: string,
  baseMachines: string[]
): Promise<string[]> {
  const normalizedVenueName = venueName.toLowerCase()
  const allOverrides = await loadOverridesFromDB()
  return applyOverrides(baseMachines, allOverrides[normalizedVenueName])
}

/**
 * Gets the venue machine list overrides for a specific venue
 */
export async function getVenueMachineListOverrides(venueName: string): Promise<VenueMachineList> {
  const normalizedVenueName = venueName.toLowerCase()
  const allOverrides = await loadOverridesFromDB()
  return allOverrides[normalizedVenueName] || { included: [], excluded: [] }
}

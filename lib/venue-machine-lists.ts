import venueMachineLists from '../venue_machine_lists.json'

export interface VenueMachineList {
  included?: string[]
  excluded?: string[]
}

/**
 * Applies venue-specific machine list overrides
 * @param venueName - The name of the venue
 * @param baseMachines - The base machine list from venues.json
 * @returns The modified machine list with includes/excludes applied
 */
export function applyVenueMachineListOverrides(
  venueName: string,
  baseMachines: string[]
): string[] {
  // Normalize venue name to lowercase for lookup
  const normalizedVenueName = venueName.toLowerCase()

  // Get the overrides for this venue
  const overrides = (venueMachineLists as Record<string, VenueMachineList>)[normalizedVenueName]

  // If no overrides exist, return the base list
  if (!overrides) {
    return baseMachines
  }

  // Start with the base machines
  let machines = [...baseMachines]

  // Apply exclusions - remove machines from the list
  if (overrides.excluded && overrides.excluded.length > 0) {
    machines = machines.filter(machine => {
      const machineLower = machine.toLowerCase()
      return !overrides.excluded!.some(excluded => excluded.toLowerCase() === machineLower)
    })
  }

  // Apply inclusions - add machines to the list (if not already present)
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
 * Gets the venue machine list overrides for a specific venue
 * @param venueName - The name of the venue
 * @returns The overrides object with included and excluded arrays
 */
export function getVenueMachineListOverrides(venueName: string): VenueMachineList {
  const normalizedVenueName = venueName.toLowerCase()
  const overrides = (venueMachineLists as Record<string, VenueMachineList>)[normalizedVenueName]

  return overrides || { included: [], excluded: [] }
}

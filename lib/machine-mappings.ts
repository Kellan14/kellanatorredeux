// Machine name aliases mapped to standardized names
// This file is imported directly into API routes to ensure it's bundled with serverless functions
export const machineMappings: Record<string, string> = {
  "pulp": "PULP",
  "bksor": "BlackKnight",
  "james bond": "007",
  "james bond 007": "007",
  "james bond '007": "007",
  "lights camera action": "lights camera action!",
  "banzairun": "banzai run",
  "party animals": "party animal",
  "mandolorian": "mandalorian",
  "bobby orr power player": "bopp",
  "ej": "elton john",
  "br": "buck rogers",
  "dp": "deadpool",
  "ebb": "eight ball beyond",
  "godzilla (stern)": "godzilla",
  "guardians of the galaxy": "guardians",
  "scooby doo": "scooby-doo",
  "the mandalorian (premium)": "mandalorian",
  "venom (r)": "venom",
  "venom left": "venom",
  "venom right": "venom",
  "ven": "venom",
  "sdnd": "dungeons and dragons stern",
  "dnd": "dungeons and dragons stern",
  "jurassic": "sternpark",
  "ghost": "ghostbusters",
  "fish tales": "FishTales",
  "ft": "FishTales",
  "jw": "John Wick",
  "foo fighters": "FOO",
  "batman dark knight": "bdk"
}

/**
 * Get all possible case variations of a machine name for database queries.
 * This handles machines stored with different case conventions (BK2K, Bk2k, bk2k, etc.)
 * Also includes all aliases that map to the same standardized name.
 */
export function getMachineVariations(machineKey: string): string[] {
  const variations = new Set<string>()
  const lowerMachineKey = machineKey.toLowerCase()

  // Add the original machine key and common case variations
  variations.add(machineKey)
  variations.add(lowerMachineKey)
  variations.add(machineKey.toUpperCase()) // Add all uppercase version (BK2K, etc.)
  // Add capitalized version (Ghost, Venom, etc.)
  variations.add(machineKey.charAt(0).toUpperCase() + machineKey.slice(1).toLowerCase())

  // Find all aliases that map to this standardized name
  for (const [alias, standardized] of Object.entries(machineMappings)) {
    if (standardized.toLowerCase() === lowerMachineKey) {
      // Add alias in multiple case variations
      variations.add(alias)
      variations.add(alias.toLowerCase())
      variations.add(alias.charAt(0).toUpperCase() + alias.slice(1).toLowerCase())
      variations.add(standardized)
    }
  }

  // Check if the machine key itself is an alias
  const standardizedName = machineMappings[lowerMachineKey]
  if (standardizedName) {
    variations.add(standardizedName)
    variations.add(standardizedName.toLowerCase())
    variations.add(standardizedName.charAt(0).toUpperCase() + standardizedName.slice(1).toLowerCase())
    // Also find other aliases for this standardized name
    for (const [alias, standard] of Object.entries(machineMappings)) {
      if (standard === standardizedName) {
        variations.add(alias)
        variations.add(alias.toLowerCase())
        variations.add(alias.charAt(0).toUpperCase() + alias.slice(1).toLowerCase())
      }
    }
  }

  return Array.from(variations)
}

/**
 * Get variations for multiple machines at once.
 * Returns a flat array of all variations for all provided machines.
 */
export function getAllMachineVariations(machines: string[]): string[] {
  const allVariations = new Set<string>()
  for (const machine of machines) {
    for (const variation of getMachineVariations(machine)) {
      allVariations.add(variation)
    }
  }
  return Array.from(allVariations)
}

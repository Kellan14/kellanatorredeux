// Venue name aliases mapped to canonical DATABASE VALUES
// This handles inconsistent venue naming in the data
export const venueMappings: Record<string, string> = {
  // 4Bs variations
  "4bs": "4Bs",
  "4bs tavern": "4Bs",
  "4Bs Tavern": "4Bs",
  "four b's": "4Bs",
  "Four B's": "4Bs",

  // Another Castle variations
  "another castle": "Another Castle",
  "Another castle": "Another Castle",

  // Ice Box variations
  "ice box": "Icebox",
  "Ice Box": "Icebox",
  "icebox": "Icebox",

  // Kraken variations
  "the kraken": "Kraken",
  "The Kraken": "Kraken",
  "kraken": "Kraken",
}

/**
 * Get all venue name variations for database queries.
 * Returns all aliases that should be searched when looking for a venue.
 */
export function getVenueVariations(venueName: string): string[] {
  const variations = new Set<string>()
  const lowerVenue = venueName.toLowerCase()

  // Add the original name and common case variations
  variations.add(venueName)
  variations.add(venueName.toLowerCase())
  variations.add(venueName.toUpperCase())

  // Check if this venue has a canonical mapping
  const canonical = venueMappings[lowerVenue] || venueMappings[venueName]
  if (canonical) {
    variations.add(canonical)
    // Find all aliases that map to this canonical name
    for (const [alias, mapped] of Object.entries(venueMappings)) {
      if (mapped === canonical) {
        variations.add(alias)
      }
    }
  }

  // Check if this IS a canonical name that others map to
  for (const [alias, mapped] of Object.entries(venueMappings)) {
    if (mapped.toLowerCase() === lowerVenue || mapped === venueName) {
      variations.add(alias)
      variations.add(mapped)
    }
  }

  return Array.from(variations)
}

/**
 * Standardize a venue name to its canonical form.
 * Returns the canonical name if a mapping exists, otherwise returns the original.
 */
export function standardizeVenueName(venueName: string | null): string | null {
  if (!venueName) return null

  const lowerName = venueName.toLowerCase()

  // Check if this name is an alias in our mappings
  if (venueMappings[lowerName]) {
    return venueMappings[lowerName]
  }
  if (venueMappings[venueName]) {
    return venueMappings[venueName]
  }

  // No mapping found - return as-is
  return venueName
}

/**
 * Check if two venue names refer to the same venue.
 * Handles variations like "Ice Box" vs "Icebox".
 */
export function venuesMatch(venue1: string | null, venue2: string | null): boolean {
  if (!venue1 || !venue2) return false

  const canonical1 = standardizeVenueName(venue1)
  const canonical2 = standardizeVenueName(venue2)

  if (canonical1 === canonical2) return true

  // Also check case-insensitive match
  return canonical1?.toLowerCase() === canonical2?.toLowerCase()
}

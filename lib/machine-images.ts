import machineMapping from '../machine_mapping.json'

/**
 * Gets the full image path for a machine
 * Returns the path to the machine's backglass image
 *
 * @param machineKey - The machine key from machines.json (e.g., "AFM", "MM", "Jaws")
 * @param machineName - The full machine name (used for fallback mapping)
 * @returns The path to the machine's backglass image
 */
export function getMachineImagePath(machineKey: string, machineName?: string): string {
  if (!machineKey) {
    return '/opdb_backglass_images/AFM.jpg' // Default fallback image
  }

  // First, check if there's a mapping for the machine name
  if (machineName) {
    const normalized = machineName.toLowerCase().trim()
    const mapped = (machineMapping as Record<string, string>)[normalized]
    if (mapped) {
      // Use the mapped name as the key
      return `/opdb_backglass_images/${mapped}.jpg`
    }
  }

  // The images are named exactly like the machine keys from machines.json
  // Try with .jpg first (most common), then .JPG
  return `/opdb_backglass_images/${machineKey}.jpg`
}

/**
 * Gets the thumbnail image path for a machine
 * Returns the path to the machine's thumbnail (200px wide, optimized for grid display)
 *
 * @param machineKey - The machine key from machines.json (e.g., "AFM", "MM", "Jaws")
 * @param machineName - The full machine name (used for fallback mapping)
 * @returns The path to the machine's thumbnail image
 */
export function getMachineThumbnailPath(machineKey: string, machineName?: string): string {
  if (!machineKey) {
    return '/opdb_backglass_images/thumbnails/AFM.jpg' // Default fallback thumbnail
  }

  // First, check if there's a mapping for the machine name
  if (machineName) {
    const normalized = machineName.toLowerCase().trim()
    const mapped = (machineMapping as Record<string, string>)[normalized]
    if (mapped) {
      // Use the mapped name as the key
      return `/opdb_backglass_images/thumbnails/${mapped}.jpg`
    }
  }

  // The thumbnails are named exactly like the machine keys from machines.json
  return `/opdb_backglass_images/thumbnails/${machineKey}.jpg`
}

/**
 * Gets a fallback image if the main image fails to load
 */
export function getFallbackImage(): string {
  return '/opdb_backglass_images/placeholder.jpg'
}

/**
 * Checks if a machine has an image available
 * Note: This is a client-side estimate - actual check would require server-side validation
 */
export function hasMachineImage(machineName: string): boolean {
  if (!machineName) return false
  return true // Assume all machines have images for now
}

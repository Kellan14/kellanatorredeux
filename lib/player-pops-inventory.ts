import { venuesMatch } from './venue-mappings'

type InventoryVenue = { key: string; name: string; machines: string[] }

export function parseLineupVenueKeys(csv: string): string[] {
  return Array.from(new Set(csv.split(/\r?\n/).flatMap(line => {
    if (!line.includes(',')) return []
    const key = line.split(',')[0].trim()
    return /^[A-Z0-9]{2,8}$/.test(key) && !['NAV', 'TBD', 'KEY'].includes(key) ? [key] : []
  })))
}

export function currentPopsMachines(venues: InventoryVenue[], currentVenueKeys: string[], selectedVenue: string) {
  const active = new Set(currentVenueKeys)
  return new Set(venues.flatMap(venue =>
    active.has(venue.key) && (selectedVenue === 'all' || venuesMatch(venue.name, selectedVenue))
      ? venue.machines.map(machine => machine.toLowerCase()) : []))
}

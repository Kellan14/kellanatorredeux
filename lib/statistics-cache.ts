export const STATISTICS_CACHE_TAG = 'statistics-results'
export const STATISTICS_SERVER_TTL_SECONDS = 3600
const statisticsParams = [
  'seasons', 'allMachines', 'venue', 'teamName', 'opponentTeam', 'teamVenueSpecific',
  'twcVenueSpecific', 'scoreLimits', 'includeManualScores', 'twcPlayers', 'opponentRoster', 'machines',
]

export function statisticsQueryKey(params: URLSearchParams): string {
  const key = new URLSearchParams()
  for (const name of statisticsParams) {
    const value = params.get(name)
    if (value !== null) key.set(name, value)
  }
  if (key.get('allMachines') === 'true') {
    for (const name of ['venue', 'machines', 'teamVenueSpecific', 'twcVenueSpecific']) key.delete(name)
  }
  for (const name of ['seasons', 'machines', 'twcPlayers', 'opponentRoster']) {
    const value = key.get(name)
    if (value) key.set(name, Array.from(new Set(value.split(','))).sort().join(','))
  }
  const scoreLimits = key.get('scoreLimits')
  if (scoreLimits) {
    try {
      const parsed = JSON.parse(scoreLimits)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        key.set('scoreLimits', JSON.stringify(Object.fromEntries(
          Object.entries(parsed).sort(([a], [b]) => a.localeCompare(b))
        )))
      }
    } catch { /* Let the API report invalid JSON. */ }
  }
  key.sort()
  return key.toString()
}

// Per-tab cache: store serialized results for predictable byte accounting.
// Treat the budget as payload size, not the browser's actual heap allocation.
export class StatisticsResultCache {
  private entries = new Map<string, { json: string; bytes: number; expiresAt: number }>()
  private bytes = 0

  constructor(
    private maxEntries = 100,
    private maxBytes = 8 * 1024 * 1024,
    private ttlMs = 10 * 60 * 1000,
    private now = Date.now,
  ) {}

  private remove(key: string) {
    const entry = this.entries.get(key)
    if (!entry) return
    this.bytes -= entry.bytes
    this.entries.delete(key)
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.remove(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return JSON.parse(entry.json) as T
  }

  set(key: string, value: unknown) {
    const json = JSON.stringify(value)
    if (json === undefined) return
    const bytes = new TextEncoder().encode(key).byteLength + new TextEncoder().encode(json).byteLength
    this.remove(key)
    if (bytes > this.maxBytes || this.maxEntries < 1) return
    const now = this.now()
    this.entries.forEach((entry, id) => { if (entry.expiresAt <= now) this.remove(id) })
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.remove(oldest.value)
    }
    this.entries.set(key, { json, bytes, expiresAt: now + this.ttlMs })
    this.bytes += bytes
  }
}

export const statisticsResults = new StatisticsResultCache()

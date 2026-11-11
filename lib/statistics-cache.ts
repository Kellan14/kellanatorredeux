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
const RECENT_KEY = 'mnp:recent-statistics:v1'
const RECENT_ENTRIES = 25
const RECENT_BYTES = 2 * 1024 * 1024
const encodedBytes = (value: string) => new TextEncoder().encode(value).byteLength
type RecentStorage = Pick<Storage, 'getItem' | 'setItem'>

export class StatisticsResultCache {
  private entries = new Map<string, { json: string; bytes: number; expiresAt: number }>()
  private bytes = 0
  private restored = false

  constructor(
    private maxEntries = 100,
    private maxBytes = 8 * 1024 * 1024,
    private ttlMs = 10 * 60 * 1000,
    private now = Date.now,
    private session?: () => RecentStorage | undefined,
  ) {}

  private restore() {
    if (this.restored || !this.session) return
    try {
      const storage = this.session()
      if (!storage) return
      this.restored = true
      const saved = storage.getItem(RECENT_KEY)
      if (!saved || encodedBytes(saved) > RECENT_BYTES) return
      const rows: unknown = JSON.parse(saved)
      if (!Array.isArray(rows)) return
      const now = this.now()
      for (const row of rows.slice(-RECENT_ENTRIES)) {
        if (!Array.isArray(row)) continue
        const [key, json, expiresAt] = row
        if (typeof key !== 'string' || typeof json !== 'string' ||
            !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + this.ttlMs) continue
        this.insert(key, json, expiresAt)
      }
    } catch {
      this.restored = true // Disabled or corrupt storage: keep using memory.
    }
  }

  private persist() {
    if (!this.session) return
    try {
      const storage = this.session()
      if (!storage) return
      const rows: string[] = []
      let bytes = 2 // brackets
      const now = this.now()
      for (const [key, entry] of Array.from(this.entries.entries()).slice(-RECENT_ENTRIES).reverse()) {
        if (entry.expiresAt <= now) continue
        const row = JSON.stringify([key, entry.json, entry.expiresAt])
        const size = encodedBytes(row) + (rows.length ? 1 : 0)
        if (bytes + size > RECENT_BYTES) continue
        rows.push(row)
        bytes += size
      }
      storage.setItem(RECENT_KEY, '[' + rows.reverse().join(',') + ']')
    } catch { /* Storage quotas/private browsing must not break Statistics. */ }
  }

  private remove(key: string) {
    const entry = this.entries.get(key)
    if (!entry) return
    this.bytes -= entry.bytes
    this.entries.delete(key)
  }

  get<T>(key: string): T | undefined {
    this.restore()
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.remove(key)
      return undefined
    }
    try {
      const value = JSON.parse(entry.json) as T
      this.entries.delete(key)
      this.entries.set(key, entry)
      this.persist()
      return value
    } catch {
      this.remove(key)
      return undefined
    }
  }

  set(key: string, value: unknown) {
    this.restore()
    const json = JSON.stringify(value)
    if (json === undefined) return
    this.insert(key, json, this.now() + this.ttlMs)
    this.persist()
  }

  private insert(key: string, json: string, expiresAt: number) {
    const bytes = encodedBytes(key) + encodedBytes(json)
    this.remove(key)
    if (bytes > this.maxBytes || this.maxEntries < 1) return
    const now = this.now()
    this.entries.forEach((entry, id) => { if (entry.expiresAt <= now) this.remove(id) })
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.remove(oldest.value)
    }
    this.entries.set(key, { json, bytes, expiresAt })
    this.bytes += bytes
  }
}

export const statisticsResults = new StatisticsResultCache(
  undefined, undefined, undefined, Date.now,
  () => typeof window === 'undefined' ? undefined : window.sessionStorage,
)

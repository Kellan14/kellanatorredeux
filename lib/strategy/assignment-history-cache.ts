// Bounded per-worker cache: store estimates, not raw game rows or rosters.
// Keys contain the shared history revision and the exact active score limits.
export function createAssignmentHistoryCache<T>(maxEntries = 4, ttlMs = 120_000, now = Date.now) {
  const entries = new Map<string, { value: T; expires: number }>()
  return {
    get(key: string) {
      const entry = entries.get(key)
      entries.delete(key)
      if (!entry || entry.expires <= now()) return undefined
      entries.set(key, entry)
      return entry.value
    },
    set(key: string, value: T) {
      entries.delete(key)
      entries.set(key, { value, expires: now() + ttlMs })
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!)
    },
  }
}

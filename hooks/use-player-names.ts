'use client'

import { useEffect, useState } from 'react'

/**
 * Shared player-name list for the player pickers.
 *
 * The list is identical on every page and changes only when the weekly sync
 * imports new games, so it is cached in localStorage and served synchronously
 * on the first render (stale-while-revalidate): the picker populates instantly
 * and quietly refreshes in the background.
 */

const STORAGE_KEY = 'mnp:player-names:v1'

interface StoredList {
  players: string[]
  fetchedAt: number
}

// Module-level cache so multiple components / route changes share one fetch.
let memoryCache: string[] | null = null
let inFlight: Promise<string[]> | null = null

function readStored(): StoredList | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredList
    if (!Array.isArray(parsed?.players) || parsed.players.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

function writeStored(players: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ players, fetchedAt: Date.now() } satisfies StoredList)
    )
  } catch {
    // Quota or private-mode failures are non-fatal — the memory cache still works.
  }
}

function fetchPlayerNames(): Promise<string[]> {
  if (!inFlight) {
    inFlight = fetch('/api/players')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { players?: string[] }) => {
        const players = data.players || []
        if (players.length > 0) {
          memoryCache = players
          writeStored(players)
        }
        return players
      })
      .catch(error => {
        console.error('Error loading players:', error)
        return memoryCache || []
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

export function usePlayerNames(): { players: string[]; loading: boolean } {
  // Seeded from the module cache so in-session navigation is instant with no flash.
  const [players, setPlayers] = useState<string[]>(() => memoryCache || [])

  useEffect(() => {
    let cancelled = false

    // 1. Paint whatever we already have (localStorage survives reloads).
    if (!memoryCache) {
      const stored = readStored()
      if (stored) {
        memoryCache = stored.players
        setPlayers(stored.players)
      }
    }

    // 2. Revalidate in the background. The response carries a long
    //    Cache-Control, so this usually resolves straight from the HTTP cache.
    fetchPlayerNames().then(next => {
      if (!cancelled && next.length > 0) setPlayers(next)
    })

    return () => {
      cancelled = true
    }
  }, [])

  return { players, loading: players.length === 0 }
}

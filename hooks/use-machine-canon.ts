'use client'

import { useEffect, useMemo, useState } from 'react'

/**
 * Client-side machine canon.
 *
 * Long form is the display name sitewide, but the canon lives in the database,
 * so components get it through this hook rather than a bundled lookup table.
 * Cached in localStorage and revalidated in the background, so the first paint
 * is never blank (same pattern as usePlayerNames).
 */

const STORAGE_KEY = 'mnp:machine-canon:v1'

export interface CanonMachine {
  key: string
  name: string
  displayName: string
  source: 'mnp' | 'local'
  active: boolean
}

let memoryCache: CanonMachine[] | null = null
let inFlight: Promise<CanonMachine[]> | null = null

function readStored(): CanonMachine[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.machines) || parsed.machines.length === 0) return null
    return parsed.machines as CanonMachine[]
  } catch {
    return null
  }
}

function writeStored(machines: CanonMachine[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ machines, fetchedAt: Date.now() }))
  } catch {
    /* quota / private mode — the memory cache still works */
  }
}

function fetchCanon(): Promise<CanonMachine[]> {
  if (!inFlight) {
    inFlight = fetch('/api/machine-canon')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { machines?: CanonMachine[] }) => {
        const machines = data.machines || []
        if (machines.length > 0) {
          memoryCache = machines
          writeStored(machines)
        }
        return machines
      })
      .catch((error) => {
        console.error('Error loading machine canon:', error)
        return memoryCache || []
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

export function useMachineCanon() {
  const [machines, setMachines] = useState<CanonMachine[]>(() => memoryCache || [])

  useEffect(() => {
    let cancelled = false

    if (!memoryCache) {
      const stored = readStored()
      if (stored) {
        memoryCache = stored
        setMachines(stored)
      }
    }

    fetchCanon().then((next) => {
      if (!cancelled && next.length > 0) setMachines(next)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const byKey = useMemo(() => new Map(machines.map((m) => [m.key, m])), [machines])

  /**
   * Long form for a canon key. Falls back to the key so a machine that is not
   * in the canon still renders as something — and stays visibly odd, rather
   * than being silently prettified into looking correct.
   */
  const display = useMemo(() => (key: string | null | undefined): string => {
    if (!key) return ''
    return byKey.get(key)?.displayName ?? key
  }, [byKey])

  return { machines, byKey, display, loading: machines.length === 0 }
}

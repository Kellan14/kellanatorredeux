'use client'

import { useState, useEffect, useCallback } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'twcPlayerAvailability'

interface TwcPlayerAvailabilityProps {
  rosterPlayers: string[]
  subPlayers: string[]
  availablePlayers: Record<string, boolean>
  onChange: (players: Record<string, boolean>) => void
  lockedPlayers?: Set<string>
}

function getDefaultAvailability(rosterPlayers: string[], subPlayers: string[]): Record<string, boolean> {
  const defaults: Record<string, boolean> = {}
  rosterPlayers.forEach(p => { defaults[p] = true })
  subPlayers.forEach(p => { defaults[p] = false })
  return defaults
}

function loadFromStorage(rosterPlayers: string[], subPlayers: string[]): Record<string, boolean> | null {
  if (typeof window === 'undefined') return null
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return null
    const parsed = JSON.parse(saved) as Record<string, boolean>
    // Merge with current roster: new players get defaults, removed players are ignored
    const allPlayers = [...rosterPlayers, ...subPlayers]
    const merged: Record<string, boolean> = {}
    const defaults = getDefaultAvailability(rosterPlayers, subPlayers)
    allPlayers.forEach(p => {
      merged[p] = parsed[p] !== undefined ? parsed[p] : defaults[p]
    })
    return merged
  } catch {
    return null
  }
}

function saveToStorage(players: Record<string, boolean>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(players))
  } catch {
    // Ignore storage errors
  }
}

function isModified(current: Record<string, boolean>, rosterPlayers: string[], subPlayers: string[]): boolean {
  const defaults = getDefaultAvailability(rosterPlayers, subPlayers)
  const allPlayers = [...rosterPlayers, ...subPlayers]
  for (const player of allPlayers) {
    const currentVal = current[player] ?? false
    const defaultVal = defaults[player] ?? false
    if (currentVal !== defaultVal) return true
  }
  return false
}

export function TwcPlayerAvailability({
  rosterPlayers,
  subPlayers,
  availablePlayers,
  onChange,
  lockedPlayers,
}: TwcPlayerAvailabilityProps) {
  const [showSubs, setShowSubs] = useState(false)
  const [initialized, setInitialized] = useState(false)

  // On mount (or when roster changes), load from localStorage and merge
  useEffect(() => {
    if (rosterPlayers.length === 0) return
    const saved = loadFromStorage(rosterPlayers, subPlayers)
    if (saved) {
      onChange(saved)
      // If any sub is checked, auto-show subs
      const hasCheckedSub = subPlayers.some(p => saved[p])
      if (hasCheckedSub) setShowSubs(true)
    }
    setInitialized(true)
  }, [rosterPlayers.join(','), subPlayers.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save to localStorage whenever availablePlayers changes (after init)
  useEffect(() => {
    if (!initialized) return
    if (Object.keys(availablePlayers).length === 0) return
    saveToStorage(availablePlayers)
  }, [availablePlayers, initialized])

  const modified = initialized && isModified(availablePlayers, rosterPlayers, subPlayers)

  const handleReset = () => {
    const defaults = getDefaultAvailability(rosterPlayers, subPlayers)
    onChange(defaults)
    saveToStorage(defaults)
    setShowSubs(false)
  }

  const handleToggle = (player: string, checked: boolean) => {
    const updated = { ...availablePlayers, [player]: checked }
    onChange(updated)
  }

  return (
    <div className="mb-4 md:mb-6">
      <div className="flex items-center justify-between mb-2 md:mb-3">
        <div>
          <h3 className="text-sm md:text-lg font-semibold">TWC Player Availability</h3>
          <p className="text-xs md:text-sm text-muted-foreground">Select players available for this match</p>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="show-subs"
            checked={showSubs}
            onCheckedChange={(checked) => setShowSubs(!!checked)}
          />
          <label
            htmlFor="show-subs"
            className="text-xs md:text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Show Subs ({subPlayers.length})
          </label>
        </div>
      </div>

      {modified && (
        <div className="flex items-center gap-2 mb-2 md:mb-3 px-2 md:px-3 py-1.5 md:py-2 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded text-xs md:text-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shadow-[0_0_4px_rgba(245,158,11,0.8)]" />
          <span className="text-amber-700 dark:text-amber-300 font-medium">Modified</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-6 md:h-7 text-xs"
            onClick={handleReset}
          >
            Reset
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1.5 md:gap-3">
        {rosterPlayers.map((player) => {
          const isLocked = lockedPlayers?.has(player)
          return (
            <div key={player} className="flex items-center space-x-1.5 md:space-x-2">
              <Checkbox
                id={`player-${player}`}
                checked={availablePlayers[player] || false}
                onCheckedChange={(checked) => handleToggle(player, !!checked)}
                disabled={isLocked}
                className="h-3.5 w-3.5 md:h-4 md:w-4"
              />
              <label
                htmlFor={`player-${player}`}
                className={`text-xs md:text-sm font-medium leading-none ${isLocked ? 'text-primary' : ''}`}
              >
                {player}{isLocked ? ' (sat)' : ''}
              </label>
            </div>
          )
        })}
        {showSubs && subPlayers.map((player) => (
          <div key={player} className="flex items-center space-x-1.5 md:space-x-2">
            <Checkbox
              id={`player-${player}`}
              checked={availablePlayers[player] || false}
              onCheckedChange={(checked) => handleToggle(player, !!checked)}
              className="h-3.5 w-3.5 md:h-4 md:w-4"
            />
            <label
              htmlFor={`player-${player}`}
              className="text-xs md:text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-muted-foreground"
            >
              {player} (sub)
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}

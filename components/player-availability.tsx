'use client'

import { useState, useEffect, useRef } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { X, Search } from 'lucide-react'

interface PlayerAvailabilityProps {
  storageKey: string
  title: string
  rosterPlayers: string[]
  subPlayers: string[]
  availablePlayers: Record<string, boolean>
  onChange: (players: Record<string, boolean>) => void
  lockedPlayers?: Set<string>
  onAddSub?: (playerName: string) => void
  onRemoveSub?: (playerName: string) => void
  addedSubs?: string[]
  /** For each sub player, the most recent (season, week) they appeared for the team. */
  subPlayerLastSeen?: Record<string, { season: number; week: number }>
}

function getDefaultAvailability(rosterPlayers: string[], subPlayers: string[]): Record<string, boolean> {
  const defaults: Record<string, boolean> = {}
  rosterPlayers.forEach(p => { defaults[p] = true })
  subPlayers.forEach(p => { defaults[p] = false })
  return defaults
}

function loadFromStorage(storageKey: string, rosterPlayers: string[], subPlayers: string[]): Record<string, boolean> | null {
  if (typeof window === 'undefined') return null
  try {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return null
    const parsed = JSON.parse(saved) as Record<string, boolean>
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

function saveToStorage(storageKey: string, players: Record<string, boolean>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey, JSON.stringify(players))
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

function PlayerSearchDropdown({ onSelect, existingPlayers }: { onSelect: (name: string) => void, existingPlayers: string[] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<string[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/search-players?q=${encodeURIComponent(query)}`)
        if (response.ok) {
          const data = await response.json()
          // Filter out players already in the list
          const filtered = (data.players || []).filter((p: string) => !existingPlayers.includes(p))
          setResults(filtered)
        }
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, existingPlayers])

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1 border rounded px-2 py-1 bg-background">
        <Search className="h-3 w-3 text-muted-foreground" />
        <input
          type="text"
          placeholder="Add player..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => query.length >= 2 && setIsOpen(true)}
          className="text-xs bg-transparent outline-none w-28 md:w-36"
        />
      </div>
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-56 max-h-48 overflow-y-auto bg-popover border rounded-md shadow-md">
          {results.map(name => (
            <button
              key={name}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
              onClick={() => {
                onSelect(name)
                setQuery('')
                setIsOpen(false)
                setResults([])
              }}
            >
              {name}
            </button>
          ))}
          {loading && <div className="px-3 py-1.5 text-xs text-muted-foreground">Searching...</div>}
        </div>
      )}
      {isOpen && query.length >= 2 && results.length === 0 && !loading && (
        <div className="absolute z-50 mt-1 w-56 bg-popover border rounded-md shadow-md px-3 py-1.5 text-xs text-muted-foreground">
          No players found
        </div>
      )}
    </div>
  )
}

export function PlayerAvailability({
  storageKey,
  title,
  rosterPlayers,
  subPlayers,
  availablePlayers,
  onChange,
  lockedPlayers,
  onAddSub,
  onRemoveSub,
  addedSubs = [],
  subPlayerLastSeen,
}: PlayerAvailabilityProps) {
  const [showSubs, setShowSubs] = useState(false)
  const [initialized, setInitialized] = useState(false)

  // On mount (or when roster changes), load from localStorage and merge
  useEffect(() => {
    if (rosterPlayers.length === 0) return
    const saved = loadFromStorage(storageKey, rosterPlayers, subPlayers)
    if (saved) {
      onChange(saved)
      const hasCheckedSub = subPlayers.some(p => saved[p])
      if (hasCheckedSub) setShowSubs(true)
    }
    setInitialized(true)
  }, [rosterPlayers.join(','), subPlayers.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save to localStorage whenever availablePlayers changes (after init)
  useEffect(() => {
    if (!initialized) return
    if (Object.keys(availablePlayers).length === 0) return
    saveToStorage(storageKey, availablePlayers)
  }, [availablePlayers, initialized, storageKey])

  const modified = initialized && isModified(availablePlayers, rosterPlayers, subPlayers)

  const handleReset = () => {
    const defaults = getDefaultAvailability(rosterPlayers, subPlayers)
    onChange(defaults)
    saveToStorage(storageKey, defaults)
    setShowSubs(false)
  }

  const handleToggle = (player: string, checked: boolean) => {
    const updated = { ...availablePlayers, [player]: checked }
    onChange(updated)
  }

  const allExistingPlayers = [...rosterPlayers, ...subPlayers]

  return (
    <div className="mb-4 md:mb-6">
      <div className="flex items-center justify-between mb-2 md:mb-3">
        <div>
          <h3 className="text-sm md:text-lg font-semibold">{title}</h3>
          <p className="text-xs md:text-sm text-muted-foreground">Select players available for this match</p>
        </div>
        <div className="flex items-center gap-3">
          {onAddSub && (
            <PlayerSearchDropdown
              onSelect={(name) => onAddSub(name)}
              existingPlayers={allExistingPlayers}
            />
          )}
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`show-subs-${storageKey}`}
              checked={showSubs}
              onCheckedChange={(checked) => setShowSubs(!!checked)}
            />
            <label
              htmlFor={`show-subs-${storageKey}`}
              className="text-xs md:text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Show Subs ({subPlayers.length})
            </label>
          </div>
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
                id={`${storageKey}-player-${player}`}
                checked={availablePlayers[player] || false}
                onCheckedChange={(checked) => handleToggle(player, !!checked)}
                disabled={isLocked}
                className="h-3.5 w-3.5 md:h-4 md:w-4"
              />
              <label
                htmlFor={`${storageKey}-player-${player}`}
                className={`text-xs md:text-sm font-medium leading-none ${isLocked ? 'text-primary' : ''}`}
              >
                {player}{isLocked ? ' (sat)' : ''}
              </label>
            </div>
          )
        })}
        {showSubs && subPlayers.map((player) => {
          const isAdded = addedSubs.includes(player)
          return (
            <div key={player} className="flex items-center space-x-1.5 md:space-x-2">
              <Checkbox
                id={`${storageKey}-player-${player}`}
                checked={availablePlayers[player] || false}
                onCheckedChange={(checked) => handleToggle(player, !!checked)}
                className="h-3.5 w-3.5 md:h-4 md:w-4"
              />
              <label
                htmlFor={`${storageKey}-player-${player}`}
                className="text-xs md:text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-muted-foreground"
              >
                {player} (sub
                {subPlayerLastSeen?.[player]
                  ? ` s${subPlayerLastSeen[player].season}w${subPlayerLastSeen[player].week}`
                  : ''}
                )
              </label>
              {isAdded && onRemoveSub && (
                <button
                  onClick={() => onRemoveSub(player)}
                  className="text-muted-foreground hover:text-destructive"
                  title="Remove added sub"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

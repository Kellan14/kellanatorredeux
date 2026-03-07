'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface PlayerComboboxProps {
  players: string[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  disabledValues?: string[]
}

export function PlayerCombobox({
  players,
  value,
  onValueChange,
  placeholder = 'Search players...',
  disabled = false,
  disabledValues = [],
}: PlayerComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Filter players based on search
  const filteredPlayers = React.useMemo(() => {
    if (!search) return players.slice(0, 50) // Show first 50 when no search
    const lowerSearch = search.toLowerCase()
    return players
      .filter(p => p.toLowerCase().includes(lowerSearch))
      .slice(0, 50) // Limit results for performance
  }, [players, search])

  // Handle click outside to close
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // When value changes externally, update search display
  React.useEffect(() => {
    if (!open) {
      setSearch(value || '')
    }
  }, [value, open])

  const handleSelect = (player: string) => {
    onValueChange(player)
    setSearch(player)
    setOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onValueChange('')
    setSearch('')
    inputRef.current?.focus()
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
    setOpen(true)
  }

  const handleFocus = () => {
    setOpen(true)
    // Select all text on focus for easy replacement
    inputRef.current?.select()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setSearch(value || '')
    }
    if (e.key === 'Enter' && filteredPlayers.length > 0) {
      e.preventDefault()
      // Select first non-disabled option
      const firstAvailable = filteredPlayers.find(p => !disabledValues.includes(p))
      if (firstAvailable) {
        handleSelect(firstAvailable)
      }
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={search}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-16"
        />
        <div className="absolute inset-y-0 right-0 flex items-center">
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-full px-2 hover:bg-transparent"
              onClick={handleClear}
              disabled={disabled}
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-full px-2 hover:bg-transparent"
            onClick={() => {
              setOpen(!open)
              if (!open) inputRef.current?.focus()
            }}
            disabled={disabled}
          >
            <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {open && filteredPlayers.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
          <div className="max-h-[300px] overflow-y-auto p-1">
            {filteredPlayers.map((player) => {
              const isDisabled = disabledValues.includes(player)
              const isSelected = value === player
              return (
                <button
                  key={player}
                  type="button"
                  onClick={() => !isDisabled && handleSelect(player)}
                  disabled={isDisabled}
                  className={cn(
                    'relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 px-3 text-sm outline-none',
                    isSelected && 'bg-accent',
                    isDisabled && 'cursor-not-allowed opacity-50',
                    !isDisabled && !isSelected && 'hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      isSelected ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {player}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {open && search && filteredPlayers.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-4 text-center text-sm text-muted-foreground shadow-lg">
          No players found
        </div>
      )}
    </div>
  )
}

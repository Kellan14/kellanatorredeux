'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'
import { AlexLoader } from '@/components/alex-loader'
import { VenueMachineListManager } from '@/components/venue-machine-list-manager'
import { MachineMappingManager } from '@/components/machine-mapping-manager'
import { PlayerMappingManager } from '@/components/player-mapping-manager'
import { SubLinkManager } from '@/components/sub-link-manager'
import { IntegrityManager } from '@/components/integrity-manager'
import { PlayerCombobox } from '@/components/ui/player-combobox'
import { createSupabaseClient } from '@/lib/supabase'
import { authFetch } from '@/lib/auth-fetch'
import type { User as SupabaseUser } from '@supabase/supabase-js'

interface Venue {
  key: string
  name: string
  machines?: string[]
}

export default function OptionsPage() {
  // Venues for the venue machine list manager
  const [venues, setVenues] = useState<Venue[]>([])
  const [selectedVenue, setSelectedVenue] = useState<string>('')
  const [loadingVenues, setLoadingVenues] = useState(true)

  // Dialog states
  const [scoreLimitsOpen, setScoreLimitsOpen] = useState(false)
  const [venueListManagerOpen, setVenueListManagerOpen] = useState(false)
  const [machineMappingOpen, setMachineMappingOpen] = useState(false)
  const [playerMappingOpen, setPlayerMappingOpen] = useState(false)
  const [subLinkOpen, setSubLinkOpen] = useState(false)
  const [integrityOpen, setIntegrityOpen] = useState(false)
  const [activeVenuesOpen, setActiveVenuesOpen] = useState(false)
  const [linkAccountOpen, setLinkAccountOpen] = useState(false)

  // Count of actionable player-name issues (drives the red "!" badge).
  const [nameIssueCount, setNameIssueCount] = useState(0)
  // Latest integrity check failed (drives its red "!" badge).
  const [integrityProblem, setIntegrityProblem] = useState(false)

  // Link account state
  const supabase = createSupabaseClient()
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [currentPlayerName, setCurrentPlayerName] = useState<string | null>(null)
  const [allPlayers, setAllPlayers] = useState<string[]>([])
  const [selectedPlayerToLink, setSelectedPlayerToLink] = useState<string>('')
  const [linkingAccount, setLinkingAccount] = useState(false)

  // Active venues state
  const [activeVenues, setActiveVenues] = useState<Venue[]>([])
  const [loadingActiveVenues, setLoadingActiveVenues] = useState(false)
  const [addVenueValue, setAddVenueValue] = useState('')

  // Score limits state
  const [scoreLimits, setScoreLimits] = useState<Record<string, number>>({})
  const [newLimitMachine, setNewLimitMachine] = useState('')
  const [newLimitScore, setNewLimitScore] = useState('')
  const [editingLimit, setEditingLimit] = useState<Record<string, string>>({})
  const [allMachines, setAllMachines] = useState<string[]>([])

  // Load venues and score limits on mount
  useEffect(() => {
    loadVenues()
    loadScoreLimits()
    loadMachines()
    loadUserAndPlayers()
    loadNameIssueCount()
    loadIntegrityStatus()
  }, [])

  // Cached count of actionable name issues (cheap read; no rescan).
  const loadNameIssueCount = async () => {
    try {
      const res = await fetch('/api/player-name-issues')
      if (res.ok) {
        const data = await res.json()
        setNameIssueCount(data.actionableCount || 0)
      }
    } catch {
      /* non-fatal */
    }
  }

  // Latest integrity report status (cheap read; no run).
  const loadIntegrityStatus = async () => {
    try {
      const res = await fetch('/api/integrity-check?read=true')
      if (res.ok) {
        const data = await res.json()
        setIntegrityProblem(!!data.report && data.report.ok === false)
      }
    } catch {
      /* non-fatal */
    }
  }

  const loadUserAndPlayers = async () => {
    // Load current user
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)

    if (user) {
      // Get current player name from profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('player_name')
        .eq('id', user.id)
        .single()

      const profile = profileData as { player_name: string | null } | null
      if (profile?.player_name) {
        setCurrentPlayerName(profile.player_name)
      }
    }

    // Load all players
    try {
      const response = await fetch('/api/head-to-head')
      if (response.ok) {
        const data = await response.json()
        setAllPlayers(data.players || [])
      }
    } catch (error) {
      console.error('Error loading players:', error)
    }
  }

  const handleLinkAccount = async () => {
    if (!user || !selectedPlayerToLink) return

    setLinkingAccount(true)
    try {
      const response = await authFetch('/api/associate-player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: selectedPlayerToLink
        })
      })

      if (response.ok) {
        setCurrentPlayerName(selectedPlayerToLink)
        setLinkAccountOpen(false)
        setSelectedPlayerToLink('')
      } else {
        console.error('Failed to link account')
      }
    } catch (error) {
      console.error('Error linking account:', error)
    } finally {
      setLinkingAccount(false)
    }
  }

  const loadVenues = async () => {
    setLoadingVenues(true)
    try {
      const [venuesResponse, matchResponse] = await Promise.all([
        fetch('/api/venues'),
        fetch('/api/latest-twc-match')
      ])
      const [venuesData, matchData] = await Promise.all([
        venuesResponse.json(),
        matchResponse.json().catch(() => ({}))
      ])
      const venueList = venuesData.venues || []
      setVenues(venueList)

      // Default to next match venue, fall back to first venue
      const nextMatchVenue = matchData.venue
      const matchVenueExists = nextMatchVenue && venueList.some((v: Venue) => v.name === nextMatchVenue)
      if (matchVenueExists) {
        setSelectedVenue(nextMatchVenue)
      } else if (venueList.length > 0) {
        setSelectedVenue(venueList[0].name)
      }
    } catch (error) {
      console.error('Error loading venues:', error)
    } finally {
      setLoadingVenues(false)
    }
  }

  const loadScoreLimits = async () => {
    try {
      const response = await fetch('/api/score-limits')
      if (response.ok) {
        const data = await response.json()
        setScoreLimits(data.limits || {})
      }
    } catch (e) {
      console.error('Failed to load score limits')
    }
  }

  const loadMachines = async () => {
    try {
      const response = await fetch('/api/machines')
      const data = await response.json()
      // API returns {key: {key, name}, ...} format
      const machineNames = Object.values(data).map((m: any) => m.name).sort()
      setAllMachines(machineNames)
    } catch (error) {
      console.error('Error loading machines:', error)
    }
  }

  // Score limits management
  const saveScoreLimits = async (newLimits: Record<string, number>) => {
    setScoreLimits(newLimits)

    // Save to database
    try {
      const response = await authFetch('/api/score-limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limits: newLimits })
      })

      if (!response.ok) {
        console.error('Failed to save score limits to database')
      }
    } catch (error) {
      console.error('Error saving score limits:', error)
    }
  }

  const addScoreLimit = (machine: string, limit: number) => {
    const newLimits = { ...scoreLimits, [machine.toLowerCase()]: limit }
    saveScoreLimits(newLimits)
  }

  const deleteScoreLimit = (machine: string) => {
    const newLimits = { ...scoreLimits }
    delete newLimits[machine.toLowerCase()]
    saveScoreLimits(newLimits)
  }

  const clearAllScoreLimits = () => {
    saveScoreLimits({})
  }

  // Active venues management
  const loadActiveVenues = async () => {
    setLoadingActiveVenues(true)
    try {
      const response = await fetch('/api/active-venues')
      const data = await response.json()
      setActiveVenues(data.venues || [])
    } catch (error) {
      console.error('Error loading active venues:', error)
    } finally {
      setLoadingActiveVenues(false)
    }
  }

  const removeActiveVenue = async (venueName: string) => {
    try {
      await authFetch('/api/active-venues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_name: venueName, action: 'remove' })
      })
      setActiveVenues(prev => prev.filter(v => v.name !== venueName))
    } catch (error) {
      console.error('Error removing venue:', error)
    }
  }

  const addActiveVenue = async (venueName: string) => {
    try {
      // If this venue was previously removed, delete the override to restore it
      // If it's a new addition, add an 'add' override
      await authFetch('/api/active-venues', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_name: venueName })
      })
      await authFetch('/api/active-venues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_name: venueName, action: 'add' })
      })
      // Reload to get fresh data
      loadActiveVenues()
      setAddVenueValue('')
    } catch (error) {
      console.error('Error adding venue:', error)
    }
  }

  if (loadingVenues) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex items-center justify-center p-12">
            <AlexLoader className="mr-2" />
            <span>Loading...</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Options</CardTitle>
          <CardDescription>
            Configure settings and manage data standardization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2"
              onClick={() => setScoreLimitsOpen(true)}
            >
              <span className="text-lg font-medium">Machine Score Limits</span>
              <span className="text-xs text-muted-foreground">Set max scores to filter outliers</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2"
              onClick={() => setVenueListManagerOpen(true)}
            >
              <span className="text-lg font-medium">Modify Venue Machine List</span>
              <span className="text-xs text-muted-foreground">Add or remove machines from venues</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2"
              onClick={() => setMachineMappingOpen(true)}
            >
              <span className="text-lg font-medium">Standardize Machines</span>
              <span className="text-xs text-muted-foreground">Map machine name variations</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2 relative"
              onClick={() => setPlayerMappingOpen(true)}
            >
              {nameIssueCount > 0 && (
                <span
                  className="absolute top-2 right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white"
                  title={`${nameIssueCount} name issue${nameIssueCount !== 1 ? 's' : ''} to review`}
                >
                  !
                </span>
              )}
              <span className="text-lg font-medium">Standardize Player Names</span>
              <span className="text-xs text-muted-foreground">Combine player name variations</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2"
              onClick={() => setSubLinkOpen(true)}
            >
              <span className="text-lg font-medium">Sub Player Links</span>
              <span className="text-xs text-muted-foreground">Link legacy sub appearances to real players</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2 relative"
              onClick={() => setIntegrityOpen(true)}
            >
              {integrityProblem && (
                <span
                  className="absolute top-2 right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white"
                  title="Latest integrity check found problems"
                >
                  !
                </span>
              )}
              <span className="text-lg font-medium">Data Integrity</span>
              <span className="text-xs text-muted-foreground">Verify DB against the archive &amp; edit history</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2"
              onClick={() => {
                setActiveVenuesOpen(true)
                loadActiveVenues()
              }}
            >
              <span className="text-lg font-medium">Active Venues</span>
              <span className="text-xs text-muted-foreground">Manage venues shown in strategy</span>
            </Button>

            <Link href="/backglass-editor">
              <Button
                variant="outline"
                className="h-24 w-full flex flex-col items-center justify-center gap-2"
              >
                <span className="text-lg font-medium">Backglass Editor</span>
                <span className="text-xs text-muted-foreground">Add or edit machine images</span>
              </Button>
            </Link>

            {user && (
              <Button
                variant="outline"
                className="h-24 flex flex-col items-center justify-center gap-2"
                onClick={() => setLinkAccountOpen(true)}
              >
                <span className="text-lg font-medium">Link Account to Player</span>
                <span className="text-xs text-muted-foreground">
                  {currentPlayerName ? `Linked to: ${currentPlayerName}` : 'Connect your account to a player name'}
                </span>
              </Button>
            )}

            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2"
              disabled
            >
              <span className="text-lg font-medium">Edit Roster</span>
              <span className="text-xs text-muted-foreground">Coming soon</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2"
              disabled
            >
              <span className="text-lg font-medium">Edit TWC Roster</span>
              <span className="text-xs text-muted-foreground">Coming soon</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Machine Score Limits Dialog */}
      <Dialog open={scoreLimitsOpen} onOpenChange={setScoreLimitsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Machine Score Limits</DialogTitle>
            <DialogDescription>
              Set maximum score thresholds to filter outliers from statistics
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {Object.keys(scoreLimits).length > 0 && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={clearAllScoreLimits}>
                  Clear All Limits
                </Button>
              </div>
            )}

            {/* Add New Score Limit */}
            <div className="border rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-medium">Add New Score Limit</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Machine</label>
                  <Select value={newLimitMachine} onValueChange={setNewLimitMachine}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select machine" />
                    </SelectTrigger>
                    <SelectContent>
                      {allMachines
                        .filter(machine => !scoreLimits[machine.toLowerCase()])
                        .map((machine) => (
                          <SelectItem key={machine} value={machine}>
                            {machine}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Maximum Score</label>
                  <Input
                    type="text"
                    placeholder="e.g., 1,000,000"
                    value={newLimitScore}
                    onChange={(e) => setNewLimitScore(e.target.value)}
                  />
                </div>
              </div>
              <Button
                onClick={() => {
                  if (newLimitMachine && newLimitScore) {
                    const cleaned = newLimitScore.replace(/[^\d]/g, '')
                    const score = parseInt(cleaned)
                    if (!isNaN(score)) {
                      addScoreLimit(newLimitMachine, score)
                      setNewLimitMachine('')
                      setNewLimitScore('')
                    }
                  }
                }}
                disabled={!newLimitMachine || !newLimitScore}
              >
                Add Limit
              </Button>
            </div>

            {/* Current Score Limits */}
            {Object.keys(scoreLimits).length > 0 && (
              <div className="border rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-medium">Current Score Limits</h3>
                <div className="space-y-2">
                  {Object.entries(scoreLimits).map(([machine, limit]) => (
                    <div key={machine} className="grid grid-cols-12 gap-2 items-center border-b pb-2">
                      <div className="col-span-5 text-sm font-medium">{machine}</div>
                      <div className="col-span-4">
                        <Input
                          type="text"
                          className="h-8"
                          value={editingLimit[machine] ?? limit.toLocaleString()}
                          onChange={(e) => setEditingLimit({ ...editingLimit, [machine]: e.target.value })}
                        />
                      </div>
                      <div className="col-span-3 flex gap-1">
                        {editingLimit[machine] !== undefined && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const cleaned = editingLimit[machine].replace(/[^\d]/g, '')
                              const score = parseInt(cleaned)
                              if (!isNaN(score)) {
                                addScoreLimit(machine, score)
                                const newEditing = { ...editingLimit }
                                delete newEditing[machine]
                                setEditingLimit(newEditing)
                              }
                            }}
                          >
                            Update
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteScoreLimit(machine)}
                        >
                          X
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Object.keys(scoreLimits).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No score limits set. Add a limit above to filter machines.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Venue Machine List Manager Dialog */}
      <VenueMachineListManager
        open={venueListManagerOpen}
        onOpenChange={setVenueListManagerOpen}
        venueName={selectedVenue}
        onVenueChange={setSelectedVenue}
        venues={venues}
        currentMachines={venues.find(v => v.name === selectedVenue)?.machines || []}
      />

      {/* Machine Mapping Manager Dialog */}
      <MachineMappingManager
        open={machineMappingOpen}
        onOpenChange={setMachineMappingOpen}
      />

      {/* Player Mapping Manager Dialog */}
      <PlayerMappingManager
        open={playerMappingOpen}
        onOpenChange={(o) => {
          setPlayerMappingOpen(o)
          if (!o) loadNameIssueCount() // refresh badge after any fixes
        }}
      />

      {/* Sub Player Links Dialog */}
      <SubLinkManager
        open={subLinkOpen}
        onOpenChange={setSubLinkOpen}
      />

      {/* Data Integrity Dialog */}
      <IntegrityManager
        open={integrityOpen}
        onOpenChange={(o) => {
          setIntegrityOpen(o)
          if (!o) loadIntegrityStatus() // refresh badge after a manual run
        }}
      />

      {/* Active Venues Dialog */}
      <Dialog open={activeVenuesOpen} onOpenChange={setActiveVenuesOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Active Venues</DialogTitle>
            <DialogDescription>
              Manage which venues appear in the strategy page dropdown. Based on the current season&apos;s venue list.
            </DialogDescription>
          </DialogHeader>

          {loadingActiveVenues ? (
            <div className="flex items-center justify-center p-8">
              <AlexLoader size={44} className="mr-2" />
              <span>Loading venues...</span>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Add venue */}
              <div className="border rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-medium">Add Venue</h3>
                <div className="flex gap-2">
                  <Select value={addVenueValue} onValueChange={setAddVenueValue}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select venue to add" />
                    </SelectTrigger>
                    <SelectContent>
                      {venues
                        .filter(v => !activeVenues.some(av => av.name === v.name))
                        .map(v => (
                          <SelectItem key={v.key} value={v.name}>
                            {v.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => {
                      if (addVenueValue) addActiveVenue(addVenueValue)
                    }}
                    disabled={!addVenueValue}
                  >
                    Add
                  </Button>
                </div>
              </div>

              {/* Current active venues */}
              <div className="border rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-medium">
                  Active Venues ({activeVenues.length})
                </h3>
                <div className="space-y-1">
                  {activeVenues.map(v => (
                    <div key={v.key} className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50">
                      <span className="text-sm">{v.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-destructive"
                        onClick={() => removeActiveVenue(v.name)}
                      >
                        X
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Link Account Dialog */}
      <Dialog open={linkAccountOpen} onOpenChange={setLinkAccountOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link Account to Player</DialogTitle>
            <DialogDescription>
              Connect your account to your TWC player name to submit scores and track your stats.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {currentPlayerName ? (
              <div className="p-4 border rounded-lg bg-green-500/10 border-green-500/30">
                <p className="text-sm font-medium text-green-700 dark:text-green-300">
                  Currently linked to: {currentPlayerName}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  You can change this by selecting a different player below.
                </p>
              </div>
            ) : (
              <div className="p-4 border rounded-lg bg-yellow-500/10 border-yellow-500/30">
                <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                  Your account is not linked to a player name.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Select your player name below to enable score submission.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Select Your Player Name</label>
              <PlayerCombobox
                players={allPlayers}
                value={selectedPlayerToLink}
                onValueChange={setSelectedPlayerToLink}
                placeholder="Search for your name..."
              />
            </div>

            <Button
              onClick={handleLinkAccount}
              disabled={!selectedPlayerToLink || linkingAccount}
              className="w-full"
            >
              {linkingAccount ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Linking...
                </>
              ) : (
                'Link Account'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

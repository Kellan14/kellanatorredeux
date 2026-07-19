'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X, Plus, Save, Loader2, Pencil, Trash2, Users, Database } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { authFetch } from '@/lib/auth-fetch'

interface PlayerMappingManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Mirrors lib/player-name-issues.ts NameIssue (kept local to avoid pulling
// server-side scan code into the client bundle).
interface NameIssue {
  normalized_name: string
  variants: string[]
  suggested_canonical: string
  issue_type: 'case' | 'split_key'
  player_key: string | null
}

export function PlayerMappingManager({
  open,
  onOpenChange,
}: PlayerMappingManagerProps) {
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [allPlayers, setAllPlayers] = useState<string[]>([])
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([])
  const [canonicalName, setCanonicalName] = useState('')
  const [editingAlias, setEditingAlias] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searchFilter, setSearchFilter] = useState('')
  const [updating, setUpdating] = useState(false)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [pendingUpdate, setPendingUpdate] = useState<Record<string, string> | null>(null)
  const [updateDescription, setUpdateDescription] = useState('')
  const [issues, setIssues] = useState<NameIssue[]>([])
  const [loadingIssues, setLoadingIssues] = useState(false)

  // Load mappings from localStorage and players from API when dialog opens
  useEffect(() => {
    if (open) {
      loadData()
    }
  }, [open])

  const loadData = async () => {
    setLoading(true)
    try {
      // Load mappings from Supabase table
      const mappingsResponse = await fetch('/api/player-name-mappings')
      const mappingsData = await mappingsResponse.json()
      if (mappingsData.mappings) {
        const mappingsObj: Record<string, string> = {}
        for (const m of mappingsData.mappings) {
          mappingsObj[m.alias] = m.canonical_name
        }
        setMappings(mappingsObj)
      }

      // Load players from API
      const response = await fetch('/api/player-mappings')
      const data = await response.json()
      setAllPlayers(data.allPlayers || [])
    } catch (error) {
      console.error('Error loading player data:', error)
    } finally {
      setLoading(false)
    }

    // Run a fresh scan for name inconsistencies (case/spelling + split-key).
    loadIssues()
  }

  // Fetch the current name issues. refresh=true recomputes server-side.
  const loadIssues = async () => {
    setLoadingIssues(true)
    try {
      const res = await fetch('/api/player-name-issues?refresh=true')
      if (res.ok) {
        const data = await res.json()
        setIssues(data.issues || [])
      }
    } catch (error) {
      console.error('Error scanning name issues:', error)
    } finally {
      setLoadingIssues(false)
    }
  }

  // Save a single mapping to Supabase
  const saveMapping = async (alias: string, canonical_name: string) => {
    try {
      await authFetch('/api/player-name-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias, canonical_name }),
      })
    } catch (error) {
      console.error('Error saving mapping:', error)
    }
  }

  // Delete a single mapping from Supabase
  const deleteMappingFromDb = async (alias: string) => {
    try {
      await authFetch('/api/player-name-mappings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias }),
      })
    } catch (error) {
      console.error('Error deleting mapping:', error)
    }
  }

  // Update local state and persist to Supabase
  const saveMappings = async (newMappings: Record<string, string>) => {
    const oldMappings = mappings
    setMappings(newMappings)

    // Find added/changed mappings
    for (const [alias, canonical] of Object.entries(newMappings)) {
      if (oldMappings[alias] !== canonical) {
        await saveMapping(alias, canonical)
      }
    }

    // Find deleted mappings
    for (const alias of Object.keys(oldMappings)) {
      if (!(alias in newMappings)) {
        await deleteMappingFromDb(alias)
      }
    }
  }

  const handleAddMapping = async () => {
    if (selectedPlayers.length === 0 || !canonicalName) {
      return
    }

    const newMappings = { ...mappings }
    let addedCount = 0

    for (const player of selectedPlayers) {
      if (player !== canonicalName) {
        newMappings[player] = canonicalName
        addedCount++
      }
    }

    if (addedCount === 0) {
      alert('No mappings added. Make sure to select at least 2 different player names, then set the canonical name.')
      return
    }

    setSaving(true)
    await saveMappings(newMappings)
    setSaving(false)
    setSelectedPlayers([])
    setCanonicalName('')
  }

  const handleUpdateMapping = async (alias: string) => {
    if (!editValue) return

    const newMappings = { ...mappings }
    newMappings[alias] = editValue
    setSaving(true)
    await saveMappings(newMappings)
    setSaving(false)
    setEditingAlias(null)
    setEditValue('')
  }

  const handleDeleteMapping = async (alias: string) => {
    const newMappings = { ...mappings }
    delete newMappings[alias]
    setSaving(true)
    await saveMappings(newMappings)
    setSaving(false)
  }

  const togglePlayerSelection = (player: string) => {
    if (selectedPlayers.includes(player)) {
      setSelectedPlayers(selectedPlayers.filter(p => p !== player))
    } else {
      setSelectedPlayers([...selectedPlayers, player])
      // If this is the first selection, set it as the canonical name
      if (selectedPlayers.length === 0) {
        setCanonicalName(player)
      }
    }
  }

  // Filter players based on search
  const filteredPlayers = allPlayers.filter(player =>
    player.toLowerCase().includes(searchFilter.toLowerCase())
  )

  // Group mappings by canonical name for display
  const groupedMappings: Record<string, string[]> = {}
  Object.entries(mappings).forEach(([alias, canonical]) => {
    if (!groupedMappings[canonical]) {
      groupedMappings[canonical] = []
    }
    groupedMappings[canonical].push(alias)
  })

  // Issues come from the server scan (/api/player-name-issues), which is
  // mapping-aware — groups already reconciled by a mapping are excluded, so the
  // old "found N / already fixed" contradiction can't happen.
  const caseIssues = issues.filter(i => i.issue_type === 'case')
  const splitKeyIssues = issues.filter(i => i.issue_type === 'split_key')

  // Fix All: write a non-destructive mapping (variant → canonical) for every
  // auto-fixable 'case' issue, then rescan so the list + badge clear instantly.
  const handleAutoFixCapitalization = async () => {
    const newMappings = { ...mappings }
    let addedCount = 0

    for (const issue of caseIssues) {
      const canonical = issue.suggested_canonical
      for (const variant of issue.variants) {
        if (variant !== canonical && newMappings[variant] !== canonical) {
          newMappings[variant] = canonical
          addedCount++
        }
      }
    }

    if (addedCount === 0) return

    setSaving(true)
    await saveMappings(newMappings)
    await loadIssues() // rescan → resolved groups drop out
    setSaving(false)
  }

  // Request confirmation before updating database
  const requestDatabaseUpdate = (mappingsToUpdate: Record<string, string>, description: string) => {
    setPendingUpdate(mappingsToUpdate)
    setUpdateDescription(description)
    setConfirmDialogOpen(true)
  }

  // Actually update the database after confirmation
  const executeDbUpdate = async () => {
    if (!pendingUpdate) return

    setUpdating(true)
    setConfirmDialogOpen(false)

    try {
      const response = await authFetch('/api/update-player-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings: pendingUpdate }),
      })

      const data = await response.json()

      if (response.ok) {
        alert(`Success! Updated ${data.totalUpdated} records in the database.`)
        // Reload data to reflect changes
        loadData()
      } else {
        alert(`Error: ${data.error || 'Failed to update database'}`)
      }
    } catch (error) {
      console.error('Error updating database:', error)
      alert('Failed to update database. Check console for details.')
    } finally {
      setUpdating(false)
      setPendingUpdate(null)
    }
  }

  // Update all mappings in the database
  const handleUpdateDatabaseAll = () => {
    if (Object.keys(mappings).length === 0) {
      alert('No mappings to apply. Add some mappings first.')
      return
    }
    requestDatabaseUpdate(
      mappings,
      `This will update ALL ${Object.keys(mappings).length} player name mappings in the database.`
    )
  }

  // Update a single canonical group in the database
  const handleUpdateDatabaseGroup = (canonical: string, aliases: string[]) => {
    const groupMappings: Record<string, string> = {}
    for (const alias of aliases) {
      groupMappings[alias] = canonical
    }
    requestDatabaseUpdate(
      groupMappings,
      `This will rename ${aliases.length} player name(s) to "${canonical}" in the database.`
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Standardize Player Names</DialogTitle>
          <DialogDescription>
            Select multiple player name variations and combine them into a single canonical name.
            This helps ensure consistent player names across the database.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Name-issue scan results */}
            {loadingIssues ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-lg p-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Scanning for name inconsistencies…
              </div>
            ) : (
              <>
                {caseIssues.length > 0 && (
                  <div className="border rounded-lg p-4 bg-yellow-500/10 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="font-medium">Auto-fixable name variants</h3>
                        <p className="text-sm text-muted-foreground">
                          Found {caseIssues.length} player{caseIssues.length !== 1 ? 's' : ''} recorded under more than one
                          spelling (capitalization, extra spaces, or typos). Fix All maps each variant to the
                          suggested canonical name — this is non-destructive and clears instantly.
                        </p>
                      </div>
                      <Button onClick={handleAutoFixCapitalization} variant="outline" disabled={saving}>
                        {saving ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Fixing…
                          </>
                        ) : (
                          `Fix All (${caseIssues.length})`
                        )}
                      </Button>
                    </div>
                    <ScrollArea className="max-h-[160px]">
                      <div className="space-y-1 pr-2">
                        {caseIssues.map((issue) => (
                          <div key={issue.normalized_name} className="text-sm flex flex-wrap items-center gap-1">
                            <span className="font-mono text-muted-foreground">
                              {issue.variants.filter(v => v !== issue.suggested_canonical).map(v => `"${v}"`).join(', ')}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-medium">{issue.suggested_canonical}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {splitKeyIssues.length > 0 && (
                  <div className="border rounded-lg p-4 bg-orange-500/10 space-y-2">
                    <div>
                      <h3 className="font-medium">Needs review: same name, different player keys</h3>
                      <p className="text-sm text-muted-foreground">
                        {splitKeyIssues.length} name{splitKeyIssues.length !== 1 ? 's' : ''} appear under more than one
                        player key — usually the same person assigned a new key in an older season, but occasionally two
                        different people. These are <strong>not</strong> auto-fixed; use the combine tool below if they
                        are the same person.
                      </p>
                    </div>
                    <ScrollArea className="max-h-[120px]">
                      <div className="space-y-1 pr-2">
                        {splitKeyIssues.map((issue) => (
                          <div key={issue.normalized_name} className="text-sm">
                            <span className="font-medium">{issue.suggested_canonical}</span>
                            <span className="text-muted-foreground"> — appears under multiple keys</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {caseIssues.length === 0 && splitKeyIssues.length === 0 && (
                  <div className="border rounded-lg p-4 bg-green-500/10 text-sm">
                    No name inconsistencies found. Everything is standardized. ✓
                  </div>
                )}
              </>
            )}

            {/* Add New Mapping Section */}
            <div className="space-y-4 border rounded-lg p-4">
              <h3 className="font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                Combine Player Names
              </h3>

              <div className="space-y-2">
                <label className="text-sm font-medium">Search and select players to combine</label>
                <Input
                  placeholder="Filter players..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
              </div>

              <ScrollArea className="h-[200px] border rounded-lg p-2">
                <div className="space-y-1">
                  {filteredPlayers.map((player) => {
                    const isSelected = selectedPlayers.includes(player)
                    const isMapped = mappings[player]
                    return (
                      <div
                        key={player}
                        className={`flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-muted/50 ${
                          isSelected ? 'bg-primary/10' : ''
                        } ${isMapped ? 'opacity-50 cursor-not-allowed' : ''}`}
                        onClick={() => !isMapped && togglePlayerSelection(player)}
                      >
                        <Checkbox
                          checked={isSelected}
                          disabled={!!isMapped}
                          className="pointer-events-none"
                        />
                        <span className="flex-1">{player}</span>
                        {isMapped && (
                          <span className="text-xs text-muted-foreground">
                            → {isMapped}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>

              {selectedPlayers.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1">
                    <span className="text-sm font-medium">Selected ({selectedPlayers.length}):</span>
                    {selectedPlayers.map((player) => (
                      <span
                        key={player}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 rounded text-sm"
                      >
                        {player}
                        <X
                          className="h-3 w-3 cursor-pointer hover:text-destructive"
                          onClick={() => togglePlayerSelection(player)}
                        />
                      </span>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Canonical name (all selected will map to this)</label>
                    <Input
                      placeholder="Enter the canonical name"
                      value={canonicalName}
                      onChange={(e) => setCanonicalName(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <Button
                onClick={handleAddMapping}
                disabled={selectedPlayers.length === 0 || !canonicalName || saving}
                className="w-full"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Mapping ({selectedPlayers.length} players → {canonicalName || '...'})
                  </>
                )}
              </Button>
            </div>

            {/* Current Mappings Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-medium">Current Player Mappings</h3>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                    Reload
                  </Button>
                  {Object.keys(mappings).length > 0 && (
                    <Button
                      size="sm"
                      onClick={handleUpdateDatabaseAll}
                      disabled={updating}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <Database className="h-4 w-4 mr-1" />
                      Update Database - All
                    </Button>
                  )}
                </div>
              </div>

              {Object.keys(groupedMappings).length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No player mappings found. Select players above to get started.
                </p>
              ) : (
                <ScrollArea className="h-[300px] border rounded-lg">
                  <div className="p-4 space-y-4">
                    {Object.entries(groupedMappings)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([canonical, aliases]) => (
                        <div
                          key={canonical}
                          className="p-3 border rounded-lg bg-muted/50"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-medium text-lg">{canonical}</div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                {aliases.length} alias{aliases.length !== 1 ? 'es' : ''}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleUpdateDatabaseGroup(canonical, aliases)}
                                disabled={updating}
                                className="h-7 text-xs"
                              >
                                <Database className="h-3 w-3 mr-1" />
                                Update
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {aliases.sort().map((alias) => (
                              <div
                                key={alias}
                                className="flex items-center justify-between py-1 px-2 bg-background rounded"
                              >
                                {editingAlias === alias ? (
                                  <div className="flex-1 flex gap-2">
                                    <Input
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      className="h-8"
                                      placeholder="New canonical name"
                                    />
                                    <Button
                                      size="sm"
                                      onClick={() => handleUpdateMapping(alias)}
                                      disabled={saving}
                                    >
                                      <Save className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setEditingAlias(null)
                                        setEditValue('')
                                      }}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="font-mono text-sm">{alias}</span>
                                    <div className="flex gap-1">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          setEditingAlias(alias)
                                          setEditValue(canonical)
                                        }}
                                        disabled={saving}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleDeleteMapping(alias)}
                                        disabled={saving}
                                      >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    </div>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        )}
      </DialogContent>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update Database</AlertDialogTitle>
            <AlertDialogDescription>
              {updateDescription}
              <br /><br />
              <strong>Are you sure? This action cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDbUpdate}
              disabled={updating}
              className="bg-green-600 hover:bg-green-700"
            >
              {updating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                'Yes, Update Database'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

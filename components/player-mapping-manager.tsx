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
import { X, Plus, Save, Loader2, Pencil, Trash2, Users, Database, ArrowUp } from 'lucide-react'
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
  keys?: { player_key: string; count: number }[]
  canonical_key?: string | null
}

interface KeyMapping {
  id: number
  from_key: string
  to_key: string
  display_name: string | null
  affected_ids?: Record<string, number[]> | null
}

// Applied merges grouped into one identity per canonical (to_key).
interface MergeGroup {
  to_key: string
  display_name: string
  froms: KeyMapping[]
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
  const [keyMappings, setKeyMappings] = useState<KeyMapping[]>([])
  const [mergingKeys, setMergingKeys] = useState(false)
  // Selection + target-picker for merging name-mapping groups together.
  const [selectedCanonicals, setSelectedCanonicals] = useState<string[]>([])
  const [mergeGroupsOpen, setMergeGroupsOpen] = useState(false)

  // Load mappings from localStorage and players from API when dialog opens
  useEffect(() => {
    if (open) {
      loadData()
    }
  }, [open])

  const loadData = async () => {
    setLoading(true)
    setSelectedCanonicals([])
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
    loadKeyMappings()
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

  // Load applied key merges (split_key fixes).
  const loadKeyMappings = async () => {
    try {
      const res = await fetch('/api/player-key-mappings')
      if (res.ok) {
        const data = await res.json()
        setKeyMappings(data.mappings || [])
      }
    } catch (error) {
      console.error('Error loading key mappings:', error)
    }
  }

  // Build the from_key -> to_key merges for one split_key issue.
  const mergesForIssue = (issue: NameIssue) => {
    const canonical = issue.canonical_key || issue.keys?.[0]?.player_key
    if (!canonical || !issue.keys) return []
    return issue.keys
      .filter((k) => k.player_key !== canonical)
      .map((k) => ({ from_key: k.player_key, to_key: canonical, display_name: issue.suggested_canonical }))
  }

  // Apply key merges for all split_key issues (or a single one), then rescan.
  const applyKeyMerges = async (merges: { from_key: string; to_key: string; display_name: string }[]) => {
    if (merges.length === 0) return
    setMergingKeys(true)
    try {
      // Record the merges (non-destructive) …
      for (const m of merges) {
        await authFetch('/api/player-key-mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(m),
        })
      }
      // … then apply them to the database now.
      await authFetch('/api/update-player-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings: merges.map((m) => ({ from_key: m.from_key, to_key: m.to_key })) }),
      })
      await Promise.all([loadIssues(), loadKeyMappings()])
    } catch (error) {
      console.error('Error applying key merges:', error)
      alert('Failed to apply key merges. Check console.')
    } finally {
      setMergingKeys(false)
    }
  }

  const handleMergeAllKeys = () => {
    applyKeyMerges(unmergedSplitIssues.flatMap(mergesForIssue))
  }

  // Undo one or more applied merges (all the from_keys for an identity). The
  // DELETE route surgically restores the affected rows, so a rescan re-splits
  // the name and it reappears in the review list above.
  const handleUndoMerge = async (fromKeys: string[]) => {
    if (fromKeys.length === 0) return
    setMergingKeys(true)
    try {
      for (const from_key of fromKeys) {
        await authFetch('/api/player-key-mappings', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from_key }),
        })
      }
      await Promise.all([loadIssues(), loadKeyMappings()])
    } catch (error) {
      console.error('Error undoing merge:', error)
      alert('Failed to undo merge. Check console.')
    } finally {
      setMergingKeys(false)
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

  const toggleCanonicalSelection = (canonical: string) => {
    setSelectedCanonicals((prev) =>
      prev.includes(canonical) ? prev.filter((c) => c !== canonical) : [...prev, canonical]
    )
  }

  // Merge several name-mapping groups into one canonical name: every selected
  // group's aliases (and the other groups' canonical spellings themselves) are
  // repointed to `target`. Non-destructive — persisted as ordinary mappings.
  const handleMergeGroups = async (target: string) => {
    const newMappings = { ...mappings }
    for (const canonical of selectedCanonicals) {
      for (const alias of groupedMappings[canonical] || []) {
        newMappings[alias] = target
      }
      // The group's own canonical spelling becomes an alias of the target.
      if (canonical !== target) newMappings[canonical] = target
    }
    // Never leave a name mapped to itself.
    if (newMappings[target] === target) delete newMappings[target]

    setMergeGroupsOpen(false)
    setSaving(true)
    await saveMappings(newMappings)
    setSaving(false)
    setSelectedCanonicals([])
  }

  // Promote one of a group's linked names to be the canonical: the old canonical
  // (and the other aliases) repoint to it, and it stops being an alias of itself.
  const handlePromoteToCanonical = async (oldCanonical: string, promotedAlias: string) => {
    const target = promotedAlias.replace(/\s+/g, ' ').trim()
    if (!target || target === oldCanonical) return
    const newMappings = { ...mappings }
    for (const alias of groupedMappings[oldCanonical] || []) {
      if (alias === promotedAlias || alias === target) delete newMappings[alias]
      else newMappings[alias] = target
    }
    newMappings[oldCanonical] = target
    if (newMappings[target] === target) delete newMappings[target]
    // Selection is keyed by canonical name; the group just got renamed, so carry
    // any existing selection over to the new canonical (otherwise the ticked box
    // appears to clear because it no longer matches a rendered group).
    setSelectedCanonicals((prev) =>
      prev.includes(oldCanonical)
        ? Array.from(new Set(prev.map((c) => (c === oldCanonical ? target : c))))
        : prev
    )
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

  // Applied merges, grouped into one identity per canonical key. This is the
  // durable record of "already merged" — a merged name drops out of the live
  // scan (its rows now share one key), so we reconstruct it from here.
  const mergeGroups: MergeGroup[] = (() => {
    const byTo = new Map<string, MergeGroup>()
    for (const km of keyMappings) {
      let g = byTo.get(km.to_key)
      if (!g) {
        g = { to_key: km.to_key, display_name: km.display_name || '', froms: [] }
        byTo.set(km.to_key, g)
      }
      if (!g.display_name && km.display_name) g.display_name = km.display_name
      g.froms.push(km)
    }
    return Array.from(byTo.values()).sort((a, b) => a.display_name.localeCompare(b.display_name))
  })()

  // A split_key issue is "unmerged" until every non-canonical key has a merge
  // recorded. (Fully merged ones normally vanish from the scan; this also guards
  // partially-merged groups from showing a stale "Merge" action.)
  const mergedFromKeys = new Set(keyMappings.map(k => k.from_key))
  const unmergedSplitIssues = splitKeyIssues.filter(issue => {
    const canonical = issue.canonical_key || issue.keys?.[0]?.player_key
    const others = (issue.keys || []).filter(k => k.player_key !== canonical)
    return others.length > 0 && !others.every(k => mergedFromKeys.has(k.player_key))
  })

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

  // Apply all mappings to the raw DB rows immediately. Not required for
  // correctness — the nightly sync-data cron re-applies every mapping — this is
  // just an "apply now" shortcut instead of waiting for the next sync.
  const handleUpdateDatabaseAll = () => {
    if (Object.keys(mappings).length === 0) {
      alert('No mappings to apply. Add some mappings first.')
      return
    }
    requestDatabaseUpdate(
      mappings,
      `This applies all ${Object.keys(mappings).length} player name mappings to the database now. They also apply automatically on the nightly sync.`
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

                {(unmergedSplitIssues.length > 0 || mergeGroups.length > 0) && (
                  <div className="border rounded-lg p-4 bg-orange-500/10 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-medium">Same name, different player keys</h3>
                        <p className="text-sm text-muted-foreground">
                          {unmergedSplitIssues.length} name{unmergedSplitIssues.length !== 1 ? 's' : ''} appear under more
                          than one player key — usually the same person assigned a new key in an older season, but
                          occasionally two different people. Merge only when it&apos;s the same person; each merge is
                          reversible with the trash icon.
                        </p>
                        {mergeGroups.length > 0 && (
                          <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                            ✓ {mergeGroups.length} already merged — scroll the list to review or undo any of them.
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={handleMergeAllKeys}
                        variant="outline"
                        disabled={mergingKeys || unmergedSplitIssues.length === 0}
                      >
                        {mergingKeys ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Merging…
                          </>
                        ) : (
                          `Merge All (${unmergedSplitIssues.length})`
                        )}
                      </Button>
                    </div>
                    <ScrollArea className="h-[300px]">
                      <div className="space-y-1 pr-2">
                        {unmergedSplitIssues.map((issue) => (
                          <div key={issue.normalized_name} className="text-sm flex items-center justify-between gap-2">
                            <span>
                              <span className="font-medium">{issue.suggested_canonical}</span>
                              <span className="text-muted-foreground">
                                {' '}— {issue.keys?.length ?? 2} keys
                                {issue.keys ? ` (${issue.keys.map((k) => k.count).join(' / ')} rows)` : ''}
                              </span>
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              disabled={mergingKeys}
                              onClick={() => applyKeyMerges(mergesForIssue(issue))}
                            >
                              Merge
                            </Button>
                          </div>
                        ))}
                        {/* Already-merged identities (reconstructed from recorded merges). */}
                        {mergeGroups.map((g) => (
                          <div key={g.to_key} className="text-sm flex items-center justify-between gap-2">
                            <span>
                              <span className="font-medium">{g.display_name || '(unknown)'}</span>
                              <span className="text-muted-foreground">
                                {' '}— {g.froms.length + 1} keys merged
                              </span>
                            </span>
                            <div className="flex items-center gap-1">
                              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
                                already merged
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                disabled={mergingKeys}
                                title="Undo this merge"
                                onClick={() => handleUndoMerge(g.froms.map((f) => f.from_key))}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {caseIssues.length === 0 && unmergedSplitIssues.length === 0 && mergeGroups.length === 0 && (
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
                <div>
                  <h3 className="font-medium">Current Player Mappings</h3>
                  <p className="text-xs text-muted-foreground">
                    Tick two or more names and press Merge to combine them into one. Mappings apply automatically on the
                    nightly sync; use “Apply now” only to update the database immediately.
                  </p>
                </div>
                <div className="flex gap-2">
                  {selectedCanonicals.length >= 2 && (
                    <Button size="sm" variant="outline" onClick={() => setMergeGroupsOpen(true)} disabled={saving}>
                      <Users className="h-4 w-4 mr-1" />
                      Merge {selectedCanonicals.length}
                    </Button>
                  )}
                  {selectedCanonicals.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setSelectedCanonicals([])} disabled={saving}>
                      Clear
                    </Button>
                  )}
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
                      Apply now
                    </Button>
                  )}
                </div>
              </div>

              {Object.keys(groupedMappings).length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No player mappings found. Select players above to get started.
                </p>
              ) : (
                <ScrollArea className="h-[320px] border rounded-lg">
                  <div className="p-2 space-y-1">
                    {Object.entries(groupedMappings)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([canonical, aliases]) => (
                        <div key={canonical} className="py-1.5 px-2 bg-muted/50 rounded">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={selectedCanonicals.includes(canonical)}
                              onCheckedChange={() => toggleCanonicalSelection(canonical)}
                              aria-label={`Select ${canonical} for merge`}
                            />
                            <div className="font-medium truncate flex-1">{canonical}</div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {aliases.length} alias{aliases.length !== 1 ? 'es' : ''}
                            </span>
                          </div>
                          <div className="mt-0.5 space-y-0.5">
                            {aliases.sort().map((alias) => (
                              <div key={alias} className="flex items-center justify-between gap-2 pl-2">
                                {editingAlias === alias ? (
                                  <div className="flex-1 flex gap-1">
                                    <Input
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      className="h-7 text-xs"
                                      placeholder="New canonical name"
                                    />
                                    <Button
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => handleUpdateMapping(alias)}
                                      disabled={saving}
                                    >
                                      <Save className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 w-7 p-0"
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
                                    <span className="font-mono text-xs text-muted-foreground truncate">{alias}</span>
                                    <div className="flex gap-0.5 shrink-0">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 w-6 p-0"
                                        title="Make this the canonical name"
                                        onClick={() => handlePromoteToCanonical(canonical, alias)}
                                        disabled={saving}
                                      >
                                        <ArrowUp className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 w-6 p-0"
                                        title="Edit which name this maps to"
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
                                        className="h-6 w-6 p-0"
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

            {/* Merged by player key — the applied key merges, shown alongside the
                name mappings. Delete (trash) surgically undoes the merge. */}
            {mergeGroups.length > 0 && (
              <div className="space-y-2">
                <div>
                  <h3 className="font-medium">Merged by player key ({mergeGroups.length})</h3>
                  <p className="text-xs text-muted-foreground">
                    Separate player keys combined into one identity (from the split-key review above). Removing a merge
                    restores the affected rows to their original keys and stops it re-applying on the nightly sync.
                  </p>
                </div>
                <ScrollArea className="h-[320px] border rounded-lg">
                  <div className="p-2 space-y-1">
                    {mergeGroups.map((g) => (
                      <div
                        key={g.to_key}
                        className="flex items-center justify-between gap-2 py-1.5 px-2 bg-muted/50 rounded"
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">{g.display_name || '(unknown)'}</div>
                          <div className="font-mono text-[10px] leading-tight text-muted-foreground truncate">
                            {g.to_key.slice(0, 8)}… ←{' '}
                            {g.froms.map((f) => `${f.from_key.slice(0, 8)}…`).join(', ')}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {g.froms.length + 1} keys
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            disabled={mergingKeys}
                            title="Undo this merge"
                            onClick={() => handleUndoMerge(g.froms.map((f) => f.from_key))}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
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

      {/* Merge-groups target picker: choose which selected name to keep. */}
      <Dialog open={mergeGroupsOpen} onOpenChange={setMergeGroupsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Merge {selectedCanonicals.length} names into one</DialogTitle>
            <DialogDescription>
              Pick the name to keep. Every other selected name (and its aliases) will map to it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            {selectedCanonicals
              .slice()
              .sort((a, b) => a.localeCompare(b))
              .map((canonical) => {
                const aliasCount = (groupedMappings[canonical] || []).length
                return (
                  <Button
                    key={canonical}
                    variant="outline"
                    className="w-full justify-between"
                    disabled={saving}
                    onClick={() => handleMergeGroups(canonical)}
                  >
                    <span className="truncate">{canonical}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      keep this{aliasCount ? ` · ${aliasCount} alias${aliasCount !== 1 ? 'es' : ''}` : ''}
                    </span>
                  </Button>
                )
              })}
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

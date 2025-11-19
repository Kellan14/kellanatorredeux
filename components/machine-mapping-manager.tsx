'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X, Plus, Save, Loader2, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface MachineMappingManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MachineMappingManager({
  open,
  onOpenChange,
}: MachineMappingManagerProps) {
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [allMachines, setAllMachines] = useState<string[]>([])
  const [newAlias, setNewAlias] = useState('')
  const [newStandardized, setNewStandardized] = useState('')
  const [selectedMachine, setSelectedMachine] = useState<string>('')
  const [editingAlias, setEditingAlias] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Load mappings and machines when dialog opens
  useEffect(() => {
    if (open) {
      loadMappings()
    }
  }, [open])

  const loadMappings = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/machine-mappings')
      const data = await response.json()
      setMappings(data.mappings || {})
      setAllMachines(data.allMachines || [])
    } catch (error) {
      console.error('Error loading machine mappings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddMapping = async () => {
    if (!newAlias || !newStandardized) return

    setSaving(true)
    try {
      const response = await fetch('/api/machine-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alias: newAlias,
          standardized: newStandardized,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setMappings(data.mappings)
        setNewAlias('')
        setNewStandardized('')
        setSelectedMachine('')
      }
    } catch (error) {
      console.error('Error adding mapping:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateMapping = async (alias: string) => {
    if (!editValue) return

    setSaving(true)
    try {
      const response = await fetch('/api/machine-mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alias,
          standardized: editValue,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setMappings(data.mappings)
        setEditingAlias(null)
        setEditValue('')
      }
    } catch (error) {
      console.error('Error updating mapping:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteMapping = async (alias: string) => {
    setSaving(true)
    try {
      const response = await fetch(`/api/machine-mappings?alias=${encodeURIComponent(alias)}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        const data = await response.json()
        setMappings(data.mappings)
      }
    } catch (error) {
      console.error('Error deleting mapping:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleSelectMachine = (machine: string) => {
    setSelectedMachine(machine)
    setNewAlias(machine)
    setNewStandardized(machine)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Standardize Machines</DialogTitle>
          <DialogDescription>
            Create mappings from machine aliases to standardized names.
            This helps ensure consistent machine names across the database.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Add New Mapping Section */}
            <div className="space-y-4 border rounded-lg p-4">
              <h3 className="font-medium">Add New Machine Mapping</h3>

              <div className="space-y-2">
                <label className="text-sm font-medium">Select a machine from the database</label>
                <Select value={selectedMachine} onValueChange={handleSelectMachine}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a machine..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {allMachines.map((machine) => (
                      <SelectItem key={machine} value={machine}>
                        {machine}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Alias (from database)</label>
                  <Input
                    placeholder="e.g., bksor"
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Standardized name</label>
                  <Input
                    placeholder="e.g., BlackKnight"
                    value={newStandardized}
                    onChange={(e) => setNewStandardized(e.target.value)}
                  />
                </div>
              </div>

              <Button
                onClick={handleAddMapping}
                disabled={!newAlias || !newStandardized || saving}
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
                    Add Mapping
                  </>
                )}
              </Button>
            </div>

            {/* Current Mappings Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Current Machine Mappings ({Object.keys(mappings).length})</h3>
                <Button variant="outline" size="sm" onClick={loadMappings} disabled={loading}>
                  Reload
                </Button>
              </div>

              {Object.keys(mappings).length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No machine mappings found. Add one above to get started.
                </p>
              ) : (
                <ScrollArea className="h-[400px] border rounded-lg">
                  <div className="p-4 space-y-2">
                    {Object.entries(mappings)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([alias, standardized]) => (
                        <div
                          key={alias}
                          className="flex items-center justify-between p-3 border rounded-lg bg-muted/50"
                        >
                          <div className="flex-1 grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Alias</div>
                              <div className="font-mono">{alias}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Standardized</div>
                              {editingAlias === alias ? (
                                <div className="flex gap-2">
                                  <Input
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    className="h-8"
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
                                <div className="font-mono">{standardized}</div>
                              )}
                            </div>
                          </div>

                          {editingAlias !== alias && (
                            <div className="flex gap-2 ml-4">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingAlias(alias)
                                  setEditValue(standardized)
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
                          )}
                        </div>
                      ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

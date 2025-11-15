'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X, Plus, Save, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface VenueMachineListManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  venueName: string
  currentMachines: string[] // The machines currently showing in stats (base + overrides)
}

export function VenueMachineListManager({
  open,
  onOpenChange,
  venueName,
  currentMachines,
}: VenueMachineListManagerProps) {
  const [included, setIncluded] = useState<string[]>([])
  const [excluded, setExcluded] = useState<string[]>([])
  const [addMachineInput, setAddMachineInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [searchResults, setSearchResults] = useState<Array<{ key: string; name: string }>>([])
  const [machinesData, setMachinesData] = useState<Record<string, any>>({})

  // Fetch machines data from API
  useEffect(() => {
    const fetchMachines = async () => {
      try {
        const response = await fetch('/api/machines')
        const data = await response.json()
        setMachinesData(data)
      } catch (error) {
        console.error('Error fetching machines:', error)
      }
    }

    fetchMachines()
  }, [])

  // Load current overrides when dialog opens
  useEffect(() => {
    if (open && venueName) {
      loadVenueMachineLists()
    }
  }, [open, venueName])

  // Search for machines as user types
  useEffect(() => {
    if (addMachineInput.length >= 2 && Object.keys(machinesData).length > 0) {
      const allMachines = Object.values(machinesData) as Array<{ key: string; name: string }>
      const searchLower = addMachineInput.toLowerCase()
      const results = allMachines.filter(
        (m) =>
          m.name.toLowerCase().includes(searchLower) ||
          m.key.toLowerCase().includes(searchLower)
      ).slice(0, 10) // Limit to 10 results
      setSearchResults(results)
    } else {
      setSearchResults([])
    }
  }, [addMachineInput, machinesData])

  const loadVenueMachineLists = async () => {
    try {
      const response = await fetch('/api/venue-machine-lists')
      const data = await response.json()
      const venueOverrides = data.lists[venueName.toLowerCase()] || { included: [], excluded: [] }
      setIncluded(venueOverrides.included || [])
      setExcluded(venueOverrides.excluded || [])
    } catch (error) {
      console.error('Error loading venue machine lists:', error)
    }
  }

  const handleAddToIncluded = (machineKey: string) => {
    if (!included.includes(machineKey)) {
      setIncluded([...included, machineKey])
    }
    // Remove from excluded if it's there
    setExcluded(excluded.filter((m) => m !== machineKey))
    setAddMachineInput('')
    setSearchResults([])
  }

  const handleAddToExcluded = (machineKey: string) => {
    if (!excluded.includes(machineKey)) {
      setExcluded([...excluded, machineKey])
    }
    // Remove from included if it's there
    setIncluded(included.filter((m) => m !== machineKey))
    setAddMachineInput('')
    setSearchResults([])
  }

  const handleRemoveFromIncluded = (machineKey: string) => {
    setIncluded(included.filter((m) => m !== machineKey))
  }

  const handleRemoveFromExcluded = (machineKey: string) => {
    setExcluded(excluded.filter((m) => m !== machineKey))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/venue-machine-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueName,
          included,
          excluded,
        }),
      })

      if (response.ok) {
        // Reload the page to refresh stats with new machine list
        window.location.reload()
      } else {
        console.error('Failed to save venue machine lists')
      }
    } catch (error) {
      console.error('Error saving venue machine lists:', error)
    } finally {
      setSaving(false)
    }
  }

  const getMachineName = (machineKey: string) => {
    const machine = machinesData[machineKey]
    return machine ? machine.name : machineKey
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Manage Machine List: {venueName}</DialogTitle>
          <DialogDescription>
            Add or remove machines from this venue's machine list. Changes will affect statistics calculations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add Machine Search */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Add Machine</label>
            <Input
              placeholder="Search for a machine by name or key..."
              value={addMachineInput}
              onChange={(e) => setAddMachineInput(e.target.value)}
            />
            {searchResults.length > 0 && (
              <ScrollArea className="h-48 border rounded-md p-2">
                <div className="space-y-1">
                  {searchResults.map((machine) => (
                    <div
                      key={machine.key}
                      className="flex items-center justify-between p-2 hover:bg-accent rounded-md"
                    >
                      <span className="text-sm">
                        {machine.name} <span className="text-muted-foreground">({machine.key})</span>
                      </span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddToIncluded(machine.key)}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Include
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddToExcluded(machine.key)}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Exclude
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Included Machines */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Manually Included Machines <Badge variant="secondary">{included.length}</Badge>
            </label>
            <p className="text-xs text-muted-foreground">
              These machines are added to the venue's list even if they don't appear in recent games.
            </p>
            <div className="flex flex-wrap gap-2 min-h-[60px] border rounded-md p-3 bg-muted/30">
              {included.length === 0 ? (
                <span className="text-sm text-muted-foreground">No machines manually included</span>
              ) : (
                included.map((machineKey) => (
                  <Badge key={machineKey} variant="default" className="gap-2">
                    {getMachineName(machineKey)}
                    <button
                      onClick={() => handleRemoveFromIncluded(machineKey)}
                      className="hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))
              )}
            </div>
          </div>

          {/* Excluded Machines */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Manually Excluded Machines <Badge variant="secondary">{excluded.length}</Badge>
            </label>
            <p className="text-xs text-muted-foreground">
              These machines are removed from the venue's list even if they appear in recent games.
            </p>
            <div className="flex flex-wrap gap-2 min-h-[60px] border rounded-md p-3 bg-muted/30">
              {excluded.length === 0 ? (
                <span className="text-sm text-muted-foreground">No machines manually excluded</span>
              ) : (
                excluded.map((machineKey) => (
                  <Badge key={machineKey} variant="destructive" className="gap-2">
                    {getMachineName(machineKey)}
                    <button
                      onClick={() => handleRemoveFromExcluded(machineKey)}
                      className="hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))
              )}
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

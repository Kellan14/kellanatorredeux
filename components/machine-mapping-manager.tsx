'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { AlexLoader } from '@/components/alex-loader'
import { Badge } from '@/components/ui/badge'

interface MachineMappingManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface CanonMachine {
  key: string
  name: string
  displayName: string
  source: 'mnp' | 'local'
}

interface Alias {
  alias: string
  alias_raw: string | null
  canon_key: string
  origin: string
  reason: string | null
}

interface MachineIssue {
  raw_value: string
  table_name: string
  column_name: string
  occurrences: number
  issue_type: 'case' | 'long_form' | 'alias' | 'unmapped' | 'upstream_added' | 'upstream_changed'
  suggested_key: string | null
  confidence: 'exact' | 'likely' | 'unknown'
  seasons: string | null
  venues: string | null
}

const ISSUE_LABEL: Record<MachineIssue['issue_type'], string> = {
  unmapped: 'Not in canon',
  upstream_added: 'New on MNP',
  upstream_changed: 'Renamed on MNP',
  long_form: 'Long form stored',
  case: 'Wrong case',
  alias: 'Via alias',
}

/**
 * Machine canon manager.
 *
 * Shows the canon (short key + long form), the aliases that resolve non-canon
 * spellings, and the scanner's findings. Read-only by design: canon and alias
 * edits go through scripts/seed-machine-*.ts so every row records why it exists
 * and each run is logged to data_provenance.
 */
export function MachineMappingManager({ open, onOpenChange }: MachineMappingManagerProps) {
  const [machines, setMachines] = useState<CanonMachine[]>([])
  const [aliases, setAliases] = useState<Alias[]>([])
  const [issues, setIssues] = useState<MachineIssue[]>([])
  const [scannedAt, setScannedAt] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    if (open) load()
  }, [open])

  const load = async () => {
    setLoading(true)
    try {
      const [canonRes, issuesRes] = await Promise.all([
        fetch('/api/machine-mappings'),
        fetch('/api/machine-name-issues'),
      ])
      if (canonRes.ok) {
        const data = await canonRes.json()
        setMachines(data.machines || [])
        setAliases(data.aliases || [])
      }
      if (issuesRes.ok) {
        const data = await issuesRes.json()
        setIssues(data.issues || [])
        setScannedAt(data.scannedAt || null)
      }
    } catch (error) {
      console.error('Error loading machine canon:', error)
    } finally {
      setLoading(false)
    }
  }

  const rescan = async () => {
    setScanning(true)
    try {
      const res = await fetch('/api/machine-name-issues?refresh=true')
      if (res.ok) {
        const data = await res.json()
        setIssues(data.issues || [])
        setScannedAt(data.scannedAt || null)
      }
    } catch (error) {
      console.error('Error scanning machine names:', error)
    } finally {
      setScanning(false)
    }
  }

  const q = search.trim().toLowerCase()
  const shownMachines = q
    ? machines.filter((m) => m.key.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q))
    : machines
  const aliasesByKey = new Map<string, Alias[]>()
  for (const a of aliases) {
    if (!aliasesByKey.has(a.canon_key)) aliasesByKey.set(a.canon_key, [])
    aliasesByKey.get(a.canon_key)!.push(a)
  }

  const unmapped = issues.filter((i) => i.issue_type === 'unmapped')
  const upstream = issues.filter((i) => i.issue_type.startsWith('upstream'))
  const tidy = issues.filter((i) => !['unmapped', 'upstream_added', 'upstream_changed'].includes(i.issue_type))
  const localCount = machines.filter((m) => m.source === 'local').length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Machine Canon</DialogTitle>
          <DialogDescription>
            Every machine has a short form (what the APIs use) and a long form (shown across the site).
            Source of truth is mondaynightpinball.com/machines.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex justify-center">
            <AlexLoader />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Health summary */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              {unmapped.length === 0 ? (
                <span className="flex items-center gap-2 text-sm font-medium text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Every stored machine name resolves to the canon
                </span>
              ) : (
                <span className="flex items-center gap-2 text-sm font-medium text-red-600">
                  <AlertTriangle className="h-4 w-4" />
                  {unmapped.length} name{unmapped.length === 1 ? '' : 's'} not in the canon
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {machines.length} machines ({localCount} local) · {aliases.length} aliases
                {scannedAt && ` · scanned ${new Date(scannedAt).toLocaleString()}`}
              </span>
              <Button size="sm" variant="outline" className="ml-auto" onClick={rescan} disabled={scanning}>
                {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="ml-2">Rescan</span>
              </Button>
            </div>

            {/* Anything needing a decision */}
            {(unmapped.length > 0 || upstream.length > 0) && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Needs attention</h3>
                <div className="space-y-1">
                  {[...unmapped, ...upstream].map((i, idx) => (
                    <div
                      key={`${i.table_name}-${i.raw_value}-${idx}`}
                      className="flex items-center justify-between rounded border p-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-medium">{i.raw_value}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {i.table_name}
                          {i.occurrences > 0 && ` · ${i.occurrences} row${i.occurrences === 1 ? '' : 's'}`}
                          {i.seasons && ` · ${i.seasons}`}
                        </span>
                      </div>
                      <Badge variant="destructive" className="shrink-0">
                        {ISSUE_LABEL[i.issue_type]}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Non-conforming but resolvable */}
            {tidy.length > 0 && (
              <details className="rounded border p-2">
                <summary className="cursor-pointer text-sm font-semibold">
                  Resolvable spellings ({tidy.length})
                </summary>
                <div className="mt-2 space-y-1">
                  {tidy.map((i, idx) => (
                    <div key={`${i.table_name}-${i.raw_value}-${idx}`} className="flex items-center justify-between text-sm">
                      <span className="truncate">
                        {i.raw_value}
                        <span className="mx-2 text-muted-foreground">→</span>
                        <span className="font-medium">{i.suggested_key}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {ISSUE_LABEL[i.issue_type]} · {i.table_name}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* The canon itself */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Canon</h3>
                <Input
                  placeholder="Search machines..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 max-w-xs"
                />
              </div>
              <ScrollArea className="h-[280px] rounded border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b">
                      <th className="p-2 text-left font-medium">Short</th>
                      <th className="p-2 text-left font-medium">Long (displayed)</th>
                      <th className="p-2 text-left font-medium">Aliases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownMachines.map((m) => {
                      const as = aliasesByKey.get(m.key) || []
                      return (
                        <tr key={m.key} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-mono text-xs">
                            {m.key}
                            {m.source === 'local' && (
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                local
                              </Badge>
                            )}
                          </td>
                          <td className="p-2">{m.displayName}</td>
                          <td className="p-2 text-xs text-muted-foreground">
                            {as.map((a) => a.alias_raw || a.alias).join(', ')}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </ScrollArea>
            </div>

            <p className="text-xs text-muted-foreground">
              Canon and alias edits run through scripts/seed-machine-canon.ts and
              scripts/seed-machine-aliases.ts, so each row records why it exists and every run is
              logged to data_provenance.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

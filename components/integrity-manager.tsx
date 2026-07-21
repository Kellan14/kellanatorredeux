'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

interface IntegrityReport {
  ran_at: string
  scope: string
  healed_names: number
  healed_keys: number
  healed_sublinks: number
  missing_total: number
  orphan_total: number
  duplicate_total: number
  ok: boolean
  gameless_total?: number
  seasons: {
    season: number
    source?: 'archive' | 'reference' | 'none'
    dbCount: number
    refCount?: number
    missing: string[]
    orphan: string[]
    gameless?: string[]
    unverified?: boolean
  }[]
  missing: { season: number; match_key: string }[]
  orphan: { season: number; match_key: string }[]
  duplicates: { match_key: string; round_number: number; game_number: number; count: number }[]
  triggered_by: string | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function IntegrityManager({ open, onOpenChange }: Props) {
  const [report, setReport] = useState<IntegrityReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState<'current' | 'full' | null>(null)
  const [neverRun, setNeverRun] = useState(false)

  useEffect(() => {
    if (open) loadReport()
  }, [open])

  const loadReport = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/integrity-check?read=true')
      const data = await res.json()
      setReport(data.report || null)
      setNeverRun(!data.report)
    } catch (e) {
      console.error('Error loading integrity report:', e)
    } finally {
      setLoading(false)
    }
  }

  const runCheck = async (scope: 'current' | 'full') => {
    setRunning(scope)
    try {
      const res = await authFetch(`/api/integrity-check?scope=${scope}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`Error: ${err.error || res.statusText}`)
        return
      }
      const data = await res.json()
      setReport(data.report || null)
      setNeverRun(false)
    } catch (e) {
      console.error('Integrity check failed:', e)
      alert('Integrity check failed. Check console.')
    } finally {
      setRunning(null)
    }
  }

  const stat = (label: string, value: number, bad?: boolean) => (
    <div className={`rounded-lg border p-3 ${bad && value > 0 ? 'bg-red-500/10' : 'bg-muted/40'}`}>
      <div className={`text-2xl font-bold ${bad && value > 0 ? 'text-red-600' : ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Data Integrity</DialogTitle>
          <DialogDescription>
            Re-applies every recorded edit (name mappings, key merges, sub-links) and reconciles the database against the
            GitHub match archive (seasons 14+) and the historical reference table (seasons 2–12). Runs automatically
            Sunday &amp; Tuesday mornings; you can also run it now.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button onClick={() => runCheck('current')} disabled={!!running} variant="outline" size="sm">
            {running === 'current' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Run current season
          </Button>
          <Button onClick={() => runCheck('full')} disabled={!!running} size="sm" className="bg-green-600 hover:bg-green-700">
            {running === 'full' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Run full check
          </Button>
          {running === 'full' && <span className="text-xs text-muted-foreground self-center">Full check scans every season against GitHub — this can take a minute…</span>}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
        ) : neverRun ? (
          <div className="border rounded-lg p-4 text-sm text-muted-foreground">No integrity check has run yet. Click “Run full check”.</div>
        ) : report ? (
          <div className="space-y-4">
            <div className={`flex items-center gap-2 rounded-lg p-3 ${report.ok ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
              {report.ok ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}
              <div className="text-sm">
                <div className="font-medium">{report.ok ? 'Database matches the archive + edit history.' : 'Discrepancies found — see below.'}</div>
                <div className="text-xs text-muted-foreground">
                  Last run {new Date(report.ran_at).toLocaleString()} · {report.scope} · {report.triggered_by || 'cron'}
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-1">Edits re-applied (drift healed this run)</h4>
              <div className="grid grid-cols-3 gap-2">
                {stat('name rows', report.healed_names)}
                {stat('key rows', report.healed_keys)}
                {stat('sub-link rows', report.healed_sublinks)}
              </div>
            </div>

            {(() => {
              const gamelessTotal = report.gameless_total ?? report.seasons.reduce((n, s) => n + (s.gameless?.length || 0), 0)
              const unverified = report.seasons.filter((s) => s.unverified).map((s) => s.season)
              return (
                <>
                  <div>
                    <h4 className="text-sm font-medium mb-1">Match coverage</h4>
                    <div className="grid grid-cols-4 gap-2">
                      {stat('missing', report.missing_total, true)}
                      {stat('orphan', report.orphan_total, true)}
                      {stat('duplicate games', report.duplicate_total, true)}
                      {stat('gameless', gamelessTotal)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Missing/orphan/duplicates are problems. “Gameless” = forfeits/byes recorded with no games (fine).
                      {unverified.length > 0 && ` Seasons with no reference source (unverified): ${unverified.join(', ')}.`}
                    </p>
                  </div>

                  {/* Per-season source + counts */}
                  <div>
                    <h4 className="text-sm font-medium mb-1">By season</h4>
                    <ScrollArea className="max-h-[180px] border rounded-lg">
                      <div className="p-2 space-y-0.5 text-xs">
                        {report.seasons.slice().sort((a, b) => a.season - b.season).map((s) => {
                          const bad = s.missing.length > 0 || s.orphan.length > 0
                          return (
                            <div key={s.season} className="flex items-center justify-between gap-2 px-1">
                              <span className="font-medium">S{s.season}</span>
                              <span className="text-muted-foreground">{s.source ?? '—'}</span>
                              <span className="flex-1 text-right">
                                {s.dbCount}/{s.refCount ?? 0} matches
                                {bad && <span className="text-red-600"> · {s.missing.length} missing · {s.orphan.length} orphan</span>}
                                {s.unverified && <span className="text-amber-600"> · unverified</span>}
                                {(s.gameless?.length || 0) > 0 && <span className="text-muted-foreground"> · {s.gameless!.length} gameless</span>}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  {report.missing_total > 0 && (
                    <Detail title="Missing (in source, not in DB)" items={report.missing.map((m) => `S${m.season} · ${m.match_key}`)} />
                  )}
                  {report.orphan_total > 0 && (
                    <Detail title="Orphan (in DB, not in source)" items={report.orphan.map((o) => `S${o.season} · ${o.match_key}`)} />
                  )}
                  {report.duplicate_total > 0 && (
                    <Detail title="Duplicate games" items={report.duplicates.map((d) => `${d.match_key} r${d.round_number} g${d.game_number} ×${d.count}`)} />
                  )}
                </>
              )
            })()}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Detail({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-sm font-medium mb-1">{title} ({items.length})</h4>
      <ScrollArea className="max-h-[160px] border rounded-lg">
        <div className="p-2 space-y-0.5 font-mono text-xs">
          {items.map((it, i) => <div key={i}>{it}</div>)}
        </div>
      </ScrollArea>
    </div>
  )
}

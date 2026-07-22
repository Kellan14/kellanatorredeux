'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ArrowUpDown } from 'lucide-react'
import { AlexLoader } from '@/components/alex-loader'
import { getMachineDisplayName } from '@/lib/machine-mappings'

interface Venue {
  key: string
  name: string
  machines?: string[]
}

interface CompareCell {
  venueAvg: number
  gameCount: number
  topScores: Array<{
    rank: number
    player: string
    team_key: string | null
    score: number
    matchKey: string | null
  }>
}

interface CompareRow {
  machine: string
  perVenue: Record<string, CompareCell>
}

type SortKey = 'machine' | { type: 'avg' | 'top' | 'games'; venue: string }

export default function CompareVenuesPage() {
  const [allVenues, setAllVenues] = useState<Venue[]>([])
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([20, 21, 22, 23])
  const [selected, setSelected] = useState<string[]>([])
  const [seasonStart, setSeasonStart] = useState(20)
  const [seasonEnd, setSeasonEnd] = useState(23)
  const [metric, setMetric] = useState<'mean' | 'median' | 'trimmed'>('mean')
  const [twcRosterOnly, setTwcRosterOnly] = useState(false)
  // TWC roster cached after first fetch so toggling on/off doesn't re-fetch.
  const [twcRoster, setTwcRoster] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<{
    venues: string[]
    sharedMachines: string[]
    rows: CompareRow[]
  } | null>(null)
  const [sort, setSort] = useState<SortKey>('machine')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Load venue list + available seasons on mount.
  useEffect(() => {
    const load = async () => {
      try {
        const [vRes, sRes] = await Promise.all([
          fetch('/api/venues'),
          fetch('/api/seasons'),
        ])
        if (vRes.ok) {
          const v = await vRes.json()
          setAllVenues(v.venues || [])
        }
        if (sRes.ok) {
          const s = await sRes.json()
          if (Array.isArray(s.seasons) && s.seasons.length > 0) {
            setAvailableSeasons(s.seasons)
            const max = s.max || s.seasons[s.seasons.length - 1]
            setSeasonEnd(max)
          }
        }
      } catch (err) {
        console.error('Initial load failed:', err)
      }
    }
    load()
  }, [])

  // Lazy-load TWC roster the first time the toggle flips on.
  useEffect(() => {
    if (!twcRosterOnly || twcRoster !== null) return
    const load = async () => {
      try {
        const currentSeason = availableSeasons.length > 0 ? Math.max(...availableSeasons) : seasonEnd
        const res = await fetch(`/api/team-roster?team=${encodeURIComponent('The Wrecking Crew')}&season=${currentSeason}&showSubs=false`)
        if (res.ok) {
          const body = await res.json()
          setTwcRoster((body.players || []).map((p: any) => p.name))
        }
      } catch (err) {
        console.error('Failed to load TWC roster:', err)
      }
    }
    load()
  }, [twcRosterOnly, twcRoster, availableSeasons, seasonEnd])

  // Refetch comparison whenever the inputs change and we have at least 2 venues.
  useEffect(() => {
    if (selected.length < 2) {
      setData(null)
      return
    }
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          venues: selected.join(','),
          seasonStart: String(seasonStart),
          seasonEnd: String(seasonEnd),
          topN: '3',
          metric,
        })
        if (twcRosterOnly && twcRoster && twcRoster.length > 0) {
          params.set('rosterPlayers', twcRoster.join(','))
        }
        const res = await fetch(`/api/compare-venues?${params}`)
        const body = await res.json()
        if (!res.ok) {
          setError(body?.error || 'Failed to load comparison')
          setData(null)
          return
        }
        setData(body)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setData(null)
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [selected, seasonStart, seasonEnd, metric, twcRosterOnly, twcRoster])

  const toggleVenue = (name: string) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((v) => v !== name) : [...prev, name]
    )
  }

  const handleSort = (key: SortKey) => {
    const sameKey =
      typeof key === 'string'
        ? sort === key
        : typeof sort === 'object' && sort.type === key.type && sort.venue === key.venue
    if (sameKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(key)
      setSortDir(typeof key === 'string' ? 'asc' : 'desc')
    }
  }

  const sortedRows = useMemo(() => {
    if (!data) return []
    const rows = [...data.rows]
    rows.sort((a, b) => {
      let av: number | string
      let bv: number | string
      if (sort === 'machine') {
        av = (getMachineDisplayName(a.machine) || a.machine).toLowerCase()
        bv = (getMachineDisplayName(b.machine) || b.machine).toLowerCase()
      } else {
        const cellA = a.perVenue[sort.venue]
        const cellB = b.perVenue[sort.venue]
        if (sort.type === 'avg') {
          av = cellA?.venueAvg || 0
          bv = cellB?.venueAvg || 0
        } else if (sort.type === 'games') {
          av = cellA?.gameCount || 0
          bv = cellB?.gameCount || 0
        } else {
          av = cellA?.topScores?.[0]?.score || 0
          bv = cellB?.topScores?.[0]?.score || 0
        }
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return rows
  }, [data, sort, sortDir])

  // Highlight the cell with the highest venue avg in each row, so the eye
  // can jump straight to "which venue plays this machine biggest".
  const bestVenuePerMachine = useMemo(() => {
    if (!data) return new Map<string, string>()
    const out = new Map<string, string>()
    for (const row of data.rows) {
      let bestVenue = ''
      let bestAvg = 0
      for (const v of data.venues) {
        const cell = row.perVenue[v]
        if (cell && cell.venueAvg > bestAvg) {
          bestAvg = cell.venueAvg
          bestVenue = v
        }
      }
      if (bestVenue) out.set(row.machine, bestVenue)
    }
    return out
  }, [data])

  return (
    <div className="container py-6 md:py-8">
      <div className="mb-4 md:mb-6">
        <h1 className="text-xl md:text-3xl font-bold">Compare Venues</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">
          Pick two or more venues to see venue averages and top scorers on the
          machines they share.
        </p>
      </div>

      {/* Venue picker */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Venues</CardTitle>
          <CardDescription className="text-xs">
            Tick at least two — the table only shows machines that appear at
            every selected venue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {allVenues.length === 0 && (
              <span className="text-sm text-muted-foreground">Loading venues…</span>
            )}
            {allVenues.map((v) => (
              <label key={v.key} className="flex items-center gap-2 text-xs md:text-sm cursor-pointer">
                <Checkbox
                  checked={selected.includes(v.name)}
                  onCheckedChange={() => toggleVenue(v.name)}
                  className="h-3.5 w-3.5"
                />
                {v.name}
              </label>
            ))}
          </div>

          {/* Season range + metric + roster filter */}
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">Seasons:</label>
              <select
                value={seasonStart}
                onChange={(e) => setSeasonStart(parseInt(e.target.value))}
                className="w-16 px-2 py-1 text-sm border rounded bg-background"
              >
                {availableSeasons.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">to</span>
              <select
                value={seasonEnd}
                onChange={(e) => setSeasonEnd(parseInt(e.target.value))}
                className="w-16 px-2 py-1 text-sm border rounded bg-background"
              >
                {availableSeasons.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">Metric:</label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as 'mean' | 'median' | 'trimmed')}
                className="px-2 py-1 text-sm border rounded bg-background"
                title="Median is most robust to outlier scores; trimmed mean drops the top + bottom 10% before averaging."
              >
                <option value="mean">Mean</option>
                <option value="median">Median (recommended)</option>
                <option value="trimmed">Trimmed mean (middle 80%)</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs md:text-sm cursor-pointer">
              <Checkbox
                checked={twcRosterOnly}
                onCheckedChange={(c) => setTwcRosterOnly(!!c)}
                className="h-3.5 w-3.5"
              />
              Only TWC roster
            </label>

            {selected.length > 0 && (
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected([])}>
                Clear venues
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {selected.length < 2 && (
        <div className="text-center p-12 text-muted-foreground text-sm">
          Select at least two venues above to start comparing.
        </div>
      )}

      {selected.length >= 2 && loading && (
        <div className="flex items-center justify-center p-12">
          <AlexLoader size={44} className="mr-2" />
          <span className="text-sm">Loading comparison…</span>
        </div>
      )}

      {error && (
        <div className="text-center p-6 text-destructive text-sm">{error}</div>
      )}

      {data && !loading && data.sharedMachines.length === 0 && (
        <div className="text-center p-12 text-muted-foreground text-sm">
          No machines are shared across those venues.
        </div>
      )}

      {data && !loading && data.sharedMachines.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {data.sharedMachines.length} shared machine{data.sharedMachines.length === 1 ? '' : 's'}
            </CardTitle>
            <CardDescription className="text-xs">
              Each cell shows the venue {metric === 'mean' ? 'average' : metric === 'median' ? 'median' : 'trimmed mean (middle 80%)'}
              {twcRosterOnly ? ' — limited to current TWC roster scores' : ''}, then the top 3 scores on that machine at that venue.
              Highest value per machine is highlighted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table className="text-xs md:text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50 sticky left-0 bg-background z-10"
                      onClick={() => handleSort('machine')}
                    >
                      <span className="flex items-center gap-1">
                        Machine
                        {sort === 'machine' && <ArrowUpDown className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    {data.venues.map((venue) => (
                      <TableHead key={venue} className="min-w-[260px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{venue}</span>
                          <span className="flex gap-1">
                            <button
                              className="text-[10px] text-muted-foreground hover:text-foreground"
                              onClick={() => handleSort({ type: 'avg', venue })}
                              title="Sort by venue avg"
                            >
                              avg
                            </button>
                            <button
                              className="text-[10px] text-muted-foreground hover:text-foreground"
                              onClick={() => handleSort({ type: 'top', venue })}
                              title="Sort by top score"
                            >
                              top
                            </button>
                            <button
                              className="text-[10px] text-muted-foreground hover:text-foreground"
                              onClick={() => handleSort({ type: 'games', venue })}
                              title="Sort by games played"
                            >
                              n
                            </button>
                          </span>
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((row) => {
                    const bestVenue = bestVenuePerMachine.get(row.machine)
                    return (
                      <TableRow key={row.machine}>
                        <TableCell className="font-medium sticky left-0 bg-background">
                          {getMachineDisplayName(row.machine) || row.machine}
                        </TableCell>
                        {data.venues.map((venue) => {
                          const cell = row.perVenue[venue]
                          const isBest = bestVenue === venue && (cell?.venueAvg || 0) > 0
                          if (!cell || cell.gameCount === 0) {
                            return (
                              <TableCell key={venue} className="text-muted-foreground">—</TableCell>
                            )
                          }
                          return (
                            <TableCell
                              key={venue}
                              className={`align-top ${isBest ? 'bg-green-50 dark:bg-green-950/30' : ''}`}
                            >
                              <div className={`font-semibold ${isBest ? 'text-green-700 dark:text-green-400' : ''}`}>
                                {Math.round(cell.venueAvg).toLocaleString()}
                                {/* gameCount counts every player-score row,
                                    not unique games — a doubles game contributes 4
                                    rows and a singles game 2. Labelled "scores"
                                    so the number is honest. */}
                                <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                                  ({cell.gameCount.toLocaleString()} scores)
                                </span>
                              </div>
                              {cell.topScores.length > 0 && (
                                <ol className="mt-1 space-y-0.5">
                                  {cell.topScores.map((s) => (
                                    <li key={`${s.rank}-${s.player}`} className="text-[11px] flex justify-between gap-2">
                                      <span className="truncate">
                                        <span className="text-muted-foreground tabular-nums">#{s.rank}</span> {s.player}
                                      </span>
                                      <span className="tabular-nums">{Math.round(s.score).toLocaleString()}</span>
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

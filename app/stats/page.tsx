'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChevronUp, ChevronDown, Loader2, ArrowUp, ArrowDown } from 'lucide-react'
import { type MachineStats } from '@/lib/tournament-data'
import { VenueMachineListManager } from '@/components/venue-machine-list-manager'
import { MachineMappingManager } from '@/components/machine-mapping-manager'
import { TwcPlayerAvailability } from '@/components/twc-player-availability'

interface Team {
  key: string
  name: string
}

interface Venue {
  key: string
  name: string
  address: string
  machines: string[]
}

// Column configuration
interface ColumnConfig {
  key: keyof MachineStats | 'machine'
  label: string
  visible: boolean
  order: number
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'machine', label: 'Machine', visible: true, order: 0 },
  { key: 'percentComparison', label: '% Comparison', visible: true, order: 1 },
  { key: 'teamAverage', label: 'Team Avg', visible: true, order: 2 },
  { key: 'twcAverage', label: 'TWC Avg', visible: true, order: 3 },
  { key: 'venueAverage', label: 'Venue Avg', visible: true, order: 4 },
  { key: 'teamHighestScore', label: 'Team High', visible: true, order: 5 },
  { key: 'percentOfVenueAvg', label: '% of V. Avg.', visible: true, order: 6 },
  { key: 'twcPercentOfVenueAvg', label: 'TWC % V. Avg.', visible: true, order: 7 },
  { key: 'timesPlayed', label: 'Times Played', visible: true, order: 8 },
  { key: 'twcTimesPlayed', label: 'TWC Played', visible: true, order: 9 },
  { key: 'timesPicked', label: 'Times Picked', visible: true, order: 10 },
  { key: 'twcTimesPicked', label: 'TWC Picked', visible: true, order: 11 },
  { key: 'pops', label: 'POPS', visible: true, order: 12 },
  { key: 'popsPicking', label: 'POPS Pick', visible: true, order: 13 },
  { key: 'popsResponding', label: 'POPS Resp', visible: true, order: 14 },
  { key: 'twcPops', label: 'TWC POPS', visible: true, order: 15 },
  { key: 'twcPopsPicking', label: 'TWC POPS Pick', visible: true, order: 16 },
  { key: 'twcPopsResponding', label: 'TWC POPS Resp', visible: true, order: 17 },
  { key: 'popsComparison', label: 'POPS Comparison', visible: true, order: 18 },
]

// Helper functions
const formatNumber = (val: number | undefined | null): string => {
  if (val === undefined || val === null || isNaN(val)) return 'N/A'
  return Math.round(val).toLocaleString()
}

const formatPercent = (val: number | undefined | null): string => {
  if (val === undefined || val === null || isNaN(val)) return 'N/A'
  return Math.round(val) + '%'
}

const formatComparison = (val: string | number | undefined): string => {
  if (val === undefined) return 'N/A'
  if (typeof val === 'string') return val
  return Math.round(val).toString()
}

const getCellValue = (stat: MachineStats, key: string): string => {
  if (key === 'machine') return stat.machine

  const value = (stat as any)[key]

  // Format based on column type
  if (key.includes('Comparison')) return formatComparison(value)
  if (key.includes('percent') || key.includes('Percent') || key.includes('pops') || key.includes('Pops')) {
    return formatPercent(value)
  }
  if (key.includes('Average') || key.includes('Score')) return formatNumber(value)
  if (key.includes('times') || key.includes('Times')) return value?.toString() || '0'

  return value?.toString() || 'N/A'
}

export default function StatsPage() {
  // State
  const [venues, setVenues] = useState<Venue[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedVenue, setSelectedVenue] = useState<string>('')
  const [selectedOpponent, setSelectedOpponent] = useState<string>('')
  const [seasonRange, setSeasonRange] = useState<[number, number]>([20, 23])
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([])
  const [machineStats, setMachineStats] = useState<MachineStats[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingDropdowns, setLoadingDropdowns] = useState(true)
  const [includeHistoricalVenues, setIncludeHistoricalVenues] = useState(false)
  const [sortColumn, setSortColumn] = useState<string>('machine')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [columnOptionsOpen, setColumnOptionsOpen] = useState(false)
  const [scoreLimitsOpen, setScoreLimitsOpen] = useState(false)
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS)
  const [scoreLimits, setScoreLimits] = useState<Record<string, number>>({})
  const [newLimitMachine, setNewLimitMachine] = useState('')
  const [newLimitScore, setNewLimitScore] = useState('')
  const [editingLimit, setEditingLimit] = useState<Record<string, string>>({})
  const [teamVenueSpecific, setTeamVenueSpecific] = useState(true)
  const [twcVenueSpecific, setTwcVenueSpecific] = useState(false)
  const [venueListManagerOpen, setVenueListManagerOpen] = useState(false)
  const [machineMappingOpen, setMachineMappingOpen] = useState(false)
  const [hasMachineModifications, setHasMachineModifications] = useState(false)
  const [hasRosterModifications, setHasRosterModifications] = useState(false)
  const [hasTwcRosterModifications, setHasTwcRosterModifications] = useState(false)
  const [includeManualScores, setIncludeManualScores] = useState(false)

  // Player availability
  const [availablePlayers, setAvailablePlayers] = useState<Record<string, boolean>>({})
  const [rosterPlayers, setRosterPlayers] = useState<string[]>([])
  const [subPlayers, setSubPlayers] = useState<string[]>([])

  // Cell details dialog
  const [cellDetailsOpen, setCellDetailsOpen] = useState(false)
  const [selectedCell, setSelectedCell] = useState<{machine: string, column: string} | null>(null)
  const [cellDetails, setCellDetails] = useState<any>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [detailSortColumn, setDetailSortColumn] = useState<string>('score')
  const [detailSortDirection, setDetailSortDirection] = useState<'asc' | 'desc'>('desc')

  // Load column config and score limits
  useEffect(() => {
    const saved = localStorage.getItem('statsColumnConfig')
    if (saved) {
      try {
        setColumns(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to parse saved column config')
      }
    }

    // Load score limits from database
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

    loadScoreLimits()
  }, [])

  // Save column config
  const saveColumnConfig = (newColumns: ColumnConfig[]) => {
    setColumns(newColumns)
    localStorage.setItem('statsColumnConfig', JSON.stringify(newColumns))
  }

  const toggleColumnVisibility = (key: string) => {
    const newColumns = columns.map(col =>
      col.key === key ? { ...col, visible: !col.visible } : col
    )
    saveColumnConfig(newColumns)
  }

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const newColumns = [...columns]
    const targetIndex = direction === 'up' ? index - 1 : index + 1

    if (targetIndex < 0 || targetIndex >= newColumns.length) return

    // Swap
    ;[newColumns[index], newColumns[targetIndex]] = [newColumns[targetIndex], newColumns[index]]

    // Update order values
    newColumns.forEach((col, idx) => {
      col.order = idx
    })

    saveColumnConfig(newColumns)
  }

  const resetColumns = () => {
    saveColumnConfig(DEFAULT_COLUMNS)
  }

  // Score limits management
  const saveScoreLimits = async (newLimits: Record<string, number>) => {
    setScoreLimits(newLimits)
    try {
      await fetch('/api/score-limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limits: newLimits })
      })
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

  // Get visible columns sorted by order
  const visibleColumns = columns.filter(col => col.visible).sort((a, b) => a.order - b.order)

  // Fetch TWC roster on mount
  useEffect(() => {
    const fetchRoster = async () => {
      try {
        const response = await fetch('/api/twc-roster')
        if (response.ok) {
          const data = await response.json()
          setRosterPlayers(data.rosterPlayers || [])
          setSubPlayers(data.subPlayers || [])
          // Set defaults (component will override from localStorage)
          const defaults: Record<string, boolean> = {}
          ;(data.rosterPlayers || []).forEach((p: string) => { defaults[p] = true })
          ;(data.subPlayers || []).forEach((p: string) => { defaults[p] = false })
          setAvailablePlayers(defaults)
        }
      } catch (error) {
        console.error('Error fetching TWC roster:', error)
      }
    }
    fetchRoster()
  }, [])

  // Load venues and teams
  useEffect(() => {
    loadVenuesAndTeams()
  }, [includeHistoricalVenues])

  // Set venue-specific defaults based on venue
  useEffect(() => {
    const isGPA = selectedVenue.toLowerCase().includes('georgetown') &&
                  selectedVenue.toLowerCase().includes('pizza')

    // At GPA: Team = NOT venue-specific, TWC = venue-specific
    // At other venues: Team = venue-specific, TWC = NOT venue-specific
    setTeamVenueSpecific(!isGPA)
    setTwcVenueSpecific(isGPA)
  }, [selectedVenue])

  // Check for modifications when venue changes
  useEffect(() => {
    const checkModifications = async () => {
      if (!selectedVenue) {
        setHasMachineModifications(false)
        setHasRosterModifications(false)
        setHasTwcRosterModifications(false)
        return
      }

      // Check for machine list modifications
      try {
        const response = await fetch('/api/venue-machine-lists')
        const data = await response.json()
        const venueKey = selectedVenue.toLowerCase()
        const venueOverrides = data.lists[venueKey]

        const hasMods = venueOverrides && (
          (venueOverrides.included && venueOverrides.included.length > 0) ||
          (venueOverrides.excluded && venueOverrides.excluded.length > 0)
        )
        setHasMachineModifications(!!hasMods)
      } catch (error) {
        console.error('Error checking machine modifications:', error)
        setHasMachineModifications(false)
      }

      // TODO: Check for roster modifications when implemented
      // For now, these will always be false
      setHasRosterModifications(false)
      setHasTwcRosterModifications(false)
    }

    checkModifications()
  }, [selectedVenue])

  useEffect(() => {
    // Only load stats when venues data is available (needed for machine list)
    if (selectedVenue && selectedOpponent && venues.length > 0) {
      loadStats()
    }
  }, [selectedVenue, selectedOpponent, seasonRange, scoreLimits, teamVenueSpecific, twcVenueSpecific, includeManualScores, availablePlayers, venues])

  const loadVenuesAndTeams = async () => {
    setLoadingDropdowns(true)
    try {
      // Fetch available seasons from database
      const seasonsResponse = await fetch('/api/seasons')
      const seasonsData = await seasonsResponse.json()
      if (seasonsData.seasons && seasonsData.seasons.length > 0) {
        setAvailableSeasons(seasonsData.seasons)
        // Update season range to use latest seasons if current default is outdated
        const maxSeason = seasonsData.max
        if (maxSeason && maxSeason > seasonRange[1]) {
          setSeasonRange([seasonRange[0], maxSeason])
        }
      }

      // If includeHistoricalVenues is false, request only venues with scores in current season
      const currentSeason = seasonsData.max || 23
      const venuesUrl = includeHistoricalVenues
        ? '/api/venues'
        : `/api/venues?season=${currentSeason}`

      const venuesResponse = await fetch(venuesUrl)
      const venuesData = await venuesResponse.json()
      const filteredVenues = venuesData.venues || []

      setVenues(filteredVenues)

      // If includeHistoricalVenues is true, load teams from all seasons
      const teamsUrl = includeHistoricalVenues
        ? '/api/teams'
        : `/api/teams?season=${currentSeason}`

      const teamsResponse = await fetch(teamsUrl)
      const teamsData = await teamsResponse.json()
      setTeams(teamsData.teams || [])

      // Get the most recent TWC match to set defaults
      const latestMatchResponse = await fetch('/api/latest-twc-match')
      const latestMatch = await latestMatchResponse.json()

      // Set venue from latest match
      if (latestMatch.venue) {
        setSelectedVenue(latestMatch.venue)
      } else {
        // Fallback to GPA
        const gpa = filteredVenues.find((v: Venue) =>
          v.name.toLowerCase().includes('georgetown') && v.name.toLowerCase().includes('pizza')
        )
        if (gpa) {
          setSelectedVenue(gpa.name)
        } else if (filteredVenues.length > 0) {
          setSelectedVenue(filteredVenues[0].name)
        }
      }

      // Set opponent from latest match
      if (latestMatch.opponent) {
        setSelectedOpponent(latestMatch.opponent)
      } else {
        // Fallback to first non-TWC team
        const defaultTeam = teamsData.teams.find((t: Team) =>
          !t.name.toLowerCase().includes('wrecking crew')
        )
        if (defaultTeam) {
          setSelectedOpponent(defaultTeam.name)
        }
      }
    } catch (error) {
      console.error('Error loading venues and teams:', error)
    } finally {
      setLoadingDropdowns(false)
    }
  }

  const loadStats = async () => {
    setLoading(true)
    try {
      const seasons = []
      for (let s = seasonRange[0]; s <= seasonRange[1]; s++) {
        seasons.push(s)
      }

      // Call new server-side API that calculates statistics on the server
      // This avoids Vercel's 4.5MB response size limit by returning only final stats (~50KB)
      // Get selected TWC players for filtering
      const selectedTwcPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p])

      const venueMachines = venues.find(v => v.name === selectedVenue)?.machines || []
      const params = new URLSearchParams({
        seasons: seasons.join(','),
        venue: selectedVenue,
        teamName: 'The Wrecking Crew',
        opponentTeam: selectedOpponent,
        teamVenueSpecific: teamVenueSpecific.toString(),
        twcVenueSpecific: twcVenueSpecific.toString(),
        scoreLimits: JSON.stringify(scoreLimits),
        includeManualScores: includeManualScores.toString(),
        ...(venueMachines.length > 0 ? { machines: venueMachines.join(',') } : {})
      })

      // Only pass twcPlayers filter if we have a roster loaded and some are unchecked
      if (selectedTwcPlayers.length > 0 && selectedTwcPlayers.length < Object.keys(availablePlayers).length) {
        params.set('twcPlayers', selectedTwcPlayers.join(','))
      }

      const response = await fetch(`/api/machine-stats?${params}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load machine stats')
      }

      console.log('[stats] Loaded', data.count, 'machine stats from server-side calculation')
      setMachineStats(data.stats || [])
    } catch (error) {
      console.error('Error loading stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const sortedStats = [...machineStats].sort((a, b) => {
    let aVal: any = sortColumn === 'machine' ? a.machine : (a as any)[sortColumn]
    let bVal: any = sortColumn === 'machine' ? b.machine : (b as any)[sortColumn]

    // Special handling for comparison columns (% Comparison, POPS Comparison)
    // Order: '+' (best) > numbers > '-' (worst) > 'N/A'
    if (sortColumn === 'percentComparison' || sortColumn === 'popsComparison') {
      const getValue = (val: any): number => {
        if (val === '+') return Infinity
        if (val === '-') return -Infinity
        if (val === 'N/A' || val === undefined || val === null) return -Infinity - 1
        return typeof val === 'number' ? val : parseFloat(val) || -Infinity - 1
      }

      const aNum = getValue(aVal)
      const bNum = getValue(bVal)
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
    }

    // Regular sorting for other columns
    if (aVal === undefined || aVal === null || aVal === 'N/A') return 1
    if (bVal === undefined || bVal === null || bVal === 'N/A') return -1

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDirection === 'asc'
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal)
    }

    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
  })

  const SortIcon = ({ column }: { column: string }) => {
    if (sortColumn !== column) return null
    return sortDirection === 'asc' ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />
  }

  const handleCellClick = async (machine: string, columnKey: string) => {
    // Don't allow clicking on the machine name column
    if (columnKey === 'machine') return

    setSelectedCell({ machine, column: columnKey })
    setCellDetailsOpen(true)
    setLoadingDetails(true)
    // Reset sort to default (score descending)
    setDetailSortColumn('score')
    setDetailSortDirection('desc')

    try {
      // Map column key to label for API
      const columnLabel = DEFAULT_COLUMNS.find(c => c.key === columnKey)?.label || columnKey

      const seasons = []
      for (let s = seasonRange[0]; s <= seasonRange[1]; s++) {
        seasons.push(s)
      }

      const response = await fetch(
        `/api/cell-details?` +
        `machine=${encodeURIComponent(machine)}` +
        `&column=${encodeURIComponent(columnLabel)}` +
        `&venue=${encodeURIComponent(selectedVenue)}` +
        `&team=${encodeURIComponent(selectedOpponent)}` +
        `&twcTeam=${encodeURIComponent('The Wrecking Crew')}` +
        `&seasonStart=${seasonRange[0]}` +
        `&seasonEnd=${seasonRange[1]}`
      )

      if (response.ok) {
        const data = await response.json()
        setCellDetails(data)
      } else {
        console.error('Failed to fetch cell details')
        setCellDetails(null)
      }
    } catch (error) {
      console.error('Error fetching cell details:', error)
      setCellDetails(null)
    } finally {
      setLoadingDetails(false)
    }
  }

  const handleDetailSort = (column: string) => {
    if (detailSortColumn === column) {
      setDetailSortDirection(detailSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setDetailSortColumn(column)
      setDetailSortDirection(column === 'score' || column === 'points' ? 'desc' : 'asc')
    }
  }

  const DetailSortIcon = ({ column }: { column: string }) => {
    if (detailSortColumn !== column) return null
    return detailSortDirection === 'asc' ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />
  }

  if (loadingDropdowns) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin mr-2" />
            <span>Loading venues and teams...</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-6 gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full md:flex-1">
              <div>
                <label className="text-sm font-medium mb-2 block">Venue</label>
                <Select value={selectedVenue} onValueChange={setSelectedVenue}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select venue" />
                  </SelectTrigger>
                  <SelectContent>
                    {venues.map((venue) => (
                      <SelectItem key={venue.key} value={venue.name}>
                        {venue.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Opponent</label>
                <Select value={selectedOpponent} onValueChange={setSelectedOpponent}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select opponent" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem key={team.key} value={team.name}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Seasons</label>
                <div className="flex gap-2">
                  <Select
                    value={String(seasonRange[0])}
                    onValueChange={(v) => setSeasonRange([parseInt(v), seasonRange[1]])}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSeasons.map(s => (
                        <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="flex items-center">to</span>
                  <Select
                    value={String(seasonRange[1])}
                    onValueChange={(v) => setSeasonRange([seasonRange[0], parseInt(v)])}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSeasons.map(s => (
                        <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Venue-Specific Checkboxes and Options Button */}
            <div className="flex flex-col gap-3 w-full md:w-auto md:ml-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="team-venue-specific"
                    checked={teamVenueSpecific}
                    onCheckedChange={(checked) => setTeamVenueSpecific(!!checked)}
                  />
                  <label
                    htmlFor="team-venue-specific"
                    className="text-xs md:text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {selectedOpponent} - Venue Specific
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="twc-venue-specific"
                    checked={twcVenueSpecific}
                    onCheckedChange={(checked) => setTwcVenueSpecific(!!checked)}
                  />
                  <label
                    htmlFor="twc-venue-specific"
                    className="text-xs md:text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    TWC - Venue Specific
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-historical-venues"
                    checked={includeHistoricalVenues}
                    onCheckedChange={(checked) => setIncludeHistoricalVenues(!!checked)}
                  />
                  <label
                    htmlFor="include-historical-venues"
                    className="text-xs md:text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Include Historical Venues
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-manual-scores"
                    checked={includeManualScores}
                    onCheckedChange={(checked) => setIncludeManualScores(!!checked)}
                  />
                  <label
                    htmlFor="include-manual-scores"
                    className="text-xs md:text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Include Manual Scores
                  </label>
                </div>
              </div>

              {/* Modification Indicators */}
              {(hasMachineModifications || hasRosterModifications || hasTwcRosterModifications) && (
                <div className="flex flex-col gap-1 text-[10px] pb-1">
                  {hasMachineModifications && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_4px_rgba(239,68,68,0.8)]" />
                      <span className="text-red-500 font-medium">machines modified</span>
                    </div>
                  )}
                  {hasRosterModifications && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_4px_rgba(239,68,68,0.8)]" />
                      <span className="text-red-500 font-medium">roster edited</span>
                    </div>
                  )}
                  {hasTwcRosterModifications && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_4px_rgba(239,68,68,0.8)]" />
                      <span className="text-red-500 font-medium">twc roster edited</span>
                    </div>
                  )}
                </div>
              )}

              {/* Column Options Button */}
              <Button
                variant="outline"
                className="w-full md:w-auto text-xs md:text-sm"
                onClick={() => setColumnOptionsOpen(true)}
              >
                Column Options
              </Button>
            </div>

            {/* Column Options Dialog */}
            <Dialog open={columnOptionsOpen} onOpenChange={setColumnOptionsOpen}>
              <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Column Options</DialogTitle>
                  <DialogDescription>
                    Customize columns - show/hide and reorder
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-medium">Column Configuration</h3>
                    <Button variant="outline" size="sm" onClick={resetColumns}>
                      Reset to Default
                    </Button>
                  </div>

                  <div className="border rounded-lg">
                    <div className="grid grid-cols-12 gap-2 p-3 bg-muted font-medium text-sm">
                      <div className="col-span-1">Order</div>
                      <div className="col-span-6">Column Name</div>
                      <div className="col-span-3">Visibility</div>
                      <div className="col-span-2">Move</div>
                    </div>

                    {columns.map((col, index) => (
                      <div key={col.key} className="grid grid-cols-12 gap-2 p-3 border-t items-center hover:bg-muted/50">
                        <div className="col-span-1 text-sm text-muted-foreground">{index + 1}</div>
                        <div className="col-span-6 text-sm font-medium">{col.label}</div>
                        <div className="col-span-3">
                          <Checkbox
                            checked={col.visible}
                            onCheckedChange={() => toggleColumnVisibility(col.key)}
                            disabled={col.key === 'machine'} // Machine column always visible
                          />
                          <span className="ml-2 text-sm">{col.visible ? 'Shown' : 'Hidden'}</span>
                        </div>
                        <div className="col-span-2 flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => moveColumn(index, 'up')}
                            disabled={index === 0}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => moveColumn(index, 'down')}
                            disabled={index === columns.length - 1}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Tip: Use the arrow buttons to reorder columns. Your preferences are saved automatically.
                  </p>
                </div>
              </DialogContent>
            </Dialog>

            {/* Machine Score Limits Dialog */}
            <Dialog open={scoreLimitsOpen} onOpenChange={setScoreLimitsOpen}>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Machine Score Limits</DialogTitle>
                  <DialogDescription>
                    Set maximum score thresholds to filter machines from the table
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setScoreLimitsOpen(false)
                        setOptionsOpen(true)
                      }}
                    >
                      ← Back
                    </Button>
                    {Object.keys(scoreLimits).length > 0 && (
                      <Button variant="outline" size="sm" onClick={clearAllScoreLimits}>
                        Clear All Limits
                      </Button>
                    )}
                  </div>

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
                            {machineStats
                              .filter(stat => !scoreLimits[stat.machine])
                              .map((stat) => (
                                <SelectItem key={stat.machine} value={stat.machine}>
                                  {stat.machine}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">Maximum Score</label>
                        <input
                          type="text"
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                              <input
                                type="text"
                                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
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
                                🗑️
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

                  <p className="text-sm text-muted-foreground">
                    Machines with scores above the limit will be hidden from the table.
                  </p>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* TWC Player Availability */}
          {rosterPlayers.length > 0 && (
            <TwcPlayerAvailability
              rosterPlayers={rosterPlayers}
              subPlayers={subPlayers}
              availablePlayers={availablePlayers}
              onChange={setAvailablePlayers}
            />
          )}

          {loading && (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin mr-2" />
              <span>Loading statistics...</span>
            </div>
          )}

          {!loading && machineStats.length > 0 && (
            <div className="overflow-x-auto -mx-4 md:mx-0">
              <Table className="text-xs md:text-sm">
                <TableHeader>
                  <TableRow>
                    {visibleColumns.map((col) => (
                      <TableHead
                        key={col.key}
                        className="cursor-pointer px-2 md:px-4 py-2 md:py-3 whitespace-nowrap"
                        onClick={() => handleSort(col.key)}
                      >
                        <span className="text-[10px] md:text-sm">{col.label}</span> <SortIcon column={col.key} />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedStats.map((stat) => (
                    <TableRow key={stat.machine}>
                      {visibleColumns.map((col) => (
                        <TableCell
                          key={col.key}
                          className={`px-2 md:px-4 py-1.5 md:py-3 whitespace-nowrap ${col.key === 'machine' ? 'font-medium sticky left-0 bg-background' : 'cursor-pointer hover:bg-muted/50'}`}
                          onClick={() => handleCellClick(stat.machine, col.key)}
                        >
                          <span className="text-[10px] md:text-sm">{getCellValue(stat, col.key)}</span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!loading && machineStats.length === 0 && (
            <div className="text-center p-12 text-muted-foreground">
              No statistics available for the selected venue and opponent.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Venue Machine List Manager Dialog */}
      <VenueMachineListManager
        open={venueListManagerOpen}
        onOpenChange={setVenueListManagerOpen}
        venueName={selectedVenue}
        currentMachines={machineStats.map(s => s.machine)}
      />

      {/* Machine Mapping Manager Dialog */}
      <MachineMappingManager
        open={machineMappingOpen}
        onOpenChange={setMachineMappingOpen}
      />

      {/* Cell Details Dialog */}
      <Dialog open={cellDetailsOpen} onOpenChange={setCellDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedCell && (() => {
                const columnLabel = DEFAULT_COLUMNS.find(c => c.key === selectedCell.column)?.label || selectedCell.column
                // Replace "Team" with actual team name in the title
                const displayLabel = columnLabel
                  .replace(/\bTeam\b/g, selectedOpponent)
                  .replace(/\bTWC\b/g, 'The Wrecking Crew')
                return `${displayLabel} for ${selectedCell.machine}`
              })()}
            </DialogTitle>
            <DialogDescription>
              {cellDetails && cellDetails.summary}
            </DialogDescription>
          </DialogHeader>

          {loadingDetails && (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin mr-2" />
              <span>Loading details...</span>
            </div>
          )}

          {!loadingDetails && cellDetails && cellDetails.details && cellDetails.details.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer" onClick={() => handleDetailSort('player')}>
                      Player <DetailSortIcon column="player" />
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleDetailSort('score')}>
                      Score <DetailSortIcon column="score" />
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleDetailSort('match')}>
                      Match <DetailSortIcon column="match" />
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleDetailSort('round')}>
                      Round <DetailSortIcon column="round" />
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleDetailSort('season')}>
                      Season <DetailSortIcon column="season" />
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleDetailSort('venue')}>
                      Venue <DetailSortIcon column="venue" />
                    </TableHead>
                    {cellDetails.details[0].points !== undefined && (
                      <TableHead className="cursor-pointer" onClick={() => handleDetailSort('points')}>
                        Points <DetailSortIcon column="points" />
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    // Sort the details
                    const sortedDetails = [...cellDetails.details].sort((a: any, b: any) => {
                      let aVal = a[detailSortColumn]
                      let bVal = b[detailSortColumn]

                      // Handle undefined/null values
                      if (aVal === undefined || aVal === null) return 1
                      if (bVal === undefined || bVal === null) return -1

                      // String comparison
                      if (typeof aVal === 'string' && typeof bVal === 'string') {
                        return detailSortDirection === 'asc'
                          ? aVal.localeCompare(bVal)
                          : bVal.localeCompare(aVal)
                      }

                      // Numeric comparison
                      return detailSortDirection === 'asc' ? aVal - bVal : bVal - aVal
                    })

                    return sortedDetails.map((detail: any, index: number) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{detail.player}</TableCell>
                        <TableCell>{detail.score.toLocaleString()}</TableCell>
                        <TableCell>{detail.match}</TableCell>
                        <TableCell>{detail.round}</TableCell>
                        <TableCell>{detail.season}</TableCell>
                        <TableCell className="text-xs">{detail.venue}</TableCell>
                        {detail.points !== undefined && <TableCell>{detail.points}</TableCell>}
                      </TableRow>
                    ))
                  })()}
                </TableBody>
              </Table>
            </div>
          )}

          {!loadingDetails && cellDetails && cellDetails.details && cellDetails.details.length === 0 && (
            <div className="text-center p-12 text-muted-foreground">
              No detailed data available for this cell
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

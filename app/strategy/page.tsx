/**
 * Strategy Page
 *
 * This page has several optimizer sections:
 *
 * 1. "Create Report" — Runs all 4 optimizers in parallel and generates a
 *    copyable text report in a dialog.
 *
 * 2. "Greedy Optimizer" — The "Optimize Singles Picks" / "Optimize Doubles Picks" buttons.
 *    - API: /api/optimize-picks (greedy algorithm)
 *    - State: singlesRecommendations / doublesRecommendations
 *    - Renders collapsible result cards with machine name, player name, stats, advantage data.
 *
 * 3. "Hungarian Optimizer" — Below the greedy optimizer.
 *    - Uses MachinePicker component → /api/strategy/optimize (Hungarian algorithm via LineupOptimizer)
 *    - State: hungarianSinglesResult / hungarianDoublesResult
 *
 * 4. "Assignment Optimizer" — Assigns players to opponent-picked machines.
 *    - API: /api/optimize-assignments (greedy assignment to fixed machines)
 *    - State: singlesAssignments / doublesAssignments
 */

'use client'

import { useState, useEffect, useMemo } from 'react'
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
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, X, ChevronDown, ChevronUp, Target, Users, Info, Check, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { getMachineImagePath } from '@/lib/machine-images'
import { getMachineDisplayName } from '@/lib/machine-mappings'
import { MachinePicker } from '@/components/strategy/MachinePicker'
import { TwcPlayerAvailability } from '@/components/twc-player-availability'
import { PlayerAvailability } from '@/components/player-availability'
import type { PlayerMachineStats, OptimizationResult } from '@/types/strategy'

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

interface MachineAdvantage {
  machine: string
  compositeScore: number
  twcPctOfVenue: number
  opponentPctOfVenue: number
  statisticalAdvantage: number
  experienceAdvantage: number
  advantageLevel: string
  topTwcPlayers: string[]
}

interface PlayerAdvantage {
  twcPctOfVenue: number
  opponentPctOfVenue: number
  statisticalAdvantage: number
  experienceAdvantage: number
  advantageLevel: string
  compositeScore: number
  twcPlays: number
}

interface AssumedOpponent {
  player: string
  avgScore: number
  venueAvg: number
  venueGames: number
  venueWinRate: number
  allAvg: number
  allGames: number
  allWinRate: number
}

interface PlayerAssignment {
  machine: string
  players: string[]
  dataSource?: string
  blendedScore?: number
  stats?: {
    player: string
    pctOfVenue: number | null
    playsCount: number
    avgScore: number
    userAverage?: number | null
    userConfidence?: number | null
  }[]
  advantage?: PlayerAdvantage
  opponentWeakness?: number
  opponentWeight?: number
  assumedOpponents?: AssumedOpponent[]
}

export default function StrategyPage() {
  // State
  const [venues, setVenues] = useState<Venue[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedVenue, setSelectedVenue] = useState<string>('')
  const [selectedOpponent, setSelectedOpponent] = useState<string>('')
  const [seasonRange, setSeasonRange] = useState<[number, number]>([20, 23])
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([])
  const [loading, setLoading] = useState(false)

  // Custom images from Supabase
  const [customImages, setCustomImages] = useState<Record<string, string>>({})

  // Helper to get machine image path with custom image fallback
  const getImagePath = (machineName: string) => {
    // Check if we have a custom image for this machine
    const customUrl = customImages[machineName] || customImages[machineName.toLowerCase()]
    if (customUrl) {
      return customUrl
    }
    return getMachineImagePath(machineName, machineName)
  }
  // Render assumed opponent detail section
  const renderAssumedOpponents = (opponents: AssumedOpponent[] | undefined, cardKey: string) => {
    if (!opponents || opponents.length === 0) return null
    const isOpen = showAssumedOpponent[cardKey] ?? false
    const venueOnly = assumedOppVenueOnly[cardKey] ?? false

    return (
      <div className="mt-2">
        <button
          className="text-xs font-medium text-red-500/80 dark:text-red-400/80 hover:text-red-600 dark:hover:text-red-300 flex items-center gap-1"
          onClick={(e) => { e.stopPropagation(); setShowAssumedOpponent(prev => ({ ...prev, [cardKey]: !isOpen })) }}
        >
          Assumed Opponent: {opponents.map(o => o.player).join(', ')}
          {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {isOpen && (
          <div className="mt-1.5 p-2 bg-red-500/5 border border-red-500/20 rounded text-xs space-y-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={venueOnly}
                  onChange={() => setAssumedOppVenueOnly(prev => ({ ...prev, [cardKey]: !venueOnly }))}
                  className="h-3 w-3 accent-primary"
                />
                Venue-specific only
              </label>
            </div>
            {opponents.map(opp => (
              <div key={opp.player} className="space-y-0.5">
                <div className="font-medium text-red-600 dark:text-red-400">{opp.player}</div>
                <div className="grid grid-cols-3 gap-1 text-muted-foreground">
                  <div>Avg: {venueOnly ? (opp.venueAvg > 0 ? opp.venueAvg.toLocaleString() : 'N/A') : opp.allAvg.toLocaleString()}</div>
                  <div>Games: {venueOnly ? opp.venueGames : opp.allGames}</div>
                  <div>Win: {venueOnly ? (opp.venueGames > 0 ? `${opp.venueWinRate}%` : 'N/A') : `${opp.allWinRate}%`}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const [loadingDropdowns, setLoadingDropdowns] = useState(true)
  const [teamVenueSpecific, setTeamVenueSpecific] = useState(true)
  const [twcVenueSpecific, setTwcVenueSpecific] = useState(false)

  // Machine advantages
  const [machineAdvantages, setMachineAdvantages] = useState<MachineAdvantage[]>([])

  // Sorting for machine advantages table
  const [advSortColumn, setAdvSortColumn] = useState<string>('compositeScore')
  const [advSortDirection, setAdvSortDirection] = useState<'asc' | 'desc'>('desc')

  // TWC Player availability
  const [availablePlayers, setAvailablePlayers] = useState<Record<string, boolean>>({})
  const [allPlayers, setAllPlayers] = useState<string[]>([])
  const [rosterPlayers, setRosterPlayers] = useState<string[]>([])
  const [subPlayers, setSubPlayers] = useState<string[]>([])
  const [twcAddedSubs, setTwcAddedSubs] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem('twcAddedSubs')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  // Opponent Player availability
  const [opponentAvailablePlayers, setOpponentAvailablePlayers] = useState<Record<string, boolean>>({})
  const [opponentRosterPlayers, setOpponentRosterPlayers] = useState<string[]>([])
  const [opponentSubPlayers, setOpponentSubPlayers] = useState<string[]>([])
  const [opponentAddedSubs, setOpponentAddedSubs] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem('opponentAddedSubs')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  // Sat-out tracking - players who have already sat out must play
  const [satOutPlayers, setSatOutPlayers] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const saved = localStorage.getItem('satOutPlayers')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })

  // Persist sat-out to localStorage
  useEffect(() => {
    try {
      if (satOutPlayers.size > 0) {
        localStorage.setItem('satOutPlayers', JSON.stringify(Array.from(satOutPlayers)))
      } else {
        localStorage.removeItem('satOutPlayers')
      }
    } catch { /* ignore */ }
  }, [satOutPlayers])

  // When a player is marked as sat out, ensure they're toggled on in availablePlayers
  const toggleSatOut = (player: string) => {
    setSatOutPlayers(prev => {
      const next = new Set(prev)
      if (next.has(player)) {
        next.delete(player)
      } else {
        next.add(player)
        // Force them available since they must play
        if (!availablePlayers[player]) {
          setAvailablePlayers(prev2 => ({ ...prev2, [player]: true }))
        }
        // Can't both sit and have sat
        if (sitThisRound.has(player)) {
          setSitThisRound(prev2 => {
            const next2 = new Set(prev2)
            next2.delete(player)
            return next2
          })
        }
      }
      return next
    })
  }

  // Sit this round - players excluded from current round (not persistent)
  const [sitThisRound, setSitThisRound] = useState<Set<string>>(new Set())

  const toggleSitThisRound = (player: string) => {
    setSitThisRound(prev => {
      const next = new Set(prev)
      if (next.has(player)) {
        next.delete(player)
      } else {
        next.add(player)
        // Can't both sit and have sat — remove from satOut if present
        if (satOutPlayers.has(player)) {
          setSatOutPlayers(prev2 => {
            const next2 = new Set(prev2)
            next2.delete(player)
            return next2
          })
        }
      }
      return next
    })
  }

  // Machine picking state
  const [numSinglesMachines, setNumSinglesMachines] = useState(7)
  const [numDoublesMachines, setNumDoublesMachines] = useState(4)
  // Slider defaults
  const SLIDER_DEFAULTS = {
    venueWeight: 70,
    userInputWeight: 0,
    confidenceBoost: 0,
    opponentWeight: 0,
    winRateWeight: 40,
    recentFormWeight: 30,
    dataConfidenceWeight: 10,
  }

  // Load persisted slider settings from localStorage
  const getPersistedSliders = () => {
    if (typeof window === 'undefined') return SLIDER_DEFAULTS
    try {
      const saved = localStorage.getItem('strategySliderSettings')
      return saved ? { ...SLIDER_DEFAULTS, ...JSON.parse(saved) } : SLIDER_DEFAULTS
    } catch { return SLIDER_DEFAULTS }
  }

  const [venueWeight, setVenueWeight] = useState(() => getPersistedSliders().venueWeight)
  const [userInputWeight, setUserInputWeight] = useState(() => getPersistedSliders().userInputWeight)
  const [confidenceBoost, setConfidenceBoost] = useState(() => getPersistedSliders().confidenceBoost)
  const [opponentWeight, setOpponentWeight] = useState(() => getPersistedSliders().opponentWeight)
  const [useNashEquilibrium, setUseNashEquilibrium] = useState(true)
  const [winRateWeight, setWinRateWeight] = useState(() => getPersistedSliders().winRateWeight)
  const [recentFormWeight, setRecentFormWeight] = useState(() => getPersistedSliders().recentFormWeight)
  const [dataConfidenceWeight, setDataConfidenceWeight] = useState(() => getPersistedSliders().dataConfidenceWeight)

  // Derived: Venue Avg Weight is the remainder
  const venueAvgWeight = 100 - winRateWeight - recentFormWeight - dataConfidenceWeight

  // Track last-applied slider values for dirty detection
  const [appliedWeights, setAppliedWeights] = useState<Record<string, number> | null>(null)

  const currentWeights = { venueWeight, userInputWeight, confidenceBoost, opponentWeight, winRateWeight, recentFormWeight, dataConfidenceWeight }
  const isSlidersDirty = appliedWeights !== null && Object.keys(currentWeights).some(
    k => (currentWeights as any)[k] !== appliedWeights[k]
  )

  // Persist slider settings to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('strategySliderSettings', JSON.stringify(currentWeights))
  }, [venueWeight, userInputWeight, confidenceBoost, opponentWeight, winRateWeight, recentFormWeight, dataConfidenceWeight])

  // Proportional adjustment when a score factor slider changes
  const handleScoreWeightChange = (
    changed: 'winRate' | 'recentForm' | 'dataConfidence',
    newValue: number
  ) => {
    const current = { winRate: winRateWeight, recentForm: recentFormWeight, venueAvg: venueAvgWeight, dataConfidence: dataConfidenceWeight }
    const remaining = 100 - newValue
    const otherKeys = (['winRate', 'recentForm', 'venueAvg', 'dataConfidence'] as const).filter(k => k !== changed)
    const otherSum = otherKeys.reduce((s, k) => s + current[k], 0)

    let newValues: Record<string, number>
    if (otherSum === 0) {
      // Distribute evenly if all others are 0
      const each = Math.floor(remaining / otherKeys.length)
      newValues = Object.fromEntries(otherKeys.map((k, i) => [k, i === 0 ? remaining - each * (otherKeys.length - 1) : each]))
    } else {
      // Scale proportionally with largest-remainder rounding
      const rawValues = otherKeys.map(k => ({ key: k, raw: (current[k] / otherSum) * remaining }))
      const floored = rawValues.map(v => ({ ...v, floor: Math.floor(v.raw), remainder: v.raw - Math.floor(v.raw) }))
      let distributed = floored.reduce((s, v) => s + v.floor, 0)
      const gap = remaining - distributed
      // Sort by remainder descending, give +1 to top `gap` entries
      floored.sort((a, b) => b.remainder - a.remainder)
      for (let i = 0; i < gap; i++) floored[i].floor++
      newValues = Object.fromEntries(floored.map(v => [v.key, v.floor]))
    }

    // Apply the values (venueAvg is derived, so we don't set it directly)
    if (changed === 'winRate') setWinRateWeight(newValue)
    else setWinRateWeight(newValues.winRate ?? winRateWeight)

    if (changed === 'recentForm') setRecentFormWeight(newValue)
    else setRecentFormWeight(newValues.recentForm ?? recentFormWeight)

    if (changed === 'dataConfidence') setDataConfidenceWeight(newValue)
    else setDataConfidenceWeight(newValues.dataConfidence ?? dataConfidenceWeight)

    // venueAvg is derived from the remaining, but we need to ensure the other sliders
    // account for it. Since venueAvg = 100 - winRate - recentForm - dataConfidence,
    // we don't store it. The proportional adjustment already distributes across all three
    // non-changed values including venueAvg, but we only store winRate, recentForm, dataConfidence.
    // Recalculate: the "venueAvg" portion from newValues gets absorbed into the derivation.
  }

  const resetSliders = () => {
    setVenueWeight(SLIDER_DEFAULTS.venueWeight)
    setUserInputWeight(SLIDER_DEFAULTS.userInputWeight)
    setConfidenceBoost(SLIDER_DEFAULTS.confidenceBoost)
    setOpponentWeight(SLIDER_DEFAULTS.opponentWeight)
    setWinRateWeight(SLIDER_DEFAULTS.winRateWeight)
    setRecentFormWeight(SLIDER_DEFAULTS.recentFormWeight)
    setDataConfidenceWeight(SLIDER_DEFAULTS.dataConfidenceWeight)
    localStorage.removeItem('strategySliderSettings')
  }

  // Build scoreWeights object for API calls (values as 0-1)
  const scoreWeights = {
    winRate: winRateWeight / 100,
    recentForm: recentFormWeight / 100,
    venueAdjustedAvg: venueAvgWeight / 100,
    confidence: dataConfidenceWeight / 100,
  }

  const applySliderChanges = () => {
    if (singlesRecommendations.length > 0) optimizeSinglesPicks()
    if (doublesRecommendations.length > 0) optimizeDoublesPicks()
    setAppliedWeights({ ...currentWeights })
  }
  const [singlesRecommendations, setSinglesRecommendations] = useState<PlayerAssignment[]>([])
  const [doublesRecommendations, setDoublesRecommendations] = useState<PlayerAssignment[]>([])
  const [recommendationsVersion, setRecommendationsVersion] = useState(0)
  const [singlesExclusions, setSinglesExclusions] = useState<Record<string, string[]>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const saved = localStorage.getItem('singlesPlayerExclusions')
      return saved ? JSON.parse(saved) : {}
    } catch { return {} }
  })
  const [doublesExclusions, setDoublesExclusions] = useState<Record<string, string[]>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const saved = localStorage.getItem('doublesPlayerExclusions')
      return saved ? JSON.parse(saved) : {}
    } catch { return {} }
  })

  // Player assignment state (when opponent picks)
  const [singlesOpponentPicks, setSinglesOpponentPicks] = useState<string[]>([])
  const [doublesOpponentPicks, setDoublesOpponentPicks] = useState<string[]>([])
  const [singlesAssignments, setSinglesAssignments] = useState<PlayerAssignment[]>([])
  const [doublesAssignments, setDoublesAssignments] = useState<PlayerAssignment[]>([])
  const [singlesAssignExclusions, setSinglesAssignExclusions] = useState<Record<string, string[]>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const saved = localStorage.getItem('singlesAssignExclusions')
      return saved ? JSON.parse(saved) : {}
    } catch { return {} }
  })
  const [doublesAssignExclusions, setDoublesAssignExclusions] = useState<Record<string, string[]>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const saved = localStorage.getItem('doublesAssignExclusions')
      return saved ? JSON.parse(saved) : {}
    } catch { return {} }
  })

  // Excluded machines (whole machine exclusion across all optimizers)
  const [excludedMachines, setExcludedMachines] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem('excludedMachines')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  // Cell details dialog
  const [cellDetailsOpen, setCellDetailsOpen] = useState(false)
  const [selectedCell, setSelectedCell] = useState<{machine: string, column: string} | null>(null)
  const [cellDetails, setCellDetails] = useState<any>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [cellSortColumn, setCellSortColumn] = useState<string>('score')
  const [cellSortDirection, setCellSortDirection] = useState<'asc' | 'desc'>('desc')

  // Expanded recommendations state
  const [expandedRecommendations, setExpandedRecommendations] = useState<Record<string, boolean>>({})
  const [showFullStats, setShowFullStats] = useState<Record<string, boolean>>({})
  const [showAssumedOpponent, setShowAssumedOpponent] = useState<Record<string, boolean>>({})
  const [assumedOppVenueOnly, setAssumedOppVenueOnly] = useState<Record<string, boolean>>({})
  const [showVenueAvgInfo, setShowVenueAvgInfo] = useState(false)
  const [showAdvantageTable, setShowAdvantageTable] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('showAdvantageTable')
      return saved !== null ? saved === 'true' : true
    }
    return true
  })

  // Player analysis state
  const [selectedAnalysisPlayer, setSelectedAnalysisPlayer] = useState<string>('')
  const [showAllVenues, setShowAllVenues] = useState(false)
  const [heatmapShowAllVenues, setHeatmapShowAllVenues] = useState(false)
  const [playerAnalysis, setPlayerAnalysis] = useState<any>(null)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [analysisSortColumn, setAnalysisSortColumn] = useState<string>('pctOfVenue')
  const [analysisSortDirection, setAnalysisSortDirection] = useState<'asc' | 'desc'>('desc')

  // Advanced optimization state
  const [matrixData, setMatrixData] = useState<{
    playerNames: string[]
    machines: string[]
    statsMap: Map<string, Map<string, PlayerMachineStats>>
  } | null>(null)
  const [loadingMatrix, setLoadingMatrix] = useState(false)
  const [optimizationFormat, setOptimizationFormat] = useState<'7x7' | '4x2'>('7x7')

  // Memoize filtered arrays so MachinePicker's useEffect doesn't reset assignments on every render
  const pickerPlayerNames = useMemo(
    () => matrixData?.playerNames.filter(p => !sitThisRound.has(p)) ?? [],
    [matrixData?.playerNames, sitThisRound]
  )
  const pickerMachines = useMemo(
    () => matrixData?.machines.filter(m => !excludedMachines.includes(m)) ?? [],
    [matrixData?.machines, excludedMachines]
  )

  // Report dialog state
  const [reportDialogOpen, setReportDialogOpen] = useState(false)
  const [reportText, setReportText] = useState('')
  const [reportCopied, setReportCopied] = useState(false)
  const [discordSending, setDiscordSending] = useState(false)
  const [discordSent, setDiscordSent] = useState(false)
  const [discordError, setDiscordError] = useState('')

  // Hungarian algorithm results from Advanced Optimization section
  const [hungarianSinglesResult, setHungarianSinglesResult] = useState<OptimizationResult | null>(null)
  const [hungarianDoublesResult, setHungarianDoublesResult] = useState<OptimizationResult | null>(null)

  // Load venues and teams
  useEffect(() => {
    loadVenuesAndTeams()
  }, [])

  // Set venue-specific defaults based on venue
  useEffect(() => {
    const isGPA = selectedVenue.toLowerCase().includes('georgetown') &&
                  selectedVenue.toLowerCase().includes('pizza')

    // At GPA: Team = NOT venue-specific, TWC = venue-specific
    // At other venues: Team = venue-specific, TWC = NOT venue-specific
    setTeamVenueSpecific(!isGPA)
    setTwcVenueSpecific(isGPA)
  }, [selectedVenue])

  // Load machine advantages when filters change
  useEffect(() => {
    if (selectedVenue && selectedOpponent) {
      loadMachineAdvantages()
    }
  }, [selectedVenue, selectedOpponent, seasonRange, teamVenueSpecific, twcVenueSpecific]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load opponent roster when opponent changes
  useEffect(() => {
    if (!selectedOpponent) return
    const loadOpponentRoster = async () => {
      try {
        const maxSeason = availableSeasons.length > 0 ? Math.max(...availableSeasons) : 22
        const response = await fetch(`/api/opponent-roster?team=${encodeURIComponent(selectedOpponent)}&currentSeason=${maxSeason}`)
        if (response.ok) {
          const data = await response.json()
          const roster = data.rosterPlayers || []
          const subs = [...(data.subPlayers || []), ...opponentAddedSubs.filter((s: string) => !roster.includes(s) && !(data.subPlayers || []).includes(s))]
          setOpponentRosterPlayers(roster)
          setOpponentSubPlayers(subs)
          // Merge with existing availability state
          setOpponentAvailablePlayers(prev => {
            const next: Record<string, boolean> = {}
            roster.forEach((player: string) => {
              next[player] = prev[player] !== undefined ? prev[player] : true
            })
            subs.forEach((player: string) => {
              next[player] = prev[player] !== undefined ? prev[player] : false
            })
            return next
          })
        }
      } catch (error) {
        console.error('Error loading opponent roster:', error)
      }
    }
    loadOpponentRoster()
  }, [selectedOpponent, availableSeasons]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist added subs to localStorage
  useEffect(() => {
    try { localStorage.setItem('twcAddedSubs', JSON.stringify(twcAddedSubs)) } catch {}
  }, [twcAddedSubs])
  useEffect(() => {
    try { localStorage.setItem('opponentAddedSubs', JSON.stringify(opponentAddedSubs)) } catch {}
  }, [opponentAddedSubs])

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

      const venuesResponse = await fetch('/api/active-venues')
      const venuesData = await venuesResponse.json()
      setVenues(venuesData.venues || [])

      // Fetch machines to get custom images
      const machinesResponse = await fetch('/api/machines')
      const machinesData = await machinesResponse.json()
      const customImagesMap: Record<string, string> = {}
      for (const key of Object.keys(machinesData)) {
        const machine = machinesData[key]
        if (machine.customImage) {
          customImagesMap[machine.name] = machine.customImage
          customImagesMap[machine.key] = machine.customImage
        }
      }
      setCustomImages(customImagesMap)

      const currentSeason = seasonsData.max || 23
      const teamsResponse = await fetch(`/api/teams?season=${currentSeason}`)
      const teamsData = await teamsResponse.json()
      setTeams(teamsData.teams || [])

      // Get the most recent TWC match to set defaults
      const latestMatchResponse = await fetch('/api/latest-twc-match')
      const latestMatch = await latestMatchResponse.json()

      // Set venue from latest match
      if (latestMatch.venue) {
        // Match by lowercase to handle standardization differences (e.g., "Icebox" vs "Ice Box")
        const matchVenueLower = latestMatch.venue.toLowerCase().replace(/\s+/g, '')
        const matchingVenue = venuesData.venues.find((v: Venue) =>
          v.name.toLowerCase().replace(/\s+/g, '') === matchVenueLower
        )
        if (matchingVenue) {
          setSelectedVenue(matchingVenue.name)
        } else {
          setSelectedVenue(latestMatch.venue)
        }
      } else {
        // Fallback to GPA
        const gpa = venuesData.venues.find((v: Venue) =>
          v.name.toLowerCase().includes('georgetown') && v.name.toLowerCase().includes('pizza')
        )
        if (gpa) {
          setSelectedVenue(gpa.name)
        } else if (venuesData.venues.length > 0) {
          setSelectedVenue(venuesData.venues[0].name)
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

  const loadMachineAdvantages = async () => {
    setLoading(true)
    try {
      const opponentPlayersList = getSelectedOpponentPlayers()
      const response = await fetch(
        `/api/machine-advantages?` +
        `venue=${encodeURIComponent(selectedVenue)}` +
        `&opponent=${encodeURIComponent(selectedOpponent)}` +
        `&seasonStart=${seasonRange[0]}` +
        `&seasonEnd=${seasonRange[1]}` +
        `&teamVenueSpecific=${teamVenueSpecific}` +
        `&twcVenueSpecific=${twcVenueSpecific}` +
        `&venueWeight=${venueWeight / 100}` +
        `&machines=${encodeURIComponent((venues.find(v => v.name === selectedVenue)?.machines || []).join(','))}` +
        (opponentPlayersList.length > 0 ? `&opponentPlayers=${encodeURIComponent(opponentPlayersList.join(','))}` : '')
      )

      if (response.ok) {
        const data = await response.json()
        setMachineAdvantages(data.advantages || [])
        setAllPlayers(data.players || [])
        setRosterPlayers(data.rosterPlayers || [])
        const baseSubs = data.subPlayers || []
        const allSubs = [...baseSubs, ...twcAddedSubs.filter((s: string) => !(data.rosterPlayers || []).includes(s) && !baseSubs.includes(s))]
        setSubPlayers(allSubs)

        // Merge new roster with existing availability state so persisted values
        // are not overwritten when the venue/opponent changes but the roster is the same.
        // New players get defaults (roster=true, subs=false); existing players keep their value.
        setAvailablePlayers(prev => {
          const next: Record<string, boolean> = {}
          ;(data.rosterPlayers || []).forEach((player: string) => {
            next[player] = prev[player] !== undefined ? prev[player] : true
          })
          allSubs.forEach((player: string) => {
            next[player] = prev[player] !== undefined ? prev[player] : false
          })
          return next
        })
      }
    } catch (error) {
      console.error('Error loading machine advantages:', error)
    } finally {
      setLoading(false)
    }
  }

  // Sub management handlers
  const handleAddTwcSub = (name: string) => {
    if (!subPlayers.includes(name) && !rosterPlayers.includes(name)) {
      setSubPlayers(prev => [...prev, name])
      setTwcAddedSubs(prev => [...prev, name])
      setAvailablePlayers(prev => ({ ...prev, [name]: false }))
    }
  }
  const handleRemoveTwcSub = (name: string) => {
    setTwcAddedSubs(prev => prev.filter(s => s !== name))
    setSubPlayers(prev => prev.filter(s => s !== name))
    setAvailablePlayers(prev => {
      const next = { ...prev }
      delete next[name]
      return next
    })
  }
  const handleAddOpponentSub = (name: string) => {
    if (!opponentSubPlayers.includes(name) && !opponentRosterPlayers.includes(name)) {
      setOpponentSubPlayers(prev => [...prev, name])
      setOpponentAddedSubs(prev => [...prev, name])
      setOpponentAvailablePlayers(prev => ({ ...prev, [name]: false }))
    }
  }
  const handleRemoveOpponentSub = (name: string) => {
    setOpponentAddedSubs(prev => prev.filter(s => s !== name))
    setOpponentSubPlayers(prev => prev.filter(s => s !== name))
    setOpponentAvailablePlayers(prev => {
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  // Get selected opponent players for API calls
  const getSelectedOpponentPlayers = () => {
    return Object.keys(opponentAvailablePlayers).filter(p => opponentAvailablePlayers[p])
  }

  const optimizeSinglesPicks = async () => {
    const selectedPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p] && !sitThisRound.has(p))

    if (selectedPlayers.length < numSinglesMachines) {
      alert(`Not enough players selected. Need ${numSinglesMachines}, have ${selectedPlayers.length}`)
      return
    }

    try {
      const response = await fetch('/api/optimize-picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue: selectedVenue,
          opponent: selectedOpponent,
          opponentPlayers: getSelectedOpponentPlayers(),
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          format: 'singles',
          numMachines: numSinglesMachines,
          availablePlayers: selectedPlayers,
          teamVenueSpecific,
          twcVenueSpecific,
          venueWeight: venueWeight / 100,
          userInputWeight: userInputWeight / 100,
          confidenceBoost: confidenceBoost / 100,
          opponentWeight: opponentWeight / 100,
          scoreWeights,
          exclusions: singlesExclusions,
          mustPlay: Array.from(satOutPlayers),
          machines: (venues.find(v => v.name === selectedVenue)?.machines || []).filter(m => !excludedMachines.includes(m)),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        console.log('Singles optimizer response:', data)
        // Clear first to force re-render, then set new data
        setSinglesRecommendations([])
        setTimeout(() => {
          setSinglesRecommendations(data.recommendations || [])
          setRecommendationsVersion(v => v + 1)
        }, 0)
        setAppliedWeights({ ...currentWeights })
        if (data.debug) console.log('Singles optimizer debug:', data.debug)
      } else {
        const errorData = await response.text()
        console.error('Singles optimizer error:', response.status, errorData)
      }
    } catch (error) {
      console.error('Error optimizing singles picks:', error)
    }
  }

  const optimizeDoublesPicks = async () => {
    const selectedPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p] && !sitThisRound.has(p))

    if (selectedPlayers.length < numDoublesMachines * 2) {
      alert(`Not enough players selected. Need ${numDoublesMachines * 2}, have ${selectedPlayers.length}`)
      return
    }

    try {
      const response = await fetch('/api/optimize-picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue: selectedVenue,
          opponent: selectedOpponent,
          opponentPlayers: getSelectedOpponentPlayers(),
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          format: 'doubles',
          numMachines: numDoublesMachines,
          availablePlayers: selectedPlayers,
          teamVenueSpecific,
          twcVenueSpecific,
          venueWeight: venueWeight / 100,
          userInputWeight: userInputWeight / 100,
          confidenceBoost: confidenceBoost / 100,
          opponentWeight: opponentWeight / 100,
          scoreWeights,
          exclusions: doublesExclusions,
          mustPlay: Array.from(satOutPlayers),
          machines: (venues.find(v => v.name === selectedVenue)?.machines || []).filter(m => !excludedMachines.includes(m)),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        console.log('Doubles optimizer response:', data)
        // Clear first to force re-render, then set new data
        setDoublesRecommendations([])
        setTimeout(() => {
          setDoublesRecommendations(data.recommendations || [])
          setRecommendationsVersion(v => v + 1)
        }, 0)
        setAppliedWeights({ ...currentWeights })
        if (data.debug) console.log('Doubles optimizer debug:', data.debug)
      } else {
        const errorData = await response.text()
        console.error('Doubles optimizer error:', response.status, errorData)
      }
    } catch (error) {
      console.error('Error optimizing doubles picks:', error)
    }
  }

  const optimizeSinglesAssignments = async () => {
    const selectedPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p] && !sitThisRound.has(p))

    if (selectedPlayers.length < singlesOpponentPicks.length) {
      alert(`Not enough players selected. Need ${singlesOpponentPicks.length}, have ${selectedPlayers.length}`)
      return
    }

    try {
      const response = await fetch('/api/optimize-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue: selectedVenue,
          opponent: selectedOpponent,
          opponentPlayers: getSelectedOpponentPlayers(),
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          format: 'singles',
          machines: singlesOpponentPicks.filter(m => !excludedMachines.includes(m)),
          availablePlayers: selectedPlayers,
          teamVenueSpecific,
          twcVenueSpecific,
          venueWeight: venueWeight / 100,
          opponentWeight: opponentWeight / 100,
          exclusions: singlesAssignExclusions,
          mustPlay: Array.from(satOutPlayers),
          scoreWeights,
          confidenceBoost: confidenceBoost / 100,
          userInputWeight: userInputWeight / 100,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setSinglesAssignments(data.assignments || [])
      }
    } catch (error) {
      console.error('Error optimizing singles assignments:', error)
    }
  }

  const optimizeDoublesAssignments = async () => {
    const selectedPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p] && !sitThisRound.has(p))

    if (selectedPlayers.length < doublesOpponentPicks.length * 2) {
      alert(`Not enough players selected. Need ${doublesOpponentPicks.length * 2}, have ${selectedPlayers.length}`)
      return
    }

    try {
      const response = await fetch('/api/optimize-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue: selectedVenue,
          opponent: selectedOpponent,
          opponentPlayers: getSelectedOpponentPlayers(),
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          format: 'doubles',
          machines: doublesOpponentPicks.filter(m => !excludedMachines.includes(m)),
          availablePlayers: selectedPlayers,
          teamVenueSpecific,
          twcVenueSpecific,
          venueWeight: venueWeight / 100,
          opponentWeight: opponentWeight / 100,
          exclusions: doublesAssignExclusions,
          mustPlay: Array.from(satOutPlayers),
          scoreWeights,
          confidenceBoost: confidenceBoost / 100,
          userInputWeight: userInputWeight / 100,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setDoublesAssignments(data.assignments || [])
      }
    } catch (error) {
      console.error('Error optimizing doubles assignments:', error)
    }
  }

  // Generate report text for all machine picks
  const [generatingReport, setGeneratingReport] = useState(false)

  const generateReport = async () => {
    setGeneratingReport(true)
    setReportDialogOpen(true)
    setReportText('Generating report...')

    const selectedPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p] && !sitThisRound.has(p))
    const venueData = venues.find(v => v.name === selectedVenue)
    const machinesAtVenue = (venueData?.machines || []).filter(m => !excludedMachines.includes(m))

    // Run all 4 optimizations in parallel
    // For the report, assign ALL players (not just the normal round count)
    const [greedySingles, greedyDoubles, hungarianSingles, hungarianDoubles] = await Promise.all([
      // Greedy Singles - use all players (1 per machine)
      fetch('/api/optimize-picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue: selectedVenue,
          opponent: selectedOpponent,
          opponentPlayers: getSelectedOpponentPlayers(),
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          format: 'singles',
          numMachines: selectedPlayers.length,
          availablePlayers: selectedPlayers,
          teamVenueSpecific,
          twcVenueSpecific,
          venueWeight: venueWeight / 100,
          userInputWeight: userInputWeight / 100,
          confidenceBoost: confidenceBoost / 100,
          opponentWeight: opponentWeight / 100,
          scoreWeights,
          exclusions: singlesExclusions,
          mustPlay: Array.from(satOutPlayers),
          machines: machinesAtVenue,
        }),
      }).then(r => r.ok ? r.json() : null).catch(() => null),

      // Greedy Doubles - use all players (2 per machine)
      fetch('/api/optimize-picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue: selectedVenue,
          opponent: selectedOpponent,
          opponentPlayers: getSelectedOpponentPlayers(),
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          format: 'doubles',
          numMachines: Math.floor(selectedPlayers.length / 2),
          availablePlayers: selectedPlayers,
          teamVenueSpecific,
          twcVenueSpecific,
          venueWeight: venueWeight / 100,
          userInputWeight: userInputWeight / 100,
          confidenceBoost: confidenceBoost / 100,
          opponentWeight: opponentWeight / 100,
          scoreWeights,
          exclusions: doublesExclusions,
          mustPlay: Array.from(satOutPlayers),
          machines: machinesAtVenue,
        }),
      }).then(r => r.ok ? r.json() : null).catch(() => null),

      // Hungarian Singles (7x7) - assign all players
      fetch('/api/strategy/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: '7x7',
          playerNames: selectedPlayers,
          machines: machinesAtVenue,
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          venue: selectedVenue,
          venueWeight: venueWeight / 100,
          userInputWeight: userInputWeight / 100,
          confidenceBoost: confidenceBoost / 100,
          opponentWeight: opponentWeight / 100,
          scoreWeights,
          exclusions: singlesExclusions,
          mustPlay: Array.from(satOutPlayers),
          opponent: selectedOpponent,
          opponentPlayers: getSelectedOpponentPlayers(),
          assignAll: true,
        }),
      }).then(r => r.ok ? r.json() : null).catch(() => null),

      // Hungarian Doubles (4x2) - assign all players
      fetch('/api/strategy/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: '4x2',
          playerNames: selectedPlayers,
          machines: machinesAtVenue,
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          venue: selectedVenue,
          venueWeight: venueWeight / 100,
          userInputWeight: userInputWeight / 100,
          confidenceBoost: confidenceBoost / 100,
          opponentWeight: opponentWeight / 100,
          scoreWeights,
          exclusions: doublesExclusions,
          mustPlay: Array.from(satOutPlayers),
          opponent: selectedOpponent,
          opponentPlayers: getSelectedOpponentPlayers(),
          assignAll: true,
        }),
      }).then(r => r.ok ? r.json() : null).catch(() => null),
    ])

    // Build report
    const lines: string[] = []
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

    lines.push(`Strategy Report - ${date}`)
    lines.push(`Venue: ${selectedVenue}`)
    lines.push(`Opponent: ${selectedOpponent}`)
    lines.push(`Seasons: ${seasonRange[0]} - ${seasonRange[1]}`)
    lines.push(`Players: ${selectedPlayers.length} available`)
    lines.push('')
    lines.push('='.repeat(50))

    // Greedy Singles Picks
    lines.push('')
    lines.push('GREEDY ALGORITHM - SINGLES PICKS')
    lines.push('-'.repeat(40))
    if (greedySingles?.recommendations?.length > 0) {
      greedySingles.recommendations.forEach((rec: any, i: number) => {
        if (i === numSinglesMachines) {
          lines.push('  - - - remaining players - - -')
        }
        const machineName = getMachineDisplayName(rec.machine)
        const players = rec.players.join(', ')
        const pctInfo = rec.stats?.length === 1
          ? `${rec.stats[0].pctOfVenue ?? 'N/A'}%`
          : rec.stats?.map((s: any) => `${s.player}: ${s.pctOfVenue ?? 'N/A'}%`).join(', ') || ''
        const opponents = rec.assumedOpponents?.map((o: any) => o.player).join(', ')
        lines.push(`${i + 1}. ${machineName}: ${players}`)
        if (pctInfo) lines.push(`   % of Venue Avg: ${pctInfo}`)
        if (opponents) lines.push(`   vs ${opponents}`)
      })
    } else {
      lines.push('Could not generate singles picks.')
    }

    // Greedy Doubles Picks
    lines.push('')
    lines.push('GREEDY ALGORITHM - DOUBLES PICKS')
    lines.push('-'.repeat(40))
    if (greedyDoubles?.recommendations?.length > 0) {
      greedyDoubles.recommendations.forEach((rec: any, i: number) => {
        if (i === numDoublesMachines) {
          lines.push('  - - - remaining players - - -')
        }
        const machineName = getMachineDisplayName(rec.machine)
        const players = rec.players.join(' & ')
        const pctInfo = rec.stats?.map((s: any) => `${s.player}: ${s.pctOfVenue ?? 'N/A'}%`).join(', ') || ''
        const opponents = rec.assumedOpponents?.map((o: any) => o.player).join(' & ')
        lines.push(`${i + 1}. ${machineName}: ${players}`)
        if (pctInfo) lines.push(`   % of Venue Avg: ${pctInfo}`)
        if (opponents) lines.push(`   vs ${opponents}`)
      })
    } else {
      lines.push('Could not generate doubles picks.')
    }

    // Hungarian Singles (7x7)
    lines.push('')
    lines.push('HUNGARIAN ALGORITHM - SINGLES (7x7)')
    lines.push('-'.repeat(40))
    if (hungarianSingles?.assignments?.length > 0) {
      const regularSinglesCount = hungarianSingles.regularCount || 7
      hungarianSingles.assignments.forEach((asn: any, i: number) => {
        if (i === regularSinglesCount) {
          lines.push('  - - - remaining players - - -')
        }
        const machineName = getMachineDisplayName(asn.machine_id)
        const player = asn.player_id
        const pct = asn.venue_adjusted_avg != null ? `${(asn.venue_adjusted_avg * 100).toFixed(0)}% of avg` : ''
        const opponents = hungarianSingles.assumedOpponents?.[asn.machine_id]?.map((o: any) => o.player).join(', ')
        lines.push(`${i + 1}. ${machineName}: ${player}${pct ? ` (${pct})` : ''}`)
        if (opponents) lines.push(`   vs ${opponents}`)
      })
    } else {
      lines.push('Could not generate Hungarian singles assignments.')
    }

    // Hungarian Doubles (4x2)
    lines.push('')
    lines.push('HUNGARIAN ALGORITHM - DOUBLES (4x2)')
    lines.push('-'.repeat(40))
    if (hungarianDoubles?.assignments?.length > 0) {
      const regularDoublesCount = hungarianDoubles.regularCount || 4
      hungarianDoubles.assignments.forEach((asn: any, i: number) => {
        if (i === regularDoublesCount) {
          lines.push('  - - - remaining players - - -')
        }
        const machineName = getMachineDisplayName(asn.machine_id)
        const players = asn.player1_id && asn.player2_id ? `${asn.player1_id} & ${asn.player2_id}` : asn.player_id
        const opponents = hungarianDoubles.assumedOpponents?.[asn.machine_id]?.map((o: any) => o.player).join(' & ')
        lines.push(`${i + 1}. ${machineName}: ${players}`)
        if (opponents) lines.push(`   vs ${opponents}`)
      })
    } else {
      lines.push('Could not generate Hungarian doubles assignments.')
    }

    // Exclusions
    const hasExclusions = Object.keys(singlesExclusions).length > 0 || Object.keys(doublesExclusions).length > 0 || excludedMachines.length > 0
    if (hasExclusions) {
      lines.push('')
      lines.push('ACTIVE EXCLUSIONS')
      lines.push('-'.repeat(40))
      if (excludedMachines.length > 0) {
        lines.push('Excluded Machines: ' + excludedMachines.map(m => getMachineDisplayName(m)).join(', '))
      }
      if (Object.keys(singlesExclusions).length > 0) {
        lines.push('Singles:')
        Object.entries(singlesExclusions).forEach(([machine, players]) => {
          lines.push(`  ${getMachineDisplayName(machine)}: ${players.join(', ')}`)
        })
      }
      if (Object.keys(doublesExclusions).length > 0) {
        lines.push('Doubles:')
        Object.entries(doublesExclusions).forEach(([machine, players]) => {
          lines.push(`  ${getMachineDisplayName(machine)}: ${players.join(', ')}`)
        })
      }
    }

    lines.push('')
    lines.push('='.repeat(50))
    lines.push('Generated by Kellanator Strategy Tool')

    setReportText(lines.join('\n'))
    setGeneratingReport(false)
    setReportCopied(false)
  }

  const copyReportToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(reportText)
      setReportCopied(true)
      setTimeout(() => setReportCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const sendToDiscord = async () => {
    setDiscordSending(true)
    setDiscordError('')
    setDiscordSent(false)
    try {
      const res = await fetch('/api/discord-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportText }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDiscordError(data.error || 'Failed to send')
      } else {
        setDiscordSent(true)
        setTimeout(() => setDiscordSent(false), 3000)
      }
    } catch {
      setDiscordError('Failed to send to Discord')
    } finally {
      setDiscordSending(false)
    }
  }

  const addExclusion = (machine: string, player: string, format: 'singles' | 'doubles') => {
    if (format === 'singles') {
      const updated = { ...singlesExclusions }
      if (!updated[machine]) updated[machine] = []
      if (!updated[machine].includes(player)) {
        updated[machine] = [...updated[machine], player]
      }
      setSinglesExclusions(updated)
    } else {
      const updated = { ...doublesExclusions }
      if (!updated[machine]) updated[machine] = []
      if (!updated[machine].includes(player)) {
        updated[machine] = [...updated[machine], player]
      }
      setDoublesExclusions(updated)
    }
  }

  const removeExclusion = (machine: string, player: string, format: 'singles' | 'doubles') => {
    if (format === 'singles') {
      const updated = { ...singlesExclusions }
      updated[machine] = (updated[machine] || []).filter(p => p !== player)
      if (updated[machine].length === 0) delete updated[machine]
      setSinglesExclusions(updated)
    } else {
      const updated = { ...doublesExclusions }
      updated[machine] = (updated[machine] || []).filter(p => p !== player)
      if (updated[machine].length === 0) delete updated[machine]
      setDoublesExclusions(updated)
    }
  }

  const addMachineExclusion = (machine: string) => {
    if (!excludedMachines.includes(machine)) {
      setExcludedMachines(prev => [...prev, machine])
    }
  }

  const removeMachineExclusion = (machine: string) => {
    setExcludedMachines(prev => prev.filter(m => m !== machine))
  }

  // Save exclusions to localStorage
  useEffect(() => {
    try {
      if (Object.keys(singlesExclusions).length > 0) {
        localStorage.setItem('singlesPlayerExclusions', JSON.stringify(singlesExclusions))
      } else {
        localStorage.removeItem('singlesPlayerExclusions')
      }
    } catch { /* ignore */ }
  }, [singlesExclusions])

  useEffect(() => {
    try {
      if (Object.keys(doublesExclusions).length > 0) {
        localStorage.setItem('doublesPlayerExclusions', JSON.stringify(doublesExclusions))
      } else {
        localStorage.removeItem('doublesPlayerExclusions')
      }
    } catch { /* ignore */ }
  }, [doublesExclusions])

  // Save excluded machines to localStorage
  useEffect(() => {
    try {
      if (excludedMachines.length > 0) {
        localStorage.setItem('excludedMachines', JSON.stringify(excludedMachines))
      } else {
        localStorage.removeItem('excludedMachines')
      }
    } catch { /* ignore */ }
  }, [excludedMachines])

  // Auto re-run optimization when exclusions change
  useEffect(() => {
    if (singlesRecommendations.length > 0) {
      optimizeSinglesPicks()
    }
  }, [singlesExclusions]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (doublesRecommendations.length > 0) {
      optimizeDoublesPicks()
    }
  }, [doublesExclusions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Assignment exclusion helpers
  const addAssignExclusion = (machine: string, player: string, format: 'singles' | 'doubles') => {
    if (format === 'singles') {
      const updated = { ...singlesAssignExclusions }
      if (!updated[machine]) updated[machine] = []
      if (!updated[machine].includes(player)) {
        updated[machine] = [...updated[machine], player]
      }
      setSinglesAssignExclusions(updated)
    } else {
      const updated = { ...doublesAssignExclusions }
      if (!updated[machine]) updated[machine] = []
      if (!updated[machine].includes(player)) {
        updated[machine] = [...updated[machine], player]
      }
      setDoublesAssignExclusions(updated)
    }
  }

  const removeAssignExclusion = (machine: string, player: string, format: 'singles' | 'doubles') => {
    if (format === 'singles') {
      const updated = { ...singlesAssignExclusions }
      updated[machine] = (updated[machine] || []).filter(p => p !== player)
      if (updated[machine].length === 0) delete updated[machine]
      setSinglesAssignExclusions(updated)
    } else {
      const updated = { ...doublesAssignExclusions }
      updated[machine] = (updated[machine] || []).filter(p => p !== player)
      if (updated[machine].length === 0) delete updated[machine]
      setDoublesAssignExclusions(updated)
    }
  }

  // Save assignment exclusions to localStorage
  useEffect(() => {
    try {
      if (Object.keys(singlesAssignExclusions).length > 0) {
        localStorage.setItem('singlesAssignExclusions', JSON.stringify(singlesAssignExclusions))
      } else {
        localStorage.removeItem('singlesAssignExclusions')
      }
    } catch { /* ignore */ }
  }, [singlesAssignExclusions])

  useEffect(() => {
    try {
      if (Object.keys(doublesAssignExclusions).length > 0) {
        localStorage.setItem('doublesAssignExclusions', JSON.stringify(doublesAssignExclusions))
      } else {
        localStorage.removeItem('doublesAssignExclusions')
      }
    } catch { /* ignore */ }
  }, [doublesAssignExclusions])

  // Auto re-run assignment optimization when exclusions change
  useEffect(() => {
    if (singlesAssignments.length > 0) {
      optimizeSinglesAssignments()
    }
  }, [singlesAssignExclusions]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (doublesAssignments.length > 0) {
      optimizeDoublesAssignments()
    }
  }, [doublesAssignExclusions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto re-run all active optimizations when machine exclusions change
  useEffect(() => {
    if (singlesRecommendations.length > 0) optimizeSinglesPicks()
    if (doublesRecommendations.length > 0) optimizeDoublesPicks()
    if (singlesAssignments.length > 0) optimizeSinglesAssignments()
    if (doublesAssignments.length > 0) optimizeDoublesAssignments()
  }, [excludedMachines]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMachine = (machine: string, format: 'singles' | 'doubles') => {
    if (format === 'singles') {
      setSinglesOpponentPicks(prev =>
        prev.includes(machine) ? prev.filter(m => m !== machine) : [...prev, machine]
      )
    } else {
      setDoublesOpponentPicks(prev =>
        prev.includes(machine) ? prev.filter(m => m !== machine) : [...prev, machine]
      )
    }
  }

  const loadPlayerAnalysis = async () => {
    if (!selectedAnalysisPlayer) {
      setPlayerAnalysis(null)
      return
    }

    setLoadingAnalysis(true)
    try {
      const response = await fetch(
        `/api/player-analysis?` +
        `player=${encodeURIComponent(selectedAnalysisPlayer)}` +
        `&venue=${encodeURIComponent(selectedVenue)}` +
        `&seasonStart=${seasonRange[0]}` +
        `&seasonEnd=${seasonRange[1]}` +
        `&allVenues=${showAllVenues}` +
        `&machines=${encodeURIComponent((venues.find(v => v.name === selectedVenue)?.machines || []).join(','))}`
      )

      if (response.ok) {
        const data = await response.json()
        setPlayerAnalysis(data)
      } else {
        setPlayerAnalysis(null)
      }
    } catch (error) {
      console.error('Error loading player analysis:', error)
      setPlayerAnalysis(null)
    } finally {
      setLoadingAnalysis(false)
    }
  }

  useEffect(() => {
    if (selectedAnalysisPlayer && selectedVenue) {
      loadPlayerAnalysis()
    }
  }, [selectedAnalysisPlayer, showAllVenues, selectedVenue, seasonRange])

  const loadMatrixData = async () => {
    if (!selectedVenue || !selectedOpponent || rosterPlayers.length === 0) {
      setMatrixData(null)
      return
    }

    setLoadingMatrix(true)
    try {
      // Get available machines from the venue
      const venue = venues.find(v => v.name === selectedVenue)
      if (!venue || !venue.machines || venue.machines.length === 0) {
        console.error('No machines found for venue:', selectedVenue)
        setMatrixData(null)
        return
      }

      // Get selected players (those who are checked as available)
      const selectedPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p])

      // If no players selected, use all roster players
      const playersToUse = selectedPlayers.length > 0 ? selectedPlayers : rosterPlayers

      if (playersToUse.length === 0) {
        console.error('No players available')
        setMatrixData(null)
        return
      }

      // Only pass venue parameter if NOT showing all venues
      const venueParam = heatmapShowAllVenues ? '' : `&venue=${encodeURIComponent(selectedVenue)}`
      const venueWeightParam = heatmapShowAllVenues ? '' : `&venueWeight=${venueWeight / 100}`
      const userInputWeightParam = userInputWeight > 0 ? `&userInputWeight=${userInputWeight / 100}` : ''

      const response = await fetch(
        `/api/strategy/matrix?` +
        `playerNames=${encodeURIComponent(playersToUse.join(','))}` +
        `&machines=${encodeURIComponent(venue.machines.join(','))}` +
        `&seasonStart=${seasonRange[0]}` +
        `&seasonEnd=${seasonRange[1]}` +
        venueParam +
        venueWeightParam +
        userInputWeightParam
      )

      if (response.ok) {
        const data = await response.json()

        // Convert serialized object back to Map structure
        const statsMap = new Map<string, Map<string, PlayerMachineStats>>()

        for (const [playerName, machineStats] of Object.entries(data.statsMap || {})) {
          const machineMap = new Map<string, PlayerMachineStats>()
          for (const [machineName, stats] of Object.entries(machineStats as Record<string, PlayerMachineStats>)) {
            machineMap.set(machineName, stats)
          }
          statsMap.set(playerName, machineMap)
        }

        setMatrixData({
          playerNames: data.playerNames,
          machines: data.machines,
          statsMap
        })
      } else {
        console.error('Failed to load matrix data:', response.statusText)
        setMatrixData(null)
      }
    } catch (error) {
      console.error('Error loading matrix data:', error)
      setMatrixData(null)
    } finally {
      setLoadingMatrix(false)
    }
  }

  useEffect(() => {
    if (selectedVenue && selectedOpponent && rosterPlayers.length > 0) {
      loadMatrixData()
    }
  }, [selectedVenue, selectedOpponent, seasonRange, rosterPlayers, availablePlayers, heatmapShowAllVenues]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCellClick = async (machine: string, columnKey: string) => {
    // Don't allow clicking on machine name column
    if (columnKey === 'machine') return

    // Map column keys to labels for the cell-details API
    const columnMap: Record<string, string> = {
      'twcPctOfVenue': 'TWC Avg',
      'opponentPctOfVenue': 'Team Avg',
    }

    const columnLabel = columnMap[columnKey] || columnKey

    setSelectedCell({ machine, column: columnLabel })
    setCellDetailsOpen(true)
    setLoadingDetails(true)

    try {
      const response = await fetch(
        `/api/cell-details?` +
        `machine=${encodeURIComponent(machine)}` +
        `&column=${encodeURIComponent(columnLabel)}` +
        `&venue=${encodeURIComponent(selectedVenue)}` +
        `&team=${encodeURIComponent(selectedOpponent)}` +
        `&twcTeam=${encodeURIComponent('The Wrecking Crew')}` +
        `&seasonStart=${seasonRange[0]}` +
        `&seasonEnd=${seasonRange[1]}` +
        `&teamVenueSpecific=${teamVenueSpecific}` +
        `&twcVenueSpecific=${twcVenueSpecific}`
      )

      if (response.ok) {
        const data = await response.json()
        setCellDetails(data)
      } else {
        setCellDetails(null)
      }
    } catch (error) {
      console.error('Error fetching cell details:', error)
      setCellDetails(null)
    } finally {
      setLoadingDetails(false)
    }
  }

  // Sort handler for machine advantages table
  const handleAdvSort = (column: string) => {
    if (advSortColumn === column) {
      setAdvSortDirection(advSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setAdvSortColumn(column)
      setAdvSortDirection(column === 'machine' ? 'asc' : 'desc')
    }
  }

  const getSortedAdvantages = () => {
    return [...machineAdvantages].sort((a, b) => {
      let aVal: any = (a as any)[advSortColumn]
      let bVal: any = (b as any)[advSortColumn]

      // Handle arrays (topTwcPlayers)
      if (Array.isArray(aVal)) aVal = aVal.join(', ')
      if (Array.isArray(bVal)) bVal = bVal.join(', ')

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = bVal?.toLowerCase() || ''
        return advSortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      aVal = aVal || 0
      bVal = bVal || 0
      return advSortDirection === 'asc' ? aVal - bVal : bVal - aVal
    })
  }

  // Sort handler for player analysis table
  const handleAnalysisSort = (column: string) => {
    if (analysisSortColumn === column) {
      setAnalysisSortDirection(analysisSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setAnalysisSortColumn(column)
      setAnalysisSortDirection(column === 'machine' || column === 'bestVenue' ? 'asc' : 'desc')
    }
  }

  const getSortedAnalysis = () => {
    if (!playerAnalysis?.machinePerformance) return []
    return [...playerAnalysis.machinePerformance].sort((a: any, b: any) => {
      let aVal = a[analysisSortColumn]
      let bVal = b[analysisSortColumn]

      if (typeof aVal === 'string') {
        aVal = aVal?.toLowerCase() || ''
        bVal = bVal?.toLowerCase() || ''
        return analysisSortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      aVal = aVal || 0
      bVal = bVal || 0
      return analysisSortDirection === 'asc' ? aVal - bVal : bVal - aVal
    })
  }

  // Sort handler for cell details dialog
  const handleCellSort = (column: string) => {
    if (cellSortColumn === column) {
      setCellSortDirection(cellSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setCellSortColumn(column)
      setCellSortDirection(column === 'score' || column === 'points' ? 'desc' : 'asc')
    }
  }

  const getSortedCellDetails = () => {
    if (!cellDetails?.details) return []
    return [...cellDetails.details].sort((a: any, b: any) => {
      let aVal = a[cellSortColumn]
      let bVal = b[cellSortColumn]

      if (aVal === undefined || aVal === null) return 1
      if (bVal === undefined || bVal === null) return -1

      if (typeof aVal === 'string') {
        return cellSortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      return cellSortDirection === 'asc' ? aVal - bVal : bVal - aVal
    })
  }

  // Sort icon component
  const SortIcon = ({ column, currentColumn, direction }: { column: string, currentColumn: string, direction: 'asc' | 'desc' }) => {
    if (column !== currentColumn) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />
    return direction === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />
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
    <div className="container mx-auto p-3 md:p-6">
      <Card>
        <CardContent className="pt-4 md:pt-6 px-3 md:px-6">
          {/* Filters - same as stats page */}
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

            {/* Venue-Specific Checkboxes */}
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
              </div>
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin mr-2" />
              <span>Loading strategic analysis...</span>
            </div>
          )}

          {!loading && selectedVenue && selectedOpponent && (
            <>
              {/* Player Availability Section */}
              <PlayerAvailability
                storageKey="twcPlayerAvailability"
                title="TWC Player Availability"
                rosterPlayers={rosterPlayers}
                subPlayers={subPlayers}
                availablePlayers={availablePlayers}
                onChange={setAvailablePlayers}
                lockedPlayers={satOutPlayers}
                onAddSub={handleAddTwcSub}
                onRemoveSub={handleRemoveTwcSub}
                addedSubs={twcAddedSubs}
              />

              <PlayerAvailability
                storageKey={`opponentPlayerAvailability_${selectedOpponent}`}
                title={`${selectedOpponent} Player Availability`}
                rosterPlayers={opponentRosterPlayers}
                subPlayers={opponentSubPlayers}
                availablePlayers={opponentAvailablePlayers}
                onChange={setOpponentAvailablePlayers}
                onAddSub={handleAddOpponentSub}
                onRemoveSub={handleRemoveOpponentSub}
                addedSubs={opponentAddedSubs}
              />

              {/* Machine Advantage Table */}
              <div className="mb-4 md:mb-6">
                <button
                  className="flex items-center gap-1 w-full text-left"
                  onClick={() => {
                    const next = !showAdvantageTable
                    setShowAdvantageTable(next)
                    localStorage.setItem('showAdvantageTable', String(next))
                  }}
                >
                  {showAdvantageTable ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  <h3 className="text-sm md:text-lg font-semibold">Machine Advantage Analysis</h3>
                </button>
                {showAdvantageTable && (
                  <>
                    <p className="text-xs md:text-sm text-muted-foreground mb-2 md:mb-3 mt-2">
                      Machines ranked by strategic advantage for TWC vs {selectedOpponent} at {selectedVenue}
                    </p>
                    {machineAdvantages.length > 0 && (
                      <div className="overflow-x-auto">
                        <Table className="text-[11px] md:text-sm">
                          <TableHeader>
                            <TableRow>
                              <TableHead
                                className="px-1.5 md:px-4 cursor-pointer hover:bg-muted/50"
                                onClick={() => handleAdvSort('machine')}
                              >
                                <div className="flex items-center">
                                  Machine
                                  <SortIcon column="machine" currentColumn={advSortColumn} direction={advSortDirection} />
                                </div>
                              </TableHead>
                              <TableHead
                                className="px-1.5 md:px-4 cursor-pointer hover:bg-muted/50"
                                onClick={() => handleAdvSort('compositeScore')}
                              >
                                <div className="flex items-center">
                                  <span className="md:hidden">Score</span><span className="hidden md:inline">Composite Score</span>
                                  <SortIcon column="compositeScore" currentColumn={advSortColumn} direction={advSortDirection} />
                                </div>
                              </TableHead>
                              <TableHead
                                className="px-1.5 md:px-4 cursor-pointer hover:bg-muted/50"
                                onClick={() => handleAdvSort('twcPctOfVenue')}
                              >
                                <div className="flex items-center">
                                  <span className="md:hidden">TWC%</span><span className="hidden md:inline">TWC % of Venue</span>
                                  <SortIcon column="twcPctOfVenue" currentColumn={advSortColumn} direction={advSortDirection} />
                                </div>
                              </TableHead>
                              <TableHead
                                className="px-1.5 md:px-4 cursor-pointer hover:bg-muted/50"
                                onClick={() => handleAdvSort('opponentPctOfVenue')}
                              >
                                <div className="flex items-center">
                                  <span className="md:hidden">Opp%</span><span className="hidden md:inline">Opponent % of Venue</span>
                                  <SortIcon column="opponentPctOfVenue" currentColumn={advSortColumn} direction={advSortDirection} />
                                </div>
                              </TableHead>
                              <TableHead
                                className="px-1.5 md:px-4 cursor-pointer hover:bg-muted/50"
                                onClick={() => handleAdvSort('statisticalAdvantage')}
                              >
                                <div className="flex items-center">
                                  <span className="md:hidden">Adv</span><span className="hidden md:inline">Statistical Advantage</span>
                                  <SortIcon column="statisticalAdvantage" currentColumn={advSortColumn} direction={advSortDirection} />
                                </div>
                              </TableHead>
                              <TableHead
                                className="px-1.5 md:px-4 cursor-pointer hover:bg-muted/50"
                                onClick={() => handleAdvSort('advantageLevel')}
                              >
                                <div className="flex items-center">
                                  <span className="md:hidden">Lvl</span><span className="hidden md:inline">Advantage Level</span>
                                  <SortIcon column="advantageLevel" currentColumn={advSortColumn} direction={advSortDirection} />
                                </div>
                              </TableHead>
                              <TableHead
                                className="px-1.5 md:px-4 cursor-pointer hover:bg-muted/50"
                                onClick={() => handleAdvSort('topTwcPlayers')}
                              >
                                <div className="flex items-center">
                                  <span className="md:hidden">Players</span><span className="hidden md:inline">Top TWC Players</span>
                                  <SortIcon column="topTwcPlayers" currentColumn={advSortColumn} direction={advSortDirection} />
                                </div>
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {getSortedAdvantages().map((adv, index) => (
                              <TableRow key={adv.machine}>
                                <TableCell className="font-medium px-1.5 md:px-4 max-w-[80px] md:max-w-none truncate">{adv.machine}</TableCell>
                                <TableCell className="px-1.5 md:px-4">{adv.compositeScore?.toFixed(1) || 'N/A'}</TableCell>
                                <TableCell
                                  className="cursor-pointer hover:bg-muted/50 px-1.5 md:px-4"
                                  onClick={() => handleCellClick(adv.machine, 'twcPctOfVenue')}
                                >
                                  {adv.twcPctOfVenue?.toFixed(1) || 'N/A'}%
                                </TableCell>
                                <TableCell
                                  className="cursor-pointer hover:bg-muted/50 px-1.5 md:px-4"
                                  onClick={() => handleCellClick(adv.machine, 'opponentPctOfVenue')}
                                >
                                  {adv.opponentPctOfVenue?.toFixed(1) || 'N/A'}%
                                </TableCell>
                                <TableCell className="px-1.5 md:px-4">{adv.statisticalAdvantage?.toFixed(1) || 'N/A'}</TableCell>
                                <TableCell className="px-1.5 md:px-4">
                                  <span className={`px-1 md:px-2 py-0.5 md:py-1 rounded text-[10px] md:text-xs ${
                                    adv.advantageLevel === 'High' ? 'bg-green-100 text-green-800' :
                                    adv.advantageLevel === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-gray-100 text-gray-800'
                                  }`}>
                                    {adv.advantageLevel}
                                  </span>
                                </TableCell>
                                <TableCell className="text-[10px] md:text-xs px-1.5 md:px-4 max-w-[70px] md:max-w-none truncate">{adv.topTwcPlayers?.filter(p => availablePlayers[p]).join(', ') || 'N/A'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Create Report Button */}
              <div className="flex justify-end mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateReport}
                  disabled={generatingReport}
                  className="text-xs"
                >
                  {generatingReport ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    'Create Report'
                  )}
                </Button>
              </div>

              {/* Strategic Planning Tabs */}
              <Tabs defaultValue="picking" className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-4 md:mb-6">
                  <TabsTrigger value="picking" className="text-[10px] md:text-sm px-1 md:px-3"><span className="md:hidden">Picking</span><span className="hidden md:inline">Machine Picking</span></TabsTrigger>
                  <TabsTrigger value="assignment" className="text-[10px] md:text-sm px-1 md:px-3"><span className="md:hidden">Assignment</span><span className="hidden md:inline">Player Assignment</span></TabsTrigger>
                  <TabsTrigger value="analysis" className="text-[10px] md:text-sm px-1 md:px-3"><span className="md:hidden">Analysis</span><span className="hidden md:inline">Player Analysis</span></TabsTrigger>
                </TabsList>

                <TabsContent value="picking" className="space-y-4">

                  <div className="p-4 border rounded bg-muted/20 space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium">Score Factor Weights</h4>
                      <div className="flex gap-2">
                        {isSlidersDirty && (
                          <Button size="sm" variant="default" onClick={applySliderChanges}>
                            Apply
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={resetSliders} className="text-xs">
                          Reset
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Win Rate</div>
                      <input type="range" min={0} max={100} step={1} value={winRateWeight}
                        onChange={(e) => handleScoreWeightChange('winRate', parseInt(e.target.value))}
                        className="flex-1 min-w-0 accent-primary h-2" />
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{winRateWeight}%</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Recent Form</div>
                      <input type="range" min={0} max={100} step={1} value={recentFormWeight}
                        onChange={(e) => handleScoreWeightChange('recentForm', parseInt(e.target.value))}
                        className="flex-1 min-w-0 accent-primary h-2" />
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{recentFormWeight}%</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Score vs Venue Avg</div>
                      <div className="flex-1 min-w-0 bg-muted rounded-full h-2">
                        <div className="bg-primary/50 rounded-full h-2" style={{ width: `${venueAvgWeight}%` }} />
                      </div>
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{venueAvgWeight}%</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Data Confidence</div>
                      <input type="range" min={0} max={100} step={1} value={dataConfidenceWeight}
                        onChange={(e) => handleScoreWeightChange('dataConfidence', parseInt(e.target.value))}
                        className="flex-1 min-w-0 accent-primary h-2" />
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{dataConfidenceWeight}%</div>
                    </div>

                    <hr className="border-border my-2" />
                    <h4 className="text-sm font-medium mb-1">Adjustable Weights</h4>

                    <div className="space-y-0">
                      <div className="flex items-center gap-2">
                        <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Venue Weight</div>
                        <div className="flex-1 min-w-0">
                          <input type="range" min={0} max={100} step={1} value={venueWeight}
                            onChange={(e) => setVenueWeight(parseInt(e.target.value))}
                            className="w-full accent-primary h-2" />
                          <div className="flex justify-between text-[10px] text-muted-foreground -mt-0.5">
                            <span>All Venues</span>
                            <span>Venue Only</span>
                          </div>
                        </div>
                        <div className="w-10 md:w-12 text-xs text-right shrink-0">{venueWeight}%</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">User Input Weight</div>
                      <input type="range" min={0} max={100} step={1} value={userInputWeight}
                        onChange={(e) => setUserInputWeight(parseInt(e.target.value))}
                        className="flex-1 min-w-0 accent-primary h-2" />
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{userInputWeight}%</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Confidence Boost</div>
                      <input type="range" min={0} max={100} step={1} value={confidenceBoost}
                        onChange={(e) => setConfidenceBoost(parseInt(e.target.value))}
                        className="flex-1 min-w-0 accent-primary h-2" />
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{confidenceBoost}%</div>
                    </div>

                    <div className="space-y-0">
                      <div className="flex items-center gap-2">
                        <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Opponent Weight</div>
                        <div className="flex-1 min-w-0">
                          <input type="range" min={0} max={100} step={1} value={opponentWeight}
                            onChange={(e) => setOpponentWeight(parseInt(e.target.value))}
                            className="w-full accent-primary h-2" />
                          <div className="flex justify-between text-[10px] text-muted-foreground -mt-0.5">
                            <span>Ignore</span>
                            <span>Target Weakness</span>
                          </div>
                        </div>
                        <div className="w-10 md:w-12 text-xs text-right shrink-0">{opponentWeight}%</div>
                      </div>
                      {opponentWeight > 0 && (
                        <label className="flex items-center gap-1.5 mt-1 ml-24 md:ml-48 text-[10px] text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={useNashEquilibrium}
                            onChange={() => setUseNashEquilibrium(!useNashEquilibrium)}
                            className="h-3 w-3 accent-primary"
                          />
                          Nash Equilibrium (Hungarian iterates until stable)
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Sat-Out Tracking */}
                  <div className="mb-3">
                    <label className="text-[10px] md:text-xs font-medium mb-1.5 block text-muted-foreground">Sat Out (must play):</label>
                    <div className="flex flex-wrap gap-1 md:gap-1.5">
                      {Object.keys(availablePlayers).filter(p => availablePlayers[p]).map(player => {
                        const hasSat = satOutPlayers.has(player)
                        return (
                          <button
                            key={player}
                            onClick={() => toggleSatOut(player)}
                            className={`px-2 py-0.5 rounded text-[10px] md:text-xs border transition-all ${
                              hasSat
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-muted/30 text-muted-foreground border-muted/40 hover:border-muted-foreground/40'
                            }`}
                          >
                            {player}
                          </button>
                        )
                      })}
                    </div>
                    {satOutPlayers.size > 0 && (
                      <button
                        onClick={() => setSatOutPlayers(new Set())}
                        className="text-[9px] md:text-[10px] text-muted-foreground hover:text-foreground mt-1"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {/* Sit This Round */}
                  <div className="mb-3">
                    <label className="text-[10px] md:text-xs font-medium mb-1.5 block text-muted-foreground">Sit This Round (exclude):</label>
                    <div className="flex flex-wrap gap-1 md:gap-1.5">
                      {Object.keys(availablePlayers).filter(p => availablePlayers[p]).map(player => {
                        const isSitting = sitThisRound.has(player)
                        return (
                          <button
                            key={player}
                            onClick={() => toggleSitThisRound(player)}
                            className={`px-2 py-0.5 rounded text-[10px] md:text-xs border transition-all ${
                              isSitting
                                ? 'bg-destructive text-destructive-foreground border-destructive'
                                : 'bg-muted/30 text-muted-foreground border-muted/40 hover:border-muted-foreground/40'
                            }`}
                          >
                            {player}
                          </button>
                        )
                      })}
                    </div>
                    {sitThisRound.size > 0 && (
                      <button
                        onClick={() => setSitThisRound(new Set())}
                        className="text-[9px] md:text-[10px] text-muted-foreground hover:text-foreground mt-1"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  <Tabs defaultValue="singles" className="w-full">
                    <TabsList className="w-full grid grid-cols-2">
                      <TabsTrigger value="singles">Singles</TabsTrigger>
                      <TabsTrigger value="doubles">Doubles</TabsTrigger>
                    </TabsList>

                    <TabsContent value="singles" className="space-y-4">
                      <div className="flex justify-center">
                        <Button onClick={optimizeSinglesPicks}>
                          Optimize Singles Picks
                        </Button>
                      </div>

                      {/* Active machine exclusions */}
                      {excludedMachines.length > 0 && (
                        <div className="mt-4 space-y-1">
                          {excludedMachines.map((machine) => (
                            <div key={`machine-excl-${machine}`} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                              <span>{getMachineDisplayName(machine)} excluded from all results</span>
                              <button
                                className="ml-auto text-amber-500 hover:text-amber-700 dark:hover:text-amber-200"
                                onClick={() => removeMachineExclusion(machine)}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Active singles exclusions - shown above all results */}
                      {Object.keys(singlesExclusions).length > 0 && (
                        <div className="mt-4 space-y-1">
                          {Object.entries(singlesExclusions).map(([machine, players]) =>
                            players.map((player) => (
                              <div key={`${machine}-${player}`} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                                <span>{player} excluded from {machine}</span>
                                <button
                                  className="ml-auto text-amber-500 hover:text-amber-700 dark:hover:text-amber-200"
                                  onClick={() => removeExclusion(machine, player, 'singles')}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {singlesRecommendations.length > 0 && (
                        <div className="mt-4">
                          <div className="flex items-center gap-2 mb-3">
                            <h4 className="font-semibold">Recommended Machine Picks:</h4>
                            <button onClick={() => setShowVenueAvgInfo(!showVenueAvgInfo)} className="md:hidden text-muted-foreground hover:text-foreground">
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {showVenueAvgInfo && (
                            <div className="md:hidden mb-3 p-2 bg-muted rounded text-xs text-muted-foreground">
                              <strong>% of avg:</strong> Each game score is divided by the venue average where it was scored and then all ratios are averaged.
                            </div>
                          )}
                          {singlesRecommendations.map((rec, index) => {
                            const adv = rec.advantage
                            const isExpanded = expandedRecommendations[rec.machine] ?? false

                            return (
                              <Collapsible
                                key={`${rec.machine}-${recommendationsVersion}-${rec.blendedScore}`}
                                open={isExpanded}
                                onOpenChange={(open) => setExpandedRecommendations(prev => ({
                                  ...prev,
                                  [rec.machine]: open
                                }))}
                                className="mb-3"
                              >
                                <div className="border rounded overflow-hidden bg-background">
                                  <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 relative overflow-hidden bg-background">
                                    <div
                                      className="absolute right-0 top-0 bottom-0 w-1/2 opacity-50"
                                      style={{
                                        backgroundImage: `url(${getImagePath(rec.machine)})`,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                        backgroundRepeat: 'no-repeat'
                                      }}
                                    />
                                    <div className="text-left relative z-10">
                                      <div className="font-medium flex items-center gap-2">
                                        {index + 1}. {rec.machine}
                                        {rec.dataSource && rec.dataSource !== 'none' && (
                                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                            rec.dataSource === 'venue' ? 'bg-green-100 text-green-800' :
                                            rec.dataSource === 'all' ? 'bg-blue-100 text-blue-800' :
                                            'bg-purple-100 text-purple-800'
                                          }`}>
                                            {rec.dataSource === 'venue' ? 'venue' : rec.dataSource === 'all' ? 'all venues' : 'blended'}
                                          </span>
                                        )}
                                      </div>
                                      {rec.players && rec.players.length > 0 && (
                                        <div className="text-sm text-muted-foreground mt-1">
                                          {rec.players.join(', ')}
                                          {rec.assumedOpponents && rec.assumedOpponents.length > 0 && (
                                            <span className="text-red-500/70 dark:text-red-400/70"> vs {rec.assumedOpponents.map(o => o.player).join(', ')}</span>
                                          )}
                                        </div>
                                      )}
                                      <div className="text-sm text-muted-foreground mt-1">
                                        {rec.blendedScore != null && (
                                          <span>Avg Score: {rec.blendedScore.toLocaleString()}</span>
                                        )}
                                        {adv && (
                                          <span className="ml-3">Edge: {adv.compositeScore.toFixed(1)}</span>
                                        )}
                                      </div>
                                      {rec.stats && rec.stats.length > 0 && (
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                          {rec.stats.map(s => (
                                            <span key={s.player} className="text-[10px] text-muted-foreground">
                                              {rec.stats!.length > 1 && <span className="font-medium">{s.player}: </span>}
                                              {s.pctOfVenue != null && <span className="inline-flex items-center gap-0.5">{s.pctOfVenue}% of avg<span className="hidden md:inline" title="Each game score is divided by the venue average where it was scored and then all ratios are averaged."><Info className="h-2.5 w-2.5 text-muted-foreground" /></span></span>}
                                              {s.userAverage != null && (
                                                <span className="ml-1.5" title="User-reported average at this venue">
                                                  avg: {s.userAverage >= 1_000_000_000 ? `${(s.userAverage / 1_000_000_000).toFixed(1)}B` : s.userAverage >= 1_000_000 ? `${(s.userAverage / 1_000_000).toFixed(1)}M` : s.userAverage >= 1_000 ? `${(s.userAverage / 1_000).toFixed(1)}K` : s.userAverage}
                                                </span>
                                              )}
                                              {s.userConfidence != null && (
                                                <span className="ml-1.5" title="User confidence at this venue">conf: {s.userConfidence}/10</span>
                                              )}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div className="relative z-10">
                                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    </div>
                                  </CollapsibleTrigger>

                                  <CollapsibleContent className="px-3 pb-3">
                                    <div className="pt-3 border-t space-y-2">
                                      {adv && (
                                        <div className="grid grid-cols-2 gap-1.5 md:gap-2 text-xs md:text-sm">
                                          <div><strong>Advantage Level:</strong> {adv.advantageLevel}</div>
                                          <div><strong>Player % of Venue:</strong> {rec.stats && rec.stats.length > 1
                                            ? rec.stats.map(s => `${s.player}: ${s.pctOfVenue ?? 'N/A'}%`).join(', ')
                                            : `${adv.twcPctOfVenue.toFixed(1)}%`
                                          }</div>
                                          <div><strong>Opp % of Venue:</strong> {adv.opponentPctOfVenue.toFixed(1)}%</div>
                                          <div><strong>Score Edge:</strong> {adv.statisticalAdvantage.toFixed(1)}</div>
                                          <div><strong>Experience Edge:</strong> {adv.experienceAdvantage} plays</div>
                                          <div><strong>Player Plays:</strong> {adv.twcPlays}</div>
                                          {rec.opponentWeight != null && rec.opponentWeight > 0 && (
                                            <>
                                              <div><strong>Opp Weakness:</strong> <span className={rec.opponentWeakness != null && rec.opponentWeakness > 0 ? 'text-green-600 dark:text-green-400' : rec.opponentWeakness != null && rec.opponentWeakness < 0 ? 'text-red-600 dark:text-red-400' : ''}>{rec.opponentWeakness != null ? `${(rec.opponentWeakness * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                              <div><strong>Score Boost:</strong> <span className={rec.opponentWeakness != null && rec.opponentWeakness > 0 ? 'text-green-600 dark:text-green-400' : rec.opponentWeakness != null && rec.opponentWeakness < 0 ? 'text-red-600 dark:text-red-400' : ''}>{rec.opponentWeakness != null && rec.opponentWeight != null ? `${(rec.opponentWeight * rec.opponentWeakness * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                            </>
                                          )}
                                        </div>
                                      )}

                                      {renderAssumedOpponents(rec.assumedOpponents, `singles-pick-${rec.machine}`)}

                                      {/* Exclude player/machine buttons */}
                                      <div className="mt-2 md:mt-3 flex flex-wrap gap-1.5 md:gap-2">
                                        {rec.players && rec.players.length > 0 && rec.players.map((player) => (
                                          <Button
                                            key={player}
                                            variant="outline"
                                            size="sm"
                                            className="text-[10px] md:text-xs h-7 md:h-8 px-2 md:px-3"
                                            onClick={() => addExclusion(rec.machine, player, 'singles')}
                                          >
                                            Exclude {player}
                                          </Button>
                                        ))}
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="text-[10px] md:text-xs h-7 md:h-8 px-2 md:px-3 text-destructive border-destructive/50 hover:bg-destructive/10"
                                          onClick={() => addMachineExclusion(rec.machine)}
                                        >
                                          Exclude Machine
                                        </Button>
                                      </div>

                                      {/* Show Full Stats button and breakdown */}
                                      <div className="mt-3 pt-3 border-t">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-xs h-7 px-2"
                                          onClick={() => setShowFullStats(prev => ({ ...prev, [`singles-${rec.machine}`]: !prev[`singles-${rec.machine}`] }))}
                                        >
                                          {showFullStats[`singles-${rec.machine}`] ? 'Hide' : 'Show'} Full Stats
                                        </Button>

                                        {showFullStats[`singles-${rec.machine}`] && (
                                          <div className="mt-3 space-y-4 text-xs bg-muted/50 rounded p-3">
                                            {/* Current Slider Settings */}
                                            <div>
                                              <h5 className="font-semibold mb-2">Slider Settings Applied:</h5>
                                              <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                                                <div>Venue Weight: {venueWeight}%</div>
                                                <div>User Input Weight: {userInputWeight}%</div>
                                                <div>Confidence Boost: {confidenceBoost}%</div>
                                                <div>Opponent Weight: {opponentWeight}%</div>
                                                <div>Win Rate Weight: {winRateWeight}%</div>
                                                <div>Recent Form Weight: {recentFormWeight}%</div>
                                                <div>Data Confidence Weight: {dataConfidenceWeight}%</div>
                                                <div>Venue Avg Weight: {venueAvgWeight}%</div>
                                              </div>
                                            </div>

                                            {/* Per-player breakdown */}
                                            {rec.stats && rec.stats.map((s: any) => (
                                              <div key={s.player} className="border-t pt-3">
                                                <h5 className="font-semibold mb-2">{s.player} Stats:</h5>
                                                <div className="space-y-2">
                                                  <div className="grid grid-cols-2 gap-1">
                                                    <div>League Games: {s.playsCount || 0}</div>
                                                    <div>Avg Score: {s.avgScore?.toLocaleString() || 'N/A'}</div>
                                                    <div>Win Rate: {s.winRate != null ? `${s.winRate}%` : 'N/A'}</div>
                                                    <div>Recent Form: {s.recentForm != null ? `${s.recentForm}%` : 'N/A'}</div>
                                                    <div>% of Venue Avg: {s.pctOfVenue != null ? `${s.pctOfVenue}%` : 'N/A'}</div>
                                                    <div>Data Confidence: {s.confidenceScore || 0}/10</div>
                                                  </div>

                                                  {/* Detailed Score Breakdown */}
                                                  {s.scoreBreakdown && (
                                                    <div className="mt-2 pt-2 border-t border-dashed">
                                                      <div className="font-medium mb-2">Individual Scores Used:</div>

                                                      {/* League Scores */}
                                                      {s.scoreBreakdown.leagueScores?.length > 0 && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">League Games ({s.scoreBreakdown.leagueScores.length}):</div>
                                                          <div className="max-h-32 overflow-y-auto bg-background/50 rounded p-1">
                                                            <table className="w-full text-[10px]">
                                                              <thead>
                                                                <tr className="text-muted-foreground">
                                                                  <th className="text-left px-1">Score</th>
                                                                  <th className="text-left px-1">Venue Avg</th>
                                                                  <th className="text-left px-1">Ratio</th>
                                                                  <th className="text-left px-1">W/L</th>
                                                                </tr>
                                                              </thead>
                                                              <tbody>
                                                                {s.scoreBreakdown.leagueScores.map((score: any, idx: number) => (
                                                                  <tr key={idx} className={score.won ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                                                    <td className="px-1">{score.score.toLocaleString()}</td>
                                                                    <td className="px-1">{Math.round(score.venueAvg).toLocaleString()}</td>
                                                                    <td className="px-1">{(score.ratio * 100).toFixed(0)}%</td>
                                                                    <td className="px-1">{score.won ? 'W' : 'L'}</td>
                                                                  </tr>
                                                                ))}
                                                              </tbody>
                                                            </table>
                                                          </div>
                                                          <div className="text-[10px] text-muted-foreground mt-1">
                                                            League Avg Ratio: {((s.scoreBreakdown.leagueVenueAdjustedAvg || 1) * 100).toFixed(1)}%
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Scores */}
                                                      {s.scoreBreakdown.userScores?.length > 0 && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">Logged Scores ({s.scoreBreakdown.userScores.length}, 1x weight each):</div>
                                                          <div className="max-h-24 overflow-y-auto bg-background/50 rounded p-1">
                                                            <table className="w-full text-[10px]">
                                                              <thead>
                                                                <tr className="text-muted-foreground">
                                                                  <th className="text-left px-1">Score</th>
                                                                  <th className="text-left px-1">Venue Avg</th>
                                                                  <th className="text-left px-1">Ratio</th>
                                                                </tr>
                                                              </thead>
                                                              <tbody>
                                                                {s.scoreBreakdown.userScores.map((score: any, idx: number) => (
                                                                  <tr key={idx}>
                                                                    <td className="px-1">{score.score.toLocaleString()}</td>
                                                                    <td className="px-1">{Math.round(score.venueAvg).toLocaleString()}</td>
                                                                    <td className="px-1">{(score.ratio * 100).toFixed(0)}%</td>
                                                                  </tr>
                                                                ))}
                                                              </tbody>
                                                            </table>
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Input Average */}
                                                      {s.scoreBreakdown.userInputAverage && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">Self-Reported Average (3x weight):</div>
                                                          <div className="text-[10px] bg-background/50 rounded p-1">
                                                            {s.scoreBreakdown.userInputAverage.score.toLocaleString()} ÷ {Math.round(s.scoreBreakdown.userInputAverage.venueAvg).toLocaleString()} = {(s.scoreBreakdown.userInputAverage.ratio * 100).toFixed(1)}%
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Average Calculation */}
                                                      {(s.scoreBreakdown.userScores?.length > 0 || s.scoreBreakdown.userInputAverage) && (
                                                        <div className="text-[10px] text-muted-foreground">
                                                          User Data Avg Ratio: {s.scoreBreakdown.userVenueAdjustedAvg != null ? `${(s.scoreBreakdown.userVenueAdjustedAvg * 100).toFixed(1)}%` : 'N/A'}
                                                        </div>
                                                      )}

                                                      {/* Final Blended Calculation */}
                                                      <div className="mt-2 pt-2 border-t border-dashed">
                                                        <div className="text-[10px] font-medium mb-1">Final Venue-Adjusted Avg Calculation:</div>
                                                        <div className="text-[10px] text-muted-foreground space-y-0.5">
                                                          {s.scoreBreakdown.userInputWeightApplied > 0 && s.scoreBreakdown.userVenueAdjustedAvg != null ? (
                                                            <>
                                                              <div>= League × (1 - {(s.scoreBreakdown.userInputWeightApplied * 100).toFixed(0)}%) + User × {(s.scoreBreakdown.userInputWeightApplied * 100).toFixed(0)}%</div>
                                                              <div>= {((s.scoreBreakdown.leagueVenueAdjustedAvg || 1) * 100).toFixed(1)}% × {(1 - s.scoreBreakdown.userInputWeightApplied).toFixed(2)} + {(s.scoreBreakdown.userVenueAdjustedAvg * 100).toFixed(1)}% × {s.scoreBreakdown.userInputWeightApplied.toFixed(2)}</div>
                                                              <div className="font-medium text-foreground">= {(s.scoreBreakdown.finalVenueAdjustedAvg * 100).toFixed(1)}% of venue average</div>
                                                            </>
                                                          ) : (
                                                            <div className="font-medium text-foreground">= {(s.scoreBreakdown.finalVenueAdjustedAvg * 100).toFixed(1)}% of venue average (league only)</div>
                                                          )}
                                                        </div>
                                                      </div>
                                                    </div>
                                                  )}

                                                  {(s.userAverage != null || s.userConfidence != null) && !s.scoreBreakdown && (
                                                    <div className="mt-2 pt-2 border-t border-dashed">
                                                      <div className="font-medium mb-1">User Input Data:</div>
                                                      <div className="grid grid-cols-2 gap-1">
                                                        {s.userAverage != null && <div>Self-Reported Avg: {s.userAverage.toLocaleString()}</div>}
                                                        {s.userConfidence != null && <div>Self-Reported Confidence: {s.userConfidence}/10</div>}
                                                      </div>
                                                    </div>
                                                  )}

                                                  <div className="mt-2 pt-2 border-t border-dashed">
                                                    <div className="font-medium mb-1">Performance Score Calculation:</div>
                                                    <div className="text-muted-foreground space-y-1">
                                                      <div>= (Win Rate × {winRateWeight}%) + (Recent Form × {recentFormWeight}%) + (Venue Adj × {venueAvgWeight}%) + (Data Conf × {dataConfidenceWeight}%)</div>
                                                      <div>= ({s.winRate ?? 0}/100 × {winRateWeight/100}) + ({s.recentForm ?? 0}/100 × {recentFormWeight/100}) + (min({(s.pctOfVenue ?? 100)}/200, 1) × {venueAvgWeight/100}) + ({s.confidenceScore ?? 0}/10 × {dataConfidenceWeight/100})</div>
                                                      <div className="font-medium text-foreground">= Performance Score: {s.performanceScore ?? 'N/A'}</div>
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            ))}

                                            {/* Explanation */}
                                            <div className="border-t pt-3 text-muted-foreground">
                                              <h5 className="font-semibold mb-1 text-foreground">How it works:</h5>
                                              <ul className="list-disc list-inside space-y-1">
                                                <li><strong>Venue Weight:</strong> Blends venue-specific stats ({venueWeight}%) with all-venue stats ({100-venueWeight}%)</li>
                                                <li><strong>User Input Weight:</strong> Blends your logged scores/averages ({userInputWeight}%) with league data ({100-userInputWeight}%)</li>
                                                <li><strong>Confidence Boost:</strong> Blends your self-reported confidence ({confidenceBoost}%) into the final score</li>
                                                <li><strong>Score Factors:</strong> Win Rate ({winRateWeight}%), Recent Form ({recentFormWeight}%), Venue Avg ({venueAvgWeight}%), Data Confidence ({dataConfidenceWeight}%)</li>
                                                {opponentWeight > 0 && <li><strong>Opponent Weight:</strong> Scores are adjusted by {opponentWeight}% of opponent weakness per machine. Positive weakness (opponent below venue avg) boosts scores, negative (above avg) penalizes.</li>}
                                              </ul>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            )
                          })}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="doubles" className="space-y-4">
                      <div className="flex justify-center">
                        <Button onClick={optimizeDoublesPicks}>
                          Optimize Doubles Picks
                        </Button>
                      </div>

                      {/* Active machine exclusions */}
                      {excludedMachines.length > 0 && (
                        <div className="mt-4 space-y-1">
                          {excludedMachines.map((machine) => (
                            <div key={`machine-excl-${machine}`} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                              <span>{getMachineDisplayName(machine)} excluded from all results</span>
                              <button
                                className="ml-auto text-amber-500 hover:text-amber-700 dark:hover:text-amber-200"
                                onClick={() => removeMachineExclusion(machine)}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Active doubles exclusions - shown above all results */}
                      {Object.keys(doublesExclusions).length > 0 && (
                        <div className="mt-4 space-y-1">
                          {Object.entries(doublesExclusions).map(([machine, players]) =>
                            players.map((player) => (
                              <div key={`${machine}-${player}`} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                                <span>{player} excluded from {machine}</span>
                                <button
                                  className="ml-auto text-amber-500 hover:text-amber-700 dark:hover:text-amber-200"
                                  onClick={() => removeExclusion(machine, player, 'doubles')}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {doublesRecommendations.length > 0 && (
                        <div className="mt-4">
                          <div className="flex items-center gap-2 mb-3">
                            <h4 className="font-semibold">Recommended Machine Picks:</h4>
                            <button onClick={() => setShowVenueAvgInfo(!showVenueAvgInfo)} className="md:hidden text-muted-foreground hover:text-foreground">
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {showVenueAvgInfo && (
                            <div className="md:hidden mb-3 p-2 bg-muted rounded text-xs text-muted-foreground">
                              <strong>% of avg:</strong> Each game score is divided by the venue average where it was scored and then all ratios are averaged.
                            </div>
                          )}
                          {doublesRecommendations.map((rec, index) => {
                            const adv = rec.advantage
                            const isExpanded = expandedRecommendations[rec.machine] ?? false

                            return (
                              <Collapsible
                                key={`${rec.machine}-${recommendationsVersion}-${rec.blendedScore}`}
                                open={isExpanded}
                                onOpenChange={(open) => setExpandedRecommendations(prev => ({
                                  ...prev,
                                  [rec.machine]: open
                                }))}
                                className="mb-3"
                              >
                                <div className="border rounded overflow-hidden bg-background">
                                  <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 relative overflow-hidden bg-background">
                                    <div
                                      className="absolute right-0 top-0 bottom-0 w-1/2 opacity-50"
                                      style={{
                                        backgroundImage: `url(${getImagePath(rec.machine)})`,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                        backgroundRepeat: 'no-repeat'
                                      }}
                                    />
                                    <div className="text-left relative z-10">
                                      <div className="font-medium flex items-center gap-2">
                                        {index + 1}. {rec.machine}
                                        {rec.dataSource && rec.dataSource !== 'none' && (
                                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                            rec.dataSource === 'venue' ? 'bg-green-100 text-green-800' :
                                            rec.dataSource === 'all' ? 'bg-blue-100 text-blue-800' :
                                            'bg-purple-100 text-purple-800'
                                          }`}>
                                            {rec.dataSource === 'venue' ? 'venue' : rec.dataSource === 'all' ? 'all venues' : 'blended'}
                                          </span>
                                        )}
                                      </div>
                                      {rec.players && rec.players.length > 0 && (
                                        <div className="text-sm text-muted-foreground mt-1">
                                          {rec.players.join(', ')}
                                          {rec.assumedOpponents && rec.assumedOpponents.length > 0 && (
                                            <span className="text-red-500/70 dark:text-red-400/70"> vs {rec.assumedOpponents.map(o => o.player).join(', ')}</span>
                                          )}
                                        </div>
                                      )}
                                      <div className="text-sm text-muted-foreground mt-1">
                                        {rec.blendedScore != null && (
                                          <span>Avg Score: {rec.blendedScore.toLocaleString()}</span>
                                        )}
                                        {adv && (
                                          <span className="ml-3">Edge: {adv.compositeScore.toFixed(1)}</span>
                                        )}
                                      </div>
                                      {rec.stats && rec.stats.length > 0 && (
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                          {rec.stats.map(s => (
                                            <span key={s.player} className="text-[10px] text-muted-foreground">
                                              <span className="font-medium">{s.player}: </span>
                                              {s.pctOfVenue != null && <span className="inline-flex items-center gap-0.5">{s.pctOfVenue}% of avg<span className="hidden md:inline" title="Each game score is divided by the venue average where it was scored and then all ratios are averaged."><Info className="h-2.5 w-2.5 text-muted-foreground" /></span></span>}
                                              {s.userAverage != null && (
                                                <span className="ml-1.5" title="User-reported average at this venue">
                                                  avg: {s.userAverage >= 1_000_000_000 ? `${(s.userAverage / 1_000_000_000).toFixed(1)}B` : s.userAverage >= 1_000_000 ? `${(s.userAverage / 1_000_000).toFixed(1)}M` : s.userAverage >= 1_000 ? `${(s.userAverage / 1_000).toFixed(1)}K` : s.userAverage}
                                                </span>
                                              )}
                                              {s.userConfidence != null && (
                                                <span className="ml-1.5" title="User confidence at this venue">conf: {s.userConfidence}/10</span>
                                              )}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div className="relative z-10">
                                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    </div>
                                  </CollapsibleTrigger>

                                  <CollapsibleContent className="px-3 pb-3">
                                    <div className="pt-3 border-t space-y-2">
                                      {adv && (
                                        <div className="grid grid-cols-2 gap-1.5 md:gap-2 text-xs md:text-sm">
                                          <div><strong>Advantage Level:</strong> {adv.advantageLevel}</div>
                                          <div><strong>Players % of Venue:</strong> {rec.stats && rec.stats.length > 1
                                            ? rec.stats.map(s => `${s.player}: ${s.pctOfVenue ?? 'N/A'}%`).join(', ')
                                            : `${adv.twcPctOfVenue.toFixed(1)}%`
                                          }</div>
                                          <div><strong>Opp % of Venue:</strong> {adv.opponentPctOfVenue.toFixed(1)}%</div>
                                          <div><strong>Score Edge:</strong> {adv.statisticalAdvantage.toFixed(1)}</div>
                                          <div><strong>Experience Edge:</strong> {adv.experienceAdvantage} plays</div>
                                          <div><strong>Players Plays:</strong> {adv.twcPlays}</div>
                                          {rec.opponentWeight != null && rec.opponentWeight > 0 && (
                                            <>
                                              <div><strong>Opp Weakness:</strong> <span className={rec.opponentWeakness != null && rec.opponentWeakness > 0 ? 'text-green-600 dark:text-green-400' : rec.opponentWeakness != null && rec.opponentWeakness < 0 ? 'text-red-600 dark:text-red-400' : ''}>{rec.opponentWeakness != null ? `${(rec.opponentWeakness * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                              <div><strong>Score Boost:</strong> <span className={rec.opponentWeakness != null && rec.opponentWeakness > 0 ? 'text-green-600 dark:text-green-400' : rec.opponentWeakness != null && rec.opponentWeakness < 0 ? 'text-red-600 dark:text-red-400' : ''}>{rec.opponentWeakness != null && rec.opponentWeight != null ? `${(rec.opponentWeight * rec.opponentWeakness * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                            </>
                                          )}
                                        </div>
                                      )}

                                      {renderAssumedOpponents(rec.assumedOpponents, `doubles-pick-${rec.machine}`)}

                                      {/* Exclude player/machine buttons */}
                                      <div className="mt-2 md:mt-3 flex flex-wrap gap-1.5 md:gap-2">
                                        {rec.players && rec.players.length > 0 && rec.players.map((player) => (
                                          <Button
                                            key={player}
                                            variant="outline"
                                            size="sm"
                                            className="text-[10px] md:text-xs h-7 md:h-8 px-2 md:px-3"
                                            onClick={() => addExclusion(rec.machine, player, 'doubles')}
                                          >
                                            Exclude {player}
                                          </Button>
                                        ))}
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="text-[10px] md:text-xs h-7 md:h-8 px-2 md:px-3 text-destructive border-destructive/50 hover:bg-destructive/10"
                                          onClick={() => addMachineExclusion(rec.machine)}
                                        >
                                          Exclude Machine
                                        </Button>
                                      </div>

                                      {/* Show Full Stats button and breakdown */}
                                      <div className="mt-3 pt-3 border-t">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-xs h-7 px-2"
                                          onClick={() => setShowFullStats(prev => ({ ...prev, [`doubles-${rec.machine}`]: !prev[`doubles-${rec.machine}`] }))}
                                        >
                                          {showFullStats[`doubles-${rec.machine}`] ? 'Hide' : 'Show'} Full Stats
                                        </Button>

                                        {showFullStats[`doubles-${rec.machine}`] && (
                                          <div className="mt-3 space-y-4 text-xs bg-muted/50 rounded p-3">
                                            {/* Current Slider Settings */}
                                            <div>
                                              <h5 className="font-semibold mb-2">Slider Settings Applied:</h5>
                                              <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                                                <div>Venue Weight: {venueWeight}%</div>
                                                <div>User Input Weight: {userInputWeight}%</div>
                                                <div>Confidence Boost: {confidenceBoost}%</div>
                                                <div>Opponent Weight: {opponentWeight}%</div>
                                                <div>Win Rate Weight: {winRateWeight}%</div>
                                                <div>Recent Form Weight: {recentFormWeight}%</div>
                                                <div>Data Confidence Weight: {dataConfidenceWeight}%</div>
                                                <div>Venue Avg Weight: {venueAvgWeight}%</div>
                                              </div>
                                            </div>

                                            {/* Per-player breakdown */}
                                            {rec.stats && rec.stats.map((s: any) => (
                                              <div key={s.player} className="border-t pt-3">
                                                <h5 className="font-semibold mb-2">{s.player} Stats:</h5>
                                                <div className="space-y-2">
                                                  <div className="grid grid-cols-2 gap-1">
                                                    <div>League Games: {s.playsCount || 0}</div>
                                                    <div>Avg Score: {s.avgScore?.toLocaleString() || 'N/A'}</div>
                                                    <div>Win Rate: {s.winRate != null ? `${s.winRate}%` : 'N/A'}</div>
                                                    <div>Recent Form: {s.recentForm != null ? `${s.recentForm}%` : 'N/A'}</div>
                                                    <div>% of Venue Avg: {s.pctOfVenue != null ? `${s.pctOfVenue}%` : 'N/A'}</div>
                                                    <div>Data Confidence: {s.confidenceScore || 0}/10</div>
                                                  </div>

                                                  {/* Detailed Score Breakdown */}
                                                  {s.scoreBreakdown && (
                                                    <div className="mt-2 pt-2 border-t border-dashed">
                                                      <div className="font-medium mb-2">Individual Scores Used:</div>

                                                      {/* League Scores */}
                                                      {s.scoreBreakdown.leagueScores?.length > 0 && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">League Games ({s.scoreBreakdown.leagueScores.length}):</div>
                                                          <div className="max-h-32 overflow-y-auto bg-background/50 rounded p-1">
                                                            <table className="w-full text-[10px]">
                                                              <thead>
                                                                <tr className="text-muted-foreground">
                                                                  <th className="text-left px-1">Score</th>
                                                                  <th className="text-left px-1">Venue Avg</th>
                                                                  <th className="text-left px-1">Ratio</th>
                                                                  <th className="text-left px-1">W/L</th>
                                                                </tr>
                                                              </thead>
                                                              <tbody>
                                                                {s.scoreBreakdown.leagueScores.map((score: any, idx: number) => (
                                                                  <tr key={idx} className={score.won ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                                                    <td className="px-1">{score.score.toLocaleString()}</td>
                                                                    <td className="px-1">{Math.round(score.venueAvg).toLocaleString()}</td>
                                                                    <td className="px-1">{(score.ratio * 100).toFixed(0)}%</td>
                                                                    <td className="px-1">{score.won ? 'W' : 'L'}</td>
                                                                  </tr>
                                                                ))}
                                                              </tbody>
                                                            </table>
                                                          </div>
                                                          <div className="text-[10px] text-muted-foreground mt-1">
                                                            League Avg Ratio: {((s.scoreBreakdown.leagueVenueAdjustedAvg || 1) * 100).toFixed(1)}%
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Scores */}
                                                      {s.scoreBreakdown.userScores?.length > 0 && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">Logged Scores ({s.scoreBreakdown.userScores.length}, 1x weight each):</div>
                                                          <div className="max-h-24 overflow-y-auto bg-background/50 rounded p-1">
                                                            <table className="w-full text-[10px]">
                                                              <thead>
                                                                <tr className="text-muted-foreground">
                                                                  <th className="text-left px-1">Score</th>
                                                                  <th className="text-left px-1">Venue Avg</th>
                                                                  <th className="text-left px-1">Ratio</th>
                                                                </tr>
                                                              </thead>
                                                              <tbody>
                                                                {s.scoreBreakdown.userScores.map((score: any, idx: number) => (
                                                                  <tr key={idx}>
                                                                    <td className="px-1">{score.score.toLocaleString()}</td>
                                                                    <td className="px-1">{Math.round(score.venueAvg).toLocaleString()}</td>
                                                                    <td className="px-1">{(score.ratio * 100).toFixed(0)}%</td>
                                                                  </tr>
                                                                ))}
                                                              </tbody>
                                                            </table>
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Input Average */}
                                                      {s.scoreBreakdown.userInputAverage && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">Self-Reported Average (3x weight):</div>
                                                          <div className="text-[10px] bg-background/50 rounded p-1">
                                                            {s.scoreBreakdown.userInputAverage.score.toLocaleString()} ÷ {Math.round(s.scoreBreakdown.userInputAverage.venueAvg).toLocaleString()} = {(s.scoreBreakdown.userInputAverage.ratio * 100).toFixed(1)}%
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Average Calculation */}
                                                      {(s.scoreBreakdown.userScores?.length > 0 || s.scoreBreakdown.userInputAverage) && (
                                                        <div className="text-[10px] text-muted-foreground">
                                                          User Data Avg Ratio: {s.scoreBreakdown.userVenueAdjustedAvg != null ? `${(s.scoreBreakdown.userVenueAdjustedAvg * 100).toFixed(1)}%` : 'N/A'}
                                                        </div>
                                                      )}

                                                      {/* Final Blended Calculation */}
                                                      <div className="mt-2 pt-2 border-t border-dashed">
                                                        <div className="text-[10px] font-medium mb-1">Final Venue-Adjusted Avg Calculation:</div>
                                                        <div className="text-[10px] text-muted-foreground space-y-0.5">
                                                          {s.scoreBreakdown.userInputWeightApplied > 0 && s.scoreBreakdown.userVenueAdjustedAvg != null ? (
                                                            <>
                                                              <div>= League × (1 - {(s.scoreBreakdown.userInputWeightApplied * 100).toFixed(0)}%) + User × {(s.scoreBreakdown.userInputWeightApplied * 100).toFixed(0)}%</div>
                                                              <div>= {((s.scoreBreakdown.leagueVenueAdjustedAvg || 1) * 100).toFixed(1)}% × {(1 - s.scoreBreakdown.userInputWeightApplied).toFixed(2)} + {(s.scoreBreakdown.userVenueAdjustedAvg * 100).toFixed(1)}% × {s.scoreBreakdown.userInputWeightApplied.toFixed(2)}</div>
                                                              <div className="font-medium text-foreground">= {(s.scoreBreakdown.finalVenueAdjustedAvg * 100).toFixed(1)}% of venue average</div>
                                                            </>
                                                          ) : (
                                                            <div className="font-medium text-foreground">= {(s.scoreBreakdown.finalVenueAdjustedAvg * 100).toFixed(1)}% of venue average (league only)</div>
                                                          )}
                                                        </div>
                                                      </div>
                                                    </div>
                                                  )}

                                                  {(s.userAverage != null || s.userConfidence != null) && !s.scoreBreakdown && (
                                                    <div className="mt-2 pt-2 border-t border-dashed">
                                                      <div className="font-medium mb-1">User Input Data:</div>
                                                      <div className="grid grid-cols-2 gap-1">
                                                        {s.userAverage != null && <div>Self-Reported Avg: {s.userAverage.toLocaleString()}</div>}
                                                        {s.userConfidence != null && <div>Self-Reported Confidence: {s.userConfidence}/10</div>}
                                                      </div>
                                                    </div>
                                                  )}

                                                  <div className="mt-2 pt-2 border-t border-dashed">
                                                    <div className="font-medium mb-1">Performance Score Calculation:</div>
                                                    <div className="text-muted-foreground space-y-1">
                                                      <div>= (Win Rate × {winRateWeight}%) + (Recent Form × {recentFormWeight}%) + (Venue Adj × {venueAvgWeight}%) + (Data Conf × {dataConfidenceWeight}%)</div>
                                                      <div>= ({s.winRate ?? 0}/100 × {winRateWeight/100}) + ({s.recentForm ?? 0}/100 × {recentFormWeight/100}) + (min({(s.pctOfVenue ?? 100)}/200, 1) × {venueAvgWeight/100}) + ({s.confidenceScore ?? 0}/10 × {dataConfidenceWeight/100})</div>
                                                      <div className="font-medium text-foreground">= Performance Score: {s.performanceScore ?? 'N/A'}</div>
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            ))}

                                            {/* Explanation */}
                                            <div className="border-t pt-3 text-muted-foreground">
                                              <h5 className="font-semibold mb-1 text-foreground">How it works:</h5>
                                              <ul className="list-disc list-inside space-y-1">
                                                <li><strong>Venue Weight:</strong> Blends venue-specific stats ({venueWeight}%) with all-venue stats ({100-venueWeight}%)</li>
                                                <li><strong>User Input Weight:</strong> Blends your logged scores/averages ({userInputWeight}%) with league data ({100-userInputWeight}%)</li>
                                                <li><strong>Confidence Boost:</strong> Blends your self-reported confidence ({confidenceBoost}%) into the final score</li>
                                                <li><strong>Score Factors:</strong> Win Rate ({winRateWeight}%), Recent Form ({recentFormWeight}%), Venue Avg ({venueAvgWeight}%), Data Confidence ({dataConfidenceWeight}%)</li>
                                                {opponentWeight > 0 && <li><strong>Opponent Weight:</strong> Scores are adjusted by {opponentWeight}% of opponent weakness per machine. Positive weakness (opponent below venue avg) boosts scores, negative (above avg) penalizes.</li>}
                                              </ul>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            )
                          })}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                <TabsContent value="assignment" className="space-y-4">

                  <div className="p-4 border rounded bg-muted/20 space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium">Score Factor Weights</h4>
                      <div className="flex gap-2">
                        {isSlidersDirty && (
                          <Button size="sm" variant="default" onClick={applySliderChanges}>
                            Apply
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={resetSliders} className="text-xs">
                          Reset
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Win Rate</div>
                      <input type="range" min={0} max={100} step={1} value={winRateWeight}
                        onChange={(e) => handleScoreWeightChange('winRate', parseInt(e.target.value))}
                        className="flex-1 min-w-0 accent-primary h-2" />
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{winRateWeight}%</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Recent Form</div>
                      <input type="range" min={0} max={100} step={1} value={recentFormWeight}
                        onChange={(e) => handleScoreWeightChange('recentForm', parseInt(e.target.value))}
                        className="flex-1 min-w-0 accent-primary h-2" />
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{recentFormWeight}%</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Score vs Venue Avg</div>
                      <div className="flex-1 min-w-0 bg-muted rounded-full h-2">
                        <div className="bg-primary/50 rounded-full h-2" style={{ width: `${venueAvgWeight}%` }} />
                      </div>
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{venueAvgWeight}%</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Data Confidence</div>
                      <input type="range" min={0} max={100} step={1} value={dataConfidenceWeight}
                        onChange={(e) => handleScoreWeightChange('dataConfidence', parseInt(e.target.value))}
                        className="flex-1 min-w-0 accent-primary h-2" />
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{dataConfidenceWeight}%</div>
                    </div>

                    <hr className="border-border my-2" />
                    <h4 className="text-sm font-medium mb-1">Adjustable Weights</h4>

                    <div className="space-y-0">
                      <div className="flex items-center gap-2">
                        <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Venue Weight</div>
                        <div className="flex-1 min-w-0">
                          <input type="range" min={0} max={100} step={1} value={venueWeight}
                            onChange={(e) => setVenueWeight(parseInt(e.target.value))}
                            className="w-full accent-primary h-2" />
                          <div className="flex justify-between text-[10px] text-muted-foreground -mt-0.5">
                            <span>All Venues</span>
                            <span>Venue Only</span>
                          </div>
                        </div>
                        <div className="w-10 md:w-12 text-xs text-right shrink-0">{venueWeight}%</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">User Input Weight</div>
                      <input type="range" min={0} max={100} step={1} value={userInputWeight}
                        onChange={(e) => setUserInputWeight(parseInt(e.target.value))}
                        className="flex-1 min-w-0 accent-primary h-2" />
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{userInputWeight}%</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Confidence Boost</div>
                      <input type="range" min={0} max={100} step={1} value={confidenceBoost}
                        onChange={(e) => setConfidenceBoost(parseInt(e.target.value))}
                        className="flex-1 min-w-0 accent-primary h-2" />
                      <div className="w-10 md:w-12 text-xs text-right shrink-0">{confidenceBoost}%</div>
                    </div>

                    <div className="space-y-0">
                      <div className="flex items-center gap-2">
                        <div className="w-24 md:w-48 text-[10px] md:text-xs truncate shrink-0">Opponent Weight</div>
                        <div className="flex-1 min-w-0">
                          <input type="range" min={0} max={100} step={1} value={opponentWeight}
                            onChange={(e) => setOpponentWeight(parseInt(e.target.value))}
                            className="w-full accent-primary h-2" />
                          <div className="flex justify-between text-[10px] text-muted-foreground -mt-0.5">
                            <span>Ignore</span>
                            <span>Target Weakness</span>
                          </div>
                        </div>
                        <div className="w-10 md:w-12 text-xs text-right shrink-0">{opponentWeight}%</div>
                      </div>
                      {opponentWeight > 0 && (
                        <label className="flex items-center gap-1.5 mt-1 ml-24 md:ml-48 text-[10px] text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={useNashEquilibrium}
                            onChange={() => setUseNashEquilibrium(!useNashEquilibrium)}
                            className="h-3 w-3 accent-primary"
                          />
                          Nash Equilibrium (Hungarian iterates until stable)
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Sat-Out Tracking */}
                  <div className="mb-3">
                    <label className="text-[10px] md:text-xs font-medium mb-1.5 block text-muted-foreground">Sat Out (must play):</label>
                    <div className="flex flex-wrap gap-1 md:gap-1.5">
                      {Object.keys(availablePlayers).filter(p => availablePlayers[p]).map(player => {
                        const hasSat = satOutPlayers.has(player)
                        return (
                          <button
                            key={player}
                            onClick={() => toggleSatOut(player)}
                            className={`px-2 py-0.5 rounded text-[10px] md:text-xs border transition-all ${
                              hasSat
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-muted/30 text-muted-foreground border-muted/40 hover:border-muted-foreground/40'
                            }`}
                          >
                            {player}
                          </button>
                        )
                      })}
                    </div>
                    {satOutPlayers.size > 0 && (
                      <button
                        onClick={() => setSatOutPlayers(new Set())}
                        className="text-[9px] md:text-[10px] text-muted-foreground hover:text-foreground mt-1"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {/* Sit This Round */}
                  <div className="mb-3">
                    <label className="text-[10px] md:text-xs font-medium mb-1.5 block text-muted-foreground">Sit This Round (exclude):</label>
                    <div className="flex flex-wrap gap-1 md:gap-1.5">
                      {Object.keys(availablePlayers).filter(p => availablePlayers[p]).map(player => {
                        const isSitting = sitThisRound.has(player)
                        return (
                          <button
                            key={player}
                            onClick={() => toggleSitThisRound(player)}
                            className={`px-2 py-0.5 rounded text-[10px] md:text-xs border transition-all ${
                              isSitting
                                ? 'bg-destructive text-destructive-foreground border-destructive'
                                : 'bg-muted/30 text-muted-foreground border-muted/40 hover:border-muted-foreground/40'
                            }`}
                          >
                            {player}
                          </button>
                        )
                      })}
                    </div>
                    {sitThisRound.size > 0 && (
                      <button
                        onClick={() => setSitThisRound(new Set())}
                        className="text-[9px] md:text-[10px] text-muted-foreground hover:text-foreground mt-1"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  <Tabs defaultValue="singles" className="w-full">
                    <TabsList className="w-full grid grid-cols-2">
                      <TabsTrigger value="singles">Singles</TabsTrigger>
                      <TabsTrigger value="doubles">Doubles</TabsTrigger>
                    </TabsList>

                    <TabsContent value="singles" className="space-y-4">
                      <div>
                        <label className="text-xs md:text-sm font-medium mb-2 block">Select machines picked by opponent:</label>
                        <div className="grid grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-1.5 md:gap-2 mb-3">
                          {machineAdvantages.map(m => {
                            const isSelected = singlesOpponentPicks.includes(m.machine)
                            return (
                              <button
                                key={m.machine}
                                onClick={() => toggleMachine(m.machine, 'singles')}
                                className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                                  isSelected ? 'border-primary ring-2 ring-primary/50 scale-[1.02]' : 'border-muted/40 opacity-50 hover:opacity-90'
                                }`}
                              >
                                <img
                                  src={getImagePath(m.machine)}
                                  alt={m.machine}
                                  className="w-full aspect-[3/4] object-cover"
                                />
                                <div className="absolute bottom-0 inset-x-0 bg-black/70 px-0.5 py-0.5 text-[8px] md:text-[10px] text-white text-center truncate">
                                  {m.machine}
                                </div>
                                {isSelected && (
                                  <div className="absolute top-0.5 right-0.5 bg-primary text-primary-foreground rounded-full w-4 h-4 md:w-5 md:h-5 flex items-center justify-center">
                                    <Check className="h-2.5 w-2.5 md:h-3 md:w-3" />
                                  </div>
                                )}
                              </button>
                            )
                          })}
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-xs md:text-sm text-muted-foreground">
                            {singlesOpponentPicks.length} machine{singlesOpponentPicks.length !== 1 ? 's' : ''} selected
                          </span>
                          <Button
                            size="sm"
                            onClick={optimizeSinglesAssignments}
                            disabled={singlesOpponentPicks.length === 0}
                          >
                            Optimize Singles
                          </Button>
                        </div>
                      </div>

                      {/* Active machine exclusions */}
                      {excludedMachines.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {excludedMachines.map((machine) => (
                            <div key={`machine-excl-${machine}`} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                              <span>{getMachineDisplayName(machine)} excluded from all results</span>
                              <button
                                className="ml-auto text-amber-500 hover:text-amber-700 dark:hover:text-amber-200"
                                onClick={() => removeMachineExclusion(machine)}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Active assignment exclusions */}
                      {Object.keys(singlesAssignExclusions).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {Object.entries(singlesAssignExclusions).map(([machine, players]) =>
                            players.map(player => (
                              <div key={`${machine}-${player}`} className="flex items-center gap-1 px-2 py-0.5 bg-destructive/10 border border-destructive/30 rounded text-[10px] md:text-xs">
                                <span>{player} excluded from {machine}</span>
                                <button
                                  onClick={() => removeAssignExclusion(machine, player, 'singles')}
                                  className="text-destructive hover:text-destructive/80"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {singlesAssignments.length > 0 && (
                        <div className="mt-4">
                          <h4 className="font-semibold text-sm mb-3">Recommended Player Assignments:</h4>
                          {singlesAssignments.map((assignment, index) => {
                            const adv = assignment.advantage
                            const isExpanded = expandedRecommendations[`assign-s-${assignment.machine}`] ?? false
                            return (
                              <Collapsible
                                key={assignment.machine}
                                open={isExpanded}
                                onOpenChange={(open) => setExpandedRecommendations(prev => ({
                                  ...prev,
                                  [`assign-s-${assignment.machine}`]: open
                                }))}
                                className="mb-3"
                              >
                                <div className="border rounded overflow-hidden bg-background">
                                  <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 relative overflow-hidden bg-background">
                                    <div
                                      className="absolute right-0 top-0 bottom-0 w-1/2 opacity-50"
                                      style={{
                                        backgroundImage: `url(${getImagePath(assignment.machine)})`,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                        backgroundRepeat: 'no-repeat'
                                      }}
                                    />
                                    <div className="text-left relative z-10">
                                      <div className="font-medium flex items-center gap-2">
                                        {index + 1}. {assignment.machine}
                                        {assignment.dataSource && assignment.dataSource !== 'none' && (
                                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                            assignment.dataSource === 'venue' ? 'bg-green-100 text-green-800' :
                                            assignment.dataSource === 'all' ? 'bg-blue-100 text-blue-800' :
                                            'bg-purple-100 text-purple-800'
                                          }`}>
                                            {assignment.dataSource === 'venue' ? 'venue' : assignment.dataSource === 'all' ? 'all venues' : 'blended'}
                                          </span>
                                        )}
                                      </div>
                                      {assignment.players && assignment.players.length > 0 && (
                                        <div className="text-sm text-muted-foreground mt-1">
                                          {assignment.players.join(', ')}
                                          {assignment.assumedOpponents && assignment.assumedOpponents.length > 0 && (
                                            <span className="text-red-500/70 dark:text-red-400/70"> vs {assignment.assumedOpponents.map(o => o.player).join(', ')}</span>
                                          )}
                                        </div>
                                      )}
                                      <div className="text-sm text-muted-foreground mt-1">
                                        {assignment.blendedScore != null && (
                                          <span>Avg Score: {assignment.blendedScore.toLocaleString()}</span>
                                        )}
                                        {adv && (
                                          <span className="ml-3">Edge: {adv.compositeScore.toFixed(1)}</span>
                                        )}
                                      </div>
                                      {assignment.stats && assignment.stats.length > 0 && (
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                          {assignment.stats.map(s => (
                                            <span key={s.player} className="text-[10px] text-muted-foreground">
                                              {assignment.stats!.length > 1 && <span className="font-medium">{s.player}: </span>}
                                              {s.pctOfVenue != null && <span className="inline-flex items-center gap-0.5">{s.pctOfVenue}% of avg<span className="hidden md:inline" title="Each game score is divided by the venue average where it was scored and then all ratios are averaged."><Info className="h-2.5 w-2.5 text-muted-foreground" /></span></span>}
                                              {s.userAverage != null && (
                                                <span className="ml-1.5" title="User-reported average at this venue">
                                                  avg: {s.userAverage >= 1_000_000_000 ? `${(s.userAverage / 1_000_000_000).toFixed(1)}B` : s.userAverage >= 1_000_000 ? `${(s.userAverage / 1_000_000).toFixed(1)}M` : s.userAverage >= 1_000 ? `${(s.userAverage / 1_000).toFixed(1)}K` : s.userAverage}
                                                </span>
                                              )}
                                              {s.userConfidence != null && (
                                                <span className="ml-1.5" title="User confidence at this venue">conf: {s.userConfidence}/10</span>
                                              )}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div className="relative z-10">
                                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    </div>
                                  </CollapsibleTrigger>

                                  <CollapsibleContent className="px-3 pb-3">
                                    <div className="pt-3 border-t space-y-2">
                                      {adv && (
                                        <div className="grid grid-cols-2 gap-1.5 md:gap-2 text-xs md:text-sm">
                                          <div><strong>Advantage Level:</strong> {adv.advantageLevel}</div>
                                          <div><strong>Player % of Venue:</strong> {assignment.stats && assignment.stats.length > 1
                                            ? assignment.stats.map(s => `${s.player}: ${s.pctOfVenue ?? 'N/A'}%`).join(', ')
                                            : `${adv.twcPctOfVenue.toFixed(1)}%`
                                          }</div>
                                          <div><strong>Opp % of Venue:</strong> {adv.opponentPctOfVenue.toFixed(1)}%</div>
                                          <div><strong>Score Edge:</strong> {adv.statisticalAdvantage.toFixed(1)}</div>
                                          <div><strong>Experience Edge:</strong> {adv.experienceAdvantage} plays</div>
                                          <div><strong>Player Plays:</strong> {adv.twcPlays}</div>
                                          {assignment.opponentWeight != null && assignment.opponentWeight > 0 && (
                                            <>
                                              <div><strong>Opp Weakness:</strong> <span className={assignment.opponentWeakness != null && assignment.opponentWeakness > 0 ? 'text-green-600 dark:text-green-400' : assignment.opponentWeakness != null && assignment.opponentWeakness < 0 ? 'text-red-600 dark:text-red-400' : ''}>{assignment.opponentWeakness != null ? `${(assignment.opponentWeakness * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                              <div><strong>Score Boost:</strong> <span className={assignment.opponentWeakness != null && assignment.opponentWeakness > 0 ? 'text-green-600 dark:text-green-400' : assignment.opponentWeakness != null && assignment.opponentWeakness < 0 ? 'text-red-600 dark:text-red-400' : ''}>{assignment.opponentWeakness != null && assignment.opponentWeight != null ? `${(assignment.opponentWeight * assignment.opponentWeakness * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                            </>
                                          )}
                                        </div>
                                      )}

                                      {renderAssumedOpponents(assignment.assumedOpponents, `singles-assign-${assignment.machine}`)}

                                      <div className="mt-2 md:mt-3 flex flex-wrap gap-1.5 md:gap-2">
                                        {assignment.players && assignment.players.length > 0 && assignment.players.map((player) => (
                                          <Button
                                            key={player}
                                            variant="outline"
                                            size="sm"
                                            className="text-[10px] md:text-xs h-7 md:h-8 px-2 md:px-3"
                                            onClick={() => addAssignExclusion(assignment.machine, player, 'singles')}
                                          >
                                            Exclude {player}
                                          </Button>
                                        ))}
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="text-[10px] md:text-xs h-7 md:h-8 px-2 md:px-3 text-destructive border-destructive/50 hover:bg-destructive/10"
                                          onClick={() => addMachineExclusion(assignment.machine)}
                                        >
                                          Exclude Machine
                                        </Button>
                                      </div>

                                      {/* Show Full Stats button and breakdown */}
                                      <div className="mt-3 pt-3 border-t">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-xs h-7 px-2"
                                          onClick={() => setShowFullStats(prev => ({ ...prev, [`assign-s-${assignment.machine}`]: !prev[`assign-s-${assignment.machine}`] }))}
                                        >
                                          {showFullStats[`assign-s-${assignment.machine}`] ? 'Hide' : 'Show'} Full Stats
                                        </Button>

                                        {showFullStats[`assign-s-${assignment.machine}`] && (
                                          <div className="mt-3 space-y-4 text-xs bg-muted/50 rounded p-3">
                                            {/* Current Slider Settings */}
                                            <div>
                                              <h5 className="font-semibold mb-2">Slider Settings Applied:</h5>
                                              <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                                                <div>Venue Weight: {venueWeight}%</div>
                                                <div>User Input Weight: {userInputWeight}%</div>
                                                <div>Confidence Boost: {confidenceBoost}%</div>
                                                <div>Opponent Weight: {opponentWeight}%</div>
                                                <div>Win Rate Weight: {winRateWeight}%</div>
                                                <div>Recent Form Weight: {recentFormWeight}%</div>
                                                <div>Data Confidence Weight: {dataConfidenceWeight}%</div>
                                                <div>Venue Avg Weight: {venueAvgWeight}%</div>
                                              </div>
                                            </div>

                                            {/* Per-player breakdown */}
                                            {assignment.stats && assignment.stats.map((s: any) => (
                                              <div key={s.player} className="border-t pt-3">
                                                <h5 className="font-semibold mb-2">{s.player} Stats:</h5>
                                                <div className="space-y-2">
                                                  <div className="grid grid-cols-2 gap-1">
                                                    <div>League Games: {s.playsCount || 0}</div>
                                                    <div>Avg Score: {s.avgScore?.toLocaleString() || 'N/A'}</div>
                                                    <div>Win Rate: {s.winRate != null ? `${s.winRate}%` : 'N/A'}</div>
                                                    <div>Recent Form: {s.recentForm != null ? `${s.recentForm}%` : 'N/A'}</div>
                                                    <div>% of Venue Avg: {s.pctOfVenue != null ? `${s.pctOfVenue}%` : 'N/A'}</div>
                                                    <div>Data Confidence: {s.confidenceScore || 0}/10</div>
                                                  </div>

                                                  {/* Detailed Score Breakdown */}
                                                  {s.scoreBreakdown && (
                                                    <div className="mt-2 pt-2 border-t border-dashed">
                                                      <div className="font-medium mb-2">Individual Scores Used:</div>

                                                      {/* League Scores */}
                                                      {s.scoreBreakdown.leagueScores?.length > 0 && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">League Games ({s.scoreBreakdown.leagueScores.length}):</div>
                                                          <div className="max-h-32 overflow-y-auto bg-background/50 rounded p-1">
                                                            <table className="w-full text-[10px]">
                                                              <thead>
                                                                <tr className="text-muted-foreground">
                                                                  <th className="text-left px-1">Score</th>
                                                                  <th className="text-left px-1">Venue Avg</th>
                                                                  <th className="text-left px-1">Ratio</th>
                                                                  <th className="text-left px-1">W/L</th>
                                                                </tr>
                                                              </thead>
                                                              <tbody>
                                                                {s.scoreBreakdown.leagueScores.map((score: any, idx: number) => (
                                                                  <tr key={idx} className={score.won ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                                                    <td className="px-1">{score.score.toLocaleString()}</td>
                                                                    <td className="px-1">{Math.round(score.venueAvg).toLocaleString()}</td>
                                                                    <td className="px-1">{(score.ratio * 100).toFixed(0)}%</td>
                                                                    <td className="px-1">{score.won ? 'W' : 'L'}</td>
                                                                  </tr>
                                                                ))}
                                                              </tbody>
                                                            </table>
                                                          </div>
                                                          <div className="text-[10px] text-muted-foreground mt-1">
                                                            League Avg Ratio: {((s.scoreBreakdown.leagueVenueAdjustedAvg || 1) * 100).toFixed(1)}%
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Scores */}
                                                      {s.scoreBreakdown.userScores?.length > 0 && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">Logged Scores ({s.scoreBreakdown.userScores.length}, 1x weight each):</div>
                                                          <div className="max-h-24 overflow-y-auto bg-background/50 rounded p-1">
                                                            <table className="w-full text-[10px]">
                                                              <thead>
                                                                <tr className="text-muted-foreground">
                                                                  <th className="text-left px-1">Score</th>
                                                                  <th className="text-left px-1">Venue Avg</th>
                                                                  <th className="text-left px-1">Ratio</th>
                                                                </tr>
                                                              </thead>
                                                              <tbody>
                                                                {s.scoreBreakdown.userScores.map((score: any, idx: number) => (
                                                                  <tr key={idx}>
                                                                    <td className="px-1">{score.score.toLocaleString()}</td>
                                                                    <td className="px-1">{Math.round(score.venueAvg).toLocaleString()}</td>
                                                                    <td className="px-1">{(score.ratio * 100).toFixed(0)}%</td>
                                                                  </tr>
                                                                ))}
                                                              </tbody>
                                                            </table>
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Input Average */}
                                                      {s.scoreBreakdown.userInputAverage && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">Self-Reported Average (3x weight):</div>
                                                          <div className="text-[10px] bg-background/50 rounded p-1">
                                                            {s.scoreBreakdown.userInputAverage.score.toLocaleString()} ÷ {Math.round(s.scoreBreakdown.userInputAverage.venueAvg).toLocaleString()} = {(s.scoreBreakdown.userInputAverage.ratio * 100).toFixed(1)}%
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Average Calculation */}
                                                      {(s.scoreBreakdown.userScores?.length > 0 || s.scoreBreakdown.userInputAverage) && (
                                                        <div className="text-[10px] text-muted-foreground">
                                                          User Data Avg Ratio: {s.scoreBreakdown.userVenueAdjustedAvg != null ? `${(s.scoreBreakdown.userVenueAdjustedAvg * 100).toFixed(1)}%` : 'N/A'}
                                                        </div>
                                                      )}

                                                      {/* Final Blended Calculation */}
                                                      <div className="mt-2 pt-2 border-t border-dashed">
                                                        <div className="text-[10px] font-medium mb-1">Final Venue-Adjusted Avg Calculation:</div>
                                                        <div className="text-[10px] text-muted-foreground space-y-0.5">
                                                          {s.scoreBreakdown.userInputWeightApplied > 0 && s.scoreBreakdown.userVenueAdjustedAvg != null ? (
                                                            <>
                                                              <div>= League × (1 - {(s.scoreBreakdown.userInputWeightApplied * 100).toFixed(0)}%) + User × {(s.scoreBreakdown.userInputWeightApplied * 100).toFixed(0)}%</div>
                                                              <div>= {((s.scoreBreakdown.leagueVenueAdjustedAvg || 1) * 100).toFixed(1)}% × {(1 - s.scoreBreakdown.userInputWeightApplied).toFixed(2)} + {(s.scoreBreakdown.userVenueAdjustedAvg * 100).toFixed(1)}% × {s.scoreBreakdown.userInputWeightApplied.toFixed(2)}</div>
                                                              <div className="font-medium text-foreground">= {(s.scoreBreakdown.finalVenueAdjustedAvg * 100).toFixed(1)}% of venue average</div>
                                                            </>
                                                          ) : (
                                                            <div className="font-medium text-foreground">= {(s.scoreBreakdown.finalVenueAdjustedAvg * 100).toFixed(1)}% of venue average (league only)</div>
                                                          )}
                                                        </div>
                                                      </div>
                                                    </div>
                                                  )}

                                                  {(s.userAverage != null || s.userConfidence != null) && !s.scoreBreakdown && (
                                                    <div className="mt-2 pt-2 border-t border-dashed">
                                                      <div className="font-medium mb-1">User Input Data:</div>
                                                      <div className="grid grid-cols-2 gap-1">
                                                        {s.userAverage != null && <div>Self-Reported Avg: {s.userAverage.toLocaleString()}</div>}
                                                        {s.userConfidence != null && <div>Self-Reported Confidence: {s.userConfidence}/10</div>}
                                                      </div>
                                                    </div>
                                                  )}

                                                  <div className="mt-2 pt-2 border-t border-dashed">
                                                    <div className="font-medium mb-1">Performance Score Calculation:</div>
                                                    <div className="text-muted-foreground space-y-1">
                                                      <div>= (Win Rate × {winRateWeight}%) + (Recent Form × {recentFormWeight}%) + (Venue Adj × {venueAvgWeight}%) + (Data Conf × {dataConfidenceWeight}%)</div>
                                                      <div>= ({s.winRate ?? 0}/100 × {winRateWeight/100}) + ({s.recentForm ?? 0}/100 × {recentFormWeight/100}) + (min({(s.pctOfVenue ?? 100)}/200, 1) × {venueAvgWeight/100}) + ({s.confidenceScore ?? 0}/10 × {dataConfidenceWeight/100})</div>
                                                      <div className="font-medium text-foreground">= Performance Score: {s.performanceScore ?? 'N/A'}</div>
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            ))}

                                            {/* Explanation */}
                                            <div className="border-t pt-3 text-muted-foreground">
                                              <h5 className="font-semibold mb-1 text-foreground">How it works:</h5>
                                              <ul className="list-disc list-inside space-y-1">
                                                <li><strong>Venue Weight:</strong> Blends venue-specific stats ({venueWeight}%) with all-venue stats ({100-venueWeight}%)</li>
                                                <li><strong>User Input Weight:</strong> Blends your logged scores/averages ({userInputWeight}%) with league data ({100-userInputWeight}%)</li>
                                                <li><strong>Confidence Boost:</strong> Blends your self-reported confidence ({confidenceBoost}%) into the final score</li>
                                                <li><strong>Score Factors:</strong> Win Rate ({winRateWeight}%), Recent Form ({recentFormWeight}%), Venue Avg ({venueAvgWeight}%), Data Confidence ({dataConfidenceWeight}%)</li>
                                                {opponentWeight > 0 && <li><strong>Opponent Weight:</strong> Scores are adjusted by {opponentWeight}% of opponent weakness per machine. Positive weakness (opponent below venue avg) boosts scores, negative (above avg) penalizes.</li>}
                                              </ul>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            )
                          })}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="doubles" className="space-y-4">
                      <div>
                        <label className="text-xs md:text-sm font-medium mb-2 block">Select machines picked by opponent:</label>
                        <div className="grid grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-1.5 md:gap-2 mb-3">
                          {machineAdvantages.map(m => {
                            const isSelected = doublesOpponentPicks.includes(m.machine)
                            return (
                              <button
                                key={m.machine}
                                onClick={() => toggleMachine(m.machine, 'doubles')}
                                className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                                  isSelected ? 'border-primary ring-2 ring-primary/50 scale-[1.02]' : 'border-muted/40 opacity-50 hover:opacity-90'
                                }`}
                              >
                                <img
                                  src={getImagePath(m.machine)}
                                  alt={m.machine}
                                  className="w-full aspect-[3/4] object-cover"
                                />
                                <div className="absolute bottom-0 inset-x-0 bg-black/70 px-0.5 py-0.5 text-[8px] md:text-[10px] text-white text-center truncate">
                                  {m.machine}
                                </div>
                                {isSelected && (
                                  <div className="absolute top-0.5 right-0.5 bg-primary text-primary-foreground rounded-full w-4 h-4 md:w-5 md:h-5 flex items-center justify-center">
                                    <Check className="h-2.5 w-2.5 md:h-3 md:w-3" />
                                  </div>
                                )}
                              </button>
                            )
                          })}
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-xs md:text-sm text-muted-foreground">
                            {doublesOpponentPicks.length} machine{doublesOpponentPicks.length !== 1 ? 's' : ''} selected
                          </span>
                          <Button
                            size="sm"
                            onClick={optimizeDoublesAssignments}
                            disabled={doublesOpponentPicks.length === 0}
                          >
                            Optimize Doubles
                          </Button>
                        </div>
                      </div>

                      {/* Active machine exclusions */}
                      {excludedMachines.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {excludedMachines.map((machine) => (
                            <div key={`machine-excl-${machine}`} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                              <span>{getMachineDisplayName(machine)} excluded from all results</span>
                              <button
                                className="ml-auto text-amber-500 hover:text-amber-700 dark:hover:text-amber-200"
                                onClick={() => removeMachineExclusion(machine)}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Active assignment exclusions */}
                      {Object.keys(doublesAssignExclusions).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {Object.entries(doublesAssignExclusions).map(([machine, players]) =>
                            players.map(player => (
                              <div key={`${machine}-${player}`} className="flex items-center gap-1 px-2 py-0.5 bg-destructive/10 border border-destructive/30 rounded text-[10px] md:text-xs">
                                <span>{player} excluded from {machine}</span>
                                <button
                                  onClick={() => removeAssignExclusion(machine, player, 'doubles')}
                                  className="text-destructive hover:text-destructive/80"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {doublesAssignments.length > 0 && (
                        <div className="mt-4">
                          <h4 className="font-semibold text-sm mb-3">Recommended Player Assignments:</h4>
                          {doublesAssignments.map((assignment, index) => {
                            const adv = assignment.advantage
                            const isExpanded = expandedRecommendations[`assign-d-${assignment.machine}`] ?? false
                            return (
                              <Collapsible
                                key={assignment.machine}
                                open={isExpanded}
                                onOpenChange={(open) => setExpandedRecommendations(prev => ({
                                  ...prev,
                                  [`assign-d-${assignment.machine}`]: open
                                }))}
                                className="mb-3"
                              >
                                <div className="border rounded overflow-hidden bg-background">
                                  <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 relative overflow-hidden bg-background">
                                    <div
                                      className="absolute right-0 top-0 bottom-0 w-1/2 opacity-50"
                                      style={{
                                        backgroundImage: `url(${getImagePath(assignment.machine)})`,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                        backgroundRepeat: 'no-repeat'
                                      }}
                                    />
                                    <div className="text-left relative z-10">
                                      <div className="font-medium flex items-center gap-2">
                                        {index + 1}. {assignment.machine}
                                        {assignment.dataSource && assignment.dataSource !== 'none' && (
                                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                            assignment.dataSource === 'venue' ? 'bg-green-100 text-green-800' :
                                            assignment.dataSource === 'all' ? 'bg-blue-100 text-blue-800' :
                                            'bg-purple-100 text-purple-800'
                                          }`}>
                                            {assignment.dataSource === 'venue' ? 'venue' : assignment.dataSource === 'all' ? 'all venues' : 'blended'}
                                          </span>
                                        )}
                                      </div>
                                      {assignment.players && assignment.players.length > 0 && (
                                        <div className="text-sm text-muted-foreground mt-1">
                                          {assignment.players.join(', ')}
                                          {assignment.assumedOpponents && assignment.assumedOpponents.length > 0 && (
                                            <span className="text-red-500/70 dark:text-red-400/70"> vs {assignment.assumedOpponents.map(o => o.player).join(', ')}</span>
                                          )}
                                        </div>
                                      )}
                                      <div className="text-sm text-muted-foreground mt-1">
                                        {assignment.blendedScore != null && (
                                          <span>Avg Score: {assignment.blendedScore.toLocaleString()}</span>
                                        )}
                                        {adv && (
                                          <span className="ml-3">Edge: {adv.compositeScore.toFixed(1)}</span>
                                        )}
                                      </div>
                                      {assignment.stats && assignment.stats.length > 0 && (
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                          {assignment.stats.map(s => (
                                            <span key={s.player} className="text-[10px] text-muted-foreground">
                                              <span className="font-medium">{s.player}: </span>
                                              {s.pctOfVenue != null && <span className="inline-flex items-center gap-0.5">{s.pctOfVenue}% of avg<span className="hidden md:inline" title="Each game score is divided by the venue average where it was scored and then all ratios are averaged."><Info className="h-2.5 w-2.5 text-muted-foreground" /></span></span>}
                                              {s.userAverage != null && (
                                                <span className="ml-1.5" title="User-reported average at this venue">
                                                  avg: {s.userAverage >= 1_000_000_000 ? `${(s.userAverage / 1_000_000_000).toFixed(1)}B` : s.userAverage >= 1_000_000 ? `${(s.userAverage / 1_000_000).toFixed(1)}M` : s.userAverage >= 1_000 ? `${(s.userAverage / 1_000).toFixed(1)}K` : s.userAverage}
                                                </span>
                                              )}
                                              {s.userConfidence != null && (
                                                <span className="ml-1.5" title="User confidence at this venue">conf: {s.userConfidence}/10</span>
                                              )}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div className="relative z-10">
                                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    </div>
                                  </CollapsibleTrigger>

                                  <CollapsibleContent className="px-3 pb-3">
                                    <div className="pt-3 border-t space-y-2">
                                      {adv && (
                                        <div className="grid grid-cols-2 gap-1.5 md:gap-2 text-xs md:text-sm">
                                          <div><strong>Advantage Level:</strong> {adv.advantageLevel}</div>
                                          <div><strong>Players % of Venue:</strong> {assignment.stats && assignment.stats.length > 1
                                            ? assignment.stats.map(s => `${s.player}: ${s.pctOfVenue ?? 'N/A'}%`).join(', ')
                                            : `${adv.twcPctOfVenue.toFixed(1)}%`
                                          }</div>
                                          <div><strong>Opp % of Venue:</strong> {adv.opponentPctOfVenue.toFixed(1)}%</div>
                                          <div><strong>Score Edge:</strong> {adv.statisticalAdvantage.toFixed(1)}</div>
                                          <div><strong>Experience Edge:</strong> {adv.experienceAdvantage} plays</div>
                                          <div><strong>Players Plays:</strong> {adv.twcPlays}</div>
                                          {assignment.opponentWeight != null && assignment.opponentWeight > 0 && (
                                            <>
                                              <div><strong>Opp Weakness:</strong> <span className={assignment.opponentWeakness != null && assignment.opponentWeakness > 0 ? 'text-green-600 dark:text-green-400' : assignment.opponentWeakness != null && assignment.opponentWeakness < 0 ? 'text-red-600 dark:text-red-400' : ''}>{assignment.opponentWeakness != null ? `${(assignment.opponentWeakness * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                              <div><strong>Score Boost:</strong> <span className={assignment.opponentWeakness != null && assignment.opponentWeakness > 0 ? 'text-green-600 dark:text-green-400' : assignment.opponentWeakness != null && assignment.opponentWeakness < 0 ? 'text-red-600 dark:text-red-400' : ''}>{assignment.opponentWeakness != null && assignment.opponentWeight != null ? `${(assignment.opponentWeight * assignment.opponentWeakness * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                            </>
                                          )}
                                        </div>
                                      )}

                                      {renderAssumedOpponents(assignment.assumedOpponents, `doubles-assign-${assignment.machine}`)}

                                      <div className="mt-2 md:mt-3 flex flex-wrap gap-1.5 md:gap-2">
                                        {assignment.players && assignment.players.length > 0 && assignment.players.map((player) => (
                                          <Button
                                            key={player}
                                            variant="outline"
                                            size="sm"
                                            className="text-[10px] md:text-xs h-7 md:h-8 px-2 md:px-3"
                                            onClick={() => addAssignExclusion(assignment.machine, player, 'doubles')}
                                          >
                                            Exclude {player}
                                          </Button>
                                        ))}
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="text-[10px] md:text-xs h-7 md:h-8 px-2 md:px-3 text-destructive border-destructive/50 hover:bg-destructive/10"
                                          onClick={() => addMachineExclusion(assignment.machine)}
                                        >
                                          Exclude Machine
                                        </Button>
                                      </div>

                                      {/* Show Full Stats button and breakdown */}
                                      <div className="mt-3 pt-3 border-t">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-xs h-7 px-2"
                                          onClick={() => setShowFullStats(prev => ({ ...prev, [`assign-d-${assignment.machine}`]: !prev[`assign-d-${assignment.machine}`] }))}
                                        >
                                          {showFullStats[`assign-d-${assignment.machine}`] ? 'Hide' : 'Show'} Full Stats
                                        </Button>

                                        {showFullStats[`assign-d-${assignment.machine}`] && (
                                          <div className="mt-3 space-y-4 text-xs bg-muted/50 rounded p-3">
                                            {/* Current Slider Settings */}
                                            <div>
                                              <h5 className="font-semibold mb-2">Slider Settings Applied:</h5>
                                              <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                                                <div>Venue Weight: {venueWeight}%</div>
                                                <div>User Input Weight: {userInputWeight}%</div>
                                                <div>Confidence Boost: {confidenceBoost}%</div>
                                                <div>Opponent Weight: {opponentWeight}%</div>
                                                <div>Win Rate Weight: {winRateWeight}%</div>
                                                <div>Recent Form Weight: {recentFormWeight}%</div>
                                                <div>Data Confidence Weight: {dataConfidenceWeight}%</div>
                                                <div>Venue Avg Weight: {venueAvgWeight}%</div>
                                              </div>
                                            </div>

                                            {/* Per-player breakdown */}
                                            {assignment.stats && assignment.stats.map((s: any) => (
                                              <div key={s.player} className="border-t pt-3">
                                                <h5 className="font-semibold mb-2">{s.player} Stats:</h5>
                                                <div className="space-y-2">
                                                  <div className="grid grid-cols-2 gap-1">
                                                    <div>League Games: {s.playsCount || 0}</div>
                                                    <div>Avg Score: {s.avgScore?.toLocaleString() || 'N/A'}</div>
                                                    <div>Win Rate: {s.winRate != null ? `${s.winRate}%` : 'N/A'}</div>
                                                    <div>Recent Form: {s.recentForm != null ? `${s.recentForm}%` : 'N/A'}</div>
                                                    <div>% of Venue Avg: {s.pctOfVenue != null ? `${s.pctOfVenue}%` : 'N/A'}</div>
                                                    <div>Data Confidence: {s.confidenceScore || 0}/10</div>
                                                  </div>

                                                  {/* Detailed Score Breakdown */}
                                                  {s.scoreBreakdown && (
                                                    <div className="mt-2 pt-2 border-t border-dashed">
                                                      <div className="font-medium mb-2">Individual Scores Used:</div>

                                                      {/* League Scores */}
                                                      {s.scoreBreakdown.leagueScores?.length > 0 && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">League Games ({s.scoreBreakdown.leagueScores.length}):</div>
                                                          <div className="max-h-32 overflow-y-auto bg-background/50 rounded p-1">
                                                            <table className="w-full text-[10px]">
                                                              <thead>
                                                                <tr className="text-muted-foreground">
                                                                  <th className="text-left px-1">Score</th>
                                                                  <th className="text-left px-1">Venue Avg</th>
                                                                  <th className="text-left px-1">Ratio</th>
                                                                  <th className="text-left px-1">W/L</th>
                                                                </tr>
                                                              </thead>
                                                              <tbody>
                                                                {s.scoreBreakdown.leagueScores.map((score: any, idx: number) => (
                                                                  <tr key={idx} className={score.won ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                                                    <td className="px-1">{score.score.toLocaleString()}</td>
                                                                    <td className="px-1">{Math.round(score.venueAvg).toLocaleString()}</td>
                                                                    <td className="px-1">{(score.ratio * 100).toFixed(0)}%</td>
                                                                    <td className="px-1">{score.won ? 'W' : 'L'}</td>
                                                                  </tr>
                                                                ))}
                                                              </tbody>
                                                            </table>
                                                          </div>
                                                          <div className="text-[10px] text-muted-foreground mt-1">
                                                            League Avg Ratio: {((s.scoreBreakdown.leagueVenueAdjustedAvg || 1) * 100).toFixed(1)}%
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Scores */}
                                                      {s.scoreBreakdown.userScores?.length > 0 && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">Logged Scores ({s.scoreBreakdown.userScores.length}, 1x weight each):</div>
                                                          <div className="max-h-24 overflow-y-auto bg-background/50 rounded p-1">
                                                            <table className="w-full text-[10px]">
                                                              <thead>
                                                                <tr className="text-muted-foreground">
                                                                  <th className="text-left px-1">Score</th>
                                                                  <th className="text-left px-1">Venue Avg</th>
                                                                  <th className="text-left px-1">Ratio</th>
                                                                </tr>
                                                              </thead>
                                                              <tbody>
                                                                {s.scoreBreakdown.userScores.map((score: any, idx: number) => (
                                                                  <tr key={idx}>
                                                                    <td className="px-1">{score.score.toLocaleString()}</td>
                                                                    <td className="px-1">{Math.round(score.venueAvg).toLocaleString()}</td>
                                                                    <td className="px-1">{(score.ratio * 100).toFixed(0)}%</td>
                                                                  </tr>
                                                                ))}
                                                              </tbody>
                                                            </table>
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Input Average */}
                                                      {s.scoreBreakdown.userInputAverage && (
                                                        <div className="mb-2">
                                                          <div className="text-[10px] font-medium text-muted-foreground mb-1">Self-Reported Average (3x weight):</div>
                                                          <div className="text-[10px] bg-background/50 rounded p-1">
                                                            {s.scoreBreakdown.userInputAverage.score.toLocaleString()} ÷ {Math.round(s.scoreBreakdown.userInputAverage.venueAvg).toLocaleString()} = {(s.scoreBreakdown.userInputAverage.ratio * 100).toFixed(1)}%
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* User Average Calculation */}
                                                      {(s.scoreBreakdown.userScores?.length > 0 || s.scoreBreakdown.userInputAverage) && (
                                                        <div className="text-[10px] text-muted-foreground">
                                                          User Data Avg Ratio: {s.scoreBreakdown.userVenueAdjustedAvg != null ? `${(s.scoreBreakdown.userVenueAdjustedAvg * 100).toFixed(1)}%` : 'N/A'}
                                                        </div>
                                                      )}

                                                      {/* Final Blended Calculation */}
                                                      <div className="mt-2 pt-2 border-t border-dashed">
                                                        <div className="text-[10px] font-medium mb-1">Final Venue-Adjusted Avg Calculation:</div>
                                                        <div className="text-[10px] text-muted-foreground space-y-0.5">
                                                          {s.scoreBreakdown.userInputWeightApplied > 0 && s.scoreBreakdown.userVenueAdjustedAvg != null ? (
                                                            <>
                                                              <div>= League × (1 - {(s.scoreBreakdown.userInputWeightApplied * 100).toFixed(0)}%) + User × {(s.scoreBreakdown.userInputWeightApplied * 100).toFixed(0)}%</div>
                                                              <div>= {((s.scoreBreakdown.leagueVenueAdjustedAvg || 1) * 100).toFixed(1)}% × {(1 - s.scoreBreakdown.userInputWeightApplied).toFixed(2)} + {(s.scoreBreakdown.userVenueAdjustedAvg * 100).toFixed(1)}% × {s.scoreBreakdown.userInputWeightApplied.toFixed(2)}</div>
                                                              <div className="font-medium text-foreground">= {(s.scoreBreakdown.finalVenueAdjustedAvg * 100).toFixed(1)}% of venue average</div>
                                                            </>
                                                          ) : (
                                                            <div className="font-medium text-foreground">= {(s.scoreBreakdown.finalVenueAdjustedAvg * 100).toFixed(1)}% of venue average (league only)</div>
                                                          )}
                                                        </div>
                                                      </div>
                                                    </div>
                                                  )}

                                                  {(s.userAverage != null || s.userConfidence != null) && !s.scoreBreakdown && (
                                                    <div className="mt-2 pt-2 border-t border-dashed">
                                                      <div className="font-medium mb-1">User Input Data:</div>
                                                      <div className="grid grid-cols-2 gap-1">
                                                        {s.userAverage != null && <div>Self-Reported Avg: {s.userAverage.toLocaleString()}</div>}
                                                        {s.userConfidence != null && <div>Self-Reported Confidence: {s.userConfidence}/10</div>}
                                                      </div>
                                                    </div>
                                                  )}

                                                  <div className="mt-2 pt-2 border-t border-dashed">
                                                    <div className="font-medium mb-1">Performance Score Calculation:</div>
                                                    <div className="text-muted-foreground space-y-1">
                                                      <div>= (Win Rate × {winRateWeight}%) + (Recent Form × {recentFormWeight}%) + (Venue Adj × {venueAvgWeight}%) + (Data Conf × {dataConfidenceWeight}%)</div>
                                                      <div>= ({s.winRate ?? 0}/100 × {winRateWeight/100}) + ({s.recentForm ?? 0}/100 × {recentFormWeight/100}) + (min({(s.pctOfVenue ?? 100)}/200, 1) × {venueAvgWeight/100}) + ({s.confidenceScore ?? 0}/10 × {dataConfidenceWeight/100})</div>
                                                      <div className="font-medium text-foreground">= Performance Score: {s.performanceScore ?? 'N/A'}</div>
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            ))}

                                            {/* Explanation */}
                                            <div className="border-t pt-3 text-muted-foreground">
                                              <h5 className="font-semibold mb-1 text-foreground">How it works:</h5>
                                              <ul className="list-disc list-inside space-y-1">
                                                <li><strong>Venue Weight:</strong> Blends venue-specific stats ({venueWeight}%) with all-venue stats ({100-venueWeight}%)</li>
                                                <li><strong>User Input Weight:</strong> Blends your logged scores/averages ({userInputWeight}%) with league data ({100-userInputWeight}%)</li>
                                                <li><strong>Confidence Boost:</strong> Blends your self-reported confidence ({confidenceBoost}%) into the final score</li>
                                                <li><strong>Score Factors:</strong> Win Rate ({winRateWeight}%), Recent Form ({recentFormWeight}%), Venue Avg ({venueAvgWeight}%), Data Confidence ({dataConfidenceWeight}%)</li>
                                                {opponentWeight > 0 && <li><strong>Opponent Weight:</strong> Scores are adjusted by {opponentWeight}% of opponent weakness per machine. Positive weakness (opponent below venue avg) boosts scores, negative (above avg) penalizes.</li>}
                                              </ul>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            )
                          })}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                <TabsContent value="analysis" className="space-y-4">

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Select TWC player:</label>
                      <Select value={selectedAnalysisPlayer || undefined} onValueChange={setSelectedAnalysisPlayer}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a player" />
                        </SelectTrigger>
                        <SelectContent>
                          {allPlayers.map((player) => (
                            <SelectItem key={player} value={player}>
                              {player}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-end">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="show-all-venues-analysis"
                          checked={showAllVenues}
                          onCheckedChange={(checked) => setShowAllVenues(!!checked)}
                        />
                        <label
                          htmlFor="show-all-venues-analysis"
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          Show all venues
                        </label>
                      </div>
                    </div>
                  </div>

                  {loadingAnalysis && (
                    <div className="flex items-center justify-center p-12">
                      <Loader2 className="h-8 w-8 animate-spin mr-2" />
                      <span>Loading player analysis...</span>
                    </div>
                  )}

                  {!loadingAnalysis && playerAnalysis && (
                    <>
                      <div className="mb-6">
                        <h4 className="font-semibold mb-3">Performance Profile for {selectedAnalysisPlayer}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                          <Card>
                            <CardContent className="pt-4">
                              <div className="text-sm text-muted-foreground">Total Games Played</div>
                              <div className="text-2xl font-bold">{playerAnalysis.totalGames}</div>
                              <div className="text-xs text-muted-foreground">
                                {showAllVenues ? 'All venues' : `At ${selectedVenue}`}
                              </div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-4">
                              <div className="text-sm text-muted-foreground">Machines Played</div>
                              <div className="text-2xl font-bold">{playerAnalysis.uniqueMachines}</div>
                              <div className="text-xs text-muted-foreground">
                                From {selectedVenue} list
                              </div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-4">
                              <div className="text-sm text-muted-foreground">Venues</div>
                              <div className="text-2xl font-bold">{playerAnalysis.venuesPlayed}</div>
                              <div className="text-xs text-muted-foreground">
                                Where these machines were played
                              </div>
                            </CardContent>
                          </Card>
                        </div>

                        <h4 className="font-semibold mb-3">Machine Performance</h4>
                        {playerAnalysis.machinePerformance && playerAnalysis.machinePerformance.length > 0 ? (
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={() => handleAnalysisSort('machine')}
                                  >
                                    <div className="flex items-center">
                                      Machine
                                      <SortIcon column="machine" currentColumn={analysisSortColumn} direction={analysisSortDirection} />
                                    </div>
                                  </TableHead>
                                  <TableHead
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={() => handleAnalysisSort('avgScore')}
                                  >
                                    <div className="flex items-center">
                                      Avg Score
                                      <SortIcon column="avgScore" currentColumn={analysisSortColumn} direction={analysisSortDirection} />
                                    </div>
                                  </TableHead>
                                  <TableHead
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={() => handleAnalysisSort('pctOfVenue')}
                                  >
                                    <div className="flex items-center">
                                      % of Venue Avg
                                      <SortIcon column="pctOfVenue" currentColumn={analysisSortColumn} direction={analysisSortDirection} />
                                    </div>
                                  </TableHead>
                                  <TableHead
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={() => handleAnalysisSort('timesPlayed')}
                                  >
                                    <div className="flex items-center">
                                      Times Played
                                      <SortIcon column="timesPlayed" currentColumn={analysisSortColumn} direction={analysisSortDirection} />
                                    </div>
                                  </TableHead>
                                  {showAllVenues && (
                                    <TableHead
                                      className="cursor-pointer hover:bg-muted/50"
                                      onClick={() => handleAnalysisSort('venuesPlayed')}
                                    >
                                      <div className="flex items-center">
                                        Venues Played
                                        <SortIcon column="venuesPlayed" currentColumn={analysisSortColumn} direction={analysisSortDirection} />
                                      </div>
                                    </TableHead>
                                  )}
                                  {showAllVenues && (
                                    <TableHead
                                      className="cursor-pointer hover:bg-muted/50"
                                      onClick={() => handleAnalysisSort('bestVenue')}
                                    >
                                      <div className="flex items-center">
                                        Best Venue
                                        <SortIcon column="bestVenue" currentColumn={analysisSortColumn} direction={analysisSortDirection} />
                                      </div>
                                    </TableHead>
                                  )}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {getSortedAnalysis().map((machine: any) => (
                                  <TableRow key={machine.machine}>
                                    <TableCell className="font-medium">{machine.machine}</TableCell>
                                    <TableCell>{machine.avgScore.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                                    <TableCell>{machine.pctOfVenue.toFixed(1)}%</TableCell>
                                    <TableCell>{machine.timesPlayed}</TableCell>
                                    {showAllVenues && <TableCell>{machine.venuesPlayed}</TableCell>}
                                    {showAllVenues && <TableCell className="text-xs">{machine.bestVenue}</TableCell>}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <div className="text-center p-12 text-muted-foreground">
                            No machine data available for this player
                          </div>
                        )}

                        {playerAnalysis.machinePerformance && playerAnalysis.machinePerformance.length > 0 && (
                          <>
                            <h4 className="font-semibold mt-6 mb-3">Top Machines for {selectedAnalysisPlayer}</h4>
                            <div className="space-y-2">
                              {playerAnalysis.machinePerformance.slice(0, 3).map((machine: any, index: number) => (
                                <div key={machine.machine} className="p-3 border rounded bg-background">
                                  <div className="font-medium">
                                    {index + 1}. {machine.machine}
                                  </div>
                                  <div className="text-sm text-muted-foreground mt-1">
                                    {machine.pctOfVenue.toFixed(1)}% of venue average ({machine.avgScore.toLocaleString(undefined, { maximumFractionDigits: 0 })} avg score)
                                    {showAllVenues && ` - Best at ${machine.bestVenue}`}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  )}

                  {!loadingAnalysis && !playerAnalysis && selectedAnalysisPlayer && (
                    <div className="text-center p-12 text-muted-foreground">
                      No data available for this player
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </CardContent>
      </Card>

      {/* NEW: Advanced Machine Optimization Section */}
      <Card className="mt-6">
        <CardContent className="pt-6">
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-5 w-5" />
              <h2 className="text-xl font-bold">Advanced Machine Optimization (Beta)</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Hungarian algorithm-based optimization with performance heatmap visualization.
              This is a new experimental feature running alongside the original strategy tools above.
            </p>
          </div>

          {!loading && selectedVenue && selectedOpponent && (
            <>
              <div className="flex justify-center mb-6">
                <Button
                  variant="outline"
                  className="text-xs md:text-sm"
                  onClick={() => {
                    const selectedPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p])
                    const playersToUse = selectedPlayers.length > 0 ? selectedPlayers : rosterPlayers
                    const venueData = venues.find(v => v.name === selectedVenue)
                    const machinesToUse = venueData?.machines || []
                    const params = new URLSearchParams({
                      venue: selectedVenue,
                      players: playersToUse.join(','),
                      machines: machinesToUse.join(','),
                      seasonStart: String(seasonRange[0]),
                      seasonEnd: String(seasonRange[1]),
                      venueWeight: String(venueWeight),
                      userInputWeight: String(userInputWeight),
                    })
                    window.open(`/strategy/heatmap?${params.toString()}`, '_blank', 'noopener')
                  }}
                >
                  Open Performance Heatmap
                </Button>
              </div>

              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Drag players onto machines for manual assignments, or use auto-optimize for algorithmic recommendations.
                </p>

                {/* Active machine exclusions */}
                {excludedMachines.length > 0 && (
                  <div className="space-y-1">
                    {excludedMachines.map((machine) => (
                      <div key={`machine-excl-${machine}`} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                        <span>{getMachineDisplayName(machine)} excluded from all results</span>
                        <button
                          className="ml-auto text-amber-500 hover:text-amber-700 dark:hover:text-amber-200"
                          onClick={() => removeMachineExclusion(machine)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Format selector */}
                <div className="flex items-center gap-4 mb-4">
                  <label className="text-sm font-medium">Format:</label>
                  <div className="flex gap-2">
                    <Button
                      variant={optimizationFormat === '7x7' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setOptimizationFormat('7x7')}
                    >
                      7x7 Singles
                    </Button>
                    <Button
                      variant={optimizationFormat === '4x2' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setOptimizationFormat('4x2')}
                    >
                      4x2 Doubles
                    </Button>
                  </div>
                </div>

                {pickerPlayerNames.length > 0 && pickerMachines.length > 0 ? (
                  <MachinePicker
                    format={optimizationFormat}
                    playerNames={pickerPlayerNames}
                    machines={pickerMachines}
                    seasonStart={seasonRange[0]}
                    seasonEnd={seasonRange[1]}
                    venue={selectedVenue}
                    venueWeight={venueWeight / 100}
                    userInputWeight={userInputWeight / 100}
                    confidenceBoost={confidenceBoost / 100}
                    scoreWeights={scoreWeights}
                    exclusions={optimizationFormat === '7x7' ? singlesExclusions : doublesExclusions}
                    mustPlay={Array.from(satOutPlayers)}
                    onAddExclusion={(machine, player) => addExclusion(machine, player, optimizationFormat === '7x7' ? 'singles' : 'doubles')}
                    onRemoveExclusion={(machine, player) => removeExclusion(machine, player, optimizationFormat === '7x7' ? 'singles' : 'doubles')}
                    onExcludeMachine={addMachineExclusion}
                    opponent={selectedOpponent}
                    opponentPlayers={getSelectedOpponentPlayers()}
                    opponentWeight={opponentWeight / 100}
                    useNashEquilibrium={useNashEquilibrium}
                    onOptimize={(result: OptimizationResult) => {
                      console.log('Optimization result:', result)
                      if (optimizationFormat === '7x7') {
                        setHungarianSinglesResult(result)
                      } else {
                        setHungarianDoublesResult(result)
                      }
                    }}
                  />
                ) : (
                  <div className="text-center p-8 border border-dashed rounded">
                    <p className="text-muted-foreground">
                      {loadingMatrix
                        ? 'Loading...'
                        : 'No data available. Make sure players are selected above.'}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {!selectedVenue || !selectedOpponent && (
            <div className="text-center p-12 text-muted-foreground">
              Please select a venue and opponent above to use advanced optimization
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cell Details Dialog */}
      <Dialog open={cellDetailsOpen} onOpenChange={setCellDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedCell && (() => {
                const displayLabel = selectedCell.column
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
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleCellSort('player')}
                    >
                      <div className="flex items-center">
                        Player
                        <SortIcon column="player" currentColumn={cellSortColumn} direction={cellSortDirection} />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleCellSort('score')}
                    >
                      <div className="flex items-center">
                        Score
                        <SortIcon column="score" currentColumn={cellSortColumn} direction={cellSortDirection} />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleCellSort('match')}
                    >
                      <div className="flex items-center">
                        Match
                        <SortIcon column="match" currentColumn={cellSortColumn} direction={cellSortDirection} />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleCellSort('round')}
                    >
                      <div className="flex items-center">
                        Round
                        <SortIcon column="round" currentColumn={cellSortColumn} direction={cellSortDirection} />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleCellSort('season')}
                    >
                      <div className="flex items-center">
                        Season
                        <SortIcon column="season" currentColumn={cellSortColumn} direction={cellSortDirection} />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleCellSort('venue')}
                    >
                      <div className="flex items-center">
                        Venue
                        <SortIcon column="venue" currentColumn={cellSortColumn} direction={cellSortDirection} />
                      </div>
                    </TableHead>
                    {cellDetails.details[0].points !== undefined && (
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleCellSort('points')}
                      >
                        <div className="flex items-center">
                          Points
                          <SortIcon column="points" currentColumn={cellSortColumn} direction={cellSortDirection} />
                        </div>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getSortedCellDetails().map((detail: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{detail.player}</TableCell>
                      <TableCell>{detail.score.toLocaleString()}</TableCell>
                      <TableCell>{detail.match}</TableCell>
                      <TableCell>{detail.round}</TableCell>
                      <TableCell>{detail.season}</TableCell>
                      <TableCell className="text-xs">{detail.venue}</TableCell>
                      {detail.points !== undefined && <TableCell>{detail.points}</TableCell>}
                    </TableRow>
                  ))}
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

      {/* Report Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Strategy Report</DialogTitle>
            <DialogDescription>
              Copy this report to share machine picks and player assignments
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <pre className="p-4 bg-muted rounded-lg text-xs whitespace-pre-wrap font-mono overflow-x-auto">
              {reportText}
            </pre>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setReportDialogOpen(false)}>
              Close
            </Button>
            <Button onClick={copyReportToClipboard}>
              {reportCopied ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Copied!
                </>
              ) : (
                'Copy to Clipboard'
              )}
            </Button>
            <Button
              onClick={sendToDiscord}
              disabled={discordSending || !reportText || reportText === 'Generating report...'}
              variant="default"
            >
              {discordSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : discordSent ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Sent!
                </>
              ) : (
                'Send to Discord'
              )}
            </Button>
          </div>
          {discordError && (
            <p className="text-sm text-destructive mt-2 text-right">{discordError}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

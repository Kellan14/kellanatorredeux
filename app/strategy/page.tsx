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
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Plus, X, ChevronDown, ChevronUp, Target, Users } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { getMachineImagePath } from '@/lib/machine-images'

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

interface PlayerAssignment {
  machine: string
  players: string[]
  stats?: {
    player: string
    pctOfVenue: number
    playsCount: number
    avgScore: number
  }[]
}

export default function StrategyPage() {
  // State
  const [venues, setVenues] = useState<Venue[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedVenue, setSelectedVenue] = useState<string>('')
  const [selectedOpponent, setSelectedOpponent] = useState<string>('')
  const [seasonRange, setSeasonRange] = useState<[number, number]>([20, 22])
  const [loading, setLoading] = useState(false)
  const [loadingDropdowns, setLoadingDropdowns] = useState(true)
  const [teamVenueSpecific, setTeamVenueSpecific] = useState(true)
  const [twcVenueSpecific, setTwcVenueSpecific] = useState(false)

  // Machine advantages
  const [machineAdvantages, setMachineAdvantages] = useState<MachineAdvantage[]>([])

  // Player availability
  const [availablePlayers, setAvailablePlayers] = useState<Record<string, boolean>>({})
  const [allPlayers, setAllPlayers] = useState<string[]>([])
  const [rosterPlayers, setRosterPlayers] = useState<string[]>([])
  const [subPlayers, setSubPlayers] = useState<string[]>([])
  const [showSubs, setShowSubs] = useState(false)

  // Machine picking state
  const [numSinglesMachines, setNumSinglesMachines] = useState(7)
  const [numDoublesMachines, setNumDoublesMachines] = useState(4)
  const [singlesRecommendations, setSinglesRecommendations] = useState<PlayerAssignment[]>([])
  const [doublesRecommendations, setDoublesRecommendations] = useState<PlayerAssignment[]>([])

  // Player assignment state (when opponent picks)
  const [singlesOpponentPicks, setSinglesOpponentPicks] = useState<string[]>([])
  const [doublesOpponentPicks, setDoublesOpponentPicks] = useState<string[]>([])
  const [singlesAssignments, setSinglesAssignments] = useState<PlayerAssignment[]>([])
  const [doublesAssignments, setDoublesAssignments] = useState<PlayerAssignment[]>([])
  const [newMachine, setNewMachine] = useState('')

  // Cell details dialog
  const [cellDetailsOpen, setCellDetailsOpen] = useState(false)
  const [selectedCell, setSelectedCell] = useState<{machine: string, column: string} | null>(null)
  const [cellDetails, setCellDetails] = useState<any>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  // Expanded recommendations state
  const [expandedRecommendations, setExpandedRecommendations] = useState<Record<string, boolean>>({})

  // Player analysis state
  const [selectedAnalysisPlayer, setSelectedAnalysisPlayer] = useState<string>('')
  const [showAllVenues, setShowAllVenues] = useState(false)
  const [playerAnalysis, setPlayerAnalysis] = useState<any>(null)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)

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
  }, [selectedVenue, selectedOpponent, seasonRange, teamVenueSpecific, twcVenueSpecific])

  const loadVenuesAndTeams = async () => {
    setLoadingDropdowns(true)
    try {
      const venuesResponse = await fetch('/api/venues')
      const venuesData = await venuesResponse.json()
      setVenues(venuesData.venues || [])

      const teamsResponse = await fetch('/api/teams?season=22')
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
      const response = await fetch(
        `/api/machine-advantages?` +
        `venue=${encodeURIComponent(selectedVenue)}` +
        `&opponent=${encodeURIComponent(selectedOpponent)}` +
        `&seasonStart=${seasonRange[0]}` +
        `&seasonEnd=${seasonRange[1]}` +
        `&teamVenueSpecific=${teamVenueSpecific}` +
        `&twcVenueSpecific=${twcVenueSpecific}`
      )

      if (response.ok) {
        const data = await response.json()
        setMachineAdvantages(data.advantages || [])
        setAllPlayers(data.players || [])
        setRosterPlayers(data.rosterPlayers || [])
        setSubPlayers(data.subPlayers || [])

        // Initialize player availability (all roster players checked by default)
        const initialAvailability: Record<string, boolean> = {}
        ;(data.rosterPlayers || []).forEach((player: string) => {
          initialAvailability[player] = true
        })
        setAvailablePlayers(initialAvailability)
      }
    } catch (error) {
      console.error('Error loading machine advantages:', error)
    } finally {
      setLoading(false)
    }
  }

  const optimizeSinglesPicks = async () => {
    const selectedPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p])

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
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          format: 'singles',
          numMachines: numSinglesMachines,
          availablePlayers: selectedPlayers,
          teamVenueSpecific,
          twcVenueSpecific,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setSinglesRecommendations(data.recommendations || [])
      }
    } catch (error) {
      console.error('Error optimizing singles picks:', error)
    }
  }

  const optimizeDoublesPicks = async () => {
    const selectedPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p])

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
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          format: 'doubles',
          numMachines: numDoublesMachines,
          availablePlayers: selectedPlayers,
          teamVenueSpecific,
          twcVenueSpecific,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setDoublesRecommendations(data.recommendations || [])
      }
    } catch (error) {
      console.error('Error optimizing doubles picks:', error)
    }
  }

  const optimizeSinglesAssignments = async () => {
    const selectedPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p])

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
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          format: 'singles',
          machines: singlesOpponentPicks,
          availablePlayers: selectedPlayers,
          teamVenueSpecific,
          twcVenueSpecific,
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
    const selectedPlayers = Object.keys(availablePlayers).filter(p => availablePlayers[p])

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
          seasonStart: seasonRange[0],
          seasonEnd: seasonRange[1],
          format: 'doubles',
          machines: doublesOpponentPicks,
          availablePlayers: selectedPlayers,
          teamVenueSpecific,
          twcVenueSpecific,
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

  const addOpponentPick = (machine: string, format: 'singles' | 'doubles') => {
    if (!machine) return

    if (format === 'singles') {
      if (!singlesOpponentPicks.includes(machine)) {
        setSinglesOpponentPicks([...singlesOpponentPicks, machine])
      }
    } else {
      if (!doublesOpponentPicks.includes(machine)) {
        setDoublesOpponentPicks([...doublesOpponentPicks, machine])
      }
    }
    setNewMachine('')
  }

  const removeOpponentPick = (machine: string, format: 'singles' | 'doubles') => {
    if (format === 'singles') {
      setSinglesOpponentPicks(singlesOpponentPicks.filter(m => m !== machine))
    } else {
      setDoublesOpponentPicks(doublesOpponentPicks.filter(m => m !== machine))
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
        `&allVenues=${showAllVenues}`
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
                      {[14, 15, 16, 17, 18, 19, 20, 21, 22].map(s => (
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
                      {[14, 15, 16, 17, 18, 19, 20, 21, 22].map(s => (
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
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold">TWC Player Availability</h3>
                    <p className="text-sm text-muted-foreground">Select players available for this match</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="show-subs"
                      checked={showSubs}
                      onCheckedChange={(checked) => setShowSubs(!!checked)}
                    />
                    <label
                      htmlFor="show-subs"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Show Subs ({subPlayers.length})
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {rosterPlayers.map((player) => (
                    <div key={player} className="flex items-center space-x-2">
                      <Checkbox
                        id={`player-${player}`}
                        checked={availablePlayers[player] || false}
                        onCheckedChange={(checked) =>
                          setAvailablePlayers({ ...availablePlayers, [player]: !!checked })
                        }
                      />
                      <label
                        htmlFor={`player-${player}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {player}
                      </label>
                    </div>
                  ))}
                  {showSubs && subPlayers.map((player) => (
                    <div key={player} className="flex items-center space-x-2">
                      <Checkbox
                        id={`player-${player}`}
                        checked={availablePlayers[player] || false}
                        onCheckedChange={(checked) =>
                          setAvailablePlayers({ ...availablePlayers, [player]: !!checked })
                        }
                      />
                      <label
                        htmlFor={`player-${player}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-muted-foreground"
                      >
                        {player} (sub)
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Machine Advantage Table */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3">Machine Advantage Analysis</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Machines ranked by strategic advantage for TWC vs {selectedOpponent} at {selectedVenue}
                </p>
                {machineAdvantages.length > 0 && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Machine</TableHead>
                          <TableHead>Composite Score</TableHead>
                          <TableHead>TWC % of Venue</TableHead>
                          <TableHead>Opponent % of Venue</TableHead>
                          <TableHead>Statistical Advantage</TableHead>
                          <TableHead>Advantage Level</TableHead>
                          <TableHead>Top TWC Players</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {machineAdvantages.map((adv, index) => (
                          <TableRow key={adv.machine}>
                            <TableCell className="font-medium">{adv.machine}</TableCell>
                            <TableCell>{adv.compositeScore?.toFixed(1) || 'N/A'}</TableCell>
                            <TableCell
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => handleCellClick(adv.machine, 'twcPctOfVenue')}
                            >
                              {adv.twcPctOfVenue?.toFixed(1) || 'N/A'}%
                            </TableCell>
                            <TableCell
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => handleCellClick(adv.machine, 'opponentPctOfVenue')}
                            >
                              {adv.opponentPctOfVenue?.toFixed(1) || 'N/A'}%
                            </TableCell>
                            <TableCell>{adv.statisticalAdvantage?.toFixed(1) || 'N/A'}</TableCell>
                            <TableCell>
                              <span className={`px-2 py-1 rounded text-xs ${
                                adv.advantageLevel === 'High' ? 'bg-green-100 text-green-800' :
                                adv.advantageLevel === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {adv.advantageLevel}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs">{adv.topTwcPlayers?.join(', ') || 'N/A'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* Strategic Planning Tabs */}
              <Tabs defaultValue="picking" className="w-full">
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3 mb-12">
                  <TabsTrigger value="picking">Machine Picking Strategy</TabsTrigger>
                  <TabsTrigger value="assignment">Player Assignment Strategy</TabsTrigger>
                  <TabsTrigger value="analysis">Player Analysis</TabsTrigger>
                </TabsList>

                <TabsContent value="picking" className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    When TWC is picking machines first, use this tool to select the optimal machines and assign players.
                  </p>

                  <Tabs defaultValue="singles" className="w-full">
                    <TabsList>
                      <TabsTrigger value="singles">Singles</TabsTrigger>
                      <TabsTrigger value="doubles">Doubles</TabsTrigger>
                    </TabsList>

                    <TabsContent value="singles" className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div>
                          <label className="text-sm font-medium mb-2 block">Number of machines to pick:</label>
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            value={numSinglesMachines}
                            onChange={(e) => setNumSinglesMachines(parseInt(e.target.value) || 7)}
                            className="w-24"
                          />
                        </div>
                        <Button onClick={optimizeSinglesPicks} className="mt-6">
                          Optimize Singles Picks
                        </Button>
                      </div>

                      {singlesRecommendations.length > 0 && (
                        <div className="mt-4">
                          <h4 className="font-semibold mb-3">Recommended Machine Picks:</h4>
                          {singlesRecommendations.map((rec, index) => {
                            const machineData = machineAdvantages.find(m => m.machine === rec.machine)
                            const isExpanded = expandedRecommendations[rec.machine]

                            return (
                              <Collapsible
                                key={rec.machine}
                                open={isExpanded}
                                onOpenChange={(open) => setExpandedRecommendations(prev => ({
                                  ...prev,
                                  [rec.machine]: open
                                }))}
                                className="mb-3"
                              >
                                <div className="border rounded overflow-hidden">
                                  <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 relative overflow-hidden">
                                    <div
                                      className="absolute right-0 top-0 bottom-0 w-1/2 opacity-50"
                                      style={{
                                        backgroundImage: `url(${getMachineImagePath(rec.machine, rec.machine)})`,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                        backgroundRepeat: 'no-repeat'
                                      }}
                                    />
                                    <div className="text-left relative z-10">
                                      <div className="font-medium">
                                        {index + 1}. {rec.machine}
                                      </div>
                                      {rec.players && rec.players.length > 0 && (
                                        <div className="text-sm text-muted-foreground mt-1">
                                          Assigned Player: {rec.players.join(', ')}
                                        </div>
                                      )}
                                      {machineData && (
                                        <div className="text-sm text-muted-foreground mt-1">
                                          Composite Score: {machineData.compositeScore.toFixed(1)}
                                        </div>
                                      )}
                                    </div>
                                    <div className="relative z-10">
                                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    </div>
                                  </CollapsibleTrigger>

                                  <CollapsibleContent className="px-3 pb-3">
                                    {machineData && (
                                      <div className="pt-3 border-t space-y-2">
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                          <div><strong>Advantage Level:</strong> {machineData.advantageLevel}</div>
                                          <div><strong>TWC % of Venue:</strong> {machineData.twcPctOfVenue.toFixed(1)}%</div>
                                          <div><strong>Opponent % of Venue:</strong> {machineData.opponentPctOfVenue.toFixed(1)}%</div>
                                          <div><strong>Statistical Advantage:</strong> {machineData.statisticalAdvantage.toFixed(1)}</div>
                                          <div><strong>Experience Advantage:</strong> {machineData.experienceAdvantage} plays</div>
                                          <div><strong>TWC Plays:</strong> {(machineData as any).twcPlays || 0}</div>
                                        </div>
                                        {machineData.topTwcPlayers && machineData.topTwcPlayers.length > 0 && (
                                          <div className="mt-3">
                                            <strong className="text-sm">Top TWC Players:</strong>
                                            <div className="text-sm text-muted-foreground">
                                              {machineData.topTwcPlayers.join(', ')}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            )
                          })}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="doubles" className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div>
                          <label className="text-sm font-medium mb-2 block">Number of machines to pick:</label>
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            value={numDoublesMachines}
                            onChange={(e) => setNumDoublesMachines(parseInt(e.target.value) || 4)}
                            className="w-24"
                          />
                        </div>
                        <Button onClick={optimizeDoublesPicks} className="mt-6">
                          Optimize Doubles Picks
                        </Button>
                      </div>

                      {doublesRecommendations.length > 0 && (
                        <div className="mt-4">
                          <h4 className="font-semibold mb-3">Recommended Machine Picks:</h4>
                          {doublesRecommendations.map((rec, index) => {
                            const machineData = machineAdvantages.find(m => m.machine === rec.machine)
                            const isExpanded = expandedRecommendations[rec.machine]

                            return (
                              <Collapsible
                                key={rec.machine}
                                open={isExpanded}
                                onOpenChange={(open) => setExpandedRecommendations(prev => ({
                                  ...prev,
                                  [rec.machine]: open
                                }))}
                                className="mb-3"
                              >
                                <div className="border rounded overflow-hidden">
                                  <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 relative overflow-hidden">
                                    <div
                                      className="absolute right-0 top-0 bottom-0 w-1/2 opacity-50"
                                      style={{
                                        backgroundImage: `url(${getMachineImagePath(rec.machine, rec.machine)})`,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                        backgroundRepeat: 'no-repeat'
                                      }}
                                    />
                                    <div className="text-left relative z-10">
                                      <div className="font-medium">
                                        {index + 1}. {rec.machine}
                                      </div>
                                      {rec.players && rec.players.length > 0 && (
                                        <div className="text-sm text-muted-foreground mt-1">
                                          Assigned Players: {rec.players.join(', ')}
                                        </div>
                                      )}
                                      {machineData && (
                                        <div className="text-sm text-muted-foreground mt-1">
                                          Composite Score: {machineData.compositeScore.toFixed(1)}
                                        </div>
                                      )}
                                    </div>
                                    <div className="relative z-10">
                                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    </div>
                                  </CollapsibleTrigger>

                                  <CollapsibleContent className="px-3 pb-3">
                                    {machineData && (
                                      <div className="pt-3 border-t space-y-2">
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                          <div><strong>Advantage Level:</strong> {machineData.advantageLevel}</div>
                                          <div><strong>TWC % of Venue:</strong> {machineData.twcPctOfVenue.toFixed(1)}%</div>
                                          <div><strong>Opponent % of Venue:</strong> {machineData.opponentPctOfVenue.toFixed(1)}%</div>
                                          <div><strong>Statistical Advantage:</strong> {machineData.statisticalAdvantage.toFixed(1)}</div>
                                          <div><strong>Experience Advantage:</strong> {machineData.experienceAdvantage} plays</div>
                                          <div><strong>TWC Plays:</strong> {(machineData as any).twcPlays || 0}</div>
                                        </div>
                                        {machineData.topTwcPlayers && machineData.topTwcPlayers.length > 0 && (
                                          <div className="mt-3">
                                            <strong className="text-sm">Top TWC Players:</strong>
                                            <div className="text-sm text-muted-foreground">
                                              {machineData.topTwcPlayers.join(', ')}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
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
                  <p className="text-sm text-muted-foreground">
                    When the opponent has picked machines, use this tool to optimally assign your players.
                  </p>

                  <Tabs defaultValue="singles" className="w-full">
                    <TabsList>
                      <TabsTrigger value="singles">Singles</TabsTrigger>
                      <TabsTrigger value="doubles">Doubles</TabsTrigger>
                    </TabsList>

                    <TabsContent value="singles" className="space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">Machines picked by opponent:</label>
                        <div className="flex gap-2 mb-3">
                          <Select value={newMachine} onValueChange={setNewMachine}>
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select machine" />
                            </SelectTrigger>
                            <SelectContent>
                              {machineAdvantages
                                .filter(m => !singlesOpponentPicks.includes(m.machine))
                                .map(m => (
                                  <SelectItem key={m.machine} value={m.machine}>
                                    {m.machine}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <Button
                            onClick={() => addOpponentPick(newMachine, 'singles')}
                            disabled={!newMachine}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add
                          </Button>
                        </div>

                        {singlesOpponentPicks.length > 0 && (
                          <div className="space-y-2 mb-4">
                            {singlesOpponentPicks.map((machine, index) => (
                              <div key={machine} className="flex items-center justify-between p-2 border rounded">
                                <span>{index + 1}. {machine}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeOpponentPick(machine, 'singles')}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}

                        {singlesOpponentPicks.length > 0 && (
                          <Button onClick={optimizeSinglesAssignments}>
                            Optimize Singles Assignments
                          </Button>
                        )}
                      </div>

                      {singlesAssignments.length > 0 && (
                        <div className="mt-4">
                          <h4 className="font-semibold mb-3">Recommended Player Assignments:</h4>
                          {singlesAssignments.map((assignment) => (
                            <div key={assignment.machine} className="mb-3 p-3 border rounded">
                              <div className="font-medium">{assignment.machine}</div>
                              <div className="text-sm text-muted-foreground mt-1">
                                Assigned Player: {assignment.players.join(', ')}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="doubles" className="space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">Machines picked by opponent:</label>
                        <div className="flex gap-2 mb-3">
                          <Select value={newMachine} onValueChange={setNewMachine}>
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select machine" />
                            </SelectTrigger>
                            <SelectContent>
                              {machineAdvantages
                                .filter(m => !doublesOpponentPicks.includes(m.machine))
                                .map(m => (
                                  <SelectItem key={m.machine} value={m.machine}>
                                    {m.machine}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <Button
                            onClick={() => addOpponentPick(newMachine, 'doubles')}
                            disabled={!newMachine}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add
                          </Button>
                        </div>

                        {doublesOpponentPicks.length > 0 && (
                          <div className="space-y-2 mb-4">
                            {doublesOpponentPicks.map((machine, index) => (
                              <div key={machine} className="flex items-center justify-between p-2 border rounded">
                                <span>{index + 1}. {machine}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeOpponentPick(machine, 'doubles')}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}

                        {doublesOpponentPicks.length > 0 && (
                          <Button onClick={optimizeDoublesAssignments}>
                            Optimize Doubles Assignments
                          </Button>
                        )}
                      </div>

                      {doublesAssignments.length > 0 && (
                        <div className="mt-4">
                          <h4 className="font-semibold mb-3">Recommended Player Assignments:</h4>
                          {doublesAssignments.map((assignment) => (
                            <div key={assignment.machine} className="mb-3 p-3 border rounded">
                              <div className="font-medium">{assignment.machine}</div>
                              <div className="text-sm text-muted-foreground mt-1">
                                Assigned Players: {assignment.players.join(', ')}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                <TabsContent value="analysis" className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Analyze individual TWC player performance on machines at {selectedVenue}.
                  </p>

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
                                  <TableHead>Machine</TableHead>
                                  <TableHead>Avg Score</TableHead>
                                  <TableHead>% of Venue Avg</TableHead>
                                  <TableHead>Times Played</TableHead>
                                  {showAllVenues && <TableHead>Venues Played</TableHead>}
                                  {showAllVenues && <TableHead>Best Venue</TableHead>}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {playerAnalysis.machinePerformance.map((machine: any) => (
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
                                <div key={machine.machine} className="p-3 border rounded">
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
            <Tabs defaultValue="heatmap" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="heatmap">Performance Heatmap</TabsTrigger>
                <TabsTrigger value="optimizer">Drag & Drop Optimizer</TabsTrigger>
              </TabsList>

              <TabsContent value="heatmap" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Visualize player performance on each machine. Darker colors indicate better win rates.
                  Click cells for detailed stats.
                </p>
                <div className="text-center p-8 border border-dashed rounded">
                  <p className="text-muted-foreground">
                    Performance matrix component coming soon
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Will display win rates, games played, and streaks for each player-machine combination
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="optimizer" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Drag players onto machines for manual assignments, or use auto-optimize for algorithmic recommendations.
                </p>
                <div className="text-center p-8 border border-dashed rounded">
                  <p className="text-muted-foreground">
                    Drag and drop machine picker coming soon
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Supports both 7x7 singles and 4x2 doubles formats
                  </p>
                </div>
              </TabsContent>
            </Tabs>
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
                    <TableHead>Player</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Match</TableHead>
                    <TableHead>Round</TableHead>
                    <TableHead>Season</TableHead>
                    <TableHead>Venue</TableHead>
                    {cellDetails.details[0].points !== undefined && <TableHead>Points</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cellDetails.details.map((detail: any, index: number) => (
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
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { PlayerCombobox } from '@/components/ui/player-combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Trophy, Target, Calendar, BarChart3, Percent, ChevronRight, ChevronDown, Users, LayoutDashboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { getMachineImagePath } from '@/lib/machine-images'
import { getMachineDisplayName } from '@/lib/machine-mappings'
import { usePlayerNames } from '@/hooks/use-player-names'

interface Top10Entry {
  rank: number
  player: string
  score: number
  venue: string
  season: number
}

interface PlayerStats {
  name: string
  ipr: number
  matchesPlayed: number
  pointsWon: number
  pointsPerMatch: number
  pops: number
  currentSeason: number
  team: string
}

interface Achievement {
  machine: string
  score: number
  rank: number
  context: string
  category: string
  venue?: string
  isVenueSpecific?: boolean
}

interface MachineScore {
  score: number
  season: number
  week: number
  venue: string
  matchKey: string
  round: string
  points: number
}

interface TeamHistory {
  team: string
  teamName: string
  seasons: number[]
}

interface MachinePops {
  machine: string
  games: number
  totalPoints: number
  totalPossible: number
  pops: number
}

interface Venue {
  key: string
  name: string
}

export default function PlayerProfilePage() {
  const router = useRouter()
  const { players } = usePlayerNames()
  const [selectedPlayer, setSelectedPlayer] = useState<string>('')
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null)
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [teamHistory, setTeamHistory] = useState<TeamHistory[]>([])
  const [machines, setMachines] = useState<string[]>([])
  const [selectedMachine, setSelectedMachine] = useState<string>('')
  const [machineScores, setMachineScores] = useState<MachineScore[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingScores, setLoadingScores] = useState(false)

  // Achievement dialog state
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null)
  const [achievementDialogOpen, setAchievementDialogOpen] = useState(false)
  const [achievementTop10, setAchievementTop10] = useState<Top10Entry[]>([])

  // POPS by Machine state
  const [machinePops, setMachinePops] = useState<MachinePops[]>([])
  const [popsExpanded, setPopsExpanded] = useState(true)
  const [popsSeasonStart, setPopsSeasonStart] = useState<number>(1)
  const [popsSeasonEnd, setPopsSeasonEnd] = useState<number>(99)
  const [popsVenue, setPopsVenue] = useState<string>('all')
  const [venues, setVenues] = useState<Venue[]>([])
  const [loadingPops, setLoadingPops] = useState(false)
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([])

  // TWC roster state for dashboard switch
  const [twcRosterPlayers, setTwcRosterPlayers] = useState<string[]>([])
  const [isOnTwcRoster, setIsOnTwcRoster] = useState<boolean>(false)

  // Load venues, seasons, and TWC roster on mount (players come from the cached hook)
  useEffect(() => {
    loadVenuesAndSeasons()
    loadTwcRoster()
  }, [])

  // Check if selected player is on TWC roster
  useEffect(() => {
    if (selectedPlayer && twcRosterPlayers.length > 0) {
      setIsOnTwcRoster(twcRosterPlayers.includes(selectedPlayer))
    } else {
      setIsOnTwcRoster(false)
    }
  }, [selectedPlayer, twcRosterPlayers])

  // Load POPS by machine when player or filters change
  useEffect(() => {
    if (selectedPlayer) {
      loadMachinePops()
    } else {
      setMachinePops([])
    }
  }, [selectedPlayer, popsSeasonStart, popsSeasonEnd, popsVenue])

  // Load player data and their machines when selected
  useEffect(() => {
    if (selectedPlayer) {
      loadPlayerData()
      loadPlayerMachines(selectedPlayer)
    } else {
      setPlayerStats(null)
      setAchievements([])
      setTeamHistory([])
      setSelectedMachine('')
      setMachineScores([])
      setMachines([])
    }
  }, [selectedPlayer])

  // Load machine scores when machine selected
  useEffect(() => {
    if (selectedPlayer && selectedMachine) {
      loadMachineScores()
    } else {
      setMachineScores([])
    }
  }, [selectedPlayer, selectedMachine])

  const loadTwcRoster = async () => {
    try {
      const response = await fetch('/api/twc-roster')
      if (response.ok) {
        const data = await response.json()
        // Include both roster players and subs as "TWC players"
        const allTwcPlayers = [...(data.rosterPlayers || []), ...(data.subPlayers || [])]
        setTwcRosterPlayers(allTwcPlayers)
      }
    } catch (error) {
      console.error('Error loading TWC roster:', error)
    }
  }

  const handleSwitchToDashboard = () => {
    router.push(`/?viewPlayer=${encodeURIComponent(selectedPlayer)}`)
  }

  const loadVenuesAndSeasons = async () => {
    try {
      const [venuesRes, seasonsRes] = await Promise.all([
        fetch('/api/venues'),
        fetch('/api/seasons')
      ])

      if (venuesRes.ok) {
        const data = await venuesRes.json()
        setVenues(data.venues || [])
      }

      if (seasonsRes.ok) {
        const data = await seasonsRes.json()
        const seasons = data.seasons || []
        setAvailableSeasons(seasons)
        if (seasons.length > 0) {
          setPopsSeasonStart(Math.min(...seasons))
          setPopsSeasonEnd(Math.max(...seasons))
        }
      }
    } catch (error) {
      console.error('Error loading venues/seasons:', error)
    }
  }

  const loadMachinePops = async () => {
    if (!selectedPlayer) return
    setLoadingPops(true)

    try {
      const params = new URLSearchParams({
        player: selectedPlayer,
        seasonStart: popsSeasonStart.toString(),
        seasonEnd: popsSeasonEnd.toString(),
        venue: popsVenue
      })

      const response = await fetch(`/api/player-pops-by-machine?${params}`)
      if (response.ok) {
        const data = await response.json()
        setMachinePops(data.machines || [])
      }
    } catch (error) {
      console.error('Error loading machine POPS:', error)
    } finally {
      setLoadingPops(false)
    }
  }

  const loadPlayerMachines = async (player: string) => {
    try {
      const response = await fetch(`/api/player-machines?player=${encodeURIComponent(player)}`)
      if (response.ok) {
        const data = await response.json()
        setMachines(data.machines || [])
      }
    } catch (error) {
      console.error('Error loading player machines:', error)
    }
  }

  const loadPlayerData = async () => {
    if (!selectedPlayer) return
    setLoading(true)

    try {
      // Load stats, achievements, and team history in parallel
      const [statsRes, achievementsRes, teamsRes] = await Promise.all([
        fetch(`/api/player-ipr?name=${encodeURIComponent(selectedPlayer)}`),
        fetch(`/api/player-top10-achievements?player=${encodeURIComponent(selectedPlayer)}`),
        fetch(`/api/player-teams?player=${encodeURIComponent(selectedPlayer)}`)
      ])

      if (statsRes.ok) {
        const data = await statsRes.json()
        setPlayerStats(data)
      }

      if (achievementsRes.ok) {
        const data = await achievementsRes.json()
        setAchievements(data.achievements || [])
      }

      if (teamsRes.ok) {
        const data = await teamsRes.json()
        setTeamHistory(data.teams || [])
      }
    } catch (error) {
      console.error('Error loading player data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMachineScores = async () => {
    if (!selectedPlayer || !selectedMachine) return
    setLoadingScores(true)

    try {
      const response = await fetch(
        `/api/player-machine-stats?` +
        `player=${encodeURIComponent(selectedPlayer)}` +
        `&machine=${encodeURIComponent(selectedMachine)}` +
        `&seasonStart=1` +
        `&seasonEnd=99`
      )

      if (response.ok) {
        const data = await response.json()
        setMachineScores(data.stats || [])
      }
    } catch (error) {
      console.error('Error loading machine scores:', error)
    } finally {
      setLoadingScores(false)
    }
  }

  const handleAchievementClick = async (achievement: Achievement) => {
    setSelectedAchievement(achievement)
    setAchievementDialogOpen(true)

    // Parse venue from context if venue-specific
    let venueParam = ''
    if (achievement.isVenueSpecific && achievement.venue) {
      venueParam = achievement.venue
    }

    try {
      const url = `/api/machine-top10?` +
        `machine=${encodeURIComponent(achievement.machine)}` +
        `&context=${encodeURIComponent(achievement.context)}` +
        `&venue=${encodeURIComponent(venueParam)}`

      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setAchievementTop10(data.topScores || [])
      }
    } catch (error) {
      console.error('Error fetching top 10:', error)
    }
  }

  const calculateStats = () => {
    if (machineScores.length === 0) return null
    const scores = machineScores.map(s => s.score).sort((a, b) => a - b)
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const mid = Math.floor(scores.length / 2)
    const median = scores.length % 2 === 0 ? (scores[mid - 1] + scores[mid]) / 2 : scores[mid]

    // Calculate POPS
    let totalPoints = 0
    let totalPossible = 0
    for (const s of machineScores) {
      totalPoints += s.points
      // Determine if doubles based on points having .5
      const isDoubles = (s.points * 10) % 10 !== 0
      totalPossible += isDoubles ? 2.5 : 3
    }
    const pops = totalPossible > 0 ? (totalPoints / totalPossible) * 100 : 0

    return {
      mean,
      median,
      count: scores.length,
      high: scores[scores.length - 1],
      low: scores[0],
      totalPoints,
      totalPossible,
      pops
    }
  }

  return (
    <div className="container py-8 px-4 md:px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Player Profile</h1>
        <p className="text-muted-foreground text-lg">
          View detailed stats and achievements for any player
        </p>
      </div>

      {/* Player Selector */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Select Player</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="w-full md:w-[300px]">
            <PlayerCombobox
              players={players}
              value={selectedPlayer}
              onValueChange={setSelectedPlayer}
              placeholder="Search players..."
            />
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading player data...</p>
        </div>
      )}

      {selectedPlayer && playerStats && !loading && (
        <>
          {/* Team Info */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                {selectedPlayer}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div>
                    <span className="text-muted-foreground">Current Team: </span>
                    <span className="font-semibold">{playerStats.team || 'Unknown'}</span>
                  </div>
                  {teamHistory.length > 1 && (
                    <div>
                      <span className="text-muted-foreground">Previous Teams: </span>
                      <span>
                        {teamHistory
                          .filter(t => t.teamName !== playerStats.team)
                          .map(t => `${t.teamName} (S${t.seasons.join(', S')})`)
                          .join(', ')}
                      </span>
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  className="w-full md:w-auto"
                  onClick={handleSwitchToDashboard}
                >
                  <LayoutDashboard className="h-4 w-4 mr-2" />
                  {isOnTwcRoster ? 'Switch to Dashboard' : 'Assume Sub for TWC'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 gap-2 md:gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
            <Card className="hover:shadow-lg transition-shadow hover:border-neon-blue/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2 p-3 md:p-6">
                <CardTitle className="text-xs md:text-sm font-medium">IPR</CardTitle>
                <Trophy className="h-3 w-3 md:h-4 md:w-4 text-neon-yellow" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">{Math.round(playerStats.ipr)}</div>
                <p className="text-[10px] md:text-xs text-muted-foreground">
                  Season {playerStats.currentSeason}
                </p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow hover:border-neon-blue/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2 p-3 md:p-6">
                <CardTitle className="text-xs md:text-sm font-medium">Matches Played</CardTitle>
                <Calendar className="h-3 w-3 md:h-4 md:w-4 text-neon-blue" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">{playerStats.matchesPlayed}</div>
                <p className="text-[10px] md:text-xs text-muted-foreground">
                  Season {playerStats.currentSeason}
                </p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow hover:border-neon-blue/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2 p-3 md:p-6">
                <CardTitle className="text-xs md:text-sm font-medium">Points Won</CardTitle>
                <Target className="h-3 w-3 md:h-4 md:w-4 text-neon-green" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">{playerStats.pointsWon}</div>
                <p className="text-[10px] md:text-xs text-muted-foreground">
                  Total this season
                </p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow hover:border-neon-blue/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2 p-3 md:p-6">
                <CardTitle className="text-xs md:text-sm font-medium">Points/Match</CardTitle>
                <BarChart3 className="h-3 w-3 md:h-4 md:w-4 text-neon-purple" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">{(playerStats.pointsPerMatch || 0).toFixed(1)}</div>
                <p className="text-[10px] md:text-xs text-muted-foreground">
                  Average per match
                </p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow hover:border-neon-blue/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2 p-3 md:p-6">
                <CardTitle className="text-xs md:text-sm font-medium">POPS</CardTitle>
                <Percent className="h-3 w-3 md:h-4 md:w-4 text-neon-pink" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">{(playerStats.pops || 0).toFixed(1)}%</div>
                <p className="text-[10px] md:text-xs text-muted-foreground">
                  Percent of points scored
                </p>
              </CardContent>
            </Card>
          </div>

          {/* POPS by Machine */}
          <Card className="mb-8">
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => setPopsExpanded(!popsExpanded)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Percent className="h-5 w-5" />
                  POPS by Machine
                </CardTitle>
                <ChevronDown
                  className={`h-5 w-5 transition-transform ${popsExpanded ? '' : '-rotate-90'}`}
                />
              </div>
              <CardDescription>
                Percentage of points scored per machine
              </CardDescription>
            </CardHeader>

            {popsExpanded && (
              <CardContent>
                {/* Filters */}
                <div className="flex flex-wrap gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Seasons:</Label>
                    <Select
                      value={popsSeasonStart.toString()}
                      onValueChange={(v) => setPopsSeasonStart(parseInt(v))}
                    >
                      <SelectTrigger className="w-[80px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableSeasons.map(s => (
                          <SelectItem key={s} value={s.toString()}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span>to</span>
                    <Select
                      value={popsSeasonEnd.toString()}
                      onValueChange={(v) => setPopsSeasonEnd(parseInt(v))}
                    >
                      <SelectTrigger className="w-[80px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableSeasons.map(s => (
                          <SelectItem key={s} value={s.toString()}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Venue:</Label>
                    <Select value={popsVenue} onValueChange={setPopsVenue}>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Venues</SelectItem>
                        {venues.map(v => (
                          <SelectItem key={v.key} value={v.name}>{v.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {loadingPops && (
                  <p className="text-muted-foreground">Loading POPS data...</p>
                )}

                {!loadingPops && machinePops.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">Machine</th>
                          <th className="text-right p-2">Games</th>
                          <th className="text-right p-2">Points</th>
                          <th className="text-right p-2">Possible</th>
                          <th className="text-right p-2">POPS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {machinePops.map((m) => (
                          <tr key={m.machine} className="border-b hover:bg-muted/50">
                            <td className="p-2 font-medium">{getMachineDisplayName(m.machine)}</td>
                            <td className="p-2 text-right">{m.games}</td>
                            <td className="p-2 text-right">{m.totalPoints}</td>
                            <td className="p-2 text-right">{m.totalPossible}</td>
                            <td className={`p-2 text-right font-semibold ${
                              m.pops >= 70 ? 'text-green-600' :
                              m.pops >= 50 ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>
                              {m.pops.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!loadingPops && machinePops.length === 0 && (
                  <p className="text-muted-foreground">
                    No POPS data found for the selected filters.
                  </p>
                )}
              </CardContent>
            )}
          </Card>

          {/* Top 10 Achievements */}
          {achievements.length > 0 && (
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Top 10 Rankings</CardTitle>
                <CardDescription>
                  {selectedPlayer}'s top 10 scores across all machines
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {achievements.map((achievement, index) => (
                    <div
                      key={index}
                      className="relative overflow-hidden border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => handleAchievementClick(achievement)}
                    >
                      {/* Background image */}
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1/3 opacity-30"
                        style={{
                          backgroundImage: `url(${getMachineImagePath(achievement.machine, achievement.machine)})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          backgroundRepeat: 'no-repeat'
                        }}
                      />
                      <div className="relative z-10 flex items-start justify-between p-3">
                        <div className="flex-1">
                          <div className="font-semibold">{achievement.machine}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {(achievement.score || 0).toLocaleString()} points - {achievement.context}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                          <div className={`text-lg font-bold ${
                            achievement.category === 'league-all' ? 'text-neon-yellow' :
                            achievement.category === 'venue-all' ? 'text-gray-400' :
                            achievement.category === 'league-season' ? 'text-orange-600' :
                            'text-neon-blue'
                          }`}>
                            #{achievement.rank}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Machine Scores Section */}
          <Card className="mb-8 relative overflow-hidden">
            {/* Background image when machine is selected */}
            {selectedMachine && (
              <div
                className="absolute right-0 top-0 bottom-0 w-1/2 opacity-20 pointer-events-none"
                style={{
                  backgroundImage: `url(${getMachineImagePath(selectedMachine, selectedMachine)})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat'
                }}
              />
            )}
            <CardHeader className="relative z-10">
              <CardTitle>Machine Scores</CardTitle>
              <CardDescription>
                Select a machine to see all of {selectedPlayer}'s scores
              </CardDescription>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="mb-4">
                <Label>Select Machine</Label>
                <Select value={selectedMachine} onValueChange={setSelectedMachine}>
                  <SelectTrigger className="w-full md:w-[300px] mt-1">
                    <SelectValue placeholder="Choose a machine..." />
                  </SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {loadingScores && (
                <p className="text-muted-foreground">Loading scores...</p>
              )}

              {selectedMachine && !loadingScores && machineScores.length > 0 && (
                <>
                  {/* Stats Summary */}
                  {(() => {
                    const stats = calculateStats()
                    if (!stats) return null
                    return (
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6 p-4 bg-muted/50 rounded-lg">
                        <div>
                          <div className="text-xs text-muted-foreground">Games</div>
                          <div className="text-lg font-semibold">{stats.count}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Average</div>
                          <div className="text-lg font-semibold">{stats.mean.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Median</div>
                          <div className="text-lg font-semibold">{stats.median.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">High</div>
                          <div className="text-lg font-semibold text-green-600">{stats.high.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Low</div>
                          <div className="text-lg font-semibold text-red-600">{stats.low.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">POPS</div>
                          <div className={`text-lg font-semibold ${
                            stats.pops >= 70 ? 'text-green-600' :
                            stats.pops >= 50 ? 'text-yellow-600' :
                            'text-red-600'
                          }`}>
                            {stats.pops.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Scores Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">Score</th>
                          <th className="text-left p-2">Season</th>
                          <th className="text-left p-2">Week</th>
                          <th className="text-left p-2">Venue</th>
                          <th className="text-left p-2">Points</th>
                        </tr>
                      </thead>
                      <tbody>
                        {machineScores
                          .sort((a, b) => b.score - a.score)
                          .map((score, index) => (
                            <tr key={index} className="border-b hover:bg-muted/50">
                              <td className="p-2 font-medium">{score.score.toLocaleString()}</td>
                              <td className="p-2">{score.season}</td>
                              <td className="p-2">{score.week}</td>
                              <td className="p-2 text-sm">{score.venue}</td>
                              <td className="p-2">{score.points}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {selectedMachine && !loadingScores && machineScores.length === 0 && (
                <p className="text-muted-foreground">
                  No scores found for {selectedPlayer} on {selectedMachine}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Achievement Top 10 Dialog */}
      <Dialog open={achievementDialogOpen} onOpenChange={setAchievementDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedAchievement?.machine} - Top 10
            </DialogTitle>
            <DialogDescription>
              {selectedAchievement?.context}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {achievementTop10.map((entry) => {
              const isCurrentPlayer = entry.player === selectedPlayer ||
                entry.player === `${selectedPlayer} (sub)` ||
                (entry.player.startsWith(selectedPlayer) && entry.player.toLowerCase().includes('(sub)'))
              return (
                <div
                  key={entry.rank}
                  className={`flex items-center justify-between p-3 border rounded-lg ${
                    isCurrentPlayer ? 'bg-neon-blue/10 border-neon-blue' : ''
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`text-2xl font-bold min-w-[3rem] ${
                      entry.rank === 1 ? 'text-neon-yellow' :
                      entry.rank === 2 ? 'text-gray-400' :
                      entry.rank === 3 ? 'text-orange-600' :
                      'text-neon-blue'
                    }`}>
                      #{entry.rank}
                    </div>
                    <div>
                      <div className={`font-semibold ${isCurrentPlayer ? 'text-neon-blue' : ''}`}>
                        {entry.player}
                        {isCurrentPlayer && (
                          <span className="ml-2 text-xs text-neon-blue">(Selected)</span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {entry.venue} - Season {entry.season}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg">
                      {(entry.score || 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">points</div>
                  </div>
                </div>
              )
            })}

            {achievementTop10.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                Loading top 10...
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

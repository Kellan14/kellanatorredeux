'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Trophy, Target, TrendingUp, Users, Calendar, BarChart3, Percent, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, LineChart } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { createSupabaseClient } from '@/lib/supabase'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { getMachineImagePath } from '@/lib/machine-images'
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

export default function HomePage() {
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [matchLabel, setMatchLabel] = useState<string>('Loading...')
  const [opponent, setOpponent] = useState<string>('Loading...')
  const [matchDate, setMatchDate] = useState<string>('')
  const [venue, setVenue] = useState<string>('')
  const [matchState, setMatchState] = useState<string>('')
  const [loading, setLoading] = useState(true)
  
  // Player stats (will be fetched based on logged-in user)
  const [playerStats, setPlayerStats] = useState({
    ipr: 0,
    matchesPlayed: 0,
    pointsWon: 0,
    pointsPerMatch: 0,
    pops: 0,
    currentSeason: 23
  })

  // Opponents section
  const [opponentPlayers, setOpponentPlayers] = useState<string[]>([])
  const [showSubs, setShowSubs] = useState(false)

  // Achievements section
  const [achievements, setAchievements] = useState<any[]>([])
  const [selectedAchievement, setSelectedAchievement] = useState<any | null>(null)
  const [achievementDialogOpen, setAchievementDialogOpen] = useState(false)
  const [achievementTop10, setAchievementTop10] = useState<any[]>([])
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const [playerDialogOpen, setPlayerDialogOpen] = useState(false)
  const [machinesAtVenue, setMachinesAtVenue] = useState<string[]>([])
  const [playerVenueSpecific, setPlayerVenueSpecific] = useState(true)
  const [machineCounts, setMachineCounts] = useState<Record<string, { atVenue: number; allVenues: number }>>({})

  // Machine selection dialog
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null)
  const [machineDialogOpen, setMachineDialogOpen] = useState(false)
  const [playerMachineStats, setPlayerMachineStats] = useState<any[]>([])
  const [sortColumn, setSortColumn] = useState<string>('score')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  // Player performance profile
  const [playerPerformance, setPlayerPerformance] = useState<any>(null)
  const [playerName, setPlayerName] = useState<string>('')
  const [ownPerformanceVenueSpecific, setOwnPerformanceVenueSpecific] = useState(true)

  // IPR history dialog
  const [iprHistoryDialogOpen, setIprHistoryDialogOpen] = useState(false)
  const [iprHistory, setIprHistory] = useState<any[]>([])

  const supabase = createSupabaseClient()

  useEffect(() => {
    checkUser()
    fetchNextMatch()
  }, [])

  useEffect(() => {
    if (opponent && opponent !== 'Loading...' && opponent !== 'Schedule unavailable') {
      fetchOpponentPlayers()
    }
  }, [opponent, showSubs])

  useEffect(() => {
    if (playerName && venue && venue !== 'Loading...') {
      fetchPlayerPerformance()
    }
  }, [playerName, venue, ownPerformanceVenueSpecific])

  useEffect(() => {
    if (playerName) {
      fetchAchievements()
    }
  }, [playerName])

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)
    if (user) {
      // Load personalized stats based on user
      loadPlayerStats(user)
    }
    setLoading(false)
  }

  const loadPlayerStats = async (user: SupabaseUser) => {
    try {
      // Get player_name from profiles table (NEW SYSTEM)
      const { data: profileData } = await supabase
        .from('profiles')
        .select('player_name')
        .eq('id', user.id)
        .maybeSingle()

      const profile = profileData as { player_name: string | null } | null

      if (!profile?.player_name) {
        console.log('No TWC player association found for this user')
        return
      }

      const playerName = profile.player_name

      // Save player name for performance profile
      setPlayerName(playerName)

      // Fetch comprehensive stats from most recent matches
      const statsResponse = await fetch(`/api/player-ipr?name=${encodeURIComponent(playerName)}`)

      if (statsResponse.ok) {
        const statsData = await statsResponse.json()

        setPlayerStats({
          ipr: statsData.ipr || 0,
          matchesPlayed: statsData.matchesPlayed || 0,
          pointsWon: statsData.pointsWon || 0,
          pointsPerMatch: statsData.pointsPerMatch || 0,
          pops: statsData.pops || 0,
          currentSeason: statsData.currentSeason || 22
        })
      } else {
        console.log(`Player "${playerName}" not found in recent matches`)
      }
    } catch (error) {
      console.error('Error loading player stats:', error)
    }
  }

  const fetchNextMatch = async () => {
    try {
      const response = await fetch('/api/latest-twc-match')
      const data = await response.json()

      if (data.opponent && data.venue) {
        setOpponent(data.opponent)
        setVenue(data.venue)
        setMatchState(data.state)

        // Set label based on match state
        if (data.state === 'complete') {
          setMatchLabel('Last Match')
        } else if (data.state === 'playing') {
          setMatchLabel('Match In Progress')
        } else {
          setMatchLabel('Next Match')
        }

        // Format date if available
        // Week info can be used to create a rough date estimate
        if (data.week) {
          setMatchDate(`Week ${data.week}`)
        }
      } else {
        setOpponent('Schedule unavailable')
        setMatchLabel('Match Info')
      }
    } catch (error) {
      console.error('Error fetching match data:', error)
      setOpponent('Schedule unavailable')
      setMatchLabel('Match Info')
    }
  }

  const fetchOpponentPlayers = async () => {
    try {
      // Fetch roster/players for the opponent team
      const response = await fetch(
        `/api/machine-advantages?` +
        `venue=${encodeURIComponent(venue)}` +
        `&opponent=${encodeURIComponent(opponent)}` +
        `&seasonStart=20` +
        `&seasonEnd=22` +
        `&teamVenueSpecific=true` +
        `&twcVenueSpecific=false`
      )

      if (response.ok) {
        const data = await response.json()
        // Get unique players from the advantages data
        const allPlayers = new Set<string>()

        // We need to fetch the actual roster - let me use a different approach
        // For now, we'll get players from match data
        const playersResponse = await fetch(`/api/team-roster?team=${encodeURIComponent(opponent)}&season=22&showSubs=${showSubs}`)

        if (playersResponse.ok) {
          const playersData = await playersResponse.json()
          // Extract just the names from player objects
          const playerNames = (playersData.players || []).map((p: any) => p.name)
          setOpponentPlayers(playerNames)
        }

        // Also fetch machines at venue for machine selection dialog
        const machines = data.advantages?.map((adv: any) => adv.machine) || []
        setMachinesAtVenue(machines)
      }
    } catch (error) {
      console.error('Error fetching opponent players:', error)
    }
  }

  const fetchPlayerPerformance = async () => {
    console.log('Fetching player performance for:', playerName, 'at venue:', venue, 'venue-specific:', ownPerformanceVenueSpecific)
    try {
      const url = `/api/player-analysis?` +
        `player=${encodeURIComponent(playerName)}` +
        `&venue=${encodeURIComponent(venue)}` +
        `&seasonStart=20` +
        `&seasonEnd=22` +
        `&allVenues=${!ownPerformanceVenueSpecific}`

      console.log('Performance API URL:', url)
      const response = await fetch(url)

      if (response.ok) {
        const data = await response.json()
        console.log('Player performance data:', data)

        // If venue-specific returned no data, try all venues
        if (ownPerformanceVenueSpecific && (!data.machinePerformance || data.machinePerformance.length === 0)) {
          console.log('No venue-specific data found, switching to all venues')
          setOwnPerformanceVenueSpecific(false)
          return
        }

        setPlayerPerformance(data)
      } else {
        console.error('Performance API failed:', response.status)
        setPlayerPerformance(null)
      }
    } catch (error) {
      console.error('Error fetching player performance:', error)
      setPlayerPerformance(null)
    }
  }

  const fetchAchievements = async () => {
    try {
      const response = await fetch(`/api/player-top10-achievements?player=${encodeURIComponent(playerName)}`)
      if (response.ok) {
        const data = await response.json()
        setAchievements(data.achievements || [])
      }
    } catch (error) {
      console.error('Error fetching achievements:', error)
    }
  }

  const handleAchievementClick = async (achievement: any) => {
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

  const handlePlayerClick = async (playerName: string) => {
    setSelectedPlayer(playerName)
    setPlayerDialogOpen(true)

    // Fetch machine play counts for this player
    try {
      const response = await fetch(
        `/api/player-machine-counts?` +
        `player=${encodeURIComponent(playerName)}` +
        `&venue=${encodeURIComponent(venue)}` +
        `&seasonStart=20` +
        `&seasonEnd=22`
      )

      if (response.ok) {
        const data = await response.json()
        setMachineCounts(data.counts || {})
      }
    } catch (error) {
      console.error('Error fetching machine counts:', error)
    }
  }

  const handleMachineClick = async (machine: string, useVenueSpecific?: boolean) => {
    if (!selectedPlayer) return

    setSelectedMachine(machine)
    setMachineDialogOpen(true)

    // Reset sort to default when opening new machine
    setSortColumn('score')
    setSortDirection('desc')

    // Use provided value or current state
    const venueFilter = useVenueSpecific !== undefined ? useVenueSpecific : playerVenueSpecific

    // Fetch stats for this player on this machine
    try {
      // Add timestamp to bust cache
      const url = `/api/player-machine-stats?` +
        `player=${encodeURIComponent(selectedPlayer)}` +
        `&machine=${encodeURIComponent(machine)}` +
        `&venue=${venueFilter ? encodeURIComponent(venue) : ''}` +
        `&seasonStart=20` +
        `&seasonEnd=22` +
        `&_t=${Date.now()}`

      console.log('Fetching player machine stats:', url)
      const response = await fetch(url, {
        cache: 'no-store'
      })

      if (response.ok) {
        const data = await response.json()
        console.log('Player machine stats received:', data)
        console.log('Stats array:', data.stats)
        console.log('Stats length:', data.stats?.length || 0)

        // Check if API returned the "disabled" message
        if (data.message && data.message.includes('disabled')) {
          console.error('API still returning disabled message - cache issue?')
          setPlayerMachineStats([])
        } else {
          setPlayerMachineStats(data.stats || [])
        }
      } else {
        console.error('Failed to fetch stats:', response.status, await response.text())
        setPlayerMachineStats([])
      }
    } catch (error) {
      console.error('Error fetching player machine stats:', error)
      setPlayerMachineStats([])
    }
  }

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New column, default to descending for score, ascending for others
      setSortColumn(column)
      setSortDirection(column === 'score' ? 'desc' : 'asc')
    }
  }

  const getSortedStats = () => {
    if (!playerMachineStats || playerMachineStats.length === 0) return []

    return [...playerMachineStats].sort((a, b) => {
      let aVal = a[sortColumn]
      let bVal = b[sortColumn]

      // Handle numeric columns
      if (sortColumn === 'score' || sortColumn === 'points' || sortColumn === 'season') {
        aVal = Number(aVal) || 0
        bVal = Number(bVal) || 0
      }

      // Handle string columns
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = bVal?.toLowerCase() || ''
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
  }

  const handleIPRClick = async () => {
    if (!playerName) return

    setIprHistoryDialogOpen(true)

    try {
      const response = await fetch(`/api/player-ipr-history?name=${encodeURIComponent(playerName)}`)
      if (response.ok) {
        const data = await response.json()
        setIprHistory(data.history || [])
      }
    } catch (error) {
      console.error('Error fetching IPR history:', error)
    }
  }

  const calculateStats = () => {
    if (!playerMachineStats || playerMachineStats.length === 0) {
      return { mean: 0, median: 0, mode: 0, iqr: 0 }
    }

    const scores = playerMachineStats.map(s => s.score).sort((a, b) => a - b)

    // Mean
    const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length

    // Median
    const mid = Math.floor(scores.length / 2)
    const median = scores.length % 2 === 0
      ? (scores[mid - 1] + scores[mid]) / 2
      : scores[mid]

    // Mode
    const frequency: Record<number, number> = {}
    scores.forEach(score => {
      frequency[score] = (frequency[score] || 0) + 1
    })
    const maxFreq = Math.max(...Object.values(frequency))
    const modes = Object.keys(frequency).filter(key => frequency[Number(key)] === maxFreq)
    const mode = Number(modes[0]) // If multiple modes, just take the first

    // IQR (Interquartile Range)
    const q1Index = Math.floor(scores.length * 0.25)
    const q3Index = Math.floor(scores.length * 0.75)
    const q1 = scores[q1Index]
    const q3 = scores[q3Index]
    const iqr = q3 - q1

    return { mean, median, mode, iqr }
  }

  return (
    <div className="container py-8 px-4 md:px-6">
      {/* Match Header */}
      <div className="text-center mb-8">
        <h1 className="text-base font-medium mb-4 text-muted-foreground">{matchLabel}</h1>
        <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-4">
          <Image
            src="/logo.jpg"
            alt="The Wrecking Crew"
            width={300}
            height={79}
            className="object-contain h-16 md:h-20 w-auto"
            priority
          />
          <div className="text-xl text-muted-foreground">vs</div>
          <div className="text-2xl font-semibold text-white">{opponent}</div>
        </div>
        {(matchDate || venue) && (
          <p className="text-muted-foreground mt-4">
            {matchDate && <span>{matchDate}</span>}
            {matchDate && venue && <span> • </span>}
            {venue && <span>{venue}</span>}
          </p>
        )}
      </div>

      {user ? (
        <>
          {/* Personal Stats Grid - Only shown when logged in */}
          <div className="grid grid-cols-2 gap-2 md:gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
            <Card
              className="hover:shadow-lg transition-shadow hover:border-neon-blue/50 cursor-pointer"
              onClick={handleIPRClick}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2 p-3 md:p-6">
                <CardTitle className="text-xs md:text-sm font-medium">
                  IPR
                </CardTitle>
                <Trophy className="h-3 w-3 md:h-4 md:w-4 text-neon-yellow" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-lg md:text-2xl font-bold">{Math.round(playerStats.ipr)}</div>
                <p className="text-[10px] md:text-xs text-muted-foreground">
                  Click for history
                </p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow hover:border-neon-blue/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2 p-3 md:p-6">
                <CardTitle className="text-xs md:text-sm font-medium">
                  Matches Played
                </CardTitle>
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
                <CardTitle className="text-xs md:text-sm font-medium">
                  Points Won
                </CardTitle>
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
                <CardTitle className="text-xs md:text-sm font-medium">
                  Points/Match
                </CardTitle>
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
                <CardTitle className="text-xs md:text-sm font-medium">
                  POPS
                </CardTitle>
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

          {/* Opponent Players Section */}
          <Card className="mb-8">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{opponent} Players</CardTitle>
                  <CardDescription>
                    Click a player to view their machine stats
                  </CardDescription>
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
                    Show Subs
                  </label>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {opponentPlayers.map((playerName) => (
                  <Button
                    key={playerName}
                    variant="outline"
                    className="justify-between h-auto py-3"
                    onClick={() => handlePlayerClick(playerName)}
                  >
                    <span className="truncate">{playerName}</span>
                    <ChevronRight className="h-4 w-4 ml-2 flex-shrink-0" />
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Player Performance Profile */}
          {playerName && venue && (
            playerPerformance && playerPerformance.machinePerformance && playerPerformance.machinePerformance.length > 0 ? (
            <Card className="mb-8">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Your Performance {ownPerformanceVenueSpecific ? `at ${venue}` : '(All Venues)'}</CardTitle>
                    <CardDescription>
                      Your machine performance profile for the upcoming venue
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="own-performance-venue-specific"
                      checked={ownPerformanceVenueSpecific}
                      onCheckedChange={(checked) => setOwnPerformanceVenueSpecific(!!checked)}
                    />
                    <label
                      htmlFor="own-performance-venue-specific"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Venue Specific
                    </label>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Machine</TableHead>
                        <TableHead>Avg Score</TableHead>
                        <TableHead>% of Venue Avg</TableHead>
                        <TableHead>Times Played</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {playerPerformance.machinePerformance.slice(0, 10).map((machine: any) => (
                        <TableRow key={machine.machine}>
                          <TableCell className="font-medium">{machine.machine}</TableCell>
                          <TableCell>{(machine.avgScore || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                          <TableCell>
                            <span className={
                              machine.pctOfVenue >= 100 ? 'text-green-600 font-semibold' :
                              machine.pctOfVenue >= 90 ? 'text-yellow-600' :
                              'text-muted-foreground'
                            }>
                              {(machine.pctOfVenue || 0).toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell>{machine.timesPlayed}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            ) : (
              <Card className="mb-8">
                <CardHeader>
                  <CardTitle>Performance Profile</CardTitle>
                  <CardDescription>
                    Debug info: Player={playerName}, Venue={venue}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground">
                    {!playerPerformance ? 'No performance data loaded yet...' :
                     !playerPerformance.machinePerformance ? 'No machine performance data...' :
                     playerPerformance.machinePerformance.length === 0 ? 'No machines played at this venue yet' :
                     'Unknown state'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    Check browser console for more details
                  </div>
                </CardContent>
              </Card>
            )
          )}

          {/* Top 10 Achievements Section */}
          {achievements.length > 0 && (
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Your Top 10 Rankings</CardTitle>
                <CardDescription>
                  Your top 10 scores across all machines (league-wide and venue-specific)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {achievements.slice(0, 20).map((achievement, index) => (
                    <div
                      key={index}
                      className="flex items-start justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => handleAchievementClick(achievement)}
                    >
                      <div className="flex-1">
                        <div className="font-semibold">{achievement.machine}</div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {(achievement.score || 0).toLocaleString()} points • #{achievement.rank} {achievement.context}
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
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Machine Selection Dialog */}
          <Dialog open={playerDialogOpen} onOpenChange={setPlayerDialogOpen}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {selectedPlayer} - Select Machine
                </DialogTitle>
                <DialogDescription>
                  Choose a machine to view {selectedPlayer}'s stats
                </DialogDescription>
              </DialogHeader>

              {/* Machines Grid */}
              <div className="space-y-3">
                {machinesAtVenue.map((machine) => {
                  const counts = machineCounts[machine] || { atVenue: 0, allVenues: 0 }

                  return (
                    <div
                      key={machine}
                      className="border rounded overflow-hidden cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => handleMachineClick(machine)}
                    >
                      <div className="p-3 flex items-center justify-between relative overflow-hidden">
                        {/* Background image on right half */}
                        <div
                          className="absolute right-0 top-0 bottom-0 w-1/2 opacity-50"
                          style={{
                            backgroundImage: `url(${getMachineImagePath(machine, machine)})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            backgroundRepeat: 'no-repeat'
                          }}
                        />
                        <div className="relative z-10 flex-1">
                          <div className="font-medium">{machine}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            <div>{counts.atVenue} play{counts.atVenue !== 1 ? 's' : ''} at {venue}</div>
                            <div>{counts.allVenues} play{counts.allVenues !== 1 ? 's' : ''} total</div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 relative z-10 flex-shrink-0" />
                      </div>
                    </div>
                  )
                })}
              </div>
            </DialogContent>
          </Dialog>

          {/* Player Machine Stats Dialog */}
          <Dialog open={machineDialogOpen} onOpenChange={setMachineDialogOpen}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {selectedPlayer} - {selectedMachine}
                </DialogTitle>
                <DialogDescription>
                  All scores for {selectedPlayer} on {selectedMachine}
                  {playerVenueSpecific ? ` at ${venue}` : ' (all venues)'}
                </DialogDescription>
              </DialogHeader>

              {/* Venue Specific Toggle */}
              <div className="flex items-center space-x-2 mb-4">
                <Checkbox
                  id="player-venue-specific-toggle"
                  checked={playerVenueSpecific}
                  onCheckedChange={(checked) => {
                    const newValue = !!checked
                    setPlayerVenueSpecific(newValue)
                    if (selectedPlayer && selectedMachine) {
                      handleMachineClick(selectedMachine, newValue)
                    }
                  }}
                />
                <label
                  htmlFor="player-venue-specific-toggle"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Venue Specific
                </label>
              </div>

              {/* Debug - show stats count */}
              {typeof window !== 'undefined' && (console.log('Dialog rendering with stats:', playerMachineStats), null)}

              {/* Statistical Summary */}
              {playerMachineStats.length > 0 && (
                <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-muted/50 rounded-lg">
                  {(() => {
                    const stats = calculateStats()
                    return (
                      <>
                        <div>
                          <div className="text-xs text-muted-foreground">Mean</div>
                          <div className="text-lg font-semibold">{(stats.mean || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Median</div>
                          <div className="text-lg font-semibold">{(stats.median || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">IQR</div>
                          <div className="text-lg font-semibold">{(stats.iqr || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}

              {/* Scores Table */}
              {playerMachineStats.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th
                          className="text-left p-2 cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('score')}
                        >
                          <div className="flex items-center gap-1">
                            Score
                            {sortColumn === 'score' && (
                              sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                            )}
                            {sortColumn !== 'score' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                        <th
                          className="text-left p-2 cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('match')}
                        >
                          <div className="flex items-center gap-1">
                            Opponent
                            {sortColumn === 'match' && (
                              sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                            )}
                            {sortColumn !== 'match' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                        <th
                          className="text-left p-2 cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('round')}
                        >
                          <div className="flex items-center gap-1">
                            Round
                            {sortColumn === 'round' && (
                              sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                            )}
                            {sortColumn !== 'round' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                        <th
                          className="text-left p-2 cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('season')}
                        >
                          <div className="flex items-center gap-1">
                            Season
                            {sortColumn === 'season' && (
                              sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                            )}
                            {sortColumn !== 'season' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                        <th
                          className="text-left p-2 cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('venue')}
                        >
                          <div className="flex items-center gap-1">
                            Venue
                            {sortColumn === 'venue' && (
                              sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                            )}
                            {sortColumn !== 'venue' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                        <th
                          className="text-left p-2 cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('points')}
                        >
                          <div className="flex items-center gap-1">
                            Points
                            {sortColumn === 'points' && (
                              sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                            )}
                            {sortColumn !== 'points' && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {getSortedStats().map((stat, index) => (
                        <tr key={index} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-medium">{(stat.score || 0).toLocaleString()}</td>
                          <td className="p-2">{stat.match}</td>
                          <td className="p-2">{stat.round}</td>
                          <td className="p-2">{stat.season}</td>
                          <td className="p-2 text-xs">{stat.venue}</td>
                          <td className="p-2">{stat.points !== undefined ? stat.points : 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="font-medium">No stats found for {selectedPlayer} on {selectedMachine}</p>
                  <p className="text-sm mt-2">
                    This player may not have played this machine{playerVenueSpecific ? ' at this venue' : ''} during seasons 20-22.
                  </p>
                  <p className="text-xs mt-2 opacity-70">
                    Check the browser console for detailed debugging information.
                  </p>
                </div>
              )}
            </DialogContent>
          </Dialog>

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
                  const isCurrentPlayer = entry.player === playerName
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
                            {isCurrentPlayer && <span className="ml-2 text-xs text-neon-blue">(You)</span>}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {entry.venue} • Season {entry.season}
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

          {/* IPR History Dialog */}
          <Dialog open={iprHistoryDialogOpen} onOpenChange={setIprHistoryDialogOpen}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>IPR History - {playerName}</DialogTitle>
                <DialogDescription>
                  Your Individual Player Ranking progression over time
                </DialogDescription>
              </DialogHeader>

              {iprHistory.length > 0 ? (
                <>
                  {/* Summary Stats */}
                  <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-muted/50 rounded-lg">
                    <div>
                      <div className="text-xs text-muted-foreground">Recent Placement</div>
                      <div className="text-lg font-semibold">{iprHistory[iprHistory.length - 1]?.ipr || 0}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Average Placement</div>
                      <div className="text-lg font-semibold">
                        {iprHistory.length > 0
                          ? (iprHistory.reduce((sum, h) => sum + h.ipr, 0) / iprHistory.length).toFixed(1)
                          : '0'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Total Matches</div>
                      <div className="text-lg font-semibold">{iprHistory.length}</div>
                    </div>
                  </div>

                  {/* Line Chart */}
                  <div className="w-full h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsLineChart
                        data={iprHistory}
                        margin={{ top: 5, right: 30, left: 20, bottom: 25 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="matchNumber"
                          tickFormatter={(value, index) => {
                            const match = iprHistory[index]
                            return match ? `S${match.season}W${match.week}` : value
                          }}
                          label={{ value: 'Season & Week', position: 'insideBottom', offset: -10 }}
                          angle={-45}
                          textAnchor="end"
                          height={60}
                        />
                        <YAxis
                          domain={[1, 6]}
                          ticks={[1, 2, 3, 4, 5, 6]}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload
                              return (
                                <div className="bg-background border rounded-lg p-3 shadow-lg">
                                  <p className="font-semibold">Season {data.season}, Week {data.week}</p>
                                  <p className="text-sm">Placement: {data.ipr}</p>
                                </div>
                              )
                            }
                            return null
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="ipr"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          activeDot={{ r: 6 }}
                        />
                      </RechartsLineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  Loading IPR history...
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        /* Not logged in view */
        <Card>
          <CardHeader>
            <CardTitle>Welcome to TWC Stats</CardTitle>
            <CardDescription>
              The Wrecking Crew's Monday Night Pinball statistics and planning tool
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Please log in to view personalized statistics and team data.
            </p>
            <div className="flex gap-4">
              <Button asChild>
                <Link href="/login">Login</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/register">Register</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

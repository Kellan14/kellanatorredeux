'use client'

import { useEffect, useState, Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Trophy, Target, TrendingUp, Users, Calendar, BarChart3, Percent, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown, LineChart, Loader2, Check, Send } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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
import { getMachineDisplayName } from '@/lib/machine-mappings'
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush } from 'recharts'

function HomePageContent() {
  const searchParams = useSearchParams()
  const viewPlayerParam = searchParams.get('viewPlayer')

  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [viewingAsPlayer, setViewingAsPlayer] = useState<string | null>(null)
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

  // Opponent top picks section
  const [opponentTopPicks, setOpponentTopPicks] = useState<any[]>([])
  const [topPicksSeasonStart, setTopPicksSeasonStart] = useState<number>(20)
  const [topPicksSeasonEnd, setTopPicksSeasonEnd] = useState<number>(23)
  const [loadingTopPicks, setLoadingTopPicks] = useState(false)
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([20, 21, 22, 23])
  const [topPicksSortColumn, setTopPicksSortColumn] = useState<string>('timesPicked')
  const [topPicksSortDirection, setTopPicksSortDirection] = useState<'asc' | 'desc'>('desc')

  // Your performance sorting
  const [perfSortColumn, setPerfSortColumn] = useState<string>('pctOfVenue')
  const [perfSortDirection, setPerfSortDirection] = useState<'asc' | 'desc'>('desc')

  // Least unique players section
  const [leastUniquePlayers, setLeastUniquePlayers] = useState<any>(null)
  const [loadingLeastUnique, setLoadingLeastUnique] = useState(false)
  const [leastUniqueSeasonStart, setLeastUniqueSeasonStart] = useState<number>(20)
  const [leastUniqueSeasonEnd, setLeastUniqueSeasonEnd] = useState<number>(23)
  const [leastUniqueCollapsed, setLeastUniqueCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('leastUniqueCollapsed')
      return saved === 'true'
    }
    return false
  })

  // Least unique players pagination
  const [luSetIndex, setLuSetIndex] = useState(0)

  // Discord send state for least unique players
  const [luDiscordSending, setLuDiscordSending] = useState(false)
  const [luDiscordSent, setLuDiscordSent] = useState(false)
  const [luDiscordError, setLuDiscordError] = useState('')
  const [luDiscordConfirm, setLuDiscordConfirm] = useState(false)

  // Hot swap players state
  const [excludedPlayers, setExcludedPlayers] = useState<Set<string>>(new Set())
  const [includedPlayers, setIncludedPlayers] = useState<Set<string>>(new Set())
  const [swapDialogOpen, setSwapDialogOpen] = useState(false)
  const [swapDialogPlayer, setSwapDialogPlayer] = useState<string | null>(null)
  const [teamAllPlayers, setTeamAllPlayers] = useState<any[]>([])
  const [loadingTeamPlayers, setLoadingTeamPlayers] = useState(false)
  const [playerSearchQuery, setPlayerSearchQuery] = useState('')
  const [playerSearchResults, setPlayerSearchResults] = useState<string[]>([])
  const [loadingSearch, setLoadingSearch] = useState(false)

  // Collapsed states for all sections
  const [statsCollapsed, setStatsCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('statsCollapsed')
      return saved === 'true'
    }
    return false
  })
  const [topPicksCollapsed, setTopPicksCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('topPicksCollapsed')
      return saved === 'true'
    }
    return false
  })
  const [opponentPlayersCollapsed, setOpponentPlayersCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('opponentPlayersCollapsed')
      return saved === 'true'
    }
    return false
  })
  const [performanceCollapsed, setPerformanceCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('performanceCollapsed')
      return saved === 'true'
    }
    return false
  })
  const [achievementsCollapsed, setAchievementsCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('achievementsCollapsed')
      return saved === 'true'
    }
    return false
  })

  // Persist all collapsed states
  useEffect(() => {
    localStorage.setItem('leastUniqueCollapsed', String(leastUniqueCollapsed))
  }, [leastUniqueCollapsed])
  useEffect(() => {
    localStorage.setItem('statsCollapsed', String(statsCollapsed))
  }, [statsCollapsed])
  useEffect(() => {
    localStorage.setItem('topPicksCollapsed', String(topPicksCollapsed))
  }, [topPicksCollapsed])
  useEffect(() => {
    localStorage.setItem('opponentPlayersCollapsed', String(opponentPlayersCollapsed))
  }, [opponentPlayersCollapsed])
  useEffect(() => {
    localStorage.setItem('performanceCollapsed', String(performanceCollapsed))
  }, [performanceCollapsed])
  useEffect(() => {
    localStorage.setItem('achievementsCollapsed', String(achievementsCollapsed))
  }, [achievementsCollapsed])

  // Reset swaps and fetch available seasons when opponent changes
  useEffect(() => {
    setExcludedPlayers(new Set())
    setIncludedPlayers(new Set())
    if (opponent && opponent !== 'Loading...' && opponent !== 'Schedule unavailable') {
      fetch(`/api/team-seasons?team=${encodeURIComponent(opponent)}`)
        .then(res => res.json())
        .then(data => {
          if (data.seasons && data.seasons.length > 0) {
            setAvailableSeasons(data.seasons)
            // Reset season range to cover all available data
            setLeastUniqueSeasonStart(data.seasons[0])
            setLeastUniqueSeasonEnd(data.seasons[data.seasons.length - 1])
            setTopPicksSeasonStart(data.seasons[0])
            setTopPicksSeasonEnd(data.seasons[data.seasons.length - 1])
          }
        })
        .catch(err => console.error('Error fetching team seasons:', err))
    }
  }, [opponent])

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
  const [playerSeasonStart, setPlayerSeasonStart] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('playerSeasonRange')
      if (saved) return JSON.parse(saved).start
    }
    return 22
  })
  const [playerSeasonEnd, setPlayerSeasonEnd] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('playerSeasonRange')
      if (saved) return JSON.parse(saved).end
    }
    return 23
  })

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
  const [venueMachines, setVenueMachines] = useState<string[]>([])


  // IPR history dialog
  const [iprHistoryDialogOpen, setIprHistoryDialogOpen] = useState(false)
  const [iprHistory, setIprHistory] = useState<any[]>([])
  const [iprBrushRange, setIprBrushRange] = useState<{ startIndex: number; endIndex: number } | null>(null)

  const supabase = createSupabaseClient()

  useEffect(() => {
    // If viewing as another player, load their stats directly
    if (viewPlayerParam) {
      setViewingAsPlayer(viewPlayerParam)
      loadViewPlayerStats(viewPlayerParam)
    } else {
      setViewingAsPlayer(null)
      checkUser()
    }
    fetchNextMatch()
  }, [viewPlayerParam])

  useEffect(() => {
    if (opponent && opponent !== 'Loading...' && opponent !== 'Schedule unavailable' && venueMachines.length > 0) {
      fetchOpponentPlayers()
    }
  }, [opponent, showSubs, venueMachines])

  useEffect(() => {
    if (playerName && venue && venue !== 'Loading...' && venueMachines.length > 0) {
      fetchPlayerPerformance()
    }
  }, [playerName, venue, ownPerformanceVenueSpecific, venueMachines])

  useEffect(() => {
    if (playerName) {
      fetchAchievements()
    }
  }, [playerName])

  // Fetch opponent top picks when opponent, venue, season filters, OR the
  // loaded opponent roster change. Including opponentPlayers in the deps
  // ensures the picks re-fetch once the roster is known so the dashboard's
  // Times Picked matches the stats page (both filter to current roster).
  useEffect(() => {
    if (opponent && opponent !== 'Loading...' && opponent !== 'Schedule unavailable' && venue && venue !== 'Loading...') {
      fetchOpponentTopPicks()
    }
  }, [opponent, venue, topPicksSeasonStart, topPicksSeasonEnd, opponentPlayers])

  const fetchOpponentTopPicks = async () => {
    setLoadingTopPicks(true)
    try {
      // Build season list from range
      const seasons: number[] = []
      for (let s = topPicksSeasonStart; s <= topPicksSeasonEnd; s++) {
        seasons.push(s)
      }

      const params = new URLSearchParams({
        seasons: seasons.join(','),
        venue,
        teamName: 'The Wrecking Crew',
        opponentTeam: opponent,
        teamVenueSpecific: 'true',
      })
      // Restrict opponent stats (incl. Times Picked) to current roster.
      if (opponentPlayers.length > 0) {
        params.set('opponentRoster', opponentPlayers.join(','))
      }

      const response = await fetch(`/api/machine-stats?${params}`)
      if (response.ok) {
        const data = await response.json()
        // Sort by timesPicked descending, take top 10
        const sorted = (data.stats || [])
          .filter((s: any) => s.timesPicked > 0)
          .sort((a: any, b: any) => b.timesPicked - a.timesPicked)
          .slice(0, 10)
        setOpponentTopPicks(sorted)
      }
    } catch (error) {
      console.error('Error fetching opponent top picks:', error)
      setOpponentTopPicks([])
    } finally {
      setLoadingTopPicks(false)
    }
  }

  // Fetch least unique players when opponent, venue, or season filters change
  useEffect(() => {
    if (opponent && opponent !== 'Loading...' && opponent !== 'Schedule unavailable' && venue && venue !== 'Loading...' && venueMachines.length > 0) {
      fetchLeastUniquePlayers()
    }
  }, [opponent, venue, leastUniqueSeasonStart, leastUniqueSeasonEnd, venueMachines, excludedPlayers, includedPlayers])

  const fetchLeastUniquePlayers = async () => {
    setLoadingLeastUnique(true)
    try {
      let url = `/api/least-unique-players?` +
        `venue=${encodeURIComponent(venue)}` +
        `&opponent=${encodeURIComponent(opponent)}` +
        `&seasonStart=${leastUniqueSeasonStart}` +
        `&seasonEnd=${leastUniqueSeasonEnd}` +
        `&machines=${encodeURIComponent(venueMachines.join(','))}`

      if (excludedPlayers.size > 0) {
        url += `&excludedPlayers=${encodeURIComponent(Array.from(excludedPlayers).join(','))}`
      }
      if (includedPlayers.size > 0) {
        url += `&includedPlayers=${encodeURIComponent(Array.from(includedPlayers).join(','))}`
      }

      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setLeastUniquePlayers(data)
        setLuSetIndex(0)
      }
    } catch (error) {
      console.error('Error fetching least unique players:', error)
      setLeastUniquePlayers(null)
    } finally {
      setLoadingLeastUnique(false)
    }
  }

  const sendLeastUniqueToDiscord = async () => {
    if (!leastUniquePlayers || !leastUniquePlayers.sets) return
    const currentSet = leastUniquePlayers.sets[luSetIndex] || leastUniquePlayers.sets[0]
    if (!currentSet || !currentSet.machines) return
    setLuDiscordSending(true)
    setLuDiscordError('')
    setLuDiscordSent(false)
    try {
      const lines: string[] = []
      lines.push(`LEAST UNIQUE PLAYERS — ${opponent} @ ${venue}`)
      lines.push(`Seasons ${leastUniqueSeasonStart}–${leastUniqueSeasonEnd}${leastUniquePlayers.sets.length > 1 ? ` (option ${luSetIndex + 1} of ${leastUniquePlayers.sets.length})` : ''}`)
      lines.push(`${currentSet.totalUniquePlayers} unique player${currentSet.totalUniquePlayers !== 1 ? 's' : ''} across 4 machines`)
      lines.push('')
      for (const m of currentSet.machines) {
        const displayName = getMachineDisplayName(m.machine)
        lines.push(`${displayName} — ${m.playerCount} player${m.playerCount !== 1 ? 's' : ''}${m.players.length > 0 ? ': ' + m.players.join(', ') : ''}`)
      }
      if (currentSet.allPlayers && currentSet.allPlayers.length > 0) {
        lines.push('')
        lines.push(`All players: ${currentSet.allPlayers.join(', ')}`)
      }
      const reportText = lines.join('\n')
      const res = await fetch('/api/discord-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportText }),
      })
      const data = await res.json()
      if (!res.ok) {
        setLuDiscordError(data.error || 'Failed to send')
      } else {
        setLuDiscordSent(true)
        setTimeout(() => setLuDiscordSent(false), 3000)
      }
    } catch {
      setLuDiscordError('Failed to send to Discord')
    } finally {
      setLuDiscordSending(false)
      setLuDiscordConfirm(false)
    }
  }

  const openSwapDialog = async (playerName: string) => {
    setSwapDialogPlayer(playerName)
    setSwapDialogOpen(true)
    setPlayerSearchQuery('')
    setPlayerSearchResults([])

    // Fetch all players who have played for this team
    setLoadingTeamPlayers(true)
    try {
      const response = await fetch(`/api/team-all-players?team=${encodeURIComponent(opponent)}`)
      if (response.ok) {
        const data = await response.json()
        setTeamAllPlayers(data.players || [])
      }
    } catch (error) {
      console.error('Error fetching team players:', error)
    } finally {
      setLoadingTeamPlayers(false)
    }
  }

  const handleSwapPlayer = (newPlayer: string) => {
    if (!swapDialogPlayer) return

    // If swapping out a roster player, add to excluded
    if (leastUniquePlayers?.rosterPlayers?.includes(swapDialogPlayer)) {
      setExcludedPlayers(prev => new Set([...Array.from(prev), swapDialogPlayer]))
    }
    // If swapping out an included player, remove from included
    if (includedPlayers.has(swapDialogPlayer)) {
      setIncludedPlayers(prev => {
        const next = new Set(prev)
        next.delete(swapDialogPlayer)
        return next
      })
    }

    // Add new player to included (unless they're already a roster player)
    if (!leastUniquePlayers?.rosterPlayers?.includes(newPlayer) || excludedPlayers.has(newPlayer)) {
      setIncludedPlayers(prev => new Set([...Array.from(prev), newPlayer]))
    }
    // If new player was excluded, un-exclude them
    if (excludedPlayers.has(newPlayer)) {
      setExcludedPlayers(prev => {
        const next = new Set(prev)
        next.delete(newPlayer)
        return next
      })
    }

    setSwapDialogOpen(false)
  }

  const resetPlayerSwaps = () => {
    setExcludedPlayers(new Set())
    setIncludedPlayers(new Set())
  }

  // Search players in database
  useEffect(() => {
    if (playerSearchQuery.length < 2) {
      setPlayerSearchResults([])
      return
    }

    const searchPlayers = async () => {
      setLoadingSearch(true)
      try {
        const response = await fetch(`/api/search-players?q=${encodeURIComponent(playerSearchQuery)}`)
        if (response.ok) {
          const data = await response.json()
          setPlayerSearchResults(data.players || [])
        }
      } catch (error) {
        console.error('Error searching players:', error)
      } finally {
        setLoadingSearch(false)
      }
    }

    const debounce = setTimeout(searchPlayers, 300)
    return () => clearTimeout(debounce)
  }, [playerSearchQuery])

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

      const pName = profile.player_name

      // Save player name for performance profile
      setPlayerName(pName)

      // Fetch comprehensive stats from most recent matches
      const statsResponse = await fetch(`/api/player-ipr?name=${encodeURIComponent(pName)}`)

      if (statsResponse.ok) {
        const statsData = await statsResponse.json()

        setPlayerStats({
          ipr: statsData.ipr || 0,
          matchesPlayed: statsData.matchesPlayed || 0,
          pointsWon: statsData.pointsWon || 0,
          pointsPerMatch: statsData.pointsPerMatch || 0,
          pops: statsData.pops || 0,
          currentSeason: statsData.currentSeason || 23
        })
      } else {
        console.log(`Player "${pName}" not found in recent matches`)
      }
    } catch (error) {
      console.error('Error loading player stats:', error)
    }
  }

  // Load stats for a player when viewing as them (from player profile)
  const loadViewPlayerStats = async (viewPlayer: string) => {
    try {
      setLoading(true)
      setPlayerName(viewPlayer)

      // Fetch stats for the view player
      const statsResponse = await fetch(`/api/player-ipr?name=${encodeURIComponent(viewPlayer)}`)

      if (statsResponse.ok) {
        const statsData = await statsResponse.json()

        setPlayerStats({
          ipr: statsData.ipr || 0,
          matchesPlayed: statsData.matchesPlayed || 0,
          pointsWon: statsData.pointsWon || 0,
          pointsPerMatch: statsData.pointsPerMatch || 0,
          pops: statsData.pops || 0,
          currentSeason: statsData.currentSeason || 23
        })
      } else {
        console.log(`Player "${viewPlayer}" not found in recent matches`)
      }
    } catch (error) {
      console.error('Error loading view player stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchNextMatch = async () => {
    try {
      // Fetch match info and venue machine list in parallel
      const [matchResponse, venuesResponse] = await Promise.all([
        fetch('/api/latest-twc-match'),
        fetch('/api/venues')
      ])
      const [data, venuesData] = await Promise.all([
        matchResponse.json(),
        venuesResponse.json()
      ])

      if (data.opponent && data.venue) {
        setOpponent(data.opponent)
        setVenue(data.venue)
        setMatchState(data.state)

        // Set venue machines immediately
        const venueEntry = (venuesData.venues || []).find((v: any) => v.name === data.venue)
        setVenueMachines(venueEntry?.machines || [])

        // Set label based on match state
        if (data.state === 'complete') {
          setMatchLabel('Last Match')
        } else if (data.state === 'playing') {
          setMatchLabel('Match In Progress')
        } else {
          setMatchLabel('Next Match')
        }

        // Format date/week info
        if (data.week) {
          const seasonLabel = data.season ? `Season ${data.season} • ` : ''
          setMatchDate(`${seasonLabel}Week ${data.week}`)
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
      const currentSeason = playerStats.currentSeason || 23
      const historicalSeason = currentSeason - 1

      // Fetch roster independently so it doesn't depend on machine-advantages
      const playersResponse = await fetch(`/api/team-roster?team=${encodeURIComponent(opponent)}&season=${currentSeason}&showSubs=${showSubs}`)
      if (playersResponse.ok) {
        const playersData = await playersResponse.json()
        const playerNames = (playersData.players || []).map((p: any) => p.name)
        setOpponentPlayers(playerNames)
      }

      // Fetch machine advantages (uses venueMachines from state)
      const response = await fetch(
        `/api/machine-advantages?` +
        `venue=${encodeURIComponent(venue)}` +
        `&opponent=${encodeURIComponent(opponent)}` +
        `&seasonStart=20` +
        `&seasonEnd=${historicalSeason}` +
        `&teamVenueSpecific=true` +
        `&twcVenueSpecific=false` +
        `&machines=${encodeURIComponent(venueMachines.join(','))}`
      )

      if (response.ok) {
        const data = await response.json()
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
      // Use previous season for historical data (current season likely has no games yet)
      const historicalSeason = (playerStats.currentSeason || 23) - 1
      const url = `/api/player-analysis?` +
        `player=${encodeURIComponent(playerName)}` +
        `&venue=${encodeURIComponent(venue)}` +
        `&seasonStart=20` +
        `&seasonEnd=${historicalSeason}` +
        `&allVenues=${!ownPerformanceVenueSpecific}` +
        `&machines=${encodeURIComponent(venueMachines.join(','))}`

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
        `&seasonStart=${playerSeasonStart}` +
        `&seasonEnd=${playerSeasonEnd}`
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
        `&seasonStart=${playerSeasonStart}` +
        `&seasonEnd=${playerSeasonEnd}` +
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
    setIprBrushRange(null)

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

  // Sort handler for Their Top Picks
  const handleTopPicksSort = (column: string) => {
    if (topPicksSortColumn === column) {
      setTopPicksSortDirection(topPicksSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setTopPicksSortColumn(column)
      setTopPicksSortDirection(column === 'machine' ? 'asc' : 'desc')
    }
  }

  const getSortedTopPicks = () => {
    return [...opponentTopPicks].sort((a, b) => {
      let aVal = a[topPicksSortColumn]
      let bVal = b[topPicksSortColumn]

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = bVal?.toLowerCase() || ''
        return topPicksSortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      aVal = aVal || 0
      bVal = bVal || 0
      return topPicksSortDirection === 'asc' ? aVal - bVal : bVal - aVal
    })
  }

  // Sort handler for Your Performance
  const handlePerfSort = (column: string) => {
    if (perfSortColumn === column) {
      setPerfSortDirection(perfSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setPerfSortColumn(column)
      setPerfSortDirection(column === 'machine' ? 'asc' : 'desc')
    }
  }

  const getSortedPerformance = () => {
    if (!playerPerformance?.machinePerformance) return []
    return [...playerPerformance.machinePerformance].sort((a: any, b: any) => {
      let aVal = a[perfSortColumn]
      let bVal = b[perfSortColumn]

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = bVal?.toLowerCase() || ''
        return perfSortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      aVal = aVal || 0
      bVal = bVal || 0
      return perfSortDirection === 'asc' ? aVal - bVal : bVal - aVal
    })
  }

  // Sort icon component
  const SortIcon = ({ column, currentColumn, direction }: { column: string, currentColumn: string, direction: 'asc' | 'desc' }) => {
    if (column !== currentColumn) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />
    return direction === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />
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

      {/* Viewing as another player banner */}
      {viewingAsPlayer && (
        <div className="mb-6 p-4 bg-neon-blue/10 border border-neon-blue/30 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-muted-foreground">Viewing dashboard as: </span>
              <span className="font-semibold text-neon-blue">{viewingAsPlayer}</span>
            </div>
            <Link href="/" className="text-sm text-neon-blue hover:underline">
              Return to your dashboard
            </Link>
          </div>
        </div>
      )}

      {(user || viewingAsPlayer) ? (
        <>
          {/* Personal Stats Grid - Only shown when logged in */}
          <Card className="mb-8">
            <CardHeader className="pb-2">
              <button
                className="flex items-center gap-2 w-full text-left"
                onClick={() => setStatsCollapsed(!statsCollapsed)}
              >
                {statsCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                <CardTitle className="text-base">
                  {viewingAsPlayer ? `${viewingAsPlayer}'s Season Stats` : 'Your Season Stats'}
                </CardTitle>
              </button>
            </CardHeader>
            {!statsCollapsed && (
              <CardContent>
                <div className="grid grid-cols-2 gap-2 md:gap-4 md:grid-cols-2 lg:grid-cols-5">
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
              </CardContent>
            )}
          </Card>

          {/* Their Top Picks Section */}
          {opponent && opponent !== 'Loading...' && opponent !== 'Schedule unavailable' && venue && (
            <Card className="mb-8">
              <CardHeader className="pb-2">
                <button
                  className="flex items-center gap-2 w-full text-left"
                  onClick={() => setTopPicksCollapsed(!topPicksCollapsed)}
                >
                  {topPicksCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  <div className="flex-1">
                    <CardTitle className="text-base">Their Top Picks</CardTitle>
                    <CardDescription className="text-xs">
                      {opponent}'s most picked machines at {venue}
                    </CardDescription>
                  </div>
                </button>
              </CardHeader>
              {!topPicksCollapsed && (
              <CardContent>
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">Seasons:</label>
                  <select
                    value={topPicksSeasonStart}
                    onChange={(e) => setTopPicksSeasonStart(parseInt(e.target.value))}
                    className="w-16 px-2 py-1 text-sm border rounded bg-background"
                  >
                    {availableSeasons.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">to</span>
                  <select
                    value={topPicksSeasonEnd}
                    onChange={(e) => setTopPicksSeasonEnd(parseInt(e.target.value))}
                    className="w-16 px-2 py-1 text-sm border rounded bg-background"
                  >
                    {availableSeasons.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                {loadingTopPicks ? (
                  <div className="text-center py-4 text-muted-foreground">Loading top picks...</div>
                ) : opponentTopPicks.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handleTopPicksSort('machine')}
                          >
                            <div className="flex items-center">
                              Machine
                              <SortIcon column="machine" currentColumn={topPicksSortColumn} direction={topPicksSortDirection} />
                            </div>
                          </TableHead>
                          <TableHead
                            className="text-right cursor-pointer hover:bg-muted/50"
                            onClick={() => handleTopPicksSort('timesPicked')}
                          >
                            <div className="flex items-center justify-end">
                              Times Picked
                              <SortIcon column="timesPicked" currentColumn={topPicksSortColumn} direction={topPicksSortDirection} />
                            </div>
                          </TableHead>
                          <TableHead
                            className="text-right cursor-pointer hover:bg-muted/50"
                            onClick={() => handleTopPicksSort('teamAverage')}
                          >
                            <div className="flex items-center justify-end">
                              Avg Score
                              <SortIcon column="teamAverage" currentColumn={topPicksSortColumn} direction={topPicksSortDirection} />
                            </div>
                          </TableHead>
                          <TableHead
                            className="text-right cursor-pointer hover:bg-muted/50"
                            onClick={() => handleTopPicksSort('percentOfVenueAvg')}
                          >
                            <div className="flex items-center justify-end">
                              % of Venue Avg
                              <SortIcon column="percentOfVenueAvg" currentColumn={topPicksSortColumn} direction={topPicksSortDirection} />
                            </div>
                          </TableHead>
                          <TableHead
                            className="text-right cursor-pointer hover:bg-muted/50"
                            onClick={() => handleTopPicksSort('pops')}
                          >
                            <div className="flex items-center justify-end">
                              POPS
                              <SortIcon column="pops" currentColumn={topPicksSortColumn} direction={topPicksSortDirection} />
                            </div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {getSortedTopPicks().map((pick: any) => (
                          <TableRow key={pick.machine}>
                            <TableCell className="font-medium">{getMachineDisplayName(pick.machine)}</TableCell>
                            <TableCell className="text-right">{pick.timesPicked}</TableCell>
                            <TableCell className="text-right">{(pick.teamAverage || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                            <TableCell className="text-right">
                              <span className={
                                pick.percentOfVenueAvg >= 100 ? 'text-green-600 font-semibold' :
                                pick.percentOfVenueAvg >= 90 ? 'text-yellow-600' :
                                'text-muted-foreground'
                              }>
                                {(pick.percentOfVenueAvg || 0).toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={
                                pick.pops >= 50 ? 'text-green-600 font-semibold' :
                                pick.pops >= 40 ? 'text-yellow-600' :
                                'text-muted-foreground'
                              }>
                                {(pick.pops || 0).toFixed(1)}%
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    No pick data available for {opponent} at {venue}
                  </div>
                )}
              </CardContent>
              )}
            </Card>
          )}

          {/* Least Unique Players Section */}
          {opponent && opponent !== 'Loading...' && opponent !== 'Schedule unavailable' && venue && (
            <Card className="mb-8">
              <CardHeader className="pb-2">
                <button
                  className="flex items-center gap-2 w-full text-left"
                  onClick={() => setLeastUniqueCollapsed(!leastUniqueCollapsed)}
                >
                  {leastUniqueCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  <div className="flex-1">
                    <CardTitle className="text-base">Least Unique Players</CardTitle>
                    <CardDescription className="text-xs">
                      4 machines with fewest {opponent} players who have played them
                    </CardDescription>
                  </div>
                </button>
              </CardHeader>
              {!leastUniqueCollapsed && (
                <CardContent>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground whitespace-nowrap">Seasons:</label>
                      <select
                        value={leastUniqueSeasonStart}
                        onChange={(e) => setLeastUniqueSeasonStart(parseInt(e.target.value))}
                        className="w-16 px-2 py-1 text-sm border rounded bg-background"
                      >
                        {availableSeasons.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <span className="text-xs text-muted-foreground">to</span>
                      <select
                        value={leastUniqueSeasonEnd}
                        onChange={(e) => setLeastUniqueSeasonEnd(parseInt(e.target.value))}
                        className="w-16 px-2 py-1 text-sm border rounded bg-background"
                      >
                        {availableSeasons.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    {(excludedPlayers.size > 0 || includedPlayers.size > 0) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={resetPlayerSwaps}
                        className="text-xs"
                      >
                        Reset to Roster
                      </Button>
                    )}
                  </div>

                  {loadingLeastUnique ? (
                    <div className="text-center py-4 text-muted-foreground">Loading...</div>
                  ) : leastUniquePlayers && leastUniquePlayers.sets && leastUniquePlayers.sets.length > 0 ? (
                    <div className="space-y-3">
                      {(() => {
                        const currentSet = leastUniquePlayers.sets[luSetIndex] || leastUniquePlayers.sets[0];
                        const totalSets = leastUniquePlayers.sets.length;
                        return (<>
                          <div className="text-sm font-medium text-center p-2 bg-muted/50 rounded">
                            {currentSet.totalUniquePlayers} unique player{currentSet.totalUniquePlayers !== 1 ? 's' : ''} across these 4 machines
                            {totalSets > 1 && (
                              <span className="text-muted-foreground ml-1">({luSetIndex + 1} of {totalSets})</span>
                            )}
                            {(excludedPlayers.size > 0 || includedPlayers.size > 0) && (
                              <span className="text-yellow-600 ml-1">(modified roster)</span>
                            )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {currentSet.machines.map((m: any, index: number) => (
                              <div key={m.machine} className="border rounded-lg p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="font-medium">{getMachineDisplayName(m.machine)}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {m.playerCount} player{m.playerCount !== 1 ? 's' : ''}
                                    {index > 0 && m.addedPlayers > 0 && (
                                      <span className="text-yellow-600 ml-1">(+{m.addedPlayers} new)</span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-xs text-muted-foreground flex flex-wrap gap-1">
                                  {m.players.length > 0 ? m.players.map((p: string) => (
                                    <button
                                      key={p}
                                      onClick={() => openSwapDialog(p)}
                                      className="hover:text-primary hover:underline cursor-pointer"
                                    >
                                      {p}
                                    </button>
                                  )) : 'No players have played this'}
                                </div>
                              </div>
                            ))}
                          </div>
                          {totalSets > 1 && (
                            <div className="flex items-center justify-center gap-2">
                              {luSetIndex > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setLuSetIndex(luSetIndex - 1)}
                                  className="text-xs"
                                >
                                  <ChevronLeft className="h-3 w-3 mr-1" />Back
                                </Button>
                              )}
                              {luSetIndex < totalSets - 1 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setLuSetIndex(luSetIndex + 1)}
                                  className="text-xs"
                                >
                                  Next<ChevronRight className="h-3 w-3 ml-1" />
                                </Button>
                              )}
                            </div>
                          )}
                          {currentSet.allPlayers && currentSet.allPlayers.length > 0 && (
                            <div className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                              <span className="font-medium">All players (click to swap):</span>{' '}
                              {currentSet.allPlayers.map((p: string, i: number) => (
                                <span key={p}>
                                  {i > 0 && ', '}
                                  <button
                                    onClick={() => openSwapDialog(p)}
                                    className="hover:text-primary hover:underline cursor-pointer"
                                  >
                                    {p}
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </>);
                      })()}
                      <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t">
                        {luDiscordConfirm ? (
                          <>
                            <span className="text-xs text-muted-foreground">Send to Discord?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={sendLeastUniqueToDiscord}
                              disabled={luDiscordSending}
                              className="text-xs"
                            >
                              {luDiscordSending ? (
                                <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Sending...</>
                              ) : 'Yes, Send'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setLuDiscordConfirm(false)}
                              disabled={luDiscordSending}
                              className="text-xs"
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setLuDiscordConfirm(true); setLuDiscordError('') }}
                            className="text-xs"
                          >
                            {luDiscordSent ? (
                              <><Check className="h-3 w-3 mr-1" />Sent!</>
                            ) : (
                              <><Send className="h-3 w-3 mr-1" />Send to Discord</>
                            )}
                          </Button>
                        )}
                      </div>
                      {luDiscordError && (
                        <p className="text-xs text-destructive mt-1 text-right">{luDiscordError}</p>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-muted-foreground">
                      No data available
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {/* Opponent Players Section */}
          <Card className="mb-8">
            <CardHeader className="pb-2">
              <button
                className="flex items-center gap-2 w-full text-left"
                onClick={() => setOpponentPlayersCollapsed(!opponentPlayersCollapsed)}
              >
                {opponentPlayersCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                <div className="flex-1">
                  <CardTitle className="text-base">{opponent} Players</CardTitle>
                  <CardDescription className="text-xs">
                    Click a player to view their machine stats
                  </CardDescription>
                </div>
              </button>
            </CardHeader>
            {!opponentPlayersCollapsed && (
            <CardContent>
              <div className="flex items-center space-x-2 mb-3">
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
            )}
          </Card>

          {/* Player Performance Profile */}
          {playerName && venue && (
            <Card className="mb-8">
              <CardHeader className="pb-2">
                <button
                  className="flex items-center gap-2 w-full text-left"
                  onClick={() => setPerformanceCollapsed(!performanceCollapsed)}
                >
                  {performanceCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  <div className="flex-1">
                    <CardTitle className="text-base">
                      {viewingAsPlayer ? `${viewingAsPlayer}'s Performance` : 'Your Performance'} {ownPerformanceVenueSpecific ? `at ${venue}` : '(All Venues)'}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {viewingAsPlayer ? `${viewingAsPlayer}'s` : 'Your'} machine performance profile for the upcoming venue
                    </CardDescription>
                  </div>
                </button>
              </CardHeader>
              {!performanceCollapsed && (
              <CardContent>
                {playerPerformance && playerPerformance.machinePerformance && playerPerformance.machinePerformance.length > 0 ? (
                <>
                  <div className="flex items-center space-x-2 mb-3">
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
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handlePerfSort('machine')}
                          >
                            <div className="flex items-center">
                              Machine
                              <SortIcon column="machine" currentColumn={perfSortColumn} direction={perfSortDirection} />
                            </div>
                          </TableHead>
                          <TableHead
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handlePerfSort('avgScore')}
                          >
                            <div className="flex items-center">
                              Avg Score
                              <SortIcon column="avgScore" currentColumn={perfSortColumn} direction={perfSortDirection} />
                            </div>
                          </TableHead>
                          <TableHead
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handlePerfSort('pctOfVenue')}
                          >
                            <div className="flex items-center">
                              % of Venue Avg
                              <SortIcon column="pctOfVenue" currentColumn={perfSortColumn} direction={perfSortDirection} />
                            </div>
                          </TableHead>
                          <TableHead
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handlePerfSort('timesPlayed')}
                          >
                            <div className="flex items-center">
                              Times Played
                              <SortIcon column="timesPlayed" currentColumn={perfSortColumn} direction={perfSortDirection} />
                            </div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {getSortedPerformance().map((machine: any) => (
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
                </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {!playerPerformance ? 'No performance data loaded yet...' :
                     !playerPerformance.machinePerformance ? 'No machine performance data...' :
                     playerPerformance.machinePerformance.length === 0 ? 'No machines played at this venue yet' :
                     'Unknown state'}
                  </div>
                )}
              </CardContent>
              )}
            </Card>
          )}

          {/* Top 10 Achievements Section */}
          {achievements.length > 0 && (
            <Card className="mb-8">
              <CardHeader className="pb-2">
                <button
                  className="flex items-center gap-2 w-full text-left"
                  onClick={() => setAchievementsCollapsed(!achievementsCollapsed)}
                >
                  {achievementsCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  <div className="flex-1">
                    <CardTitle className="text-base">
                      {viewingAsPlayer ? `${viewingAsPlayer}'s Top 10 Rankings` : 'Your Top 10 Rankings'}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {viewingAsPlayer ? `${viewingAsPlayer}'s` : 'Your'} top 10 scores across all machines (league-wide and venue-specific)
                    </CardDescription>
                  </div>
                </button>
              </CardHeader>
              {!achievementsCollapsed && (
              <CardContent>
                <div className="space-y-3">
                  {achievements.map((achievement, index) => (
                    <div
                      key={index}
                      className="relative overflow-hidden border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => handleAchievementClick(achievement)}
                    >
                      {/* Background image on right side */}
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
                    </div>
                  ))}
                </div>
              </CardContent>
              )}
            </Card>
          )}

          {/* Machine Selection Dialog */}
          <Dialog open={playerDialogOpen} onOpenChange={setPlayerDialogOpen}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
              <DialogHeader>
                <DialogTitle>
                  {selectedPlayer} - Select Machine
                </DialogTitle>
                <DialogDescription>
                  Choose a machine to view {selectedPlayer}'s stats
                </DialogDescription>
              </DialogHeader>

              {/* Season Range */}
              <div className="flex items-center gap-2 mb-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Seasons:</label>
                <input
                  type="number"
                  min={2}
                  max={playerSeasonEnd}
                  value={playerSeasonStart}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 2
                    setPlayerSeasonStart(val)
                    localStorage.setItem('playerSeasonRange', JSON.stringify({ start: val, end: playerSeasonEnd }))
                  }}
                  className="w-16 px-2 py-1 text-sm border rounded bg-background"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="number"
                  min={playerSeasonStart}
                  max={99}
                  value={playerSeasonEnd}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 23
                    setPlayerSeasonEnd(val)
                    localStorage.setItem('playerSeasonRange', JSON.stringify({ start: playerSeasonStart, end: val }))
                  }}
                  className="w-16 px-2 py-1 text-sm border rounded bg-background"
                />
                <button
                  className="px-2 py-1 text-xs rounded border bg-muted hover:bg-accent transition-colors"
                  onClick={() => {
                    if (!selectedPlayer) return
                    fetch(
                      `/api/player-machine-counts?` +
                      `player=${encodeURIComponent(selectedPlayer)}` +
                      `&venue=${encodeURIComponent(venue)}` +
                      `&seasonStart=${playerSeasonStart}` +
                      `&seasonEnd=${playerSeasonEnd}`
                    ).then(r => r.json()).then(data => {
                      setMachineCounts(data.counts || {})
                    }).catch(console.error)
                  }}
                >
                  Apply
                </button>
              </div>

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
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto p-3 md:p-6">
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
                <div className="grid grid-cols-3 gap-2 md:gap-4 mb-4 md:mb-6 p-2 md:p-4 bg-muted/50 rounded-lg">
                  {(() => {
                    const stats = calculateStats()
                    return (
                      <>
                        <div>
                          <div className="text-[10px] md:text-xs text-muted-foreground">Mean</div>
                          <div className="text-sm md:text-lg font-semibold">{(stats.mean || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        </div>
                        <div>
                          <div className="text-[10px] md:text-xs text-muted-foreground">Median</div>
                          <div className="text-sm md:text-lg font-semibold">{(stats.median || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        </div>
                        <div>
                          <div className="text-[10px] md:text-xs text-muted-foreground">IQR</div>
                          <div className="text-sm md:text-lg font-semibold">{(stats.iqr || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}

              {/* Scores Table */}
              {playerMachineStats.length > 0 ? (
                <div className="w-full overflow-hidden">
                  <table className="w-full text-[11px] md:text-sm" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b">
                        <th
                          className="text-left px-1 py-1 md:p-2 cursor-pointer hover:bg-muted/50 select-none overflow-hidden"
                          style={{ width: '30%' }}
                          onClick={() => handleSort('score')}
                        >
                          <div className="flex items-center gap-0.5">
                            Score
                            {sortColumn === 'score' ? (sortDirection === 'asc' ? <ArrowUp className="h-2.5 w-2.5 flex-shrink-0" /> : <ArrowDown className="h-2.5 w-2.5 flex-shrink-0" />) : <ArrowUpDown className="h-2.5 w-2.5 opacity-30 flex-shrink-0" />}
                          </div>
                        </th>
                        <th
                          className="text-left px-1 py-1 md:p-2 cursor-pointer hover:bg-muted/50 select-none overflow-hidden"
                          style={{ width: '8%' }}
                          onClick={() => handleSort('points')}
                        >
                          <div className="flex items-center gap-0.5">
                            Pts
                            {sortColumn === 'points' ? (sortDirection === 'asc' ? <ArrowUp className="h-2.5 w-2.5 flex-shrink-0" /> : <ArrowDown className="h-2.5 w-2.5 flex-shrink-0" />) : <ArrowUpDown className="h-2.5 w-2.5 opacity-30 flex-shrink-0" />}
                          </div>
                        </th>
                        <th
                          className="text-left px-1 py-1 md:p-2 cursor-pointer hover:bg-muted/50 select-none overflow-hidden"
                          style={{ width: '28%' }}
                          onClick={() => handleSort('match')}
                        >
                          <div className="flex items-center gap-0.5">
                            Opp
                            {sortColumn === 'match' ? (sortDirection === 'asc' ? <ArrowUp className="h-2.5 w-2.5 flex-shrink-0" /> : <ArrowDown className="h-2.5 w-2.5 flex-shrink-0" />) : <ArrowUpDown className="h-2.5 w-2.5 opacity-30 flex-shrink-0" />}
                          </div>
                        </th>
                        <th
                          className="text-left px-1 py-1 md:p-2 cursor-pointer hover:bg-muted/50 select-none overflow-hidden"
                          style={{ width: '8%' }}
                          onClick={() => handleSort('round')}
                        >
                          <div className="flex items-center gap-0.5">
                            Rd
                            {sortColumn === 'round' ? (sortDirection === 'asc' ? <ArrowUp className="h-2.5 w-2.5 flex-shrink-0" /> : <ArrowDown className="h-2.5 w-2.5 flex-shrink-0" />) : <ArrowUpDown className="h-2.5 w-2.5 opacity-30 flex-shrink-0" />}
                          </div>
                        </th>
                        <th
                          className="text-left px-1 py-1 md:p-2 cursor-pointer hover:bg-muted/50 select-none overflow-hidden"
                          style={{ width: '8%' }}
                          onClick={() => handleSort('season')}
                        >
                          <div className="flex items-center gap-0.5">
                            S
                            {sortColumn === 'season' ? (sortDirection === 'asc' ? <ArrowUp className="h-2.5 w-2.5 flex-shrink-0" /> : <ArrowDown className="h-2.5 w-2.5 flex-shrink-0" />) : <ArrowUpDown className="h-2.5 w-2.5 opacity-30 flex-shrink-0" />}
                          </div>
                        </th>
                        <th
                          className="text-left px-1 py-1 md:p-2 cursor-pointer hover:bg-muted/50 select-none overflow-hidden"
                          style={{ width: '18%' }}
                          onClick={() => handleSort('venue')}
                        >
                          <div className="flex items-center gap-0.5">
                            Venue
                            {sortColumn === 'venue' ? (sortDirection === 'asc' ? <ArrowUp className="h-2.5 w-2.5 flex-shrink-0" /> : <ArrowDown className="h-2.5 w-2.5 flex-shrink-0" />) : <ArrowUpDown className="h-2.5 w-2.5 opacity-30 flex-shrink-0" />}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {getSortedStats().map((stat, index) => (
                        <tr key={index} className="border-b hover:bg-muted/50">
                          <td className="px-1 py-1 md:p-2 font-medium tabular-nums overflow-hidden text-ellipsis whitespace-nowrap">{(stat.score || 0).toLocaleString()}</td>
                          <td className="px-1 py-1 md:p-2 tabular-nums">{stat.points !== undefined ? stat.points : '-'}</td>
                          <td className="px-1 py-1 md:p-2 overflow-hidden text-ellipsis whitespace-nowrap">{stat.match}</td>
                          <td className="px-1 py-1 md:p-2">{stat.round}</td>
                          <td className="px-1 py-1 md:p-2">{stat.season}</td>
                          <td className="px-1 py-1 md:p-2 overflow-hidden text-ellipsis whitespace-nowrap">{stat.venue}</td>
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
                  // Check if this score belongs to the current player
                  // Match both exact name and "(sub)" variants (e.g., "Kellan Kirkland" and "Kellan Kirkland (sub)")
                  const isExactMatch = entry.player === playerName
                  const isSubMatch = entry.player === `${playerName} (sub)` ||
                    (entry.player.startsWith(playerName) && entry.player.toLowerCase().includes('(sub)'))
                  const isCurrentPlayer = isExactMatch || isSubMatch
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
                              <span className="ml-2 text-xs text-neon-blue">
                                {isSubMatch ? '(You - sub)' : '(You)'}
                              </span>
                            )}
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
                (() => {
                  const defaultStart = Math.max(0, iprHistory.length - 30)
                  const defaultEnd = iprHistory.length - 1
                  const startIdx = iprBrushRange?.startIndex ?? defaultStart
                  const endIdx = iprBrushRange?.endIndex ?? defaultEnd
                  const visibleData = iprHistory.slice(startIdx, endIdx + 1)
                  const visibleIPRs = visibleData.map((d: any) => d.ipr)
                  const minIPR = Math.max(1, Math.floor(Math.min(...visibleIPRs)) - 1)
                  const maxIPR = Math.min(10, Math.ceil(Math.max(...visibleIPRs)) + 1)
                  const visibleAvg = visibleData.length > 0
                    ? (visibleData.reduce((sum: number, h: any) => sum + h.ipr, 0) / visibleData.length).toFixed(1)
                    : '0'

                  // Build unique seasons list for quick-select buttons
                  const seasonIndices = new Map<number, { start: number; end: number }>()
                  iprHistory.forEach((h: any, i: number) => {
                    const existing = seasonIndices.get(h.season)
                    if (!existing) {
                      seasonIndices.set(h.season, { start: i, end: i })
                    } else {
                      existing.end = i
                    }
                  })
                  const seasons = Array.from(seasonIndices.keys()).sort((a, b) => a - b)

                  // Determine which seasons are visible for the label
                  const visibleSeasons = Array.from(new Set(visibleData.map((d: any) => d.season))).sort((a: number, b: number) => a - b)
                  const rangeLabel = visibleSeasons.length === 1
                    ? `S${visibleSeasons[0]}`
                    : `S${visibleSeasons[0]}-S${visibleSeasons[visibleSeasons.length - 1]}`

                  // Calculate tick interval to prevent overlap
                  const visibleCount = endIdx - startIdx + 1
                  const tickInterval = visibleCount <= 15 ? 0 : Math.floor(visibleCount / 12)

                  return (
                    <>
                      {/* Summary Stats */}
                      <div className="grid grid-cols-3 gap-4 mb-4 p-4 bg-muted/50 rounded-lg">
                        <div>
                          <div className="text-xs text-muted-foreground">Recent Placement</div>
                          <div className="text-lg font-semibold">{visibleData[visibleData.length - 1]?.ipr || 0}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Avg Placement</div>
                          <div className="text-lg font-semibold">{visibleAvg}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Matches</div>
                          <div className="text-lg font-semibold">{visibleData.length} <span className="text-xs text-muted-foreground font-normal">/ {iprHistory.length}</span></div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground text-center mb-2">Showing {rangeLabel} ({visibleData.length} matches)</div>

                      {/* Season Quick-Select */}
                      <div className="flex flex-wrap gap-1 mb-4 justify-center">
                        <button
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            startIdx === 0 && endIdx === iprHistory.length - 1
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-muted border-border hover:bg-accent'
                          }`}
                          onClick={() => setIprBrushRange({ startIndex: 0, endIndex: iprHistory.length - 1 })}
                        >
                          All
                        </button>
                        {seasons.map((s) => {
                          const range = seasonIndices.get(s)!
                          const isActive = startIdx === range.start && endIdx === range.end
                          return (
                            <button
                              key={s}
                              className={`px-2 py-1 text-xs rounded border transition-colors ${
                                isActive
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-muted border-border hover:bg-accent'
                              }`}
                              onClick={() => setIprBrushRange({ startIndex: range.start, endIndex: range.end })}
                            >
                              S{s}
                            </button>
                          )
                        })}
                      </div>

                      {/* Line Chart with Brush */}
                      <div className="w-full" style={{ height: '420px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <RechartsLineChart
                            data={iprHistory}
                            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="matchNumber"
                              tickFormatter={(value, index) => {
                                const match = iprHistory.find((h: any) => h.matchNumber === value)
                                return match ? `S${match.season}W${match.week}` : value
                              }}
                              angle={-45}
                              textAnchor="end"
                              height={60}
                              interval={tickInterval}
                              tick={{ fontSize: 11 }}
                            />
                            <YAxis
                              domain={[minIPR, maxIPR]}
                              allowDecimals={false}
                              tick={{ fontSize: 12 }}
                            />
                            <Tooltip
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload
                                  return (
                                    <div className="bg-background border rounded-lg p-3 shadow-lg">
                                      <p className="font-semibold">Season {data.season}, Week {data.week}</p>
                                      <p className="text-sm">IPR: {data.ipr}</p>
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
                              dot={visibleCount <= 30 ? { r: 3 } : false}
                              activeDot={{ r: 6 }}
                            />
                            <Brush
                              dataKey="matchNumber"
                              height={30}
                              stroke="hsl(var(--muted-foreground))"
                              fill="hsl(var(--muted))"
                              startIndex={startIdx}
                              endIndex={endIdx}
                              onChange={(range: any) => {
                                if (range && typeof range.startIndex === 'number' && typeof range.endIndex === 'number') {
                                  setIprBrushRange({ startIndex: range.startIndex, endIndex: range.endIndex })
                                }
                              }}
                              tickFormatter={(value: any, index: number) => {
                                const match = iprHistory[index]
                                return match ? `S${match.season}` : ''
                              }}
                            />
                          </RechartsLineChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-xs text-muted-foreground text-center mt-2">
                        Drag the handles below the chart to adjust range. Drag the shaded area to pan.
                      </p>
                    </>
                  )
                })()
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  Loading IPR history...
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Player Swap Dialog */}
          <Dialog open={swapDialogOpen} onOpenChange={setSwapDialogOpen}>
            <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Swap Player</DialogTitle>
                <DialogDescription>
                  Replace {swapDialogPlayer} with another player
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Team Players Section */}
                <div>
                  <h4 className="text-sm font-medium mb-2">Team Players</h4>
                  {loadingTeamPlayers ? (
                    <div className="text-center py-4 text-muted-foreground">Loading...</div>
                  ) : (
                    <div className="max-h-40 overflow-y-auto border rounded p-2 space-y-1">
                      {teamAllPlayers
                        .filter(p => p.name !== swapDialogPlayer)
                        .map(p => (
                          <button
                            key={p.name}
                            onClick={() => handleSwapPlayer(p.name)}
                            className="w-full text-left px-2 py-1 text-sm rounded hover:bg-muted flex items-center justify-between"
                          >
                            <span>{p.name}</span>
                            {p.isSub && <span className="text-xs text-muted-foreground">(sub)</span>}
                          </button>
                        ))}
                      {teamAllPlayers.length === 0 && (
                        <div className="text-center py-2 text-muted-foreground text-sm">No players found</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Manual Search Section */}
                <div>
                  <h4 className="text-sm font-medium mb-2">Manual Entry</h4>
                  <input
                    type="text"
                    placeholder="Search all players..."
                    value={playerSearchQuery}
                    onChange={(e) => setPlayerSearchQuery(e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded bg-background"
                  />
                  {loadingSearch && (
                    <div className="text-center py-2 text-muted-foreground text-sm">Searching...</div>
                  )}
                  {playerSearchResults.length > 0 && (
                    <div className="max-h-32 overflow-y-auto border rounded mt-2 p-2 space-y-1">
                      {playerSearchResults
                        .filter(p => p !== swapDialogPlayer)
                        .map(p => (
                          <button
                            key={p}
                            onClick={() => handleSwapPlayer(p)}
                            className="w-full text-left px-2 py-1 text-sm rounded hover:bg-muted"
                          >
                            {p}
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                {/* Remove Player Option */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-red-600 hover:text-red-700"
                  onClick={() => {
                    if (swapDialogPlayer) {
                      // Just exclude the player without adding a replacement
                      if (leastUniquePlayers?.rosterPlayers?.includes(swapDialogPlayer)) {
                        setExcludedPlayers(prev => new Set([...Array.from(prev), swapDialogPlayer]))
                      }
                      if (includedPlayers.has(swapDialogPlayer)) {
                        setIncludedPlayers(prev => {
                          const next = new Set(prev)
                          next.delete(swapDialogPlayer)
                          return next
                        })
                      }
                      setSwapDialogOpen(false)
                    }
                  }}
                >
                  Remove {swapDialogPlayer} (no replacement)
                </Button>
              </div>
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

export default function HomePage() {
  return (
    <Suspense fallback={<div className="container py-8 px-4 md:px-6 text-center">Loading...</div>}>
      <HomePageContent />
    </Suspense>
  )
}

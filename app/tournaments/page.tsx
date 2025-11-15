'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { tournamentDataService } from '@/lib/data-service'
import { 
  calculateMachineStats, 
  getUniqueTeams, 
  getUniqueVenues,
  type Match,
  type MachineStats,
  type ProcessedScore
} from '@/lib/tournament-data'
import { Loader2, Trophy, Target, TrendingUp } from 'lucide-react'

export default function TournamentsPage() {
  const [loading, setLoading] = useState(true)
  const [matches, setMatches] = useState<Match[]>([])
  const [processedData, setProcessedData] = useState<ProcessedScore[]>([])
  const [selectedTeam, setSelectedTeam] = useState('The Wrecking Crew')
  const [selectedVenue, setSelectedVenue] = useState('Georgetown Pizza and Arcade')
  const [selectedSeasons, setSelectedSeasons] = useState<[number, number]>([20, 21])
  const [teams, setTeams] = useState<string[]>([])
  const [venues, setVenues] = useState<string[]>([])
  const [machineStats, setMachineStats] = useState<MachineStats[]>([])

  // Load initial data
  useEffect(() => {
    loadTournamentData()
  }, [])

  // Recalculate stats when filters change
  useEffect(() => {
    if (processedData.length > 0) {
      const stats = calculateMachineStats(
        processedData,
        selectedTeam,
        selectedVenue,
        selectedSeasons,
        { 
          includeVenueSpecific: true,
          includeTWCStats: selectedTeam !== 'The Wrecking Crew'
        }
      )
      setMachineStats(stats)
    }
  }, [processedData, selectedTeam, selectedVenue, selectedSeasons])

  const loadTournamentData = async () => {
    setLoading(true)
    try {
      // Load sample data for now
      const sampleMatches = await tournamentDataService.loadSampleData()
      setMatches(sampleMatches)

      // Process the data
      const processed = await tournamentDataService.getProcessedScores([20, 21])
      setProcessedData(processed)

      // Extract unique teams and venues
      const uniqueTeams = getUniqueTeams(sampleMatches)
      const uniqueVenues = getUniqueVenues(sampleMatches)
      
      setTeams(uniqueTeams)
      setVenues(uniqueVenues)
      
      // Set default selections
      if (uniqueTeams.length > 0 && !uniqueTeams.includes(selectedTeam)) {
        setSelectedTeam(uniqueTeams[0])
      }
      if (uniqueVenues.length > 0 && !uniqueVenues.includes(selectedVenue)) {
        setSelectedVenue(uniqueVenues[0])
      }
    } catch (error) {
      console.error('Error loading tournament data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="container flex items-center justify-center min-h-[calc(100vh-3.5rem)]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="container py-8 px-4 md:px-6">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Tournament Statistics</h1>
        <p className="text-muted-foreground text-lg">
          Analyze tournament performance and machine statistics
        </p>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Select team, venue, and season range</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="team">Team</Label>
              <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                <SelectTrigger id="team">
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map(team => (
                    <SelectItem key={team} value={team}>
                      {team}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="venue">Venue</Label>
              <Select value={selectedVenue} onValueChange={setSelectedVenue}>
                <SelectTrigger id="venue">
                  <SelectValue placeholder="Select venue" />
                </SelectTrigger>
                <SelectContent>
                  {venues.map(venue => (
                    <SelectItem key={venue} value={venue}>
                      {venue}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="seasons">Season Range</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={selectedSeasons[0]}
                  onChange={(e) => setSelectedSeasons([parseInt(e.target.value), selectedSeasons[1]])}
                  min={1}
                  max={30}
                />
                <span className="flex items-center">-</span>
                <Input
                  type="number"
                  value={selectedSeasons[1]}
                  onChange={(e) => setSelectedSeasons([selectedSeasons[0], parseInt(e.target.value)])}
                  min={1}
                  max={30}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistics Tabs */}
      <Tabs defaultValue="machines" className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="machines">Machines</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>

        {/* Machine Statistics */}
        <TabsContent value="machines" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Machine Performance</CardTitle>
              <CardDescription>
                Statistics for {selectedTeam} at {selectedVenue}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {machineStats.length === 0 ? (
                <p className="text-muted-foreground">No data available for selected filters</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {machineStats.slice(0, 9).map((stat) => (
                      <Card key={stat.machine}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-lg capitalize">
                            {stat.machine.replace(/-/g, ' ')}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Team Avg:</span>
                            <span className="font-medium">
                              {stat.teamAverage.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">% of Venue:</span>
                            <span className="font-medium">
                              {stat.percentOfVenueAvg.toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Times Played:</span>
                            <span className="font-medium">{stat.timesPlayed}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">POPS:</span>
                            <span className="font-medium">{stat.pops.toFixed(1)}%</span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Summary Statistics */}
        <TabsContent value="summary" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Matches
                </CardTitle>
                <Trophy className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{matches.length}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Machines Analyzed
                </CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{machineStats.length}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Average POPS
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {machineStats.length > 0
                    ? (machineStats.reduce((sum, s) => sum + s.pops, 0) / machineStats.length).toFixed(1)
                    : 0}%
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Best Machine
                </CardTitle>
                <Trophy className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold capitalize">
                  {machineStats.length > 0
                    ? machineStats.reduce((best, current) => 
                        current.percentOfVenueAvg > best.percentOfVenueAvg ? current : best
                      ).machine.replace(/-/g, ' ')
                    : 'N/A'}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Trends */}
        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Performance Trends</CardTitle>
              <CardDescription>Visualization coming soon</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Charts and trend analysis will be displayed here
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
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
import { createSupabaseClient } from '@/lib/supabase'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { ArrowLeft, Trophy, TrendingUp, Star, Trash2 } from 'lucide-react'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function MachinePage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const machine = decodeURIComponent(params.machine as string)
  const venueFromQuery = searchParams.get('venue')

  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [playerName, setPlayerName] = useState<string>('')
  const [venues, setVenues] = useState<string[]>([])
  const [selectedVenue, setSelectedVenue] = useState<string>('')
  const [score, setScore] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // User input: average and confidence
  const [userAvgValue, setUserAvgValue] = useState<string>('')
  const [userAvgMultiplier, setUserAvgMultiplier] = useState<string>('million')
  const [userConfidence, setUserConfidence] = useState<number>(0)
  const [savingAvg, setSavingAvg] = useState(false)
  const [savingConfidence, setSavingConfidence] = useState(false)

  // User scores
  const [userScores, setUserScores] = useState<any[]>([])
  const [loadingUserScores, setLoadingUserScores] = useState(true)

  // Top scores
  const [topSeasonScores, setTopSeasonScores] = useState<any[]>([])
  const [topAllTimeScores, setTopAllTimeScores] = useState<any[]>([])
  const [loadingTopScores, setLoadingTopScores] = useState(true)

  // Venues with machine
  const [venuesWithMachine, setVenuesWithMachine] = useState<string[]>([])
  const [loadingVenues, setLoadingVenues] = useState(true)

  const supabase = createSupabaseClient()

  useEffect(() => {
    checkUser()
    loadVenues()
    loadTopScores()
    loadVenuesWithMachine()
  }, [])

  useEffect(() => {
    if (playerName) {
      loadUserScores()
    }
  }, [playerName, machine])

  useEffect(() => {
    if (playerName && selectedVenue) {
      loadUserInputs()
    } else {
      // Clear inputs when no venue selected
      setUserAvgValue('')
      setUserAvgMultiplier('million')
      setUserConfidence(0)
    }
  }, [playerName, machine, selectedVenue])

  useEffect(() => {
    // Priority: URL query param > localStorage > first venue
    if (venueFromQuery && venuesWithMachine.includes(venueFromQuery)) {
      setSelectedVenue(venueFromQuery)
    } else {
      const lastVenue = localStorage.getItem('lastSelectedVenue')
      if (lastVenue && venuesWithMachine.includes(lastVenue)) {
        setSelectedVenue(lastVenue)
      } else if (venuesWithMachine.length > 0 && !selectedVenue) {
        setSelectedVenue(venuesWithMachine[0])
      }
    }
  }, [venuesWithMachine, venueFromQuery])

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)

    if (user) {
      // Get player name from UID mapping
      const mappingResponse = await fetch(`/api/player-mapping?uid=${user.id}`)
      if (mappingResponse.ok) {
        const mappingData = await mappingResponse.json()
        setPlayerName(mappingData.name || '')
      }
    }
  }

  const loadVenues = async () => {
    try {
      const response = await fetch('/api/venues')
      if (response.ok) {
        const data = await response.json()
        setVenues(data.venues.map((v: any) => v.name))
      }
    } catch (error) {
      console.error('Error loading venues:', error)
    }
  }

  const loadUserScores = async () => {
    if (!playerName) return

    setLoadingUserScores(true)
    try {
      const response = await fetch(`/api/user-machine-scores?player=${encodeURIComponent(playerName)}&machine=${encodeURIComponent(machine)}`)
      if (response.ok) {
        const data = await response.json()
        setUserScores(data.scores || [])
      }
    } catch (error) {
      console.error('Error loading user scores:', error)
    } finally {
      setLoadingUserScores(false)
    }
  }

  const loadTopScores = async () => {
    setLoadingTopScores(true)
    try {
      const response = await fetch(`/api/machine-top-scores?machine=${encodeURIComponent(machine)}`)
      if (response.ok) {
        const data = await response.json()
        setTopSeasonScores(data.topSeasonScores || [])
        setTopAllTimeScores(data.topAllTimeScores || [])
      }
    } catch (error) {
      console.error('Error loading top scores:', error)
    } finally {
      setLoadingTopScores(false)
    }
  }

  const loadVenuesWithMachine = async () => {
    setLoadingVenues(true)
    try {
      const response = await fetch(`/api/machine-venues?machine=${encodeURIComponent(machine)}`)
      if (response.ok) {
        const data = await response.json()
        setVenuesWithMachine(data.venues || [])
      }
    } catch (error) {
      console.error('Error loading venues with machine:', error)
    } finally {
      setLoadingVenues(false)
    }
  }

  const multipliers: Record<string, number> = {
    thousand: 1_000,
    million: 1_000_000,
    billion: 1_000_000_000,
  }

  const loadUserInputs = async () => {
    if (!playerName || !selectedVenue) return
    try {
      const response = await fetch(
        `/api/user-machine-inputs?player=${encodeURIComponent(playerName)}&machine=${encodeURIComponent(machine)}&venue=${encodeURIComponent(selectedVenue)}`
      )
      if (response.ok) {
        const data = await response.json()
        if (data.input) {
          setUserConfidence(data.input.userConfidence || 0)
          if (data.input.userAverage) {
            // Convert raw number back to value + multiplier for display
            const raw = data.input.userAverage
            if (raw >= 1_000_000_000 && raw % 1_000_000_000 === 0) {
              setUserAvgValue(String(raw / 1_000_000_000))
              setUserAvgMultiplier('billion')
            } else if (raw >= 1_000_000 && raw % 1_000_000 === 0) {
              setUserAvgValue(String(raw / 1_000_000))
              setUserAvgMultiplier('million')
            } else if (raw >= 1_000 && raw % 1_000 === 0) {
              setUserAvgValue(String(raw / 1_000))
              setUserAvgMultiplier('thousand')
            } else {
              setUserAvgValue(String(raw / 1_000_000))
              setUserAvgMultiplier('million')
            }
          } else {
            setUserAvgValue('')
            setUserAvgMultiplier('million')
          }
        } else {
          // No data for this venue — reset
          setUserAvgValue('')
          setUserAvgMultiplier('million')
          setUserConfidence(0)
        }
      }
    } catch (error) {
      console.error('Error loading user inputs:', error)
    }
  }

  const handleClearAverage = async () => {
    if (!user || !playerName || !selectedVenue) return

    setSavingAvg(true)
    try {
      const response = await fetch('/api/save-user-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine,
          venue: selectedVenue,
          playerName,
          userId: user.id,
          userAverage: null,
        }),
      })
      if (response.ok) {
        setUserAvgValue('')
        setUserAvgMultiplier('million')
      }
    } catch (error) {
      console.error('Error clearing average:', error)
    } finally {
      setSavingAvg(false)
    }
  }

  const handleClearConfidence = async () => {
    if (!user || !playerName || !selectedVenue) return

    setSavingConfidence(true)
    try {
      const response = await fetch('/api/save-user-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine,
          venue: selectedVenue,
          playerName,
          userId: user.id,
          userConfidence: null,
        }),
      })
      if (response.ok) {
        setUserConfidence(0)
      }
    } catch (error) {
      console.error('Error clearing confidence:', error)
    } finally {
      setSavingConfidence(false)
    }
  }

  const handleSaveAverage = async () => {
    if (!user || !playerName || !userAvgValue || !selectedVenue) return

    setSavingAvg(true)
    try {
      const rawAverage = Math.round(parseFloat(userAvgValue) * multipliers[userAvgMultiplier])
      const response = await fetch('/api/save-user-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine,
          venue: selectedVenue,
          playerName,
          userId: user.id,
          userAverage: rawAverage,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        alert(`Error: ${data.error || 'Failed to save average'}`)
      }
    } catch (error) {
      console.error('Error saving average:', error)
    } finally {
      setSavingAvg(false)
    }
  }

  const handleSaveConfidence = async (value: number) => {
    setUserConfidence(value)
    if (!user || !playerName || !selectedVenue) return

    setSavingConfidence(true)
    try {
      const response = await fetch('/api/save-user-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine,
          venue: selectedVenue,
          playerName,
          userId: user.id,
          userConfidence: value,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        alert(`Error: ${data.error || 'Failed to save confidence'}`)
      }
    } catch (error) {
      console.error('Error saving confidence:', error)
    } finally {
      setSavingConfidence(false)
    }
  }

  const handleAddScore = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user || !playerName || !selectedVenue || !score) {
      alert('Please fill in all fields')
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/save-score', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          machine,
          score: parseInt(score),
          venue: selectedVenue,
          playerName,
          userId: user.id,
        }),
      })

      if (response.ok) {
        // Save selected venue to localStorage
        localStorage.setItem('lastSelectedVenue', selectedVenue)

        // Clear form and reload data
        setScore('')
        loadUserScores()
        loadTopScores()

        alert('Score saved successfully!')
      } else {
        const data = await response.json()
        alert(`Error: ${data.error || 'Failed to save score'}`)
      }
    } catch (error) {
      console.error('Error saving score:', error)
      alert('Failed to save score')
    } finally {
      setSaving(false)
    }
  }

  const handleVenueChange = (venue: string) => {
    setSelectedVenue(venue)
    localStorage.setItem('lastSelectedVenue', venue)
  }

  const handleDeleteScore = async (scoreId: number) => {
    if (!user || !confirm('Are you sure you want to delete this score?')) {
      return
    }

    try {
      const response = await fetch(`/api/user-machine-scores?id=${scoreId}&userId=${user.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        loadUserScores()
        loadTopScores()
      } else {
        const data = await response.json()
        alert(`Error: ${data.error || 'Failed to delete score'}`)
      }
    } catch (error) {
      console.error('Error deleting score:', error)
      alert('Failed to delete score')
    }
  }

  return (
    <div className="container py-8 px-4 md:px-6">
      <div className="mb-6">
        <Link href="/machines">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Machines
          </Button>
        </Link>
      </div>

      <h1 className="text-3xl font-bold mb-8">{machine}</h1>

      {user && playerName && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>User Input</CardTitle>
            <CardDescription>Your data for {machine}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Add a Score */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Add a Score</h3>
              <form onSubmit={handleAddScore} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="venue">Venue</Label>
                    <Select value={selectedVenue} onValueChange={handleVenueChange}>
                      <SelectTrigger id="venue">
                        <SelectValue placeholder="Select venue" />
                      </SelectTrigger>
                      <SelectContent>
                        {venuesWithMachine.map((venue) => (
                          <SelectItem key={venue} value={venue}>
                            {venue}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="score">Score</Label>
                    <Input
                      id="score"
                      type="number"
                      value={score}
                      onChange={(e) => setScore(e.target.value)}
                      placeholder="Enter your score"
                      required
                    />
                  </div>
                </div>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Add Score'}
                </Button>
              </form>
            </div>

            <hr className="border-border" />

            {/* What are you averaging? */}
            <div>
              <h3 className="text-sm font-semibold mb-1">
                What are you averaging?
                <span className="font-normal text-muted-foreground ml-2">at {selectedVenue || '...'}</span>
              </h3>
              {!selectedVenue && (
                <p className="text-xs text-muted-foreground mb-3">Select a venue above first</p>
              )}
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Input
                    type="number"
                    value={userAvgValue}
                    onChange={(e) => setUserAvgValue(e.target.value)}
                    placeholder="e.g. 50"
                    step="any"
                    disabled={!selectedVenue}
                  />
                </div>
                <div className="w-36">
                  <Select value={userAvgMultiplier} onValueChange={setUserAvgMultiplier} disabled={!selectedVenue}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="thousand">thousand</SelectItem>
                      <SelectItem value="million">million</SelectItem>
                      <SelectItem value="billion">billion</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleSaveAverage}
                  disabled={savingAvg || !userAvgValue || !selectedVenue}
                  size="sm"
                >
                  {savingAvg ? 'Saving...' : 'Save'}
                </Button>
                {userAvgValue && (
                  <Button
                    onClick={handleClearAverage}
                    disabled={savingAvg || !selectedVenue}
                    size="sm"
                    variant="outline"
                  >
                    Clear
                  </Button>
                )}
              </div>
              {userAvgValue && (
                <p className="text-xs text-muted-foreground mt-1">
                  Saved: {(parseFloat(userAvgValue) * multipliers[userAvgMultiplier]).toLocaleString()}
                </p>
              )}
            </div>

            <hr className="border-border" />

            {/* How confident are you? */}
            <div>
              <h3 className="text-sm font-semibold mb-1">
                How confident are you on this game?
                <span className="font-normal text-muted-foreground ml-2">at {selectedVenue || '...'}</span>
                {savingConfidence && <span className="text-muted-foreground font-normal ml-2">Saving...</span>}
              </h3>
              {!selectedVenue && (
                <p className="text-xs text-muted-foreground mb-3">Select a venue above first</p>
              )}
              <div className="flex items-center gap-2">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((dot) => (
                  <button
                    key={dot}
                    type="button"
                    onClick={() => handleSaveConfidence(dot)}
                    disabled={!selectedVenue}
                    className={`w-7 h-7 rounded-full border-2 transition-colors text-xs font-medium ${
                      dot <= userConfidence
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-muted-foreground/30 text-muted-foreground hover:border-primary/50'
                    } ${!selectedVenue ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {dot}
                  </button>
                ))}
                {userConfidence > 0 && (
                  <Button
                    onClick={handleClearConfidence}
                    disabled={savingConfidence || !selectedVenue}
                    size="sm"
                    variant="outline"
                    className="ml-2"
                  >
                    Clear
                  </Button>
                )}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>Not confident</span>
                <span>Very confident</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!user && (
        <Card className="mb-8">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Please log in to add scores
            </p>
          </CardContent>
        </Card>
      )}

      {user && !playerName && (
        <Card className="mb-8">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Your account is not linked to a player name.{' '}
              <a href="/options" className="text-primary hover:underline">
                Go to Options
              </a>{' '}
              to associate your account with a Wrecking Crew player.
            </p>
          </CardContent>
        </Card>
      )}

      {playerName && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Your Scores</CardTitle>
            <CardDescription>Your recorded scores on {machine}</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingUserScores ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : userScores.length > 0 ? (
              <>
                <Table className="table-fixed w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[30%]">Score</TableHead>
                      <TableHead className="w-[35%] truncate">Venue</TableHead>
                      <TableHead className="w-[25%]">Source</TableHead>
                      <TableHead className="w-[10%]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userScores.map((s, i) => (
                      <TableRow key={i} className={s.source === 'manual' ? 'bg-yellow-500/10' : ''}>
                        <TableCell className="font-semibold truncate">
                          {s.source === 'manual' && <Star className="h-3 w-3 inline mr-1 text-yellow-500" />}
                          {s.score.toLocaleString()}
                        </TableCell>
                        <TableCell className="truncate text-sm">{s.venue}</TableCell>
                        <TableCell>
                          {s.source === 'manual' ? (
                            <span className="text-yellow-600 dark:text-yellow-400 text-xs sm:text-sm">Added</span>
                          ) : (
                            <span className="text-muted-foreground text-xs sm:text-sm">S{s.season} W{s.week}</span>
                          )}
                        </TableCell>
                        <TableCell className="p-1">
                          {s.source === 'manual' && s.id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                              onClick={() => handleDeleteScore(s.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground mt-2">
                  <Star className="h-3 w-3 inline mr-1 text-yellow-500" />
                  Highlighted scores are manually added
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">No scores recorded yet</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              Top 10 This Season
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTopScores ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : topSeasonScores.length > 0 ? (
              <div className="space-y-3">
                {topSeasonScores.map((s, i) => (
                  <div key={i} className="flex items-center justify-between p-3 border rounded">
                    <div>
                      <div className="font-semibold">#{i + 1} {s.player}</div>
                      <div className="text-sm text-muted-foreground">{s.venue}</div>
                    </div>
                    <div className="text-xl font-bold">{s.score.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No scores this season</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              Top 10 All Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTopScores ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : topAllTimeScores.length > 0 ? (
              <div className="space-y-3">
                {topAllTimeScores.map((s, i) => (
                  <div key={i} className="flex items-center justify-between p-3 border rounded">
                    <div>
                      <div className="font-semibold">#{i + 1} {s.player}</div>
                      <div className="text-sm text-muted-foreground">{s.venue} • Season {s.season}</div>
                    </div>
                    <div className="text-xl font-bold">{s.score.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No scores recorded</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Venues with {machine}</CardTitle>
          <CardDescription>Where you can find this machine</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingVenues ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : venuesWithMachine.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {venuesWithMachine.map((venue) => (
                <div key={venue} className="p-3 border rounded">
                  {venue}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">Machine not found at any venues</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

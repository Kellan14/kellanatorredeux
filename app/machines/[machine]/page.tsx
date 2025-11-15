'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
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
import { ArrowLeft, Trophy, TrendingUp } from 'lucide-react'
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
  const machine = decodeURIComponent(params.machine as string)

  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [playerName, setPlayerName] = useState<string>('')
  const [venues, setVenues] = useState<string[]>([])
  const [selectedVenue, setSelectedVenue] = useState<string>('')
  const [score, setScore] = useState<string>('')
  const [saving, setSaving] = useState(false)

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
    // Load last selected venue from localStorage
    const lastVenue = localStorage.getItem('lastSelectedVenue')
    if (lastVenue && venuesWithMachine.includes(lastVenue)) {
      setSelectedVenue(lastVenue)
    } else if (venuesWithMachine.length > 0 && !selectedVenue) {
      setSelectedVenue(venuesWithMachine[0])
    }
  }, [venuesWithMachine])

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
            <CardTitle>Add a Score</CardTitle>
            <CardDescription>Record your score for {machine}</CardDescription>
          </CardHeader>
          <CardContent>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Score</TableHead>
                    <TableHead>Venue</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userScores.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-semibold">{s.score.toLocaleString()}</TableCell>
                      <TableCell>{s.venue}</TableCell>
                      <TableCell>{new Date(s.played_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
              Top 3 This Season
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
              Top 3 All Time
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

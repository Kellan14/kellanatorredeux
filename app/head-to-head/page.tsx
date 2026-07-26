'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { PlayerCombobox } from '@/components/ui/player-combobox'
import { Users, Trophy, Swords } from 'lucide-react'
import { getMachineImagePath } from '@/lib/machine-images'
import { usePlayerNames } from '@/hooks/use-player-names'

interface Match {
  matchKey: string
  season: number
  week: number
  venue: string
  totalRounds: number
  h2hRounds: number
  player1Wins: number
  player2Wins: number
  ties: number
}

interface Summary {
  totalMatches: number
  totalH2HRounds: number
  player1Wins: number
  player2Wins: number
  ties: number
}

interface Round {
  round: number
  machine: string
  isH2H: boolean
  player1Score: number | null
  player1Points: number | null
  player2Score: number | null
  player2Points: number | null
  winner: 'player1' | 'player2' | 'tie' | null
}

interface MachineScore {
  score: number
  season: number
  week: number
  venue: string
  matchKey: string
  isH2H: boolean
  won: boolean | null
}

export default function HeadToHeadPage() {
  const { players } = usePlayerNames()
  const [player1, setPlayer1] = useState<string>('')
  const [player2, setPlayer2] = useState<string>('')
  const [matches, setMatches] = useState<Match[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null)
  const [rounds, setRounds] = useState<Round[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingRounds, setLoadingRounds] = useState(false)

  // Machine comparison state
  const [machines, setMachines] = useState<string[]>([])
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null)
  const [player1MachineScores, setPlayer1MachineScores] = useState<MachineScore[]>([])
  const [player2MachineScores, setPlayer2MachineScores] = useState<MachineScore[]>([])
  const [loadingMachineScores, setLoadingMachineScores] = useState(false)

  // Auto-load head-to-head data when both players are selected
  useEffect(() => {
    if (!player1 || !player2 || player1 === player2) {
      setMatches([])
      setSummary(null)
      setMachines([])
      setSelectedMatch(null)
      setSelectedMachine(null)
      setRounds([])
      setPlayer1MachineScores([])
      setPlayer2MachineScores([])
      return
    }

    const loadHeadToHead = async () => {
      setLoading(true)
      setSelectedMatch(null)
      setSelectedMachine(null)
      setRounds([])
      setPlayer1MachineScores([])
      setPlayer2MachineScores([])

      try {
        const response = await fetch(
          `/api/head-to-head?player1=${encodeURIComponent(player1)}&player2=${encodeURIComponent(player2)}`
        )
        if (response.ok) {
          const data = await response.json()
          setMatches(data.matches || [])
          setSummary(data.summary || null)
          setMachines(data.machines || [])
        }
      } catch (error) {
        console.error('Error loading head-to-head data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadHeadToHead()
  }, [player1, player2])

  const loadMatchDetails = async (matchKey: string) => {
    if (!player1 || !player2) return

    setLoadingRounds(true)
    setSelectedMatch(matchKey)

    try {
      const response = await fetch(
        `/api/head-to-head?player1=${encodeURIComponent(player1)}&player2=${encodeURIComponent(player2)}&match=${encodeURIComponent(matchKey)}`
      )
      if (response.ok) {
        const data = await response.json()
        setRounds(data.rounds || [])
      }
    } catch (error) {
      console.error('Error loading match details:', error)
    } finally {
      setLoadingRounds(false)
    }
  }

  const loadMachineScores = async (machine: string) => {
    if (!player1 || !player2) return

    setLoadingMachineScores(true)
    setSelectedMachine(machine)

    try {
      const response = await fetch(
        `/api/head-to-head?player1=${encodeURIComponent(player1)}&player2=${encodeURIComponent(player2)}&machine=${encodeURIComponent(machine)}`
      )
      if (response.ok) {
        const data = await response.json()
        setPlayer1MachineScores(data.player1Scores || [])
        setPlayer2MachineScores(data.player2Scores || [])
      }
    } catch (error) {
      console.error('Error loading machine scores:', error)
    } finally {
      setLoadingMachineScores(false)
    }
  }

  return (
    <div className="container py-8 px-4 md:px-6">
      <h1 className="text-3xl font-bold mb-8 flex items-center gap-3">
        <Swords className="h-8 w-8" />
        Head to Head
      </h1>

      {/* Player Selection */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Select Players</CardTitle>
          <CardDescription>Choose two players to compare their head-to-head matchups</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <Label htmlFor="player1">Player 1</Label>
              <PlayerCombobox
                players={players}
                value={player1}
                onValueChange={setPlayer1}
                placeholder="Search players..."
                disabledValues={player2 ? [player2] : []}
              />
            </div>

            <div className="flex justify-center">
              <span className="text-2xl font-bold text-muted-foreground">vs</span>
            </div>

            <div>
              <Label htmlFor="player2">Player 2</Label>
              <PlayerCombobox
                players={players}
                value={player2}
                onValueChange={setPlayer2}
                placeholder="Search players..."
                disabledValues={player1 ? [player1] : []}
              />
            </div>
          </div>
          {loading && (
            <p className="text-sm text-muted-foreground mt-4">Loading...</p>
          )}
        </CardContent>
      </Card>

      {/* Summary Stats */}
      {summary && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              Overall Record
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-green-500/10 rounded-lg">
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                  {summary.player1Wins}
                </div>
                <div className="text-sm text-muted-foreground">{player1} Wins</div>
              </div>
              <div className="p-4 bg-gray-500/10 rounded-lg">
                <div className="text-3xl font-bold text-gray-600 dark:text-gray-400">
                  {summary.ties}
                </div>
                <div className="text-sm text-muted-foreground">Ties</div>
              </div>
              <div className="p-4 bg-blue-500/10 rounded-lg">
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                  {summary.player2Wins}
                </div>
                <div className="text-sm text-muted-foreground">{player2} Wins</div>
              </div>
            </div>
            <div className="mt-4 text-center text-sm text-muted-foreground">
              {summary.totalMatches} matches | {summary.totalH2HRounds} head-to-head rounds
            </div>
          </CardContent>
        </Card>
      )}

      {/* Match List and Details */}
      {matches.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Match List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Matches Together
              </CardTitle>
              <CardDescription>Click a match to see round-by-round details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {matches.map((match) => (
                  <button
                    key={match.matchKey}
                    onClick={() => loadMatchDetails(match.matchKey)}
                    className={`w-full p-3 rounded-lg border text-left transition-colors ${
                      selectedMatch === match.matchKey
                        ? 'bg-primary/10 border-primary'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">
                          Season {match.season} Week {match.week}
                        </div>
                        <div className="text-sm text-muted-foreground">{match.venue}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm">
                          <span className="text-green-600 dark:text-green-400">{match.player1Wins}</span>
                          {' - '}
                          <span className="text-gray-500">{match.ties}</span>
                          {' - '}
                          <span className="text-blue-600 dark:text-blue-400">{match.player2Wins}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {match.h2hRounds} H2H rounds
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Round Details - Compact View */}
          <Card>
            <CardHeader>
              <CardTitle>Round-by-Round Comparison</CardTitle>
              <CardDescription>
                {selectedMatch
                  ? `${player1} vs ${player2}`
                  : 'Select a match to see details'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingRounds ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : rounds.length > 0 ? (
                <div className="space-y-2">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_2fr_1fr] gap-2 pb-2 border-b font-medium text-sm">
                    <div className="text-green-600 dark:text-green-400 text-center">{player1}</div>
                    <div className="text-center">Machine</div>
                    <div className="text-blue-600 dark:text-blue-400 text-center">{player2}</div>
                  </div>

                  {/* Rounds */}
                  {rounds.map((round) => (
                    <div
                      key={round.round}
                      className={`grid grid-cols-[1fr_2fr_1fr] gap-2 p-2 rounded relative ${
                        round.isH2H ? 'bg-yellow-500/10 border border-yellow-500/30' : ''
                      }`}
                    >
                      {/* Player 1 Score */}
                      <div className={`text-center font-mono text-lg ${
                        round.winner === 'player1' ? 'font-bold text-green-600 dark:text-green-400' : ''
                      }`}>
                        {round.player1Score?.toLocaleString() ?? '-'}
                      </div>

                      {/* Machine + H2H indicator */}
                      <div className="text-center">
                        <div className="text-sm">{round.machine}</div>
                        <div className="text-xs text-muted-foreground">
                          Round {round.round}
                          {round.isH2H && (
                            <span className="ml-1 text-yellow-600 dark:text-yellow-400">(H2H)</span>
                          )}
                        </div>
                      </div>

                      {/* Player 2 Score */}
                      <div className={`text-center font-mono text-lg ${
                        round.winner === 'player2' ? 'font-bold text-blue-600 dark:text-blue-400' : ''
                      }`}>
                        {round.player2Score?.toLocaleString() ?? '-'}
                      </div>

                      {/* Connecting line for H2H */}
                      {round.isH2H && round.player1Score != null && round.player2Score != null && (
                        <div className="absolute inset-x-0 top-1/2 flex items-center justify-center pointer-events-none">
                          <div className="w-1/2 h-0.5 bg-yellow-500/50" />
                        </div>
                      )}
                    </div>
                  ))}

                  <p className="text-xs text-muted-foreground mt-4">
                    <span className="inline-block w-3 h-3 bg-yellow-500/30 border border-yellow-500/50 rounded mr-1" />
                    Highlighted rounds are head-to-head (both players on same machine)
                  </p>
                </div>
              ) : selectedMatch ? (
                <p className="text-muted-foreground">No round data available</p>
              ) : (
                <p className="text-muted-foreground">Select a match from the list to see round-by-round scores</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Machine Score Comparison */}
      {machines.length > 0 && (
        <Card className="mt-8 relative overflow-hidden">
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
            <CardTitle>Compare Scores by Machine</CardTitle>
            <CardDescription>Select a machine to see all scores for both players</CardDescription>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="mb-4">
              <Label htmlFor="machine-select">Select Machine</Label>
              <Select value={selectedMachine || ''} onValueChange={loadMachineScores}>
                <SelectTrigger id="machine-select" className="w-full md:w-64">
                  <SelectValue placeholder="Choose a machine" />
                </SelectTrigger>
                <SelectContent>
                  {machines.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loadingMachineScores && (
              <p className="text-muted-foreground">Loading scores...</p>
            )}

            {selectedMachine && !loadingMachineScores && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                {/* Player 1 Scores */}
                <Card className="border-green-500/30">
                  <CardHeader className="bg-green-500/5 py-3">
                    <CardTitle className="text-green-600 dark:text-green-400 text-lg">{player1}</CardTitle>
                    <CardDescription>
                      {player1MachineScores.length} scores on {selectedMachine}
                      {player1MachineScores.length > 0 && (
                        <span className="ml-2 font-medium">
                          • Avg: {Math.round(player1MachineScores.reduce((sum, s) => sum + s.score, 0) / player1MachineScores.length).toLocaleString()}
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4 max-h-[400px] overflow-y-auto">
                    <div className="space-y-2">
                      {player1MachineScores.map((score, i) => (
                        <div
                          key={`${score.matchKey}-${i}`}
                          className={`p-3 rounded-lg border ${
                            score.isH2H
                              ? 'bg-yellow-500/10 border-yellow-500/50'
                              : 'bg-muted/30 border-border'
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="text-sm text-muted-foreground">
                                S{score.season} W{score.week} @ {score.venue}
                              </div>
                              {score.isH2H && (
                                <div className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                                  vs {player2}
                                  {score.won === true && ' (Won)'}
                                  {score.won === false && ' (Lost)'}
                                </div>
                              )}
                            </div>
                            <div className={`text-xl font-mono font-bold ${
                              score.won === true ? 'text-green-600 dark:text-green-400' : ''
                            }`}>
                              {score.score.toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))}
                      {player1MachineScores.length === 0 && (
                        <p className="text-muted-foreground text-sm">No scores recorded</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Player 2 Scores */}
                <Card className="border-blue-500/30">
                  <CardHeader className="bg-blue-500/5 py-3">
                    <CardTitle className="text-blue-600 dark:text-blue-400 text-lg">{player2}</CardTitle>
                    <CardDescription>
                      {player2MachineScores.length} scores on {selectedMachine}
                      {player2MachineScores.length > 0 && (
                        <span className="ml-2 font-medium">
                          • Avg: {Math.round(player2MachineScores.reduce((sum, s) => sum + s.score, 0) / player2MachineScores.length).toLocaleString()}
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4 max-h-[400px] overflow-y-auto">
                    <div className="space-y-2">
                      {player2MachineScores.map((score, i) => (
                        <div
                          key={`${score.matchKey}-${i}`}
                          className={`p-3 rounded-lg border ${
                            score.isH2H
                              ? 'bg-yellow-500/10 border-yellow-500/50'
                              : 'bg-muted/30 border-border'
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="text-sm text-muted-foreground">
                                S{score.season} W{score.week} @ {score.venue}
                              </div>
                              {score.isH2H && (
                                <div className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                                  vs {player1}
                                  {score.won === true && ' (Won)'}
                                  {score.won === false && ' (Lost)'}
                                </div>
                              )}
                            </div>
                            <div className={`text-xl font-mono font-bold ${
                              score.won === true ? 'text-blue-600 dark:text-blue-400' : ''
                            }`}>
                              {score.score.toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))}
                      {player2MachineScores.length === 0 && (
                        <p className="text-muted-foreground text-sm">No scores recorded</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {selectedMachine && !loadingMachineScores && (player1MachineScores.length > 0 || player2MachineScores.length > 0) && (
              <p className="text-xs text-muted-foreground mt-4">
                <span className="inline-block w-3 h-3 bg-yellow-500/30 border border-yellow-500/50 rounded mr-1" />
                Highlighted scores are head-to-head games against each other
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* No matches found */}
      {player1 && player2 && !loading && matches.length === 0 && summary === null && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No matches found between {player1} and {player2}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

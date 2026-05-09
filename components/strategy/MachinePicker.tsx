'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { DndProvider, useDrag, useDrop } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { X, Info, ChevronDown, ChevronUp } from 'lucide-react'
import type { OptimizationResult, Assignment, PairAssignment, AssumedOpponent } from '@/types/strategy'

interface ScoreWeights {
  winRate: number
  recentForm: number
  venueAdjustedAvg: number
  confidence: number
}

interface ForcedAssignment {
  player: string
  machine: string
}

interface MachinePickerProps {
  format: '7x7' | '4x2'
  playerNames: string[]
  machines: string[]
  seasonStart?: number
  seasonEnd?: number
  venue?: string
  venueWeight?: number
  userInputWeight?: number
  confidenceBoost?: number
  scoreWeights?: ScoreWeights
  exclusions?: Record<string, string[]>
  mustPlay?: string[]
  onAddExclusion?: (machine: string, player: string) => void
  onRemoveExclusion?: (machine: string, player: string) => void
  onExcludeMachine?: (machine: string) => void
  onOptimize?: (result: OptimizationResult) => void
  opponent?: string
  opponentPlayers?: string[]
  opponentWeight?: number
  useNashEquilibrium?: boolean
  searchMachineSubsets?: boolean
  usePerGameNormalized?: boolean
  avgMethod?: 'mean' | 'median' | 'trimmed'
  trimPct?: number
}

interface DragItem {
  type: string
  playerName: string
  index: number
}

function DraggablePlayer({ playerName, index }: { playerName: string; index: number }) {
  const [{ isDragging }, drag] = useDrag({
    type: 'PLAYER',
    item: { type: 'PLAYER', playerName, index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  })

  return (
    <div
      ref={drag as any}
      className={`
        px-2 py-1 bg-primary/10 border border-primary/30 rounded cursor-move
        hover:bg-primary/20 transition-colors text-xs
        ${isDragging ? 'opacity-50' : 'opacity-100'}
      `}
    >
      {playerName}
    </div>
  )
}

interface PlayerStats {
  venue_adjusted_avg?: number
  user_average?: number | null
  user_confidence?: number | null
}

function AssignedPlayer({
  playerName,
  machine,
  stats,
  onExclude,
  isForced,
  onForce,
  onUnforce
}: {
  playerName: string
  machine: string
  stats?: PlayerStats
  onExclude?: (machine: string, player: string) => void
  isForced?: boolean
  onForce?: (machine: string, player: string) => void
  onUnforce?: (machine: string, player: string) => void
}) {
  const [{ isDragging }, drag] = useDrag({
    type: 'PLAYER',
    item: { type: 'PLAYER', playerName, index: 0 },
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  })

  const [showInfo, setShowInfo] = useState(false)

  const venueAvgPct = stats?.venue_adjusted_avg != null
    ? `${(stats.venue_adjusted_avg * 100).toFixed(0)}%`
    : null

  const userAvgDisplay = stats?.user_average
    ? stats.user_average >= 1_000_000_000
      ? `${(stats.user_average / 1_000_000_000).toFixed(1)}B`
      : stats.user_average >= 1_000_000
      ? `${(stats.user_average / 1_000_000).toFixed(1)}M`
      : stats.user_average >= 1_000
      ? `${(stats.user_average / 1_000).toFixed(1)}K`
      : String(stats.user_average)
    : null

  return (
    <div className={`mt-0.5 ${isDragging ? 'opacity-50' : ''}`}>
      <div
        ref={drag as any}
        className={`px-1.5 py-0.5 rounded text-[10px] text-foreground truncate cursor-move ${
          isForced
            ? 'bg-blue-500/30 border border-blue-500/60'
            : 'bg-green-500/20 border border-green-500/40'
        }`}
      >
        {isForced && <span className="mr-1">🔒</span>}
        {playerName}
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        {onExclude && !isForced && (
          <button
            onClick={() => onExclude(machine, playerName)}
            className="flex items-center gap-0.5 px-1 text-[9px] text-muted-foreground hover:text-destructive transition-colors"
            title={`Exclude ${playerName} from ${machine}`}
          >
            <X className="h-2 w-2" />
            <span>exclude</span>
          </button>
        )}
        {!isForced && onForce && playerName && (
          <button
            onClick={() => onForce(machine, playerName)}
            className="flex items-center gap-0.5 px-1 text-[9px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            title={`Force ${playerName} on ${machine} and re-optimize`}
          >
            <span>force {playerName.split(' ')[0]}</span>
          </button>
        )}
        {isForced && onUnforce && (
          <button
            onClick={() => onUnforce(machine, playerName)}
            className="flex items-center gap-0.5 px-1 text-[9px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
            title={`Remove force constraint for ${playerName}`}
          >
            <X className="h-2 w-2" />
            <span>unforce</span>
          </button>
        )}
      </div>
      {(venueAvgPct || userAvgDisplay || stats?.user_confidence) && (
        <div className="flex items-center gap-1.5 mt-0.5 px-1 text-[9px] text-muted-foreground">
          {venueAvgPct && (
            <span className="flex items-center gap-0.5" title="% of venue average — each game score is divided by the venue average where it was scored and then all ratios are averaged">
              {venueAvgPct} of avg
              <button
                onClick={() => setShowInfo(!showInfo)}
                className="hover:text-foreground"
              >
                <Info className="h-2 w-2" />
              </button>
            </span>
          )}
          {userAvgDisplay && (
            <span title="User-reported average at this venue">avg: {userAvgDisplay}</span>
          )}
          {stats?.user_confidence && (
            <span title="User confidence at this venue">conf: {stats.user_confidence}/10</span>
          )}
        </div>
      )}
      {showInfo && (
        <div className="mt-0.5 px-1 py-0.5 bg-muted rounded text-[8px] text-muted-foreground leading-tight">
          Each game score is divided by the venue average where it was scored and then all ratios are averaged.
        </div>
      )}
    </div>
  )
}

interface MachineAssignmentData {
  expected_score?: number
  confidence?: number
  player1_venue_adjusted_avg?: number
  player2_venue_adjusted_avg?: number
}

function MachineSlot({
  machine,
  assignedPlayers,
  playerStatsMap,
  assignmentData,
  assumedOpponents,
  onDrop,
  onExclude,
  onExcludeMachine,
  format,
  forcedPlayers,
  onForce,
  onUnforce
}: {
  machine: string
  assignedPlayers: string[]
  playerStatsMap?: Record<string, PlayerStats>
  assignmentData?: MachineAssignmentData
  assumedOpponents?: AssumedOpponent[]
  onDrop: (playerName: string, machine: string) => void
  onExclude?: (machine: string, player: string) => void
  onExcludeMachine?: (machine: string) => void
  format: '7x7' | '4x2'
  forcedPlayers?: Set<string>
  onForce?: (machine: string, player: string) => void
  onUnforce?: (machine: string, player: string) => void
}) {
  const maxPlayers = format === '7x7' ? 1 : 2
  const [isExpanded, setIsExpanded] = useState(false)
  const [showOppDetail, setShowOppDetail] = useState(false)
  const [oppVenueOnly, setOppVenueOnly] = useState(false)

  const [{ isOver, canDrop }, drop] = useDrop({
    accept: 'PLAYER',
    drop: (item: DragItem) => {
      onDrop(item.playerName, machine)
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop()
    })
  })

  const showDropZone = canDrop && isOver
  const hasForced = assignedPlayers.some(p => forcedPlayers?.has(p))
  const hasPlayers = assignedPlayers.length > 0

  return (
    <div
      ref={drop as any}
      className={`
        px-2 py-1.5 border rounded
        ${showDropZone ? 'border-green-500 bg-green-500/10' : hasForced ? 'border-blue-500/50 bg-blue-500/5' : 'border-border bg-background'}
        transition-colors
      `}
    >
      <div className="flex items-center justify-between gap-1">
        <button
          className="font-medium text-[11px] text-foreground truncate text-left flex-1 hover:text-primary transition-colors"
          title={`${machine} — click for details`}
          onClick={() => hasPlayers && setIsExpanded(!isExpanded)}
        >
          {machine}
          {assumedOpponents && assumedOpponents.length > 0 && (
            <span className="text-red-500/70 dark:text-red-400/70 ml-1 text-[9px] font-normal"> vs {assumedOpponents.map(o => o.player).join(', ')}</span>
          )}
          {hasPlayers && (
            <span className="ml-1 inline-block align-middle">
              {isExpanded ? <ChevronUp className="h-2.5 w-2.5 inline" /> : <ChevronDown className="h-2.5 w-2.5 inline" />}
            </span>
          )}
        </button>
        {onExcludeMachine && (
          <button
            className="text-[9px] text-destructive hover:text-destructive/80 shrink-0"
            onClick={() => onExcludeMachine(machine)}
            title="Exclude this machine from all results"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {assignedPlayers.map((player) => (
        <AssignedPlayer
          key={player}
          playerName={player}
          machine={machine}
          stats={playerStatsMap?.[player]}
          onExclude={onExclude}
          isForced={forcedPlayers?.has(player)}
          onForce={onForce}
          onUnforce={onUnforce}
        />
      ))}
      {assignedPlayers.length < maxPlayers && (
        <div className="mt-0.5 px-1.5 py-0.5 border border-dashed border-border rounded text-[10px] text-muted-foreground text-center">
          {canDrop ? 'Drop' : 'Empty'}
        </div>
      )}
      {/* Expanded details panel */}
      {isExpanded && hasPlayers && (
        <div className="mt-1.5 pt-1.5 border-t border-dashed space-y-1.5">
          {assignmentData && (
            <div className="grid grid-cols-2 gap-0.5 text-[9px] text-muted-foreground">
              {assignmentData.expected_score != null && (
                <div><strong>Score:</strong> {assignmentData.expected_score.toFixed(3)}</div>
              )}
              {assignmentData.confidence != null && (
                <div><strong>Confidence:</strong> {assignmentData.confidence}/10</div>
              )}
            </div>
          )}
          {assignedPlayers.map(player => {
            const stats = playerStatsMap?.[player]
            if (!stats) return null
            return (
              <div key={player} className="text-[9px] text-muted-foreground bg-muted/50 rounded p-1">
                <div className="font-medium text-foreground mb-0.5">{player}</div>
                <div className="grid grid-cols-2 gap-0.5">
                  {stats.venue_adjusted_avg != null && (
                    <div>% of Venue: {(stats.venue_adjusted_avg * 100).toFixed(0)}%</div>
                  )}
                  {stats.user_average != null && (
                    <div>User Avg: {stats.user_average >= 1_000_000 ? `${(stats.user_average / 1_000_000).toFixed(1)}M` : stats.user_average >= 1_000 ? `${(stats.user_average / 1_000).toFixed(1)}K` : stats.user_average}</div>
                  )}
                  {stats.user_confidence != null && (
                    <div>User Conf: {stats.user_confidence}/10</div>
                  )}
                </div>
              </div>
            )
          })}
          {/* Assumed Opponents */}
          {assumedOpponents && assumedOpponents.length > 0 && (
            <div className="mt-1.5">
              <button
                className="text-[9px] font-medium text-red-500/80 dark:text-red-400/80 hover:text-red-600 dark:hover:text-red-300 flex items-center gap-0.5"
                onClick={(e) => { e.stopPropagation(); setShowOppDetail(!showOppDetail) }}
              >
                Assumed Opponent: {assumedOpponents.map(o => o.player).join(', ')}
                {showOppDetail ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
              </button>
              {showOppDetail && (
                <div className="mt-1 p-1.5 bg-red-500/5 border border-red-500/20 rounded text-[9px] space-y-1">
                  <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={oppVenueOnly}
                      onChange={() => setOppVenueOnly(!oppVenueOnly)}
                      className="h-2.5 w-2.5 accent-primary"
                    />
                    Venue-specific only
                  </label>
                  {assumedOpponents.map(opp => (
                    <div key={opp.player} className="space-y-0.5">
                      <div className="font-medium text-red-600 dark:text-red-400">{opp.player}</div>
                      <div className="grid grid-cols-3 gap-0.5 text-muted-foreground">
                        <div>Avg: {oppVenueOnly ? (opp.venueAvg > 0 ? opp.venueAvg.toLocaleString() : 'N/A') : opp.allAvg.toLocaleString()}</div>
                        <div>Games: {oppVenueOnly ? opp.venueGames : opp.allGames}</div>
                        <div>Win: {oppVenueOnly ? (opp.venueGames > 0 ? `${opp.venueWinRate}%` : 'N/A') : `${opp.allWinRate}%`}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function MachinePicker({
  format,
  playerNames,
  machines,
  seasonStart = 20,
  seasonEnd = 22,
  venue,
  venueWeight,
  userInputWeight = 0,
  confidenceBoost = 0,
  scoreWeights,
  exclusions = {},
  mustPlay = [],
  onAddExclusion,
  onRemoveExclusion,
  onExcludeMachine,
  onOptimize,
  opponent,
  opponentPlayers,
  opponentWeight = 0,
  useNashEquilibrium = true,
  searchMachineSubsets = false,
  usePerGameNormalized = true,
  avgMethod = 'mean',
  trimPct = 0.1
}: MachinePickerProps) {
  const [assignments, setAssignments] = useState<Map<string, string[]>>(new Map())
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forcedAssignments, setForcedAssignments] = useState<ForcedAssignment[]>([])

  useEffect(() => {
    const newAssignments = new Map<string, string[]>()
    machines.forEach(machine => {
      newAssignments.set(machine, [])
    })
    setAssignments(newAssignments)
  }, [machines])

  const getUnassignedPlayers = (): string[] => {
    const assignedPlayers = new Set<string>()
    assignments.forEach(players => {
      players.forEach(p => assignedPlayers.add(p))
    })
    return playerNames.filter(name => !assignedPlayers.has(name))
  }

  const handleDrop = (playerName: string, machine: string) => {
    setAssignments(prev => {
      const newAssignments = new Map(prev)
      newAssignments.forEach((players, m) => {
        const filtered = players.filter(p => p !== playerName)
        newAssignments.set(m, filtered)
      })
      const currentPlayers = newAssignments.get(machine) || []
      const maxPlayers = format === '7x7' ? 1 : 2
      if (currentPlayers.length < maxPlayers) {
        newAssignments.set(machine, [...currentPlayers, playerName])
      }
      return newAssignments
    })
    if (optimizationResult) {
      setNeedsRescore(true)
    }
  }

  // Score the current manual assignments via API without re-optimizing
  const [needsRescore, setNeedsRescore] = useState(false)
  const rescoreRef = useRef(0)
  useEffect(() => {
    if (!needsRescore) return
    setNeedsRescore(false)

    const rescoreId = ++rescoreRef.current

    const scoreCurrentAssignments = async () => {
      try {
        // Build assignments list from current state
        const currentAssignments: Array<{ player: string; machine: string }> = []
        assignments.forEach((players, machine) => {
          players.forEach(player => {
            currentAssignments.push({ player, machine })
          })
        })

        if (currentAssignments.length === 0) return

        const response = await fetch('/api/strategy/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            format,
            assignments: currentAssignments,
            seasonStart,
            seasonEnd,
            venue,
            venueWeight,
            userInputWeight,
            confidenceBoost,
            scoreWeights
          })
        })

        if (!response.ok) return
        if (rescoreRef.current !== rescoreId) return // stale response

        const result = await response.json()
        setOptimizationResult(prev => prev ? {
          ...prev,
          total_score: result.total_score,
          win_probability: result.win_probability,
          assignments: result.assignments
        } : null)
      } catch {
        // Silently fail — scores just won't update
      }
    }

    scoreCurrentAssignments()
  }, [needsRescore, assignments]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleReset = () => {
    const newAssignments = new Map<string, string[]>()
    machines.forEach(machine => {
      newAssignments.set(machine, [])
    })
    setAssignments(newAssignments)
    setOptimizationResult(null)
    setError(null)
    allStatsCache.current = {}
    setStatsCacheVersion(v => v + 1)
    setForcedAssignments([])
  }

  // Force a player onto a machine and re-optimize
  const handleForce = async (machine: string, player: string) => {
    const newForced = [...forcedAssignments.filter(fa => fa.machine !== machine && fa.player !== player), { player, machine }]
    setForcedAssignments(newForced)

    // Re-optimize with the new forced assignment
    setIsOptimizing(true)
    setError(null)
    try {
      const response = await fetch('/api/strategy/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          playerNames,
          machines,
          seasonStart,
          seasonEnd,
          venue,
          venueWeight,
          userInputWeight,
          confidenceBoost,
          scoreWeights,
          exclusions,
          mustPlay,
          useCache: false,
          forcedAssignments: newForced,
          opponent,
          opponentPlayers,
          opponentWeight,
          useNashEquilibrium,
          searchMachineSubsets,
          usePerGameNormalized,
          avgMethod,
          trimPct
        })
      })

      if (!response.ok) {
        throw new Error(`Optimization failed: ${response.statusText}`)
      }

      const result: OptimizationResult = await response.json()
      setOptimizationResult(result)

      const newAssignments = new Map<string, string[]>()
      machines.forEach(m => {
        newAssignments.set(m, [])
      })

      result.assignments.forEach((assignment: Assignment | PairAssignment) => {
        if ('player1_id' in assignment) {
          const players = [assignment.player1_id, assignment.player2_id].filter(Boolean) as string[]
          newAssignments.set(assignment.machine_id, players)
        } else {
          newAssignments.set(assignment.machine_id, [assignment.player_id])
        }
      })

      setAssignments(newAssignments)

      if (onOptimize) {
        onOptimize(result)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed')
      console.error('Optimization error:', err)
    } finally {
      setIsOptimizing(false)
    }
  }

  // Remove a forced assignment and re-optimize
  const handleUnforce = async (machine: string, player: string) => {
    const newForced = forcedAssignments.filter(fa => !(fa.machine === machine && fa.player === player))
    setForcedAssignments(newForced)

    // Re-optimize without the forced assignment
    setIsOptimizing(true)
    setError(null)
    try {
      const response = await fetch('/api/strategy/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          playerNames,
          machines,
          seasonStart,
          seasonEnd,
          venue,
          venueWeight,
          userInputWeight,
          confidenceBoost,
          scoreWeights,
          exclusions,
          mustPlay,
          useCache: false,
          forcedAssignments: newForced,
          opponent,
          opponentPlayers,
          opponentWeight,
          useNashEquilibrium,
          searchMachineSubsets,
          usePerGameNormalized,
          avgMethod,
          trimPct
        })
      })

      if (!response.ok) {
        throw new Error(`Optimization failed: ${response.statusText}`)
      }

      const result: OptimizationResult = await response.json()
      setOptimizationResult(result)

      const newAssignments = new Map<string, string[]>()
      machines.forEach(m => {
        newAssignments.set(m, [])
      })

      result.assignments.forEach((assignment: Assignment | PairAssignment) => {
        if ('player1_id' in assignment) {
          const players = [assignment.player1_id, assignment.player2_id].filter(Boolean) as string[]
          newAssignments.set(assignment.machine_id, players)
        } else {
          newAssignments.set(assignment.machine_id, [assignment.player_id])
        }
      })

      setAssignments(newAssignments)

      if (onOptimize) {
        onOptimize(result)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed')
      console.error('Optimization error:', err)
    } finally {
      setIsOptimizing(false)
    }
  }

  const handleOptimize = async () => {
    hasOptimizedOnce.current = true
    lastOptimizedParams.current = currentParamsKey
    setIsOptimizing(true)
    setError(null)
    try {
      const response = await fetch('/api/strategy/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          playerNames,
          machines,
          seasonStart,
          seasonEnd,
          venue,
          venueWeight,
          userInputWeight,
          confidenceBoost,
          scoreWeights,
          exclusions,
          mustPlay,
          useCache: false,
          forcedAssignments,
          opponent,
          opponentPlayers,
          opponentWeight,
          useNashEquilibrium,
          searchMachineSubsets,
          usePerGameNormalized,
          avgMethod,
          trimPct
        })
      })

      if (!response.ok) {
        throw new Error(`Optimization failed: ${response.statusText}`)
      }

      const result: OptimizationResult = await response.json()
      setOptimizationResult(result)

      const newAssignments = new Map<string, string[]>()
      machines.forEach(machine => {
        newAssignments.set(machine, [])
      })

      result.assignments.forEach((assignment: Assignment | PairAssignment) => {
        if ('player1_id' in assignment) {
          const players = [assignment.player1_id, assignment.player2_id].filter(Boolean) as string[]
          newAssignments.set(assignment.machine_id, players)
        } else {
          newAssignments.set(assignment.machine_id, [assignment.player_id])
        }
      })

      setAssignments(newAssignments)

      if (onOptimize) {
        onOptimize(result)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed')
      console.error('Optimization error:', err)
    } finally {
      setIsOptimizing(false)
    }
  }

  const hasOptimizedOnce = useRef(false)
  const lastOptimizedParams = useRef<string | null>(null)

  // Track dirty state for Apply button
  const currentParamsKey = JSON.stringify({ exclusions, userInputWeight, confidenceBoost, venueWeight, scoreWeights })
  const isParamsDirty = hasOptimizedOnce.current && lastOptimizedParams.current !== null && lastOptimizedParams.current !== currentParamsKey

  const unassignedPlayers = getUnassignedPlayers()

  // Persistent cache of all player-machine stats we've ever received
  // Keyed as allStatsCache[player][machine] = PlayerStats
  // This survives drag-drops — stats are only added/updated, never cleared (except on reset)
  const allStatsCache = useRef<Record<string, Record<string, PlayerStats>>>({})
  const [statsCacheVersion, setStatsCacheVersion] = useState(0)

  // Update cache whenever optimizationResult changes
  useEffect(() => {
    if (!optimizationResult) return
    let changed = false
    for (const assignment of optimizationResult.assignments) {
      if ('player1_id' in assignment) {
        // PairAssignment (doubles)
        const pa = assignment as import('@/types/strategy').PairAssignment
        const hasP1Stats = pa.player1_venue_adjusted_avg != null || pa.player1_user_average != null || pa.player1_user_confidence != null
        const hasP2Stats = pa.player2_venue_adjusted_avg != null || pa.player2_user_average != null || pa.player2_user_confidence != null
        if (hasP1Stats) {
          if (!allStatsCache.current[pa.player1_id]) allStatsCache.current[pa.player1_id] = {}
          allStatsCache.current[pa.player1_id][pa.machine_id] = {
            venue_adjusted_avg: pa.player1_venue_adjusted_avg,
            user_average: pa.player1_user_average,
            user_confidence: pa.player1_user_confidence,
          }
          changed = true
        }
        if (hasP2Stats) {
          if (!allStatsCache.current[pa.player2_id]) allStatsCache.current[pa.player2_id] = {}
          allStatsCache.current[pa.player2_id][pa.machine_id] = {
            venue_adjusted_avg: pa.player2_venue_adjusted_avg,
            user_average: pa.player2_user_average,
            user_confidence: pa.player2_user_confidence,
          }
          changed = true
        }
      } else {
        // Singles Assignment
        const a = assignment as import('@/types/strategy').Assignment
        if (a.venue_adjusted_avg == null && a.user_average == null && a.user_confidence == null) continue
        if (!allStatsCache.current[a.player_id]) allStatsCache.current[a.player_id] = {}
        allStatsCache.current[a.player_id][a.machine_id] = {
          venue_adjusted_avg: a.venue_adjusted_avg,
          user_average: a.user_average,
          user_confidence: a.user_confidence,
        }
        changed = true
      }
    }
    if (changed) setStatsCacheVersion(v => v + 1)
  }, [optimizationResult])

  // Build machinePlayerStats from cache + current assignments
  const machinePlayerStats = React.useMemo(() => {
    const result: Record<string, Record<string, PlayerStats>> = {}
    // For each currently assigned player, look up their stats for that machine
    assignments.forEach((players, machine) => {
      for (const player of players) {
        const stats = allStatsCache.current[player]?.[machine]
        if (stats) {
          if (!result[machine]) result[machine] = {}
          result[machine][player] = stats
        }
      }
    })
    return result
  }, [assignments, statsCacheVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build assignment data map for expanded details
  const machineAssignmentData = React.useMemo(() => {
    const result: Record<string, MachineAssignmentData> = {}
    if (!optimizationResult) return result
    for (const assignment of optimizationResult.assignments) {
      if ('player1_id' in assignment) {
        const pa = assignment as import('@/types/strategy').PairAssignment
        result[pa.machine_id] = {
          expected_score: pa.expected_score,
          confidence: undefined,
          player1_venue_adjusted_avg: pa.player1_venue_adjusted_avg,
          player2_venue_adjusted_avg: pa.player2_venue_adjusted_avg,
        }
      } else {
        const a = assignment as import('@/types/strategy').Assignment
        result[a.machine_id] = {
          expected_score: a.expected_score,
          confidence: a.confidence,
        }
      }
    }
    return result
  }, [optimizationResult])

  const machineCount = machines.length
  const gridCols = machineCount <= 4 ? 2 : machineCount <= 9 ? 3 : 4

  // Collect all active exclusions for display
  const hasExclusions = Object.keys(exclusions).some(m => exclusions[m]?.length > 0)

  // Create a Set of forced player names for easy lookup
  const forcedPlayers = new Set(forcedAssignments.map(fa => fa.player))
  const hasForcedAssignments = forcedAssignments.length > 0

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="space-y-3">
        {/* Header with controls */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Machine Assignments ({format})
            </h3>
            <p className="text-xs text-muted-foreground">
              Drag players to machines or use auto-optimize
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-1 text-xs border border-border rounded hover:bg-muted transition-colors text-foreground"
            >
              Reset
            </button>
            {isParamsDirty && (
              <button
                onClick={handleOptimize}
                disabled={isOptimizing}
                className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-muted disabled:text-muted-foreground transition-colors"
              >
                Apply Changes
              </button>
            )}
            <button
              onClick={handleOptimize}
              disabled={isOptimizing}
              className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground transition-colors"
            >
              {isOptimizing ? 'Optimizing...' : 'Optimize'}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-2 bg-destructive/10 border border-destructive/30 rounded text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Active exclusions */}
        {hasExclusions && onRemoveExclusion && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(exclusions).map(([machine, players]) =>
              (players || []).map(player => (
                <div
                  key={`${machine}-${player}`}
                  className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded text-[10px] text-amber-700 dark:text-amber-400"
                >
                  <span>{player} excluded from {machine}</span>
                  <button
                    onClick={() => onRemoveExclusion(machine, player)}
                    className="hover:text-foreground"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Active forced assignments */}
        {hasForcedAssignments && (
          <div className="flex flex-wrap gap-1">
            {forcedAssignments.map(fa => (
              <div
                key={`forced-${fa.machine}-${fa.player}`}
                className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 rounded text-[10px] text-blue-700 dark:text-blue-400"
              >
                <span>🔒 {fa.player} forced on {fa.machine}</span>
                <button
                  onClick={() => handleUnforce(fa.machine, fa.player)}
                  className="hover:text-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Optimization results summary */}
        {optimizationResult && (
          <div className="p-2 bg-primary/10 border border-primary/30 rounded">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground">
              <span><span className="font-medium">Score:</span> {optimizationResult.total_score.toFixed(2)}</span>
              <span><span className="font-medium">Format:</span> {optimizationResult.format}</span>
            </div>
            {optimizationResult.suggestions && optimizationResult.suggestions.length > 0 && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                {optimizationResult.suggestions.join(' | ')}
              </div>
            )}
          </div>
        )}

        {/* Available players (compact inline) */}
        <div>
          <h4 className="font-medium mb-1 text-xs text-foreground">
            Available ({unassignedPlayers.length})
          </h4>
          <div className="flex flex-wrap gap-1">
            {unassignedPlayers.map((player, idx) => (
              <DraggablePlayer key={player} playerName={player} index={idx} />
            ))}
            {unassignedPlayers.length === 0 && (
              <span className="text-xs text-muted-foreground">All players assigned</span>
            )}
          </div>
        </div>

        {/* Machine assignment grid */}
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
        >
          {machines.map(machine => (
            <MachineSlot
              key={machine}
              machine={machine}
              assignedPlayers={assignments.get(machine) || []}
              playerStatsMap={machinePlayerStats[machine]}
              assignmentData={machineAssignmentData[machine]}
              assumedOpponents={optimizationResult?.assumedOpponents?.[machine]}
              onDrop={handleDrop}
              onExclude={onAddExclusion}
              onExcludeMachine={onExcludeMachine}
              format={format}
              forcedPlayers={forcedPlayers}
              onForce={handleForce}
              onUnforce={handleUnforce}
            />
          ))}
        </div>
      </div>
    </DndProvider>
  )
}

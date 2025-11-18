'use client'

import React, { useState, useEffect } from 'react'
import { DndProvider, useDrag, useDrop } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import type { OptimizationResult, Assignment, PairAssignment } from '@/types/strategy'

interface MachinePickerProps {
  format: '7x7' | '4x2'
  playerNames: string[]
  machines: string[]
  seasonStart?: number
  seasonEnd?: number
  onOptimize?: (result: OptimizationResult) => void
}

interface DragItem {
  type: string
  playerName: string
  index: number
}

/**
 * Draggable player component
 */
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
        px-3 py-2 mb-2 bg-blue-100 border border-blue-300 rounded cursor-move
        hover:bg-blue-200 transition-colors
        ${isDragging ? 'opacity-50' : 'opacity-100'}
      `}
    >
      <div className="text-sm font-medium text-blue-900">{playerName}</div>
    </div>
  )
}

/**
 * Droppable machine slot component
 */
function MachineSlot({
  machine,
  assignedPlayers,
  onDrop,
  format
}: {
  machine: string
  assignedPlayers: string[]
  onDrop: (playerName: string, machine: string) => void
  format: '7x7' | '4x2'
}) {
  const maxPlayers = format === '7x7' ? 1 : 2

  const [{ isOver, canDrop }, drop] = useDrop({
    accept: 'PLAYER',
    canDrop: () => assignedPlayers.length < maxPlayers,
    drop: (item: DragItem) => {
      onDrop(item.playerName, machine)
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop()
    })
  })

  const isFull = assignedPlayers.length >= maxPlayers
  const showDropZone = canDrop && isOver

  return (
    <div
      ref={drop as any}
      className={`
        p-3 border-2 rounded min-h-[100px]
        ${showDropZone ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-white'}
        ${isFull ? 'bg-gray-50' : ''}
        transition-colors
      `}
    >
      <div className="font-semibold text-sm mb-2 text-gray-700 truncate" title={machine}>
        {machine}
      </div>

      <div className="space-y-1">
        {assignedPlayers.map((player, idx) => (
          <div
            key={idx}
            className="px-2 py-1 bg-green-100 border border-green-300 rounded text-xs"
          >
            {player}
          </div>
        ))}

        {assignedPlayers.length < maxPlayers && (
          <div className="px-2 py-1 border border-dashed border-gray-300 rounded text-xs text-gray-400 text-center">
            {canDrop ? 'Drop here' : 'Empty'}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Main MachinePicker component with drag-and-drop functionality
 */
export function MachinePicker({
  format,
  playerNames,
  machines,
  seasonStart = 20,
  seasonEnd = 22,
  onOptimize
}: MachinePickerProps) {
  const [assignments, setAssignments] = useState<Map<string, string[]>>(new Map())
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Initialize empty assignments
  useEffect(() => {
    const newAssignments = new Map<string, string[]>()
    machines.forEach(machine => {
      newAssignments.set(machine, [])
    })
    setAssignments(newAssignments)
  }, [machines])

  // Get unassigned players
  const getUnassignedPlayers = (): string[] => {
    const assignedPlayers = new Set<string>()
    assignments.forEach(players => {
      players.forEach(p => assignedPlayers.add(p))
    })
    return playerNames.filter(name => !assignedPlayers.has(name))
  }

  // Handle player drop
  const handleDrop = (playerName: string, machine: string) => {
    setAssignments(prev => {
      const newAssignments = new Map(prev)

      // Remove player from any existing assignment
      newAssignments.forEach((players, m) => {
        const filtered = players.filter(p => p !== playerName)
        newAssignments.set(m, filtered)
      })

      // Add to new machine
      const currentPlayers = newAssignments.get(machine) || []
      const maxPlayers = format === '7x7' ? 1 : 2

      if (currentPlayers.length < maxPlayers) {
        newAssignments.set(machine, [...currentPlayers, playerName])
      }

      return newAssignments
    })
  }

  // Reset assignments
  const handleReset = () => {
    const newAssignments = new Map<string, string[]>()
    machines.forEach(machine => {
      newAssignments.set(machine, [])
    })
    setAssignments(newAssignments)
    setOptimizationResult(null)
    setError(null)
  }

  // Run optimization
  const handleOptimize = async () => {
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
          useCache: true
        })
      })

      if (!response.ok) {
        throw new Error(`Optimization failed: ${response.statusText}`)
      }

      const result: OptimizationResult = await response.json()
      setOptimizationResult(result)

      // Apply optimized assignments
      const newAssignments = new Map<string, string[]>()
      machines.forEach(machine => {
        newAssignments.set(machine, [])
      })

      result.assignments.forEach((assignment: Assignment | PairAssignment) => {
        if ('player1_id' in assignment) {
          // 4x2 format
          const players = [assignment.player1_id, assignment.player2_id]
          newAssignments.set(assignment.machine_id, players)
        } else {
          // 7x7 format
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

  const unassignedPlayers = getUnassignedPlayers()

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="space-y-4">
        {/* Header with controls */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              Machine Assignments ({format})
            </h3>
            <p className="text-sm text-gray-600">
              Drag players to machines or use auto-optimize
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={handleOptimize}
              disabled={isOptimizing}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
            >
              {isOptimizing ? 'Optimizing...' : 'Auto-Optimize'}
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Optimization results */}
        {optimizationResult && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded">
            <div className="grid grid-cols-3 gap-4 text-sm mb-2">
              <div>
                <span className="font-medium">Total Score:</span>{' '}
                {optimizationResult.total_score.toFixed(2)}
              </div>
              <div>
                <span className="font-medium">Win Probability:</span>{' '}
                {(optimizationResult.win_probability * 100).toFixed(1)}%
              </div>
              <div>
                <span className="font-medium">Format:</span> {optimizationResult.format}
              </div>
            </div>

            {optimizationResult.suggestions && optimizationResult.suggestions.length > 0 && (
              <div className="mt-2">
                <div className="font-medium text-sm mb-1">Suggestions:</div>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {optimizationResult.suggestions.map((suggestion, idx) => (
                    <li key={idx} className="text-gray-700">{suggestion}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">
          {/* Unassigned players */}
          <div>
            <h4 className="font-semibold mb-3 text-sm text-gray-700">
              Available Players ({unassignedPlayers.length})
            </h4>
            <div className="border border-gray-300 rounded p-3 bg-gray-50 min-h-[200px]">
              {unassignedPlayers.map((player, idx) => (
                <DraggablePlayer key={player} playerName={player} index={idx} />
              ))}
              {unassignedPlayers.length === 0 && (
                <div className="text-sm text-gray-400 text-center py-8">
                  All players assigned
                </div>
              )}
            </div>
          </div>

          {/* Machine assignments */}
          <div>
            <h4 className="font-semibold mb-3 text-sm text-gray-700">
              Machine Assignments ({machines.length})
            </h4>
            <div className="grid grid-cols-1 gap-3">
              {machines.map(machine => (
                <MachineSlot
                  key={machine}
                  machine={machine}
                  assignedPlayers={assignments.get(machine) || []}
                  onDrop={handleDrop}
                  format={format}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </DndProvider>
  )
}

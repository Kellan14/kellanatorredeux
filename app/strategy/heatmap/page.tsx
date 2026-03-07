'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PerformanceMatrix } from '@/components/strategy/PerformanceMatrix'
import type { PlayerMachineStats } from '@/types/strategy'
import { Loader2 } from 'lucide-react'

function HeatmapContent() {
  const searchParams = useSearchParams()
  const venue = searchParams.get('venue') || ''
  const players = searchParams.get('players') || ''
  const machines = searchParams.get('machines') || ''
  const seasonStart = searchParams.get('seasonStart') || '20'
  const seasonEnd = searchParams.get('seasonEnd') || '22'
  const venueWeight = searchParams.get('venueWeight') || '50'
  const userInputWeight = searchParams.get('userInputWeight') || '0'

  const [matrixData, setMatrixData] = useState<{
    playerNames: string[]
    machines: string[]
    statsMap: Map<string, Map<string, PlayerMachineStats>>
  } | null>(null)
  const [loading, setLoading] = useState(true)

  // Request fullscreen and landscape on mount
  useEffect(() => {
    const requestFullscreen = async () => {
      try {
        await document.documentElement.requestFullscreen()
      } catch {
        // Fullscreen may be blocked by browser
      }
      try {
        await (screen.orientation as any).lock('landscape')
      } catch {
        // Orientation lock may not be supported
      }
    }
    requestFullscreen()

    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    if (!players || !machines) return

    const fetchData = async () => {
      setLoading(true)
      try {
        const vw = parseInt(venueWeight) / 100
        const uiw = parseInt(userInputWeight) / 100
        const venueParam = venue ? `&venue=${encodeURIComponent(venue)}&venueWeight=${vw}` : ''
        const userInputParam = uiw > 0 ? `&userInputWeight=${uiw}` : ''

        const response = await fetch(
          `/api/strategy/matrix?` +
          `playerNames=${encodeURIComponent(players)}` +
          `&machines=${encodeURIComponent(machines)}` +
          `&seasonStart=${seasonStart}` +
          `&seasonEnd=${seasonEnd}` +
          venueParam +
          userInputParam
        )

        if (response.ok) {
          const data = await response.json()
          const statsMap = new Map<string, Map<string, PlayerMachineStats>>()

          for (const [playerName, machineStats] of Object.entries(data.statsMap || {})) {
            const machineMap = new Map<string, PlayerMachineStats>()
            for (const [machineName, stats] of Object.entries(machineStats as Record<string, PlayerMachineStats>)) {
              machineMap.set(machineName, stats)
            }
            statsMap.set(playerName, machineMap)
          }

          setMatrixData({
            playerNames: data.playerNames,
            machines: data.machines,
            statsMap
          })
        }
      } catch (error) {
        console.error('Error loading heatmap data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [players, machines, seasonStart, seasonEnd, venue, venueWeight, userInputWeight])

  return (
    <div className="min-h-screen bg-gray-900 p-2 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-sm font-semibold text-gray-100">
          Performance Heatmap {venue && `— ${venue}`}
        </h1>
        <button
          onClick={() => window.close()}
          className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 border border-gray-600 rounded"
        >
          Close
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400 mr-2" />
          <span className="text-gray-400">Loading performance matrix...</span>
        </div>
      )}

      {!loading && matrixData && (
        <PerformanceMatrix
          playerNames={matrixData.playerNames}
          machines={matrixData.machines}
          statsMap={matrixData.statsMap}
        />
      )}

      {!loading && !matrixData && (
        <div className="flex items-center justify-center flex-1">
          <p className="text-gray-400">No performance data available.</p>
        </div>
      )}
    </div>
  )
}

export default function HeatmapPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400 mr-2" />
        <span className="text-gray-400">Loading...</span>
      </div>
    }>
      <HeatmapContent />
    </Suspense>
  )
}

'use client'

import React from 'react'
import type { PlayerMachineStats } from '@/types/strategy'

interface PerformanceMatrixProps {
  playerNames: string[]
  machines: string[]
  statsMap: Map<string, Map<string, PlayerMachineStats>>
  onCellClick?: (playerName: string, machine: string) => void
}

/**
 * Displays a heatmap of player performance on different machines
 */
export function PerformanceMatrix({
  playerNames,
  machines,
  statsMap,
  onCellClick
}: PerformanceMatrixProps) {
  const getPerformanceColor = (stats: PlayerMachineStats | undefined): string => {
    if (!stats || stats.games_played === 0) {
      return 'bg-gray-700'
    }

    const score = stats.win_rate

    if (score >= 0.7) return 'bg-green-500'
    if (score >= 0.6) return 'bg-green-400'
    if (score >= 0.5) return 'bg-yellow-400'
    if (score >= 0.4) return 'bg-orange-400'
    return 'bg-red-400'
  }

  const getConfidenceOpacity = (stats: PlayerMachineStats | undefined): string => {
    if (!stats) return 'opacity-20'

    if (stats.games_played >= 10) return 'opacity-100'
    if (stats.games_played >= 5) return 'opacity-75'
    if (stats.games_played >= 3) return 'opacity-50'
    return 'opacity-30'
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse">
        <thead>
          <tr>
            <th className="border border-gray-600 bg-gray-800 p-2 text-left text-sm font-medium text-gray-100">
              Player
            </th>
            {machines.map((machine) => (
              <th
                key={machine}
                className="border border-gray-600 bg-gray-800 p-2 text-center text-sm font-medium text-gray-100"
              >
                <div className="max-w-[120px] truncate" title={machine}>
                  {machine}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {playerNames.map((playerName) => {
            const playerStats = statsMap.get(playerName)

            return (
              <tr key={playerName}>
                <td className="border border-gray-600 bg-gray-800 p-2 text-sm font-medium text-gray-100">
                  <div className="max-w-[150px] truncate" title={playerName}>
                    {playerName}
                  </div>
                </td>
                {machines.map((machine) => {
                  const stats = playerStats?.get(machine)
                  const colorClass = getPerformanceColor(stats)
                  const opacityClass = getConfidenceOpacity(stats)

                  return (
                    <td
                      key={`${playerName}-${machine}`}
                      className={`border border-gray-600 p-1 cursor-pointer hover:ring-2 hover:ring-blue-500 ${colorClass} ${opacityClass}`}
                      onClick={() => onCellClick?.(playerName, machine)}
                      title={
                        stats
                          ? `Win Rate: ${(stats.win_rate * 100).toFixed(1)}%\nGames: ${stats.games_played}\nAvg Score: ${stats.avg_score.toLocaleString()}\nRecent Form: ${(stats.recent_form * 100).toFixed(1)}%`
                          : 'No data'
                      }
                    >
                      <div className="flex flex-col items-center justify-center min-h-[50px] text-white text-xs">
                        {stats && stats.games_played > 0 ? (
                          <>
                            <div className="font-bold">
                              {(stats.win_rate * 100).toFixed(0)}%
                            </div>
                            <div className="text-[10px] opacity-90">
                              {stats.games_played}g
                            </div>
                            {stats.streak_type && stats.streak_count >= 3 && (
                              <div className="text-[10px] font-bold">
                                {stats.streak_type === 'win' ? '🔥' : '❄️'}
                                {stats.streak_count}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-gray-400">-</div>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="mt-4 flex items-center gap-6 text-xs text-gray-300">
        <div className="font-semibold">Legend:</div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-green-500"></div>
          <span>70%+</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-green-400"></div>
          <span>60-70%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-yellow-400"></div>
          <span>50-60%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-orange-400"></div>
          <span>40-50%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-red-400"></div>
          <span>&lt;40%</span>
        </div>
        <div className="ml-4 text-gray-400">
          Opacity indicates confidence (more games = more opaque)
        </div>
      </div>
    </div>
  )
}

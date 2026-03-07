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
 * Displays a heatmap of player performance on different machines.
 * Scales to fit within the viewport width.
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

  // Use compact layout when there are many columns
  const isCompact = machines.length > 8

  return (
    <div className="w-full overflow-x-auto">
      <table className="border-collapse" style={{ minWidth: `${(isCompact ? 100 : 120) + machines.length * 56}px` }}>
        <thead>
          <tr>
            <th
              className="border border-gray-600 bg-gray-800 p-1 text-left text-xs font-medium text-gray-100 sticky left-0 z-10"
              style={{ width: isCompact ? '100px' : '120px', minWidth: isCompact ? '100px' : '120px' }}
            >
              Player
            </th>
            {machines.map((machine) => (
              <th
                key={machine}
                className="border border-gray-600 bg-gray-800 p-1 text-center font-medium text-gray-100 align-bottom"
                style={{ minWidth: '56px' }}
              >
                <div
                  className="text-[10px] leading-tight"
                  style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)', minHeight: '60px' }}
                  title={machine}
                >
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
                <td className="border border-gray-600 bg-gray-800 p-1 text-xs font-medium text-gray-100 sticky left-0 z-10">
                  <div className="truncate" title={playerName}>
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
                      className={`border border-gray-600 p-0 cursor-pointer hover:ring-2 hover:ring-blue-500 ${colorClass} ${opacityClass}`}
                      onClick={() => onCellClick?.(playerName, machine)}
                      title={
                        stats
                          ? `Win Rate: ${(stats.win_rate * 100).toFixed(1)}%\nGames: ${stats.games_played}\nAvg Score: ${stats.avg_score.toLocaleString()}\nRecent Form: ${(stats.recent_form * 100).toFixed(1)}%`
                          : 'No data'
                      }
                    >
                      <div className="flex flex-col items-center justify-center min-h-[36px] text-white">
                        {stats && stats.games_played > 0 ? (
                          <>
                            <div className="font-bold text-[11px] leading-tight">
                              {(stats.win_rate * 100).toFixed(0)}%
                            </div>
                            <div className="text-[9px] opacity-90 leading-tight">
                              {stats.games_played}g
                            </div>
                            {stats.streak_type && stats.streak_count >= 3 && (
                              <div className="text-[9px] font-bold leading-tight">
                                {stats.streak_type === 'win' ? '🔥' : '❄️'}
                                {stats.streak_count}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-gray-400 text-[11px]">-</div>
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

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-300">
        <div className="font-semibold">Legend:</div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-500"></div>
          <span>70%+</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-400"></div>
          <span>60-70%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-yellow-400"></div>
          <span>50-60%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-orange-400"></div>
          <span>40-50%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-red-400"></div>
          <span>&lt;40%</span>
        </div>
        <div className="text-gray-400">
          Opacity = confidence (more games = more opaque)
        </div>
      </div>
    </div>
  )
}

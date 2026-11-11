export type DoublesExclusions = Record<string, string[]>
export type DoublesLineup = {
  score: number
  picks: { machine: string; players: string[] }[]
}

function exclusionKey(exclusions: DoublesExclusions) {
  return JSON.stringify(Object.keys(exclusions).sort().map(machine => [
    machine, Array.from(new Set(exclusions[machine])).sort(),
  ]))
}

function lineupKey(lineup: DoublesLineup) {
  return JSON.stringify(lineup.picks.map(p => JSON.stringify([p.machine, [...p.players].sort()])).sort())
}

// Branch by ruling out one player-machine assignment from the previous result.
// An iteration is an optimizer call, not a guarantee of a new feasible lineup.
export async function rankDoublesRuns(options: {
  iterations: number
  machines: number
  mustPlay: string[]
  exclusions: DoublesExclusions
  signal: AbortSignal
  solve: (exclusions: DoublesExclusions, signal: AbortSignal) => Promise<DoublesLineup | null>
  onProgress?: (completed: number) => void
}) {
  const queue = [{ exclusions: options.exclusions, parentScore: Infinity }]
  const seen = new Set([exclusionKey(options.exclusions)])
  const results = new Map<string, DoublesLineup>()
  let completed = 0
  while (completed < options.iterations && queue.length && !options.signal.aborted) {
    const { exclusions } = queue.shift()!
    let lineup: DoublesLineup | null
    try {
      lineup = await options.solve(exclusions, options.signal)
    } catch (error) {
      if (options.signal.aborted) break
      throw error
    }
    if (options.signal.aborted) break
    completed++
    options.onProgress?.(completed)
    if (!lineup || !Number.isFinite(lineup.score) || lineup.picks.length !== options.machines) continue
    const players = lineup.picks.flatMap(p => p.players)
    if (lineup.picks.some(p => !p.machine || p.players.length !== 2 || p.players.some(player =>
      !player || exclusions[p.machine]?.includes(player))) ||
      new Set(players).size !== options.machines * 2 ||
      new Set(lineup.picks.map(p => p.machine)).size !== options.machines ||
      options.mustPlay.some(player => !players.includes(player))) continue

    const key = lineupKey(lineup)
    if (!results.has(key) || results.get(key)!.score < lineup.score) results.set(key, lineup)
    if (completed >= options.iterations) break
    for (const { machine, players: pair } of lineup.picks) {
      for (const player of pair) {
        const next = { ...exclusions, [machine]: [...(exclusions[machine] || []), player] }
        const branch = exclusionKey(next)
        if (seen.has(branch)) continue
        seen.add(branch)
        queue.push({ exclusions: next, parentScore: lineup.score })
      }
    }
    // Try alternatives to the strongest known lineups first. Prefer a
    // shallower branch on a tie (stable sort keeps the insertion order).
    queue.sort((a, b) => b.parentScore - a.parentScore)
  }
  return { completed, lineups: Array.from(results.values()).sort((a, b) => b.score - a.score) }
}

import { hungarianAlgorithm } from './hungarian'
import type { buildAssignmentEstimator } from './assignment-estimator'

export type AssignmentEvidence = ReturnType<ReturnType<typeof buildAssignmentEstimator>['estimate']>
export type AssignmentPreviewLineup = {
  score: number
  picks: { machine: string; players: string[]; evidence: AssignmentEvidence[] }[]
  bench: string[]
  alternatives: { player: string; machine: string; to: string | null; scoreDelta: number;
    changes: { player: string; to: string | null }[] }[]
}

export type PreviewOptions = {
  players: string[]
  machines: string[]
  mustPlay: string[]
  exclusions: Record<string, string[]>
  forced: { player: string; machine: string }[]
  requiredMachines?: string[]
  minGames: number
  limit: number
  method: 'greedy' | 'hungarian'
  estimate: (player: string, machine: string) => AssignmentEvidence
  signal?: AbortSignal
}

const blocked = -1e6

// A completion check prevents the greedy solver from spending a slot needed
// by a must-play/forced player. Bench slots are part of the matching.
function canComplete(matrix: number[][], fixed: number[], used: boolean[]) {
  const owners = Array<number>(matrix.length).fill(-1)
  function visit(row: number, seen: boolean[]): boolean {
    return matrix[row].some((score, col) => {
      if (score === blocked || used[col] || seen[col]) return false
      seen[col] = true
      if (owners[col] !== -1 && !visit(owners[col], seen)) return false
      owners[col] = row
      return true
    })
  }
  return fixed.every((col, row) => col >= 0 || visit(row, []))
}

function greedy(matrix: number[][]) {
  const assignments = Array<number>(matrix.length).fill(-1)
  const used: boolean[] = []
  if (!canComplete(matrix, assignments, used)) return null
  const edges = matrix.flatMap((row, i) => row.flatMap((score, j) => score === blocked ? [] : [{ i, j, score }]))
    .sort((a,b) => b.score - a.score || a.j - b.j || a.i - b.i)
  let assigned = 0
  for (const {i,j} of edges) {
    if (assignments[i] >= 0 || used[j]) continue
    assignments[i] = j; used[j] = true
    if (canComplete(matrix, assignments, used)) {
      if (++assigned === matrix.length) break
    } else {
      assignments[i] = -1; used[j] = false
    }
  }
  return assignments
}

export async function solveAssignmentPreview(options: PreviewOptions) {
  options.signal?.throwIfAborted()
  const { players, machines, mustPlay, exclusions, forced, estimate } = options
  const required = new Set([...mustPlay, ...forced.map(f => f.player)])
  const forcedByPlayer = new Map(forced.map(f => [f.player, f.machine]))
  const forcedMachines = new Set([...forced.map(f => f.machine), ...(options.requiredMachines ?? [])])
  const values = machines.map(machine => players.map(player => estimate(player, machine)))
  const costs = machines.map((machine, m) => players.map((player, p) => {
    const f = forcedByPlayer.get(player)
    const e = values[m][p]
    return (f && f !== machine) || exclusions[machine]?.includes(player) || e.machineGames < options.minGames
      ? blocked : e.score ?? blocked
  }))
  const bench = players.map(p => Array(Math.max(0, players.length - 8)).fill(required.has(p) ? blocked : 0))
  type Solution = { score: number; subset: number[]; slots: number[] }
  function solve(subset: number[], forbid?: [number, number]): Solution | null {
    const matrix = players.map((_, p) => [
      ...subset.flatMap(m => {
        const score = forbid?.[0] === p && forbid[1] === m ? blocked : costs[m][p]
        return [score, score]
      }), ...bench[p],
    ])
    const slots = options.method === 'greedy' ? greedy(matrix) : hungarianAlgorithm(matrix).assignments
    if (!slots || slots.some((slot, p) => slot < 0 || matrix[p][slot] === blocked)) return null
    return { score: slots.reduce((s, slot, p) => s + matrix[p][slot], 0), subset, slots }
  }
  const best: { solution: Solution; key: string }[] = []
  const seen = new Set<string>()
  function retain(solution: Solution | null) {
    if (!solution) return
    if (best.length >= options.limit && solution.score < best[best.length - 1].solution.score) return
    const key = JSON.stringify(solution.subset.map((m, i) =>
      [m, solution.slots.flatMap((slot, p) => slot < 8 && Math.floor(slot/2) === i ? [p] : [])]))
    if (seen.has(key)) return
    seen.add(key)
    best.push({ solution, key })
    best.sort((a,b) => b.solution.score - a.solution.score || a.key.localeCompare(b.key))
    if (best.length > options.limit) seen.delete(best.pop()!.key)
  }
  let examined = 0
  for (let a = 0; a < machines.length - 3; a++) for (let b = a+1; b < machines.length - 2; b++)
    for (let c = b+1; c < machines.length - 1; c++) for (let d = c+1; d < machines.length; d++) {
      if (++examined % 128 === 0) {
        // Let request cancellation propagate during a large venue search.
        await new Promise<void>(resolve => setImmediate(resolve))
        options.signal?.throwIfAborted()
      }
      const subset = [a,b,c,d]
      if (subset.filter(m => forcedMachines.has(machines[m])).length !== forcedMachines.size) continue
      const result = solve(subset)
      retain(result)
      // Explore nearby pairings as well as different machine sets. A single
      // excluded edge removes both slots on that machine.
      if (result && best.some(b => b.solution === result) && options.limit > 1) {
        result.slots.forEach((slot, p) => {
          if (slot < 8 && !forcedByPlayer.has(players[p])) retain(solve(subset, [p, subset[Math.floor(slot/2)]]))
        })
      }
    }
  const lineups: AssignmentPreviewLineup[] = best.map(({ solution }) => {
    const { subset, slots, score } = solution
    const alternatives: AssignmentPreviewLineup['alternatives'] = []
    const picks = subset.map((m, i) => {
      const assigned = slots.flatMap((slot, p) => slot < 8 && Math.floor(slot/2) === i ? [p] : [])
      for (const p of assigned) {
        if (forcedByPlayer.has(players[p])) continue
        const other = solve(subset, [p,m])
        if (other) {
          const machineForSlot = (slot: number) => slot < 8 ? machines[subset[Math.floor(slot/2)]] : null
          alternatives.push({ player: players[p], machine: machines[m], to: machineForSlot(other.slots[p]),
            scoreDelta: other.score - score,
            changes: other.slots.flatMap((slot, i) => i !== p && machineForSlot(slots[i]) !== machineForSlot(slot)
              ? [{ player: players[i], to: machineForSlot(slot) }] : []) })
        }
      }
      return { machine: machines[m], players: assigned.map(p => players[p]), evidence: assigned.map(p => values[m][p]) }
    })
    return { score, picks, bench: players.filter((_, p) => slots[p] >= 8), alternatives }
  })
  return { lineups, examined }
}

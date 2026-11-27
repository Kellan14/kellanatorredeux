export type LeastUniqueCandidate = { machine: string; players: string[] }
export type LeastUniqueSet = {
  machines: (LeastUniqueCandidate & { playerCount: number; addedPlayers: number })[]
  totalUniquePlayers: number
  allPlayers: string[]
}
export type LeastUniqueResult = {
  sets?: LeastUniqueSet[]
  candidateMachines?: LeastUniqueCandidate[]
  rosterPlayers?: string[]
}

const key = (machine: string) => machine.trim().toLowerCase()

export function summarizeLeastUniqueSet(machines: LeastUniqueCandidate[]): LeastUniqueSet {
  const all = new Set<string>()
  const summary = machines.map(({ machine, players }) => {
    const unique = Array.from(new Set(players))
    const before = all.size
    unique.forEach(player => all.add(player))
    return { machine, players: unique, playerCount: unique.length, addedPlayers: all.size - before }
  })
  return { machines: summary, allPlayers: Array.from(all), totalUniquePlayers: all.size }
}

export function leastUniqueReplacements(current: LeastUniqueSet, outgoing: string, data: LeastUniqueResult) {
  const from = key(outgoing)
  const selected = new Set(current.machines.map(m => key(m.machine)))
  if (!selected.has(from)) return []
  // Also support older responses that only return the generated options.
  const candidates = data.candidateMachines ?? data.sets?.flatMap(set => set.machines) ?? []
  const seen = new Set(selected)
  const options = []
  for (const candidate of candidates) {
    const id = key(candidate.machine)
    if (seen.has(id)) continue
    seen.add(id)
    const set = summarizeLeastUniqueSet(current.machines.map(m => key(m.machine) === from ? candidate : m))
    options.push({ machine: candidate.machine, playerCount: new Set(candidate.players).size, set })
  }
  return options.sort((a, b) => a.set.totalUniquePlayers - b.set.totalUniquePlayers ||
    a.playerCount - b.playerCount || a.machine.localeCompare(b.machine))
}

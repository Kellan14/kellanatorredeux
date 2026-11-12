import { NextResponse } from 'next/server'
import { fetchAllRecords, supabase } from '../supabase'
import { getScoreLimits, isScoreValid } from '../score-limits'
import { buildAssignmentEstimator } from './assignment-estimator'
import { leagueNormalizationScores } from './normalization'
import { solveAssignmentPreview, type PreviewOptions } from './assignment-preview'

export function assignmentPreviewEnabled() {
  return process.env.STRATEGY_ASSIGNMENT_PREVIEW === 'true'
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const name = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 150
const names = (value: unknown): value is string[] => Array.isArray(value) && value.every(name)
const key = (value: string) => value.toLowerCase()
const columns = ['id', 'machine', 'venue', 'round_number', 'home_points', 'away_points',
  ...[1, 2, 3, 4].flatMap(i => [`player_${i}_name`, `player_${i}_score`])].join(',')

export async function handleAssignmentPreview(body: Record<string, unknown>, method: PreviewOptions['method'], signal: AbortSignal) {
  if (!assignmentPreviewEnabled()) return fail('Automatic scoring preview is disabled.', 403)
  const expectedFormat = method === 'greedy' ? 'doubles' : '4x2'
  if (body.format !== expectedFormat || (body.numMachines !== undefined && body.numMachines !== 4))
    return fail('Automatic scoring currently supports four-machine doubles rounds only.')
  const players = method === 'greedy' ? body.availablePlayers : body.playerNames
  const { machines, seasonStart, seasonEnd, venue, mustPlay = [], forcedAssignments = [],
    exclusions: rawExclusions = {}, minMachineGames = 0, lineupLimit = 5 } = body
  if (!names(players) || players.length < 8 || players.length > 12 || new Set(players.map(key)).size !== players.length)
    return fail('Choose 8–12 distinct available players.')
  if (!names(machines) || machines.length < 4 || machines.length > 32 || new Set(machines.map(key)).size !== machines.length)
    return fail('Choose 4–32 distinct machine keys.')
  if (!name(venue) || typeof seasonStart !== 'number' || typeof seasonEnd !== 'number' ||
    !Number.isInteger(seasonStart) || !Number.isInteger(seasonEnd) || seasonStart < 1 || seasonEnd > 100 ||
    seasonEnd < seasonStart)
    return fail('Choose a venue and a valid season range.')
  if (seasonEnd - seasonStart >= 8) return fail('Choose no more than eight seasons for the automatic scoring preview.')
  if (typeof lineupLimit !== 'number' || !Number.isInteger(lineupLimit) || lineupLimit < 1 || lineupLimit > 20 ||
    typeof minMachineGames !== 'number' || !Number.isInteger(minMachineGames) || minMachineGames < 0 || minMachineGames > 100)
    return fail('Choose 1–20 lineups and a minimum history of 0–100 games.')
  if (!names(mustPlay) || mustPlay.some(p => !players.includes(p))) return fail('Every must-play player must be available.')
  if (!rawExclusions || typeof rawExclusions !== 'object' || Array.isArray(rawExclusions))
    return fail('Invalid player-machine exclusions.')
  const machineByKey = new Map(machines.map(m => [key(m), m]))
  const exclusions: Record<string, string[]> = Object.create(null)
  for (const [m, excluded] of Object.entries(rawExclusions)) {
    if (!names(excluded)) return fail('Invalid player-machine exclusions.')
    const machine = machineByKey.get(key(m))
    if (machine) exclusions[machine] = [...(exclusions[machine] || []), ...excluded]
  }
  if (!Array.isArray(forcedAssignments) || forcedAssignments.length > 8) return fail('Invalid forced assignments.')
  const forced: PreviewOptions['forced'] = []
  for (const assignment of forcedAssignments) {
    if (!name(assignment?.player) || !name(assignment?.machine)) return fail('Invalid forced assignment.')
    const machine = machineByKey.get(key(assignment.machine))
    if (!machine || !players.includes(assignment.player)) return fail('Forced assignments need an available player and machine.')
    if (forced.some(f => f.player === assignment.player) || exclusions[machine]?.includes(assignment.player))
      return fail('A forced assignment is duplicated or conflicts with an exclusion.')
    if (forced.filter(f => f.machine === machine).length >= 2) return fail('A machine has more than two forced players.')
    forced.push({ player: assignment.player, machine })
  }
  if (new Set([...mustPlay, ...forced.map(f => f.player)]).size > 8 || new Set(forced.map(f => f.machine)).size > 4)
    return fail('The must-play and forced assignments exceed the available doubles slots.')

  signal.throwIfAborted()
  const [games, limits] = await Promise.all([
    fetchAllRecords(() => supabase.from('games').select(columns)
      .gte('season', seasonStart).lte('season', seasonEnd).abortSignal(signal)),
    getScoreLimits(),
  ])
  signal.throwIfAborted()
  const records = leagueNormalizationScores(games, (m, s) => isScoreValid(m, s, limits))
  const estimator = buildAssignmentEstimator(records)
  const estimate = (p: string, m: string) => estimator.estimate(p, m, venue)
  if (estimate(players[0], machines[0]).score === null) return fail('No usable league score history in this season range.', 422)
  const result = await solveAssignmentPreview({ players, machines, mustPlay, exclusions, forced,
    minGames: minMachineGames, limit: lineupLimit, method, estimate, signal })
  if (!result.lineups.length) return fail('No complete lineup satisfies the constraints. Check must-play players, exclusions, forced assignments, and minimum history.', 422)
  return NextResponse.json({ assignmentPreview: {
    ...result, method, seasonStart, seasonEnd, modelVersion: estimator.version, minMachineGames,
  } })
}

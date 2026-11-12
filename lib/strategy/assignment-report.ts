import type { AssignmentPreviewLineup } from './assignment-preview'

export type AssignmentPreview = {
  lineups: AssignmentPreviewLineup[]
  examined: number
  modelVersion: string
  seasonStart: number
  seasonEnd: number
  minMachineGames: number
}

export function automaticDoublesReport(preview: AssignmentPreview, displayMachine: (key: string) => string): string[] {
  const lineup = preview.lineups[0]
  if (!lineup) return ['Automatic doubles: no complete lineup.']
  return [
    `Automatic · ${preview.modelVersion} · seasons ${preview.seasonStart}–${preview.seasonEnd}`,
    `Model score: ${lineup.score.toFixed(3)} (not projected match points). Minimum machine history: ${preview.minMachineGames}.`,
    'Own-team history only; manual weights, opponent adjustments and pair bonuses are not used.',
    ...lineup.picks.flatMap((pick, i) => [
      `${i + 1}. ${displayMachine(pick.machine)}: ${pick.players.join(' & ')}`,
      ...pick.players.map((p, j) => {
        const e = pick.evidence[j]
        return `   ${p}: ${e.machineGames ? `${e.machineGames} prior scores (${e.venueGames} here), ${Math.round(e.machineWeight * 100)}% machine-history weight`
          : e.evidence === 'overall' ? 'no machine history; overall player strength' : 'no player history; league baseline'}`
      }),
    ]),
    ...(lineup.bench.length ? [`Sits this round: ${lineup.bench.join(', ')}. Check participation needs from earlier rounds.`] : []),
  ]
}

import assert from 'node:assert/strict'
import { automaticDoublesReport } from '../lib/strategy/assignment-report.ts'

const preview = {
  modelVersion: 'doubles-log-normalized-v1', seasonStart: 21, seasonEnd: 24, minMachineGames: 0, examined: 1,
  lineups: [{ score: 6.12, bench: ['C'], alternatives: [],
    picks: [{ machine: 'AFM', players: ['A', 'B'], evidence: [
      { machineGames: 4, venueGames: 1, machineWeight: 4/14, evidence: 'machine' },
      { machineGames: 0, venueGames: 0, machineWeight: 0, evidence: 'overall' },
    ] }],
  }],
}
const report = automaticDoublesReport(preview, () => 'Attack from Mars').join('\n')
for (const phrase of ['doubles-log-normalized-v1', 'seasons 21–24', 'not projected match points',
  'Attack from Mars: A & B', '4 prior scores (1 here), 29%', 'no machine history', 'Sits this round: C'])
  assert(report.includes(phrase), phrase)
assert.deepEqual(automaticDoublesReport({...preview,lineups:[]}, String), ['Automatic doubles: no complete lineup.'])
console.log('Automatic doubles report: model, score units, evidence, bench and empty result passed.')

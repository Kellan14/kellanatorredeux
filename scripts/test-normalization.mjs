import assert from 'node:assert/strict'
import {buildNormalizationIndex,leagueNormalizationScores} from '../lib/strategy/normalization.ts'
const rows=[
  {player:'A',machine:'AFM',venue:'Kraken',score:3000},
  {player:'B',machine:'AFM',venue:'Kraken',score:1000},
  {player:'A',machine:'AFM',venue:'GPA',score:900},
  {player:'B',machine:'AFM',venue:'GPA',score:300},
]
const index=buildNormalizationIndex(rows)
assert.equal(index.player('A','afm').ratio,1.5)
assert.equal(index.player('A','afm').count,2)
assert.equal(index.player('A','afm').logRatio,Math.log1p(1.5))
assert.equal(index.player('missing','AFM'),null)
const scaled=buildNormalizationIndex(rows.map(r=>r.venue==='GPA'?{...r,score:r.score*1000}:r))
assert.deepEqual(scaled.player('A','afm'),index.player('A','afm'))
const zero=buildNormalizationIndex([{player:'A',machine:'M',venue:'Kraken',score:0},{player:'B',machine:'M',venue:'the kraken',score:100}])
assert.equal(zero.baseline('M','Kraken'),50)
assert.equal(zero.player('A','M').ratio,0)
assert.equal(buildNormalizationIndex([{player:'A',machine:'M',venue:'V',score:0}]).player('A','M'),null)
const game={machine:'M',venue:'V',round_number:1,home_points:3,away_points:2,player_1_name:'A',player_1_score:0,player_2_name:'B',player_2_score:100}
assert.equal(leagueNormalizationScores([game],()=>true).length,2)
assert.equal(leagueNormalizationScores([{...game,home_points:null}],()=>true).length,0)
assert.equal(leagueNormalizationScores([game],(_,s)=>s<50).length,1)
console.log('Normalization unit tests passed: venue-scale invariance, aliases, zeros, missing/invalid scores, completed-game filtering.')

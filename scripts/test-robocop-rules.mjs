import assert from 'node:assert/strict'
import {
  consumeRoboCopLaserKick,
  createRoboCopRulesState,
  endRoboCopBall,
  endRoboCopMultiball,
  pulseRoboCopSwitch,
  startRoboCopBall,
  tiltRoboCopBall,
} from '../lib/robocop-rules.ts'

const hit = (state, switchNumber, time) => pulseRoboCopSwitch(state, switchNumber, time)

function qualifyAllArrests(state, time = 1000) {
  ;[33, 34, 35, 36, 41, 42, 43, 23].forEach((switchNumber, index) => {
    hit(state, switchNumber, time + index * 20)
  })
  assert.deepEqual([...state.litArrests], ['green', 'yellow', 'red'])
}

{
  const state = createRoboCopRulesState()
  startRoboCopBall(state, 1, 0)
  state.skillShotLane = 25
  hit(state, 25, 100)
  assert.equal(state.redTarget, true, 'an unlit 2 lane spots the red directive')
  assert.equal(state.laserKickLit, true, 'first Jones qualification relights Laser Kick')
  hit(state, 25, 200)
  assert.equal(state.topLanes.size, 1, 'a lit lane does not spot another target')
  hit(state, 26, 300)
  hit(state, 27, 400)
  assert.equal(state.bonusMultiplier, 2, 'completing 2-0-9 advances bonus X')
  assert.equal(state.topLanes.size, 0, 'completed top lanes reset for another cycle')
  const beforeReturn = state.score
  hit(state, 18, 500)
  assert.equal(state.score - beforeReturn, 30_000, 'the left return scores 30K once')
}

{
  const state = createRoboCopRulesState()
  qualifyAllArrests(state)
  assert.equal(state.laserKickLit, true)
  assert.equal(consumeRoboCopLaserKick(state, 1400), true)
  assert.equal(consumeRoboCopLaserKick(state, 1500), false, 'Laser Kick is single-use until relit')
  hit(state, 23, 1600)
  assert.equal(state.laserKickLit, true, 'the captive ball can relight an already-qualified Jones kick')

  hit(state, 32, 2000)
  hit(state, 32, 2200)
  hit(state, 32, 2400)
  assert.equal(state.lockedBalls, 3)
  assert.equal(state.multiballActive, true)
  assert.equal(state.jackpotLit, true)

  const initialJackpot = state.jackpotValue
  hit(state, 44, 2500)
  assert.ok(state.jackpotValue > initialJackpot, 'spinner scoring builds the live jackpot')
  hit(state, 32, 2700)
  assert.equal(state.jackpotCollected, true)
  assert.equal(state.jackpotLit, false, 'only one jackpot is available per multiball')

  ;[33, 34, 35, 36, 41].forEach((switchNumber, index) => hit(state, switchNumber, 3000 + index * 20))
  assert.equal(state.rampSpecialLit, true, 'five post-jackpot target hits light the ramp special')
  hit(state, 32, 3200)
  assert.equal(state.rampSpecialLit, false, 'the right ramp consumes the lit special')

  endRoboCopMultiball(state, 4000)
  assert.equal(state.multiballActive, false)
  assert.equal(state.lockedBalls, 0)
  assert.equal(state.litArrests.size, 0)
}

{
  const state = createRoboCopRulesState()
  for (let visit = 0; visit < 7; visit += 1) hit(state, 30, 1000 + visit * 200)
  assert.equal(state.mysteryLetters, 7)
  assert.equal(state.extraBallAwarded, true, 'ROBOCOP completion awards an extra ball')
}

{
  const state = createRoboCopRulesState()
  state.score = 10_000
  state.bonusValue = 5_000
  state.bonusMultiplier = 3
  state.bonusHold = true
  assert.equal(endRoboCopBall(state, 1000), 15_000)
  assert.equal(state.score, 25_000)
  assert.equal(state.bonusMultiplier, 3, 'Bonus Hold preserves the multiplier for one ball')
  assert.equal(state.bonusHold, false)
  state.bonusValue = 1_000
  endRoboCopBall(state, 2000)
  assert.equal(state.bonusMultiplier, 1, 'the following unheld end-of-ball resets bonus X')
}

{
  const state = createRoboCopRulesState()
  startRoboCopBall(state, 1, 0)
  const scoreBeforeTilt = state.score
  assert.equal(tiltRoboCopBall(state, 100), true)
  hit(state, 32, 200)
  hit(state, 44, 300)
  assert.equal(state.score, scoreBeforeTilt, 'playfield switches do not score after tilt')
  assert.equal(state.lockedBalls, 0, 'rules cannot advance after tilt')
  startRoboCopBall(state, 2, 1000)
  assert.equal(state.tilted, false, 'the next ball clears the tilt latch')
}

console.log('RoboCop rules: 6 sequences passed')

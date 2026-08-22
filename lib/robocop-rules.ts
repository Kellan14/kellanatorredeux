// RoboCop (Data East, 1989) switch-driven rules foundation.
// The switch numbering follows the Data East service chart. VPX supplies the
// geometry, but its table script is not authoritative when it conflicts with
// the machine's documented switch matrix.

export type RoboCopDirective = 'green' | 'yellow' | 'red'

export type RoboCopRulesState = {
  score: number
  bonusMultiplier: number
  topLanes: Set<number>
  greenTargets: Set<number>
  yellowTargets: Set<number>
  redTarget: boolean
  litArrests: Set<RoboCopDirective>
  collectedArrests: Set<RoboCopDirective>
  lockedBalls: number
  multiballActive: boolean
  jackpotValue: number
  jackpotLit: boolean
  jackpotCollected: boolean
  postJackpotTargetHits: number
  rampSpecialLit: boolean
  targetPracticeActive: boolean
  targetPracticeHits: number
  targetPracticeStartedAt: number
  ed209LitUntil: number
  mysteryLetters: number
  extraBallLit: boolean
  extraBallAwarded: boolean
  jumpCount: number
  jumpCombo: number
  interveningComboSwitches: number
  doubleScoringUntil: number
  bonusHold: boolean
  jumpmasterBonusLit: boolean
  spinnerValue: number
  laserKickLit: boolean
  switchCounts: Record<number, number>
  lastAward: string | null
  lastAwardUntil: number
}

export type RoboCopSwitchResult = {
  switchNumber: number
  points: number
  award: string | null
}

export function createRoboCopRulesState(): RoboCopRulesState {
  return {
    score: 0,
    bonusMultiplier: 1,
    topLanes: new Set(),
    greenTargets: new Set(),
    yellowTargets: new Set(),
    redTarget: false,
    litArrests: new Set(),
    collectedArrests: new Set(),
    lockedBalls: 0,
    multiballActive: false,
    jackpotValue: 500_000,
    jackpotLit: false,
    jackpotCollected: false,
    postJackpotTargetHits: 0,
    rampSpecialLit: false,
    targetPracticeActive: false,
    targetPracticeHits: 0,
    targetPracticeStartedAt: 0,
    ed209LitUntil: 0,
    mysteryLetters: 0,
    extraBallLit: false,
    extraBallAwarded: false,
    jumpCount: 0,
    jumpCombo: 0,
    interveningComboSwitches: 0,
    doubleScoringUntil: 0,
    bonusHold: false,
    jumpmasterBonusLit: false,
    spinnerValue: 100,
    laserKickLit: false,
    switchCounts: {},
    lastAward: null,
    lastAwardUntil: 0,
  }
}

function updateDirectiveProgress(state: RoboCopRulesState, time: number) {
  const previousCount = state.litArrests.size
  if (state.greenTargets.size === 4) state.litArrests.add('green')
  if (state.yellowTargets.size === 3) state.litArrests.add('yellow')
  if (state.redTarget) state.litArrests.add('red')
  if (state.litArrests.size > previousCount) {
    state.targetPracticeActive = true
    state.targetPracticeHits = 0
    state.targetPracticeStartedAt = time
  }
  if (state.litArrests.size === 3) state.laserKickLit = true
  // The three playfield lamps are 1K each when lit; an unlit spinner retains
  // its base value. This also caps the documented spinner value at 3K/spin.
  state.spinnerValue = Math.max(100, state.litArrests.size * 1000)
}

function score(state: RoboCopRulesState, basePoints: number, time: number, buildsJackpot = true) {
  const points = basePoints * (time < state.doubleScoringUntil ? 2 : 1)
  state.score += points
  if (buildsJackpot && state.multiballActive && state.jackpotLit && !state.jackpotCollected) {
    state.jackpotValue = Math.min(1_000_000, state.jackpotValue + points)
  }
  return points
}

const TARGET_PRACTICE_SWITCHES = [33, 34, 35, 36, 41, 42, 43, 23] as const
const ARREST_ORDER: readonly RoboCopDirective[] = ['green', 'yellow', 'red']

function spotDirectiveTarget(state: RoboCopRulesState, laneSwitch: number, time: number) {
  if (laneSwitch === 25) state.redTarget = true
  if (laneSwitch === 26) {
    const next = [41, 42, 43].find((target) => !state.yellowTargets.has(target))
    if (next) state.yellowTargets.add(next)
  }
  if (laneSwitch === 27) {
    const next = [33, 34, 35, 36].find((target) => !state.greenTargets.has(target))
    if (next) state.greenTargets.add(next)
  }
  updateDirectiveProgress(state, time)
}

function advanceTargetPractice(state: RoboCopRulesState, switchNumber: number, time: number) {
  if (!state.targetPracticeActive) return false
  const cycleIndex = Math.floor((time - state.targetPracticeStartedAt) / 350) % TARGET_PRACTICE_SWITCHES.length
  if (TARGET_PRACTICE_SWITCHES[cycleIndex] !== switchNumber) return false
  state.targetPracticeHits += 1
  if (state.targetPracticeHits >= 4) {
    state.targetPracticeActive = false
    state.ed209LitUntil = time + 15_000
  }
  return true
}

/** Applies one closed-switch pulse to a single competing ball's rule state. */
export function pulseRoboCopSwitch(
  state: RoboCopRulesState,
  switchNumber: number,
  time: number,
): RoboCopSwitchResult {
  state.switchCounts[switchNumber] = (state.switchCounts[switchNumber] ?? 0) + 1
  let points = 0
  let award: string | null = null

  if (switchNumber !== 32 && state.jumpCombo > 0) {
    state.interveningComboSwitches += 1
    if (state.interveningComboSwitches >= 3) {
      state.jumpCombo = 0
      state.interveningComboSwitches = 0
    }
  }

  const isDirectiveTarget = switchNumber === 23
    || (switchNumber >= 33 && switchNumber <= 36)
    || (switchNumber >= 41 && switchNumber <= 43)
  const hitFlashingSight = isDirectiveTarget && advanceTargetPractice(state, switchNumber, time)
  if (hitFlashingSight) award = state.ed209LitUntil > time
    ? 'ED-209 MILLION LIT'
    : `TARGET PRACTICE ${state.targetPracticeHits}/4`

  if (isDirectiveTarget && state.jackpotCollected && state.multiballActive && !state.rampSpecialLit) {
    state.postJackpotTargetHits += 1
    if (state.postJackpotTargetHits >= 5) {
      state.rampSpecialLit = true
      award = 'RAMP SPECIAL LIT'
    }
  }

  if (switchNumber >= 33 && switchNumber <= 36) {
    const wasLit = state.litArrests.has('green')
    state.greenTargets.add(switchNumber)
    updateDirectiveProgress(state, time)
    if (!wasLit && state.litArrests.has('green')) award = 'GREEN ARREST LIT'
  } else if (switchNumber >= 41 && switchNumber <= 43) {
    const wasLit = state.litArrests.has('yellow')
    state.yellowTargets.add(switchNumber)
    updateDirectiveProgress(state, time)
    if (!wasLit && state.litArrests.has('yellow')) award = 'YELLOW ARREST LIT'
  } else if (switchNumber === 23) {
    const wasLit = state.litArrests.has('red')
    state.redTarget = true
    state.laserKickLit = true
    updateDirectiveProgress(state, time)
    if (!wasLit) award = 'RED ARREST / LASER KICK'
  } else if (switchNumber >= 25 && switchNumber <= 27) {
    const wasUnlit = !state.topLanes.has(switchNumber)
    state.topLanes.add(switchNumber)
    if (wasUnlit) spotDirectiveTarget(state, switchNumber, time)
    if (state.topLanes.size === 3) {
      state.topLanes.clear()
      state.bonusMultiplier = Math.min(5, state.bonusMultiplier + 1)
      award = `${state.bonusMultiplier}X BONUS`
    }
  } else if (switchNumber === 18) {
    points = score(state, 30_000, time)
    award = 'LEFT RETURN 30K'
  } else if (switchNumber === 32) {
    const specialWasLit = state.rampSpecialLit
    const jumpmasterBonusWasLit = state.jumpmasterBonusLit
    points = score(state, 100_000, time)
    state.jumpCount += 1
    state.jumpCombo += 1
    state.interveningComboSwitches = 0
    award = 'RIGHT RAMP 100K'
    if (state.jumpCombo % 2 === 0) {
      state.doubleScoringUntil = time + 10_000
      award = 'DOUBLE SCORING'
    }
    if (state.jumpCombo === 3) {
      state.bonusHold = true
      award = 'BONUS HOLD'
    }

    if (state.jumpCount >= 14 && !state.jumpmasterBonusLit) {
      state.jumpmasterBonusLit = true
      state.rampSpecialLit = true
      state.extraBallLit = true
      award = 'EVERYTHING IS LIT'
    }

    if (state.ed209LitUntil > time) {
      points += score(state, 1_000_000, time)
      state.ed209LitUntil = 0
      award = 'ED-209 MILLION'
    }
    if (specialWasLit) {
      points += score(state, 1_000_000, time)
      state.rampSpecialLit = false
      award = 'RAMP SPECIAL 1M'
    }
    if (jumpmasterBonusWasLit) {
      points += score(state, 500_000, time)
      state.jumpmasterBonusLit = false
      award = 'JUMPMASTER 500K'
    }

    const wasMultiballActive = state.multiballActive
    if (wasMultiballActive && state.jackpotLit && !state.jackpotCollected) {
      points += score(state, state.jackpotValue, time, false)
      state.jackpotCollected = true
      state.jackpotLit = false
      award = `JACKPOT ${state.jackpotValue}`
    }

    const nextArrest = ARREST_ORDER.find((directive) => (
      state.litArrests.has(directive) && !state.collectedArrests.has(directive)
    ))
    if (nextArrest) {
      state.collectedArrests.add(nextArrest)
      state.lockedBalls += 1
      points += score(state, 80_000, time)
      award = `${nextArrest.toUpperCase()} ARREST`
      if (state.lockedBalls >= 3 && !state.multiballActive) {
        state.multiballActive = true
        state.jackpotValue = 500_000
        state.jackpotLit = true
        state.jackpotCollected = false
        award = 'MULTIBALL / JACKPOT LIT'
      }
    }
  } else if (switchNumber === 44) {
    points = score(state, state.spinnerValue, time)
    award = `SPINNER ${state.spinnerValue}`
  } else if (switchNumber === 30) {
    state.mysteryLetters = Math.min(7, state.mysteryLetters + 1)
    award = `MYSTERY ${'ROBOCOP'.slice(0, state.mysteryLetters)}`
    if (state.extraBallLit || state.mysteryLetters === 7) {
      state.extraBallLit = false
      state.extraBallAwarded = true
      award = 'EXTRA BALL'
    }
  }

  if (award) {
    state.lastAward = award
    state.lastAwardUntil = time + 900
  }
  return { switchNumber, points, award }
}

export function formatRoboCopScore(scoreValue: number) {
  if (scoreValue >= 1_000_000) return `${(scoreValue / 1_000_000).toFixed(scoreValue >= 10_000_000 ? 0 : 1)}M`
  if (scoreValue >= 1_000) return `${Math.floor(scoreValue / 1_000)}K`
  return String(scoreValue)
}

/**
 * Rotates the lit top lanes, the way the flipper buttons do on the machine.
 *
 * The 2-0-9 lanes are a rotating bank: each flip shifts which lanes are lit
 * one position, so the player can line up the unlit lane with where the ball
 * is heading. Left rotates one way, right the other.
 */
export function rotateRoboCopTopLanes(state: RoboCopRulesState, direction: 'left' | 'right') {
  const lanes = TOP_LANE_SWITCHES
  const shift = direction === 'left' ? lanes.length - 1 : 1
  const rotated = new Set<number>()
  state.topLanes.forEach((lane) => {
    const index = lanes.indexOf(lane)
    if (index < 0) {
      rotated.add(lane)
      return
    }
    rotated.add(lanes[(index + shift) % lanes.length])
  })
  state.topLanes = rotated
}

const TOP_LANE_SWITCHES: readonly number[] = [25, 26, 27]
const ROBOCOP_LETTER_LAMPS = [25, 26, 27, 28, 29, 17, 18] as const
const GREEN_TARGET_LAMPS = [4, 3, 2, 1] as const
const GREEN_TARGET_SWITCHES = [33, 34, 35, 36] as const
const YELLOW_TARGET_LAMPS = [9, 10, 11] as const
const YELLOW_TARGET_SWITCHES = [41, 42, 43] as const
const TARGET_PRACTICE_LAMPS = [5, 6, 7, 8, 12, 13, 14, 23] as const

function flashing(time: number, interval = 180) {
  return Math.floor(time / interval) % 2 === 0 ? 1 : 0.12
}

/**
 * Returns the intensity of one lamp in RoboCop's documented 1–64 matrix.
 * A small non-zero off value is intentionally left to the renderer so the
 * insert remains a visible piece of translucent playfield plastic.
 */
export function getRoboCopLampLevel(state: RoboCopRulesState, lampNumber: number, time: number) {
  const greenTargetIndex = GREEN_TARGET_LAMPS.indexOf(lampNumber as typeof GREEN_TARGET_LAMPS[number])
  if (greenTargetIndex >= 0) return state.greenTargets.has(GREEN_TARGET_SWITCHES[greenTargetIndex]) ? 1 : 0

  const yellowTargetIndex = YELLOW_TARGET_LAMPS.indexOf(lampNumber as typeof YELLOW_TARGET_LAMPS[number])
  if (yellowTargetIndex >= 0) return state.yellowTargets.has(YELLOW_TARGET_SWITCHES[yellowTargetIndex]) ? 1 : 0

  const practiceIndex = TARGET_PRACTICE_LAMPS.indexOf(lampNumber as typeof TARGET_PRACTICE_LAMPS[number])
  if (practiceIndex >= 0) {
    if (!state.targetPracticeActive) return 0
    const activeIndex = Math.floor((time - state.targetPracticeStartedAt) / 350) % TARGET_PRACTICE_LAMPS.length
    return activeIndex === practiceIndex ? 1 : 0.08
  }

  const letterIndex = ROBOCOP_LETTER_LAMPS.indexOf(lampNumber as typeof ROBOCOP_LETTER_LAMPS[number])
  if (letterIndex >= 0) return state.mysteryLetters > letterIndex ? 1 : 0

  if (lampNumber === 19) return state.lockedBalls < 3 && state.litArrests.size > state.collectedArrests.size ? flashing(time, 220) : 0
  if (lampNumber === 20) return state.laserKickLit ? 0 : 1
  if (lampNumber === 21 || lampNumber === 40) return state.extraBallLit ? flashing(time, 210) : 0
  if (lampNumber === 22) return state.litArrests.has('red') ? 1 : 0

  if (lampNumber === 30) return state.litArrests.has('green') ? 1 : 0
  if (lampNumber === 31) return state.litArrests.has('yellow') ? 1 : 0
  if (lampNumber === 32) return state.litArrests.has('red') ? 1 : 0
  if (lampNumber === 33) return state.jumpmasterBonusLit ? flashing(time) : 0
  if (lampNumber === 34) return state.bonusMultiplier >= 2 ? 1 : 0
  if (lampNumber === 35) return state.bonusMultiplier >= 3 ? 1 : 0
  if (lampNumber === 36) return state.bonusHold ? 1 : 0
  if (lampNumber === 37) return state.bonusMultiplier >= 4 ? 1 : 0
  if (lampNumber === 38) return state.bonusMultiplier >= 5 ? 1 : 0
  if (lampNumber === 39) return state.targetPracticeActive ? flashing(time, 140) : 0

  if (lampNumber === 45) return state.laserKickLit ? flashing(time, 190) : 0
  if (lampNumber === 47 || lampNumber === 48) return state.mysteryLetters >= 7 ? 1 : 0
  if (lampNumber === 49) return state.topLanes.has(25) ? 1 : 0
  if (lampNumber === 50) return state.topLanes.has(26) ? 1 : 0
  if (lampNumber === 51) return state.topLanes.has(27) ? 1 : 0
  if (lampNumber >= 52 && lampNumber <= 55) return state.jumpCombo >= lampNumber - 51 ? 1 : 0

  if (lampNumber === 57) return state.litArrests.has('green') ? (state.collectedArrests.has('green') ? 1 : flashing(time)) : 0
  if (lampNumber === 58) return state.litArrests.has('yellow') ? (state.collectedArrests.has('yellow') ? 1 : flashing(time)) : 0
  if (lampNumber === 59) return state.litArrests.has('red') ? (state.collectedArrests.has('red') ? 1 : flashing(time)) : 0
  if (lampNumber === 60) return state.ed209LitUntil > time ? flashing(time, 130) : 0
  if (lampNumber === 61) return state.rampSpecialLit ? flashing(time, 170) : 0
  if (lampNumber === 62) return state.jackpotLit ? flashing(time, 130) : 0
  if (lampNumber === 63 || lampNumber === 64) return state.targetPracticeActive || state.ed209LitUntil > time ? flashing(time, 150) : 0

  return 0
}

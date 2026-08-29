// RoboCop (Data East, 1989) switch-driven rules foundation.
// The switch numbering follows the Data East service chart. VPX supplies the
// geometry, but its table script is not authoritative when it conflicts with
// the machine's documented switch matrix.

export type RoboCopDirective = 'green' | 'yellow' | 'red'

export type RoboCopRulesState = {
  tilted: boolean
  score: number
  bonusValue: number
  lastBonusAward: number
  bonusMultiplier: number
  currentBall: number
  skillShotLane: number
  skillShotAvailable: boolean
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
  rampSpecialLitUntil: number
  targetPracticeActive: boolean
  targetPracticeHits: number
  targetPracticeRequired: number
  targetPracticeCompletions: number
  targetPracticeStartedAt: number
  ed209LitUntil: number
  mysteryLetters: number
  extraBallLit: boolean
  extraBallLitUntil: number
  extraBallAwarded: boolean
  jumpCount: number
  jumpCombo: number
  interveningComboSwitches: number
  doubleScoringUntil: number
  bonusHold: boolean
  jumpmasterBonusLit: boolean
  jumpmasterAchieved: boolean
  everythingLitUntil: number
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
    tilted: false,
    score: 0,
    bonusValue: 0,
    lastBonusAward: 0,
    bonusMultiplier: 1,
    currentBall: 1,
    skillShotLane: 25,
    skillShotAvailable: false,
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
    rampSpecialLitUntil: 0,
    targetPracticeActive: false,
    targetPracticeHits: 0,
    targetPracticeRequired: 4,
    targetPracticeCompletions: 0,
    targetPracticeStartedAt: 0,
    ed209LitUntil: 0,
    mysteryLetters: 0,
    extraBallLit: false,
    extraBallLitUntil: 0,
    extraBallAwarded: false,
    jumpCount: 0,
    jumpCombo: 0,
    interveningComboSwitches: 0,
    doubleScoringUntil: 0,
    bonusHold: false,
    jumpmasterBonusLit: false,
    jumpmasterAchieved: false,
    everythingLitUntil: 0,
    spinnerValue: 100,
    laserKickLit: false,
    switchCounts: {},
    lastAward: null,
    lastAwardUntil: 0,
  }
}

function updateDirectiveProgress(state: RoboCopRulesState, time: number) {
  const previousCount = state.litArrests.size
  const redWasLit = state.litArrests.has('red')
  if (state.greenTargets.size === 4) state.litArrests.add('green')
  if (state.yellowTargets.size === 3) state.litArrests.add('yellow')
  if (state.redTarget) state.litArrests.add('red')
  if (state.litArrests.size > previousCount) {
    state.targetPracticeActive = true
    state.targetPracticeHits = 0
    state.targetPracticeStartedAt = time
  }
  // Jones (the red directive) relights Laser Kick when first completed,
  // including when an unlit 2 lane spots the captive-ball target. A direct
  // captive-ball hit is handled separately and can relight it every time.
  if (!redWasLit && state.litArrests.has('red')) state.laserKickLit = true
  // The three playfield lamps are 1K each when lit; an unlit spinner retains
  // its base value. This also caps the documented spinner value at 3K/spin.
  state.spinnerValue = Math.max(100, state.litArrests.size * 1000)
}

function score(state: RoboCopRulesState, basePoints: number, time: number, buildsJackpot = true) {
  const points = basePoints * (time < state.doubleScoringUntil ? 2 : 1)
  state.score += points
  state.bonusValue = Math.min(
    250_000,
    state.bonusValue + Math.max(100, Math.floor(basePoints / 1000) * 100),
  )
  if (buildsJackpot && state.multiballActive && state.jackpotLit && !state.jackpotCollected) {
    state.jackpotValue = Math.min(1_000_000, state.jackpotValue + points)
  }
  return points
}

const TARGET_PRACTICE_SWITCHES = [33, 34, 35, 36, 41, 42, 43, 23] as const
const ARREST_ORDER: readonly RoboCopDirective[] = ['green', 'yellow', 'red']
const MYSTERY_VALUES = [50_000, 75_000, 100_000, 125_000, 150_000, 200_000, 250_000] as const
// Factory Double Playfield is approximately twenty seconds. Every second
// successful jump in the continuing combo refreshes the full window.
const DOUBLE_PLAYFIELD_MILLISECONDS = 20_000
const BASE_SWITCH_SCORES: Readonly<Record<number, number>> = {
  17: 10_000,
  19: 10_000,
  20: 30_000,
  21: 1_000,
  22: 1_000,
  23: 10_000,
  25: 10_000,
  26: 10_000,
  27: 10_000,
  28: 50_000,
  29: 50_000,
  31: 50_000,
  33: 10_000,
  34: 10_000,
  35: 10_000,
  36: 10_000,
  37: 10,
  38: 10,
  41: 10_000,
  42: 10_000,
  43: 10_000,
  45: 25_000,
  46: 1_000,
  47: 1_000,
  48: 1_000,
}

/** Starts one physical ball without disturbing locks or game-long progress. */
export function startRoboCopBall(state: RoboCopRulesState, ballNumber: number, time: number) {
  state.tilted = false
  state.currentBall = ballNumber
  state.skillShotLane = 25 + (Math.floor(time / 137) + ballNumber) % 3
  state.skillShotAvailable = true
  state.lastBonusAward = 0
  state.jumpCombo = 0
  state.interveningComboSwitches = 0
  state.doubleScoringUntil = 0
  state.lastAward = `BALL ${ballNumber}`
  state.lastAwardUntil = time + 900
}

/** Counts end-of-ball bonus and resets only the features that end with a ball. */
export function endRoboCopBall(state: RoboCopRulesState, time: number, tilted = false) {
  const bonus = tilted ? 0 : state.bonusValue * state.bonusMultiplier
  state.score += bonus
  state.lastBonusAward = bonus
  state.bonusValue = 0
  state.skillShotAvailable = false
  state.jumpCombo = 0
  state.interveningComboSwitches = 0
  state.doubleScoringUntil = 0
  state.targetPracticeActive = false
  state.targetPracticeHits = 0
  state.ed209LitUntil = 0
  state.everythingLitUntil = 0
  state.jumpmasterBonusLit = false
  if (state.rampSpecialLitUntil > 0) {
    state.rampSpecialLit = false
    state.rampSpecialLitUntil = 0
  }
  if (state.extraBallLitUntil > 0) {
    state.extraBallLit = false
    state.extraBallLitUntil = 0
  }
  if (state.bonusHold) state.bonusHold = false
  else state.bonusMultiplier = 1
  state.lastAward = tilted ? 'BONUS FORFEITED' : `BONUS ${formatRoboCopScore(bonus)}`
  state.lastAwardUntil = time + 1400
  return bonus
}

/** Latches the current ball's tilt state; switches remain inert until its drain. */
export function tiltRoboCopBall(state: RoboCopRulesState, time: number) {
  if (state.tilted) return false
  state.tilted = true
  state.skillShotAvailable = false
  state.doubleScoringUntil = 0
  state.targetPracticeActive = false
  state.ed209LitUntil = 0
  state.lastAward = 'TILT'
  state.lastAwardUntil = time + 1800
  return true
}

/** Resets the directive/lock cycle when three-ball multiball returns to one. */
export function endRoboCopMultiball(state: RoboCopRulesState, time: number) {
  state.multiballActive = false
  state.lockedBalls = 0
  state.greenTargets.clear()
  state.yellowTargets.clear()
  state.redTarget = false
  state.litArrests.clear()
  state.collectedArrests.clear()
  state.spinnerValue = 100
  state.jackpotLit = false
  state.jackpotCollected = false
  state.jackpotValue = 500_000
  state.postJackpotTargetHits = 0
  state.rampSpecialLit = false
  state.rampSpecialLitUntil = 0
  state.lastAward = 'MULTIBALL ENDED'
  state.lastAwardUntil = time + 900
}

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
  if (state.targetPracticeHits >= state.targetPracticeRequired) {
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
  if (state.tilted) return { switchNumber, points: 0, award: null }
  if (state.rampSpecialLitUntil > 0 && time >= state.rampSpecialLitUntil) state.rampSpecialLit = false
  if (state.extraBallLitUntil > 0 && time >= state.extraBallLitUntil) state.extraBallLit = false
  state.switchCounts[switchNumber] = (state.switchCounts[switchNumber] ?? 0) + 1
  let points = 0
  let award: string | null = null

  const baseScore = BASE_SWITCH_SCORES[switchNumber]
  if (baseScore) points += score(state, baseScore, time)

  if (state.skillShotAvailable) {
    if (switchNumber >= 25 && switchNumber <= 27) {
      if (switchNumber === state.skillShotLane) {
        const skillShot = 100_000 * state.currentBall
        points += score(state, skillShot, time)
        award = `SKILL SHOT ${formatRoboCopScore(skillShot)}`
      }
      state.skillShotAvailable = false
    } else if (BASE_SWITCH_SCORES[switchNumber] || switchNumber === 18 || switchNumber === 32 || switchNumber === 44) {
      state.skillShotAvailable = false
    }
  }

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
    : `TARGET PRACTICE ${state.targetPracticeHits}/${state.targetPracticeRequired}`

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
    points += score(state, 30_000, time)
    award = 'LEFT RETURN 30K'
  } else if (switchNumber === 32) {
    const specialWasLit = state.rampSpecialLit
      && (state.rampSpecialLitUntil === 0 || state.rampSpecialLitUntil > time)
    const jumpmasterBonusWasLit = state.jumpmasterBonusLit && state.everythingLitUntil > time
    points += score(state, 100_000, time)
    state.jumpCount += 1
    state.jumpCombo += 1
    state.interveningComboSwitches = 0
    award = 'RIGHT RAMP 100K'
    if (state.jumpCombo % 2 === 0) {
      state.doubleScoringUntil = time + DOUBLE_PLAYFIELD_MILLISECONDS
      award = 'DOUBLE SCORING'
    }
    if (state.jumpCombo === 3) {
      state.bonusHold = true
      award = 'BONUS HOLD'
    }

    if (state.jumpCount >= 14 && !state.jumpmasterAchieved) {
      state.jumpmasterAchieved = true
      state.jumpmasterBonusLit = true
      state.rampSpecialLit = true
      state.rampSpecialLitUntil = time + 15_000
      state.extraBallLit = true
      state.extraBallLitUntil = time + 15_000
      state.everythingLitUntil = time + 15_000
      state.laserKickLit = true
      award = 'EVERYTHING IS LIT'
    }

    if (state.ed209LitUntil > time) {
      points += score(state, 1_000_000, time)
      state.ed209LitUntil = 0
      state.targetPracticeCompletions += 1
      state.targetPracticeRequired = Math.min(8, state.targetPracticeRequired + 1)
      award = 'ED-209 MILLION'
    }
    if (specialWasLit) {
      points += score(state, 1_000_000, time)
      state.rampSpecialLit = false
      state.rampSpecialLitUntil = 0
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
    points += score(state, state.spinnerValue, time)
    award = `SPINNER ${state.spinnerValue}`
  } else if (switchNumber === 30) {
    const mysteryValue = MYSTERY_VALUES[Math.floor(time / 180) % MYSTERY_VALUES.length]
    points += score(state, mysteryValue, time)
    state.mysteryLetters = Math.min(7, state.mysteryLetters + 1)
    award = `MYSTERY ${formatRoboCopScore(mysteryValue)} · ${'ROBOCOP'.slice(0, state.mysteryLetters)}`
    const extraBallWasLit = state.extraBallLit
      && (state.extraBallLitUntil === 0 || state.extraBallLitUntil > time)
    if (extraBallWasLit || state.mysteryLetters === 7) {
      state.extraBallLit = false
      state.extraBallLitUntil = 0
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

/** Consumes one lit left-outlane kickback exactly when its coil fires. */
export function consumeRoboCopLaserKick(state: RoboCopRulesState, time: number) {
  if (!state.laserKickLit) return false
  state.laserKickLit = false
  state.lastAward = 'LASER KICK'
  state.lastAwardUntil = time + 1100
  return true
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
  if (state.tilted) return 0
  const everythingLit = state.everythingLitUntil > time
  const extraBallLit = state.extraBallLit
    && (state.extraBallLitUntil === 0 || state.extraBallLitUntil > time)
  const rampSpecialLit = state.rampSpecialLit
    && (state.rampSpecialLitUntil === 0 || state.rampSpecialLitUntil > time)
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

  if (lampNumber === 15) return state.targetPracticeActive || everythingLit ? flashing(time, 170) : 0
  if (lampNumber === 16) return everythingLit ? flashing(time, 170) : 0
  if (lampNumber === 19) return state.lockedBalls < 3 && state.litArrests.size > state.collectedArrests.size ? flashing(time, 220) : 0
  if (lampNumber === 20) return state.laserKickLit ? 0 : 1
  if (lampNumber === 21 || lampNumber === 40) return extraBallLit ? flashing(time, 210) : 0
  if (lampNumber === 22) return state.litArrests.has('red') ? 1 : 0
  if (lampNumber === 24) return everythingLit ? flashing(time, 170) : 0

  if (lampNumber === 30) return state.litArrests.has('green') ? 1 : 0
  if (lampNumber === 31) return state.litArrests.has('yellow') ? 1 : 0
  if (lampNumber === 32) return state.litArrests.has('red') ? 1 : 0
  if (lampNumber === 33) return everythingLit ? flashing(time) : 0
  if (lampNumber === 34) return state.bonusMultiplier >= 2 ? 1 : 0
  if (lampNumber === 35) return state.bonusMultiplier >= 3 ? 1 : 0
  if (lampNumber === 36) return state.bonusHold ? 1 : 0
  if (lampNumber === 37) return state.bonusMultiplier >= 4 ? 1 : 0
  if (lampNumber === 38) return state.bonusMultiplier >= 5 ? 1 : 0
  if (lampNumber === 39) return state.targetPracticeActive ? flashing(time, 140) : 0

  if (lampNumber === 41) return state.litArrests.has('red') ? 1 : 0
  if (lampNumber === 42) return state.litArrests.has('yellow') ? 1 : 0
  if (lampNumber === 43) return state.litArrests.has('green') ? 1 : 0
  if (lampNumber === 44) return state.jumpCombo > 0 ? flashing(time, 230) : 0
  if (lampNumber === 45) return state.laserKickLit ? flashing(time, 190) : 0
  if (lampNumber === 46) return everythingLit ? flashing(time, 170) : 0
  if (lampNumber === 47) return everythingLit || state.jumpCombo > 0 ? flashing(time, 170) : 0
  if (lampNumber === 48) return everythingLit || state.doubleScoringUntil > time ? flashing(time, 130) : 0
  if (lampNumber === 49) return state.topLanes.has(25) ? 1 : 0
  if (lampNumber === 50) return state.topLanes.has(26) ? 1 : 0
  if (lampNumber === 51) return state.topLanes.has(27) ? 1 : 0
  if (lampNumber >= 52 && lampNumber <= 55) {
    if (!state.skillShotAvailable) return 0
    const guideIndex = lampNumber - 52
    const laneIndex = state.skillShotLane - 25
    return guideIndex === laneIndex || guideIndex === laneIndex + 1 ? flashing(time, 190) : 0.08
  }

  if (lampNumber === 57) return state.litArrests.has('green') ? (state.collectedArrests.has('green') ? 1 : flashing(time)) : 0
  if (lampNumber === 58) return state.litArrests.has('yellow') ? (state.collectedArrests.has('yellow') ? 1 : flashing(time)) : 0
  if (lampNumber === 59) return state.litArrests.has('red') ? (state.collectedArrests.has('red') ? 1 : flashing(time)) : 0
  if (lampNumber === 60) return state.ed209LitUntil > time ? flashing(time, 130) : 0
  if (lampNumber === 61) return rampSpecialLit ? flashing(time, 170) : 0
  if (lampNumber === 62) return state.jackpotLit ? flashing(time, 130) : 0
  if (lampNumber === 63 || lampNumber === 64) return state.targetPracticeActive || state.ed209LitUntil > time ? flashing(time, 150) : 0

  return 0
}

// Extracts active nFozzy/script physics constants from RoboCop's embedded
// VBScript. Keeping these values generated prevents the browser port from
// drifting away from the actual table script.

import { writeFile } from 'node:fs/promises'
import { readCompoundFile, readTableScript } from './lib/vpx-reader.mjs'

const VPX_PATH = 'games/Robocop (Data East 1989)_drakkon(mod_1.2).vpx'
const OUTPUT_PATH = 'lib/vpx-robocop-script-physics.ts'

const streams = await readCompoundFile(VPX_PATH)
const rawScript = readTableScript(streams).replace(/\r/g, '')
const script = rawScript
  .split('\n')
  .map((line) => line.replace(/'.*$/, ''))
  .join('\n')

const number = (name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = script.match(new RegExp(`^\\s*(?:Const\\s+)?${escaped}\\s*=\\s*(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))`, 'im'))
  if (!match) throw new Error(`script value ${name} was not found`)
  return Number(match[1])
}

const curve = (name) => [...script.matchAll(new RegExp(
  `^\\s*${name}\\.addpoint\\s+\\d+\\s*,\\s*(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))\\s*,\\s*(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))`,
  'gim',
))].map((match) => [Number(match[1]), Number(match[2])])

const standupNames = [...script.matchAll(/^\s*ST(\d+)\s*=\s*Array\(sw\d+/gim)]
  .map((match) => `sw${match[1]}`)
const timerInterval = (() => {
  const match = rawScript.match(/The game timer interval is\s+(\d+)\s*ms/i)
  if (!match) throw new Error('GameTimer interval comment was not found')
  return Number(match[1])
})()
const standupDisabledMilliseconds = number('STMaxOffset') / number('STAnimStep') * timerInterval
const restEndAngleOffsetDegrees = (() => {
  const match = script.match(/FEndAngle\s*-\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*\*\s*Dir/i)
  if (!match) throw new Error('flipper rest end-angle offset was not found')
  return Number(match[1])
})()

const physics = {
  gameTimerIntervalMilliseconds: timerInterval,
  flipper: {
    coilRampUpMode: number('FlipperCoilRampupMode'),
    endOfStrokeTorque: number('EOSTnew'),
    endOfStrokeAngleDegrees: number('EOSAnew'),
    endOfStrokeRampUp: number('EOSRampup'),
    startOfStrokeRampUp: number('SOSRampup'),
    liveCatchMilliseconds: number('LiveCatch'),
    liveElasticity: number('LiveElasticity'),
    restElasticityMultiplier: number('SOSEM'),
    returnTorqueRatio: number('EOSReturn'),
    restEndAngleOffsetDegrees,
    liveCatchDistanceMin: number('LiveDistanceMin'),
    liveCatchDistanceMax: number('LiveDistanceMax'),
    dampenerCurve: curve('FlippersD'),
  },
  rubber: {
    dampenerCurve: curve('RubbersD'),
    sleeveMultiplier: 0.85,
  },
  targetBouncer: {
    enabled: Boolean(number('TargetBouncerEnabled')),
    factor: number('TargetBouncerFactor'),
  },
  standup: {
    names: standupNames,
    animationStep: number('STAnimStep'),
    maximumOffset: number('STMaxOffset'),
    mass: number('STMass'),
    disabledMilliseconds: standupDisabledMilliseconds,
  },
}

const output = `// Generated from ${VPX_PATH} by scripts/extract-vpx-script-physics.mjs.\n`
  + `// Do not hand-edit numeric values; regenerate them from the source VPX.\n\n`
  + `export const VPX_ROBOCOP_SCRIPT_PHYSICS = ${JSON.stringify(physics, null, 2)} as const\n`

await writeFile(OUTPUT_PATH, output)
console.log(`wrote ${OUTPUT_PATH}`)

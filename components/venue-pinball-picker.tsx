'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Image from 'next/image'
import { Play, RotateCcw, Smartphone, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { VpxTableLamps } from '@/components/vpx-table-lamps'
import { getMachineImagePath, getMachineThumbnailPath } from '@/lib/machine-images'
import { VPX_TABLE, type VpxGate, type VpxKicker, type VpxPoint, type VpxRamp, type VpxRuleTrigger, type VpxSegment, type VpxSpinner, type VpxWall } from '@/lib/vpx-robocop-table'
import { VPX_COLLISION_PRIMITIVES, type VpxCollisionPrimitive } from '@/lib/vpx-robocop-primitives'
import { VPX_COLLISION_WALLS } from '@/lib/vpx-robocop-walls'
import { VPX_TRIGGER_VOLUMES, type VpxTriggerVolume } from '@/lib/vpx-robocop-triggers'
import { VPX_COLLECTIONS } from '@/lib/vpx-robocop-collections'
import { VPX_ROBOCOP_SCRIPT_PHYSICS } from '@/lib/vpx-robocop-script-physics'
import {
  applyVpxBumperCoil,
  applyVpxPlayfieldFriction,
  applyVpxScatter,
  applyVpxSlingshotImpulse,
  applyVpxSurfaceFriction,
  createVpxGateMover,
  createVpxFlipperMover,
  createVpxSpinnerMover,
  getVpxCircleHit,
  getVpxFlipperProfileContact,
  getVpxLineSegmentHit,
  hitVpxGateMover,
  hitVpxSpinnerMover,
  resolveVpxFlipperContact,
  resolveVpxKickerBevelContact,
  resolveVpxSpatialSurfaceContact,
  resolveVpxStaticContact,
  resolveVpxSurfaceContact,
  stepVpxFlipperMover,
  stepVpxGateMover,
  stepVpxSpinnerMover,
  vpxPlungerLaunchSpeed,
  VPX_CONTACT_VELOCITY,
  type VpxFlipperMover,
  type VpxFlipperParameters,
  type VpxGateMover,
  type VpxSpinnerMover,
} from '@/lib/vpx-physics'
import { useMachineCanon } from '@/hooks/use-machine-canon'
import {
  consumeRoboCopLaserKick,
  createRoboCopRulesState,
  endRoboCopBall,
  endRoboCopMultiball,
  formatRoboCopScore,
  pulseRoboCopSwitch,
  rotateRoboCopTopLanes,
  startRoboCopBall,
  tiltRoboCopBall,
  type RoboCopRulesState,
} from '@/lib/robocop-rules'

type Venue = { key: string; name: string; machines: string[] }
type Peg = {
  x: number; y: number; r?: number; kind?: 'post' | 'bumper'
  elasticity?: number; elasticityFalloff?: number; friction?: number; scatter?: number; force?: number
  threshold?: number
  switchNumber?: number
}
type Rail = {
  x1: number; y1: number; x2: number; y2: number
  kind?: 'rubber' | 'wall' | 'slingshot'
  elasticity?: number; elasticityFalloff?: number; friction?: number; scatter?: number; force?: number; thickness?: number
  heightBottom?: number; heightTop?: number
  /** Slingshot trigger threshold, in VPX velocity units (Surface SLTH). */
  threshold?: number
  vpxWall?: boolean
  wallName?: string
  joint?: boolean
  allowsInvertedEscape?: boolean
  switchNumber?: number
}
type Mode = {
  id: string
  name: string
  description: string
  accent: string
}
type FlipperSide = 'left' | 'right'
type FlipperCorrectionSample = { x: number; y: number }
type Ball = {
  machineKey: string
  label: string
  x: number
  y: number
  vx: number
  vy: number
  angularVelocity: number
  angularVelocityX: number
  angularVelocityY: number
  radius: number
  color: string
  z: number
  vz: number
  straightZDrop: boolean
  rampTrackIndex: number | null
  rampDistance: number
  rampSpeed: number
  rampOffset: number
  rampLateralSpeed: number
  active: boolean
  launchAt: number
  capturedBy: string | null
  kickerVolume: string | null
  releaseAt: number
  objectCooldowns: Record<string, number>
  activeRuleVolumes: Record<string, boolean>
  flipperCorrectionSamples: Partial<Record<FlipperSide, FlipperCorrectionSample>>
  corSpeed: number
  corVelocityX: number
  corVelocityY: number
  corElapsedMilliseconds: number
  rules: RoboCopRulesState
  isRegularBall: boolean
  parked: boolean
  /** Physical eject occupied by a logically locked ball. */
  parkedAt: string | null
  heldInShooterLane: boolean
  pendingCandidateSteps: number
  pendingRuleLock: boolean
  pendingJackpot: boolean
  lastRuleSwitch: number | null
  finished: boolean
}

type RulesPickerPhase = 'idle' | 'normal' | 'multiball' | 'standard-multiball' | 'selected'
type FullGamePhase = 'idle' | 'ready' | 'playing' | 'game-over'
type RulesBallOptions = {
  x?: number
  y?: number
  active?: boolean
  parked?: boolean
  parkedAt?: string | null
  heldInShooterLane?: boolean
  colorIndex?: number
}

const WIDTH = 640
// Keep RoboCop's native playfield aspect ratio in the simulation buffer. CSS
// may fit this dashboard to the viewport, but never stretches its geometry.
const HEIGHT = 1518
const BALL_TO_VPX_VELOCITY_SCALE = 10 / 16.667
const PALETTE = ['#ff006e', '#3a86ff', '#06d6a0', '#ffbe0b', '#8338ec', '#fb5607', '#00b4d8', '#ef476f']

const BALL_GLOW_SPREAD = 15
const BALL_GLOW_SPRITE_SIZE = 64
const ballGlowSprites = new Map<string, HTMLCanvasElement>()

/** Pre-rendered drop-shadow substitute, one canvas per palette colour. */
function getBallGlowSprite(color: string) {
  let sprite = ballGlowSprites.get(color)
  if (sprite) return sprite
  sprite = document.createElement('canvas')
  sprite.width = BALL_GLOW_SPRITE_SIZE
  sprite.height = BALL_GLOW_SPRITE_SIZE
  const context = sprite.getContext('2d')
  if (context) {
    const half = BALL_GLOW_SPRITE_SIZE / 2
    const gradient = context.createRadialGradient(half, half, half * 0.35, half, half, half)
    gradient.addColorStop(0, color)
    gradient.addColorStop(0.55, `${color}66`)
    gradient.addColorStop(1, `${color}00`)
    context.fillStyle = gradient
    context.fillRect(0, 0, BALL_GLOW_SPRITE_SIZE, BALL_GLOW_SPRITE_SIZE)
  }
  ballGlowSprites.set(color, sprite)
  return sprite
}

const scaleVpxPoint = ([x, y]: readonly number[]) => ({
  x: x * WIDTH / VPX_TABLE.playableWidth,
  y: y * HEIGHT / VPX_TABLE.height,
})

const VPX_TRIGGER_BY_NAME = new Map<string, VpxTriggerVolume>(
  VPX_TRIGGER_VOLUMES.map((trigger) => [trigger.name, trigger]),
)
const VPX_COLLECTION_BY_NAME = new Map(
  VPX_COLLECTIONS.map((collection) => [collection.name, collection]),
)
const VPX_DAMPENED_POSTS = new Set<string>(VPX_COLLECTION_BY_NAME.get('dPosts')?.items ?? [])
const VPX_DAMPENED_SLEEVES = new Set<string>(VPX_COLLECTION_BY_NAME.get('dSleeves')?.items ?? [])

const VPX_STATIC_COLLISION_WALLS = VPX_COLLISION_WALLS.filter(
  (wall) => wall.name !== 'LeftSlingShot' && wall.name !== 'RightSlingShot',
)
const VPX_COLLISION_WALL_BY_NAME = new Map<string, (typeof VPX_COLLISION_WALLS)[number]>(
  VPX_COLLISION_WALLS.map((wall) => [wall.name, wall]),
)

function vpxWallHeightBand(wall: VpxWall): readonly [number, number] {
  if (wall.heightBottom != null && wall.heightTop != null) return [wall.heightBottom, wall.heightTop]
  return VPX_TABLE.collisionHeightBands[
    wall.name as keyof typeof VPX_TABLE.collisionHeightBands
  ] ?? [0, 50]
}

function vpxWallHasSolidBottom(wall: VpxWall | string) {
  const name = typeof wall === 'string' ? wall : wall.name
  const generated = VPX_COLLISION_WALL_BY_NAME.get(name)
  if (generated) return generated.solidBottom
  if (typeof wall !== 'string' && wall.solidBottom != null) return wall.solidBottom
  return (VPX_TABLE.solidBottomWalls as readonly string[]).includes(name)
}

const VPX_DRAIN_CENTER = scaleVpxPoint(VPX_TABLE.drain.center)
const VPX_DRAIN_RADIUS = VPX_TABLE.drain.radius * WIDTH / VPX_TABLE.playableWidth
const FINISH_Y = VPX_DRAIN_CENTER.y
const FINISH_LEFT = VPX_DRAIN_CENTER.x - VPX_DRAIN_RADIUS
const FINISH_RIGHT = VPX_DRAIN_CENTER.x + VPX_DRAIN_RADIUS
const VPX_PLAYFIELD_SCALE = WIDTH / VPX_TABLE.playableWidth
const VPX_BALL_RADIUS = 25 * VPX_PLAYFIELD_SCALE
// VPX splits gravity by the table's own inclination rather than by a tuned
// constant: gravity.y = sin(slope) * strength, gravity.z = -cos(slope) *
// strength. RoboCop ships SLOP = SLPX = 6 degrees.
const PLAYFIELD_TOTAL_GRAVITY = VPX_TABLE.playfield.gravity * VPX_PLAYFIELD_SCALE
const PLAYFIELD_SLOPE_RADIANS = VPX_TABLE.playfield.slope * Math.PI / 180
const PLAYFIELD_PLANAR_GRAVITY = PLAYFIELD_TOTAL_GRAVITY * Math.sin(PLAYFIELD_SLOPE_RADIANS)
const PLAYFIELD_NORMAL_GRAVITY = PLAYFIELD_TOTAL_GRAVITY * Math.cos(PLAYFIELD_SLOPE_RADIANS)

// The gravity split actually in force. It stays at the table's 6-degree pitch
// unless motion control is on, in which case it tracks the phone's real pitch:
// planar = g*sin(pitch), normal = g*cos(pitch). Hold the phone at a pinball
// machine's angle and it plays normally; hold it vertical and normal gravity
// goes to zero, which removes the normal force friction depends on, so the
// ball simply free-falls at a full g.
const playfieldGravity = {
  planar: PLAYFIELD_PLANAR_GRAVITY,
  normal: PLAYFIELD_NORMAL_GRAVITY,
}
// The ball parks on the plunger tip, one radius up-lane of the plunger centre,
// centred between the walls that form the lane. These come from the VPX rather
// than from an eyeballed box.
const VPX_BALL_RADIUS_UNITS = 25
// A free spinner rests at angle 0, which is exactly where stepVpxSpinnerMover
// wraps 0 <-> 2*PI. Float jitter there crosses the wrap on almost every step
// and reads as a completed revolution, so the switch pulsed forever after the
// spinner had visibly stopped. A spinner only actually gets over the top with
// enough energy to pass angle = PI: 0.5 * w^2 > 2 * g, with the g = 0.025
// restoring term stepVpxSpinnerMover applies.
const SPINNER_TURN_MIN_SPEED = Math.sqrt(4 * 0.025)
// Global pace of the simulation. 1 runs at the VPX-derived rate; higher makes
// the whole table quicker without touching any value taken from the .vpx --
// the ball, flippers, gates and spinner all scale together, and the substep
// count scales with it so collision accuracy is unchanged. Real-time holds
// (kicker dwell, award flashes) are deliberately not scaled.
const GAME_SPEED = 1.2
// Tip of the rod at its park position, then back off one ball radius so the
// ball sits against the tip rather than over the plunger body.
const VPX_PLUNGER_TIP_Y = VPX_TABLE.plunger.center[1]
  - VPX_TABLE.plunger.stroke * (1 - VPX_TABLE.plunger.parkPosition)
const RAPID_FIRE_LANE = {
  left: VPX_TABLE.shooterLane.left * VPX_PLAYFIELD_SCALE,
  right: VPX_TABLE.shooterLane.right * VPX_PLAYFIELD_SCALE,
  top: VPX_TABLE.shooterLane.top * HEIGHT / VPX_TABLE.height,
  bottom: (VPX_PLUNGER_TIP_Y - VPX_BALL_RADIUS_UNITS) * HEIGHT / VPX_TABLE.height,
}
const VPX_PLUNGER_REST = scaleVpxPoint([
  VPX_TABLE.plunger.center[0],
  VPX_PLUNGER_TIP_Y - VPX_BALL_RADIUS_UNITS,
])

type CaptiveBallState = {
  distance: number
  speed: number
  sourceRules: RoboCopRulesState | null
  targetCooldownUntil: number
}

function getCircularWallGeometry(name: string) {
  const wall = VPX_COLLISION_WALL_BY_NAME.get(name)
  if (!wall) return null
  const points = wall.points.map(scaleVpxPoint)
  const center = points.reduce((sum, point) => ({
    x: sum.x + point.x / points.length,
    y: sum.y + point.y / points.length,
  }), { x: 0, y: 0 })
  const radius = points.reduce((sum, point) => (
    sum + Math.hypot(point.x - center.x, point.y - center.y) / points.length
  ), 0)
  return { center, radius }
}

function getCaptiveBallRest() {
  const [firstName, secondName] = VPX_TABLE.captiveBall.restWalls
  const first = getCircularWallGeometry(firstName)
  const second = getCircularWallGeometry(secondName)
  if (!first || !second) return scaleVpxPoint(VPX_TABLE.captiveBall.spawnCenter)

  // Circle-circle intersection: the captive ball's centre must be one captive
  // radius beyond each stop's perimeter. Of the two solutions, the up-table
  // one is the stable pocket above Wall173 and Wall76.
  const radius1 = first.radius + VPX_BALL_RADIUS
  const radius2 = second.radius + VPX_BALL_RADIUS
  const dx = second.center.x - first.center.x
  const dy = second.center.y - first.center.y
  const separation = Math.hypot(dx, dy)
  if (separation < 1e-6) return scaleVpxPoint(VPX_TABLE.captiveBall.spawnCenter)
  const along = (radius1 * radius1 - radius2 * radius2 + separation * separation) / (2 * separation)
  const perpendicular = Math.sqrt(Math.max(0, radius1 * radius1 - along * along))
  const baseX = first.center.x + dx * along / separation
  const baseY = first.center.y + dy * along / separation
  const offsetX = -dy * perpendicular / separation
  const offsetY = dx * perpendicular / separation
  const optionA = { x: baseX + offsetX, y: baseY + offsetY }
  const optionB = { x: baseX - offsetX, y: baseY - offsetY }
  return optionA.y < optionB.y ? optionA : optionB
}

const CAPTIVE_BALL_REST = getCaptiveBallRest()
const CAPTIVE_BALL_TARGET = scaleVpxPoint(VPX_TABLE.captiveBall.targetCenter)
const CAPTIVE_BALL_VECTOR = {
  x: CAPTIVE_BALL_TARGET.x - CAPTIVE_BALL_REST.x,
  y: CAPTIVE_BALL_TARGET.y - CAPTIVE_BALL_REST.y,
}
const CAPTIVE_BALL_AXIS_LENGTH = Math.hypot(CAPTIVE_BALL_VECTOR.x, CAPTIVE_BALL_VECTOR.y)
const CAPTIVE_BALL_AXIS = {
  x: CAPTIVE_BALL_VECTOR.x / CAPTIVE_BALL_AXIS_LENGTH,
  y: CAPTIVE_BALL_VECTOR.y / CAPTIVE_BALL_AXIS_LENGTH,
}
const CAPTIVE_TARGET_DEPTH = VPX_TABLE.captiveBall.targetDepth * HEIGHT / VPX_TABLE.height
const CAPTIVE_BALL_TRAVEL = CAPTIVE_BALL_AXIS_LENGTH - VPX_BALL_RADIUS - CAPTIVE_TARGET_DEPTH / 2
const KICKBACK_CENTER = scaleVpxPoint(VPX_TABLE.kickback.center)
const KICKBACK_TIP_Y = KICKBACK_CENTER.y
  - VPX_TABLE.kickback.stroke * (1 - VPX_TABLE.kickback.parkPosition) * HEIGHT / VPX_TABLE.height
const KICKBACK_HALF_WIDTH = VPX_TABLE.kickback.width * VPX_PLAYFIELD_SCALE / 2
// PlungerMoverObject::Fire and HitPlunger::Collide from VPX. The kickback is
// scripted with PullBack at startup, so its solenoid Fire uses a full pull.
const KICKBACK_LAUNCH_SPEED = vpxPlungerLaunchSpeed(VPX_TABLE.kickback, 1)
  / BALL_TO_VPX_VELOCITY_SCALE

function captiveBallPosition(state: CaptiveBallState) {
  return {
    x: CAPTIVE_BALL_REST.x + CAPTIVE_BALL_AXIS.x * state.distance,
    y: CAPTIVE_BALL_REST.y + CAPTIVE_BALL_AXIS.y * state.distance,
  }
}

function collideCaptiveBall(ball: Ball, state: CaptiveBallState) {
  if (ball.rampTrackIndex != null || ball.capturedBy || ball.z > ball.radius * 0.5) return false
  const captive = captiveBallPosition(state)
  const dx = ball.x - captive.x
  const dy = ball.y - captive.y
  const minimumDistance = ball.radius + VPX_BALL_RADIUS
  const distanceSquared = dx * dx + dy * dy
  if (distanceSquared >= minimumDistance * minimumDistance) return false
  const distance = Math.sqrt(distanceSquared)
  const normalX = distance > 1e-6 ? dx / distance : -CAPTIVE_BALL_AXIS.x
  const normalY = distance > 1e-6 ? dy / distance : -CAPTIVE_BALL_AXIS.y
  const captiveVelocityX = CAPTIVE_BALL_AXIS.x * state.speed
  const captiveVelocityY = CAPTIVE_BALL_AXIS.y * state.speed
  const relativeNormalSpeed = (ball.vx - captiveVelocityX) * normalX
    + (ball.vy - captiveVelocityY) * normalY

  // The captive ball is constrained to its guide, so the normal impulse is
  // projected onto that guide while the transverse component is absorbed by
  // its rails. Equal pinballs use the usual two-body denominator of two.
  if (relativeNormalSpeed < 0) {
    const impulse = -(1 + 0.9) * relativeNormalSpeed / 2
    ball.vx += impulse * normalX
    ball.vy += impulse * normalY
    state.speed -= impulse * (normalX * CAPTIVE_BALL_AXIS.x + normalY * CAPTIVE_BALL_AXIS.y)
    state.speed = Math.max(-32, Math.min(32, state.speed))
    state.sourceRules = ball.rules
  }

  const overlap = minimumDistance - Math.max(distance, 1e-6)
  ball.x += normalX * overlap
  ball.y += normalY * overlap
  return true
}

function stepCaptiveBall(state: CaptiveBallState, step: number, time: number) {
  // Project playfield gravity onto the captive guide. The target is up-table,
  // so this naturally rolls the captive ball back to its lower stop.
  state.speed += CAPTIVE_BALL_AXIS.y * playfieldGravity.planar * step
  state.speed *= Math.pow(0.998, step)
  state.distance += state.speed * step

  if (state.distance <= 0) {
    state.distance = 0
    if (state.speed < 0) state.speed = Math.abs(state.speed) > 0.45 ? -state.speed * 0.12 : 0
    return
  }
  if (state.distance < CAPTIVE_BALL_TRAVEL) return

  state.distance = CAPTIVE_BALL_TRAVEL
  if (state.speed > 0) {
    state.speed = -state.speed * VPX_TABLE.captiveBall.elasticity
    if (state.sourceRules && time >= state.targetCooldownUntil) {
      pulseRoboCopSwitch(state.sourceRules, VPX_TABLE.captiveBall.switchNumber, time)
      state.targetCooldownUntil = time + 100
    }
  }
}

function tryFireLaserKick(ball: Ball, time: number) {
  if (ball.rules.tilted
    || !ball.rules.laserKickLit
    || ball.rampTrackIndex != null
    || ball.capturedBy
    || ball.z > ball.radius * 0.5
    || (ball.objectCooldowns.LaserKick ?? 0) > time
    || Math.abs(ball.x - KICKBACK_CENTER.x) > KICKBACK_HALF_WIDTH + ball.radius
    || ball.y < KICKBACK_TIP_Y - ball.radius
    || ball.y > KICKBACK_CENTER.y + ball.radius) return false

  ball.x = KICKBACK_CENTER.x
  ball.y = KICKBACK_TIP_Y - ball.radius
  ball.vx = 0
  ball.vy = -KICKBACK_LAUNCH_SPEED
  ball.vz = 0
  ball.angularVelocity = 0
  ball.angularVelocityX = 0
  ball.angularVelocityY = 0
  ball.rampTrackIndex = null
  ball.activeRuleVolumes = {}
  ball.flipperCorrectionSamples = {}
  ball.objectCooldowns.LaserKick = time + 900
  return consumeRoboCopLaserKick(ball.rules, time)
}

function drawCaptiveBall(ctx: CanvasRenderingContext2D, state: CaptiveBallState) {
  const position = captiveBallPosition(state)
  const radius = VPX_BALL_RADIUS
  const shine = ctx.createRadialGradient(
    position.x - radius * 0.35,
    position.y - radius * 0.42,
    radius * 0.08,
    position.x,
    position.y,
    radius,
  )
  shine.addColorStop(0, '#ffffff')
  shine.addColorStop(0.2, '#dbe4ea')
  shine.addColorStop(0.58, '#717b84')
  shine.addColorStop(0.82, '#252b31')
  shine.addColorStop(1, '#090b0d')
  ctx.beginPath()
  ctx.arc(position.x, position.y, radius, 0, Math.PI * 2)
  ctx.fillStyle = shine
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,.72)'
  ctx.lineWidth = 1.4
  ctx.stroke()
}

type MechanicalLine<T extends VpxGate | VpxSpinner = VpxGate | VpxSpinner> = {
  source: T
  x1: number; y1: number; x2: number; y2: number
}

const mechanicalLine = <T extends VpxGate | VpxSpinner>(source: T): MechanicalLine<T> => {
  const center = scaleVpxPoint(source.center)
  const rotation = source.rotation * Math.PI / 180
  const halfLength = source.length * VPX_PLAYFIELD_SCALE / 2
  const dx = Math.cos(rotation) * halfLength
  const dy = Math.sin(rotation) * halfLength
  return { source, x1: center.x - dx, y1: center.y - dy, x2: center.x + dx, y2: center.y + dy }
}

const VPX_GATES = (VPX_TABLE.gates as readonly VpxGate[]).map(mechanicalLine)
const VPX_SPINNERS = (VPX_TABLE.spinners as readonly VpxSpinner[]).map(mechanicalLine)
const VPX_KICKERS = (VPX_TABLE.kickers as readonly VpxKicker[]).map((source) => ({
  source,
  center: scaleVpxPoint(source.center),
  ejectCenter: scaleVpxPoint(source.ejectCenter ?? source.center),
  radius: source.radius * VPX_PLAYFIELD_SCALE,
  hitHeight: source.hitHeight * VPX_PLAYFIELD_SCALE,
}))

function railsFromVpxWall(wall: VpxWall, excludedEdge?: number, horizontalEdges = true): Rail[] {
  const heightBand = vpxWallHeightBand(wall)
  return wall.points.flatMap((point, index) => {
    if (index === excludedEdge) return []
    const start = scaleVpxPoint(point)
    const end = scaleVpxPoint(wall.points[(index + 1) % wall.points.length])
    return [{
      x1: start.x, y1: start.y, x2: end.x, y2: end.y, kind: 'wall',
      elasticity: wall.elasticity,
      elasticityFalloff: wall.elasticityFalloff,
      friction: wall.friction,
      scatter: wall.scatter,
      thickness: (wall.thickness ?? 0) * VPX_PLAYFIELD_SCALE,
      heightBottom: heightBand[0] * VPX_PLAYFIELD_SCALE,
      heightTop: heightBand[1] * VPX_PLAYFIELD_SCALE,
      vpxWall: true,
      wallName: horizontalEdges ? wall.name : undefined,
      allowsInvertedEscape: wall.name === 'Wall4',
    }]
  })
}

function railsFromVpxSegment(segment: VpxSegment): Rail[] {
  const start = scaleVpxPoint(segment.from)
  const end = scaleVpxPoint(segment.to)
  const rail: Rail = {
    x1: start.x, y1: start.y, x2: end.x, y2: end.y, kind: 'wall',
    elasticity: segment.elasticity, elasticityFalloff: segment.elasticityFalloff,
    friction: segment.friction, scatter: segment.scatter, thickness: 0,
    heightBottom: 0, heightTop: 65 * VPX_PLAYFIELD_SCALE, vpxWall: true,
    wallName: segment.name,
    switchNumber: /^sw\d+$/.test(segment.name) ? Number(segment.name.slice(2)) : undefined,
  }
  return segment.oneWay ? [rail] : [rail, { ...rail, x1: end.x, y1: end.y, x2: start.x, y2: start.y }]
}

function railFromVpxOneWayGate(gate: MechanicalLine<VpxGate>): Rail {
  const center = scaleVpxPoint(gate.source.center)
  const dx = gate.x2 - gate.x1
  const dy = gate.y2 - gate.y1
  const length = Math.hypot(dx, dy)
  const tangentX = dx / length
  const tangentY = dy / length
  // Gate::PhysicSetup winds this opposite the visible HitGate and extends it
  // by PHYS_SKIN (one ball radius) at both ends to prevent clipping around it.
  const halfLength = length / 2 + VPX_BALL_RADIUS
  return {
    x1: center.x + tangentX * halfLength,
    y1: center.y + tangentY * halfLength,
    x2: center.x - tangentX * halfLength,
    y2: center.y - tangentY * halfLength,
    kind: 'wall',
    elasticity: gate.source.elasticity,
    elasticityFalloff: 0,
    friction: gate.source.friction,
    scatter: 0,
    thickness: 0,
    heightBottom: 0,
    heightTop: VPX_BALL_RADIUS * 2,
    vpxWall: true,
    joint: false,
  }
}

const VPX_PLAYFIELD_RAILS: Rail[] = [
  ...VPX_STATIC_COLLISION_WALLS.flatMap((wall) => railsFromVpxWall(wall)),
  ...VPX_TABLE.rubbers.flatMap((wall) => railsFromVpxWall(wall, undefined, false)),
  ...VPX_TABLE.slingBodies.flatMap((wall) => railsFromVpxWall(wall, wall.slingshotEdge)),
  ...VPX_TABLE.contacts.flatMap(railsFromVpxSegment),
  ...VPX_GATES.filter((gate) => !gate.source.twoWay).map(railFromVpxOneWayGate),
  ...VPX_TABLE.wireGuides.flatMap((guide) => guide.points.slice(0, -1).map((point, index) => {
    const start = scaleVpxPoint(point)
    const end = scaleVpxPoint(guide.points[index + 1])
    const wireRadius = guide.diameter * VPX_PLAYFIELD_SCALE / 2
    return {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y, kind: 'wall' as const,
      elasticity: guide.elasticity, elasticityFalloff: 0, friction: guide.friction, scatter: 0,
      thickness: wireRadius,
      heightBottom: (guide.height - guide.diameter / 2) * VPX_PLAYFIELD_SCALE,
      heightTop: (guide.height + guide.diameter / 2) * VPX_PLAYFIELD_SCALE,
      vpxWall: true,
    }
  })),
  ...VPX_TABLE.slingFaces.map((face) => {
    const start = scaleVpxPoint(face.from)
    const end = scaleVpxPoint(face.to)
    return {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y, kind: 'slingshot' as const,
      elasticity: face.elasticity, elasticityFalloff: face.elasticityFalloff,
      friction: face.friction, scatter: face.scatter, force: face.force, thickness: 0,
      threshold: face.threshold,
      // The face is the missing edge of the sling body polygon (railsFromVpxWall
      // excludes it via slingshotEdge). It has to be swept in the same
      // continuous pass as the body, or a ball can be pushed through the gap
      // into the body's interior and wedge against Wall004 with no way out.
      vpxWall: true,
      wallName: face.name,
      heightBottom: 26 * VPX_PLAYFIELD_SCALE, heightTop: 36 * VPX_PLAYFIELD_SCALE,
      switchNumber: face.name === 'LeftSlingShot' ? 21 : 22,
    }
  }),
]

// The static playfield is ~1600 rail segments. Testing every one of them
// against every ball, on every one of the 12-24 physics substeps per frame,
// was the simulation's dominant cost. The rails never move, so bucket them
// into a uniform grid once and only test the segments a ball's swept path can
// actually reach.
const RAIL_GRID_CELL = 48
const RAIL_GRID_COLUMNS = Math.ceil(WIDTH / RAIL_GRID_CELL) + 1
const RAIL_GRID_ROWS = Math.ceil(HEIGHT / RAIL_GRID_CELL) + 1

class RailGrid {
  readonly rails: readonly Rail[]
  private readonly cells: Int32Array[]
  private readonly stamps: Int32Array
  private readonly scratch: Int32Array
  private stamp = 0

  constructor(rails: readonly Rail[]) {
    this.rails = rails
    this.stamps = new Int32Array(rails.length)
    this.scratch = new Int32Array(rails.length)
    const buckets: number[][] = Array.from(
      { length: RAIL_GRID_COLUMNS * RAIL_GRID_ROWS },
      () => [],
    )
    rails.forEach((rail, index) => {
      // Pad by the segment thickness and a ball radius so a query only has to
      // cover the ball's centre path, not its full silhouette.
      const pad = (rail.thickness ?? 0) + VPX_BALL_RADIUS + 1
      const minColumn = clampColumn(Math.min(rail.x1, rail.x2) - pad)
      const maxColumn = clampColumn(Math.max(rail.x1, rail.x2) + pad)
      const minRow = clampRow(Math.min(rail.y1, rail.y2) - pad)
      const maxRow = clampRow(Math.max(rail.y1, rail.y2) + pad)
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          buckets[row * RAIL_GRID_COLUMNS + column].push(index)
        }
      }
    })
    this.cells = buckets.map((bucket) => Int32Array.from(bucket))
  }

  /**
   * Rail indices whose bucket overlaps the box, de-duplicated. The returned
   * view is reused between calls, so consume it before querying again.
   */
  query(minX: number, minY: number, maxX: number, maxY: number) {
    const minColumn = clampColumn(minX)
    const maxColumn = clampColumn(maxX)
    const minRow = clampRow(minY)
    const maxRow = clampRow(maxY)
    this.stamp += 1
    const stamp = this.stamp
    let count = 0
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const cell = this.cells[row * RAIL_GRID_COLUMNS + column]
        for (let index = 0; index < cell.length; index += 1) {
          const rail = cell[index]
          if (this.stamps[rail] === stamp) continue
          this.stamps[rail] = stamp
          this.scratch[count] = rail
          count += 1
        }
      }
    }
    return this.scratch.subarray(0, count)
  }
}

function clampColumn(x: number) {
  const column = Math.floor(x / RAIL_GRID_CELL)
  return column < 0 ? 0 : column > RAIL_GRID_COLUMNS - 1 ? RAIL_GRID_COLUMNS - 1 : column
}

function clampRow(y: number) {
  const row = Math.floor(y / RAIL_GRID_CELL)
  return row < 0 ? 0 : row > RAIL_GRID_ROWS - 1 ? RAIL_GRID_ROWS - 1 : row
}

type VpxPrimitiveTriangle = {
  ax: number; ay: number; az: number
  bx: number; by: number; bz: number
  cx: number; cy: number; cz: number
  normalX: number; normalY: number; normalZ: number
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
  material: Pick<VpxCollisionPrimitive, 'name' | 'elasticity' | 'elasticityFalloff' | 'friction' | 'scatter'>
}

const VPX_PRIMITIVE_TRIANGLES: readonly VpxPrimitiveTriangle[] = VPX_COLLISION_PRIMITIVES.flatMap((primitive) => {
  const vertices: number[] = []
  for (let index = 0; index < primitive.vertices.length; index += 3) {
    vertices.push(
      primitive.vertices[index] * WIDTH / VPX_TABLE.playableWidth,
      primitive.vertices[index + 1] * HEIGHT / VPX_TABLE.height,
      primitive.vertices[index + 2] * VPX_PLAYFIELD_SCALE,
    )
  }
  const triangles: VpxPrimitiveTriangle[] = []
  for (let index = 0; index < primitive.indices.length; index += 3) {
    const a = primitive.indices[index] * 3
    const b = primitive.indices[index + 1] * 3
    const c = primitive.indices[index + 2] * 3
    const ax = vertices[a]; const ay = vertices[a + 1]; const az = vertices[a + 2]
    const bx = vertices[b]; const by = vertices[b + 1]; const bz = vertices[b + 2]
    const cx = vertices[c]; const cy = vertices[c + 1]; const cz = vertices[c + 2]
    const abx = bx - ax; const aby = by - ay; const abz = bz - az
    const acx = cx - ax; const acy = cy - ay; const acz = cz - az
    let normalX = aby * acz - abz * acy
    let normalY = abz * acx - abx * acz
    let normalZ = abx * acy - aby * acx
    const normalLength = Math.hypot(normalX, normalY, normalZ)
    if (normalLength < 1e-7) continue
    normalX /= normalLength; normalY /= normalLength; normalZ /= normalLength
    triangles.push({
      ax, ay, az, bx, by, bz, cx, cy, cz,
      normalX, normalY, normalZ,
      minX: Math.min(ax, bx, cx), minY: Math.min(ay, by, cy), minZ: Math.min(az, bz, cz),
      maxX: Math.max(ax, bx, cx), maxY: Math.max(ay, by, cy), maxZ: Math.max(az, bz, cz),
      material: primitive,
    })
  }
  return triangles
})

class PrimitiveTriangleGrid {
  readonly triangles: readonly VpxPrimitiveTriangle[]
  private readonly cells: Int32Array[]
  private readonly stamps: Int32Array
  private readonly scratch: Int32Array
  private stamp = 0

  constructor(triangles: readonly VpxPrimitiveTriangle[]) {
    this.triangles = triangles
    this.stamps = new Int32Array(triangles.length)
    this.scratch = new Int32Array(triangles.length)
    const buckets: number[][] = Array.from(
      { length: RAIL_GRID_COLUMNS * RAIL_GRID_ROWS },
      () => [],
    )
    triangles.forEach((triangle, index) => {
      const pad = VPX_BALL_RADIUS + 1
      const minColumn = clampColumn(triangle.minX - pad)
      const maxColumn = clampColumn(triangle.maxX + pad)
      const minRow = clampRow(triangle.minY - pad)
      const maxRow = clampRow(triangle.maxY + pad)
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          buckets[row * RAIL_GRID_COLUMNS + column].push(index)
        }
      }
    })
    this.cells = buckets.map((bucket) => Int32Array.from(bucket))
  }

  query(x: number, y: number) {
    const cell = this.cells[clampRow(y) * RAIL_GRID_COLUMNS + clampColumn(x)]
    this.stamp += 1
    const stamp = this.stamp
    let count = 0
    for (let index = 0; index < cell.length; index += 1) {
      const triangle = cell[index]
      if (this.stamps[triangle] === stamp) continue
      this.stamps[triangle] = stamp
      this.scratch[count] = triangle
      count += 1
    }
    return this.scratch.subarray(0, count)
  }
}

const VPX_PRIMITIVE_TRIANGLE_GRID = new PrimitiveTriangleGrid(VPX_PRIMITIVE_TRIANGLES)

// advanceThroughVpxWalls only ever looks at VPX walls and the post-collision
// sweep only ever looks at the handful of non-wall rails (the slingshot
// faces). Split them once rather than re-filtering ~1600 entries per substep.
const VPX_WALL_RAILS = VPX_PLAYFIELD_RAILS.filter((rail) => rail.vpxWall)
const VPX_WALL_RAIL_GRID = new RailGrid(VPX_WALL_RAILS)
const VPX_LOOSE_RAILS = VPX_PLAYFIELD_RAILS.filter((rail) => !rail.vpxWall)

type VpxWallHorizontalSurface = {
  points: readonly { x: number; y: number }[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  height: number
  normalZ: 1 | -1
  elasticity: number
  elasticityFalloff: number
  friction: number
  scatter: number
}

// Surface::PhysicSetup always creates an upward-facing Hit3DPoly at m_heighttop.
// Side rails alone let airborne balls fall through these authored wall tops.
const VPX_WALL_TOP_SURFACES: readonly VpxWallHorizontalSurface[] = [
  ...VPX_STATIC_COLLISION_WALLS,
  ...VPX_TABLE.slingBodies,
].map((wall) => {
  const heightBand = vpxWallHeightBand(wall)
  const points = wall.points.map(scaleVpxPoint)
  return {
    points,
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
    height: heightBand[1] * VPX_PLAYFIELD_SCALE,
    normalZ: 1 as const,
    elasticity: wall.elasticity,
    elasticityFalloff: wall.elasticityFalloff,
    friction: wall.friction,
    scatter: wall.scatter,
  }
})

// Surface::PhysicSetup adds the downward-facing polygon only when ISBS is set.
const VPX_WALL_BOTTOM_SURFACES: readonly VpxWallHorizontalSurface[] = [
  ...VPX_STATIC_COLLISION_WALLS,
  ...VPX_TABLE.slingBodies,
].filter(vpxWallHasSolidBottom)
  .map((wall) => {
    const heightBand = vpxWallHeightBand(wall)
    const points = wall.points.map(scaleVpxPoint)
    return {
      points,
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y)),
      height: heightBand[0] * VPX_PLAYFIELD_SCALE,
      normalZ: -1 as const,
      elasticity: wall.elasticity,
      elasticityFalloff: wall.elasticityFalloff,
      friction: wall.friction,
      scatter: wall.scatter,
    }
  })

class WallHorizontalSurfaceGrid {
  readonly surfaces: readonly VpxWallHorizontalSurface[]
  private readonly cells: Int32Array[]
  private readonly stamps: Int32Array
  private readonly scratch: Int32Array
  private stamp = 0

  constructor(surfaces: readonly VpxWallHorizontalSurface[]) {
    this.surfaces = surfaces
    this.stamps = new Int32Array(surfaces.length)
    this.scratch = new Int32Array(surfaces.length)
    const buckets: number[][] = Array.from(
      { length: RAIL_GRID_COLUMNS * RAIL_GRID_ROWS },
      () => [],
    )
    surfaces.forEach((surface, index) => {
      const minColumn = clampColumn(surface.minX)
      const maxColumn = clampColumn(surface.maxX)
      const minRow = clampRow(surface.minY)
      const maxRow = clampRow(surface.maxY)
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          buckets[row * RAIL_GRID_COLUMNS + column].push(index)
        }
      }
    })
    this.cells = buckets.map((bucket) => Int32Array.from(bucket))
  }

  query(minX: number, minY: number, maxX: number, maxY: number) {
    const minColumn = clampColumn(minX)
    const maxColumn = clampColumn(maxX)
    const minRow = clampRow(minY)
    const maxRow = clampRow(maxY)
    this.stamp += 1
    const stamp = this.stamp
    let count = 0
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const cell = this.cells[row * RAIL_GRID_COLUMNS + column]
        for (let index = 0; index < cell.length; index += 1) {
          const surface = cell[index]
          if (this.stamps[surface] === stamp) continue
          this.stamps[surface] = stamp
          this.scratch[count] = surface
          count += 1
        }
      }
    }
    return this.scratch.subarray(0, count)
  }
}

const VPX_WALL_TOP_SURFACE_GRID = new WallHorizontalSurfaceGrid(VPX_WALL_TOP_SURFACES)
const VPX_WALL_BOTTOM_SURFACE_GRID = new WallHorizontalSurfaceGrid(VPX_WALL_BOTTOM_SURFACES)

const VPX_BUMPERS: Peg[] = VPX_TABLE.bumpers.map((bumper, index) => {
  const center = scaleVpxPoint(bumper.center)
  return {
    x: center.x, y: center.y, r: bumper.radius * VPX_PLAYFIELD_SCALE, kind: 'bumper',
    // BumperHitCircle inherits HitObject's material defaults in VPX; bumper
    // objects only author their scatter, threshold, and coil force.
    elasticity: 0.3, elasticityFalloff: 0, friction: 0.3,
    scatter: bumper.scatter, force: bumper.force, threshold: bumper.threshold,
    switchNumber: [46, 47, 48][index],
  }
})

type RampNode = {
  x: number; y: number; z: number; width: number; distance: number
  friction: number; elasticity: number; leftWallHeight: number; rightWallHeight: number
}
type RampTrack = {
  name: string
  nodes: readonly RampNode[]
  length: number
  // Planar reject box: the node polyline's extent grown by the widest half
  // width, so tryEnterVpxRamp can dismiss a whole track without walking it.
  minX: number; minY: number; maxX: number; maxY: number
}

function catmullRom(value0: number, value1: number, value2: number, value3: number, t: number) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * ((2 * value1) + (-value0 + value2) * t
    + (2 * value0 - 5 * value1 + 4 * value2 - value3) * t2
    + (-value0 + 3 * value1 - 3 * value2 + value3) * t3)
}

function sampleClosedVpxTrigger(source: VpxTriggerVolume) {
  const controls = source.points.map(scaleVpxPoint)
  if (controls.length < 3 || !source.smooth.some(Boolean)) return controls
  const sampled: { x: number; y: number }[] = []
  for (let index = 0; index < controls.length; index += 1) {
    const p0 = controls[(index - 1 + controls.length) % controls.length]
    const p1 = controls[index]
    const p2 = controls[(index + 1) % controls.length]
    const p3 = controls[(index + 2) % controls.length]
    const subdivisions = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 8))
    const curved = source.smooth[index] || source.smooth[(index + 1) % controls.length]
    for (let subdivision = 0; subdivision < subdivisions; subdivision += 1) {
      const progress = subdivision / subdivisions
      sampled.push(curved ? {
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, progress),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, progress),
      } : {
        x: p1.x + (p2.x - p1.x) * progress,
        y: p1.y + (p2.y - p1.y) * progress,
      })
    }
  }
  return sampled
}

/**
 * Drops sub-ball-radius segments that double back on themselves.
 *
 * VPX ramp parts are authored independently, so a joint between two parts can
 * reverse by a fraction of a unit: RoboCop's shooter wireform climbs to
 * y=159.25 on Ramp91 and then Ramp10 resumes at y=160.88, 1.6 units back
 * down-table. advanceVpxRamp re-projects the ball onto the current segment's
 * tangent every substep, so a sliver pointing backwards flips rampSpeed's
 * sign; the ball reverses out, re-enters and oscillates there forever. A
 * genuine hairpin has long legs and is left alone.
 */
function removeRampSpurs<T extends { x: number; y: number }>(nodes: T[]) {
  for (let index = 1; index < nodes.length - 1; index += 1) {
    const previous = nodes[index - 1]
    const node = nodes[index]
    const next = nodes[index + 1]
    const inX = node.x - previous.x
    const inY = node.y - previous.y
    const outX = next.x - node.x
    const outY = next.y - node.y
    const inLength = Math.hypot(inX, inY)
    const outLength = Math.hypot(outX, outY)
    if (inLength < 1e-6 || outLength < 1e-6) continue
    const reverses = (inX * outX + inY * outY) / (inLength * outLength) < 0
    if (!reverses || Math.min(inLength, outLength) >= VPX_BALL_RADIUS) continue
    nodes.splice(index, 1)
    index -= 1
  }
  return nodes
}

const VPX_RAMP_TRACKS: readonly RampTrack[] = VPX_TABLE.rampTracks.map((track) => {
  const rawNodes: Omit<RampNode, 'distance'>[] = []
  const parts: readonly VpxRamp[] = track.parts
  parts.forEach((ramp) => {
    const sourcePoints = ramp.reverse ? [...ramp.points].reverse() : [...ramp.points]
    const startHeight = ramp.reverse ? ramp.heightTop : ramp.heightBottom
    const endHeight = ramp.reverse ? ramp.heightBottom : ramp.heightTop
    const startWidth = ramp.reverse ? ramp.widthTop : ramp.widthBottom
    const endWidth = ramp.reverse ? ramp.widthBottom : ramp.widthTop
    const sourceDistances = [0]
    for (let index = 1; index < sourcePoints.length; index += 1) {
      sourceDistances.push(sourceDistances[index - 1] + Math.hypot(
        sourcePoints[index][0] - sourcePoints[index - 1][0],
        sourcePoints[index][1] - sourcePoints[index - 1][1],
      ))
    }
    const sourceLength = sourceDistances[sourceDistances.length - 1] || 1
    sourcePoints.forEach((point, index) => {
      const progress = sourceDistances[index] / sourceLength
      const scaled = scaleVpxPoint(point)
      const node = {
        x: scaled.x,
        y: scaled.y,
        z: (startHeight + (endHeight - startHeight) * progress) * VPX_PLAYFIELD_SCALE,
        width: (startWidth + (endWidth - startWidth) * progress) * VPX_PLAYFIELD_SCALE,
        friction: ramp.friction,
        elasticity: ramp.elasticity,
        leftWallHeight: ramp.leftWallHeight * VPX_PLAYFIELD_SCALE,
        rightWallHeight: ramp.rightWallHeight * VPX_PLAYFIELD_SCALE,
      }
      const previous = rawNodes[rawNodes.length - 1]
      if (previous && Math.hypot(node.x - previous.x, node.y - previous.y, node.z - previous.z) < 0.75) return
      rawNodes.push(node)
    })
  })

  removeRampSpurs(rawNodes)

  const sampledNodes: Omit<RampNode, 'distance'>[] = []
  if (track.smooth) {
    for (let index = 0; index < rawNodes.length - 1; index += 1) {
      const p0 = rawNodes[Math.max(0, index - 1)]
      const p1 = rawNodes[index]
      const p2 = rawNodes[index + 1]
      const p3 = rawNodes[Math.min(rawNodes.length - 1, index + 2)]
      const subdivisions = Math.max(3, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 12))
      for (let subdivision = 0; subdivision < subdivisions; subdivision += 1) {
        const progress = subdivision / subdivisions
        sampledNodes.push({
          x: catmullRom(p0.x, p1.x, p2.x, p3.x, progress),
          y: catmullRom(p0.y, p1.y, p2.y, p3.y, progress),
          z: p1.z + (p2.z - p1.z) * progress,
          width: p1.width + (p2.width - p1.width) * progress,
          friction: p1.friction + (p2.friction - p1.friction) * progress,
          elasticity: p1.elasticity + (p2.elasticity - p1.elasticity) * progress,
          leftWallHeight: p1.leftWallHeight + (p2.leftWallHeight - p1.leftWallHeight) * progress,
          rightWallHeight: p1.rightWallHeight + (p2.rightWallHeight - p1.rightWallHeight) * progress,
        })
      }
    }
    sampledNodes.push(rawNodes[rawNodes.length - 1])
  } else {
    sampledNodes.push(...rawNodes)
  }

  let distance = 0
  const nodes = sampledNodes.map((node, index) => {
    if (index > 0) {
      const previous = sampledNodes[index - 1]
      distance += Math.hypot(node.x - previous.x, node.y - previous.y, node.z - previous.z)
    }
    return { ...node, distance }
  })
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, halfWidth = 0
  nodes.forEach((node) => {
    if (node.x < minX) minX = node.x
    if (node.x > maxX) maxX = node.x
    if (node.y < minY) minY = node.y
    if (node.y > maxY) maxY = node.y
    if (node.width / 2 > halfWidth) halfWidth = node.width / 2
  })
  return {
    name: track.name,
    nodes,
    length: distance,
    minX: minX - halfWidth, minY: minY - halfWidth,
    maxX: maxX + halfWidth, maxY: maxY + halfWidth,
  }
})

const VPX_RULE_TRIGGERS = (VPX_TABLE.ruleTriggers as readonly VpxRuleTrigger[]).map((trigger) => {
  const exact = VPX_TRIGGER_BY_NAME.get(trigger.name)
  return {
    source: trigger,
    center: scaleVpxPoint(exact?.center ?? trigger.center),
    radius: (exact?.radius ?? trigger.radius) * VPX_PLAYFIELD_SCALE,
    hitHeight: (exact?.hitHeight ?? trigger.hitHeight) * VPX_PLAYFIELD_SCALE,
    points: exact?.points.length ? sampleClosedVpxTrigger(exact) : trigger.points?.map(scaleVpxPoint),
    rampTrackIndex: trigger.rampTrack
      ? VPX_RAMP_TRACKS.findIndex((track) => track.name === trigger.rampTrack)
      : null,
  }
})

function sampleRamp(track: RampTrack, distance: number) {
  const clamped = Math.max(0, Math.min(track.length, distance))
  let upperIndex = 1
  while (upperIndex < track.nodes.length - 1 && track.nodes[upperIndex].distance < clamped) upperIndex += 1
  const from = track.nodes[upperIndex - 1]
  const to = track.nodes[upperIndex]
  const segmentLength = Math.max(0.0001, to.distance - from.distance)
  const progress = (clamped - from.distance) / segmentLength
  const tangentX = (to.x - from.x) / segmentLength
  const tangentY = (to.y - from.y) / segmentLength
  const tangentZ = (to.z - from.z) / segmentLength
  const planarTangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentY))
  const normalX = -tangentX * tangentZ / planarTangentLength
  const normalY = -tangentY * tangentZ / planarTangentLength
  const normalZ = planarTangentLength
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    z: from.z + (to.z - from.z) * progress,
    width: from.width + (to.width - from.width) * progress,
    friction: from.friction + (to.friction - from.friction) * progress,
    elasticity: from.elasticity + (to.elasticity - from.elasticity) * progress,
    leftWallHeight: from.leftWallHeight + (to.leftWallHeight - from.leftWallHeight) * progress,
    rightWallHeight: from.rightWallHeight + (to.rightWallHeight - from.rightWallHeight) * progress,
    tangentX,
    tangentY,
    tangentZ,
    normalX: -tangentY / planarTangentLength,
    normalY: tangentX / planarTangentLength,
    surfaceNormalX: normalX,
    surfaceNormalY: normalY,
    surfaceNormalZ: normalZ,
  }
}

const VPX_FLIPPER = VPX_TABLE.flippers.left
const FLIPPER_LENGTH = VPX_FLIPPER.length * VPX_PLAYFIELD_SCALE
const FLIPPER_BASE_RADIUS = VPX_FLIPPER.baseRadius * VPX_PLAYFIELD_SCALE
const FLIPPER_END_RADIUS = VPX_FLIPPER.endRadius * VPX_PLAYFIELD_SCALE
const FLIPPER_RUBBER_THICKNESS = VPX_FLIPPER.rubberThickness * VPX_PLAYFIELD_SCALE
const FLIPPER_REST_ANGLE = (VPX_FLIPPER.startAngle - 90) * Math.PI / 180
const FLIPPER_END_ANGLE = (VPX_FLIPPER.endAngle - 90) * Math.PI / 180
const FLIPPER_LEFT_CENTER = scaleVpxPoint(VPX_TABLE.flippers.left.center)
const FLIPPER_RIGHT_CENTER = scaleVpxPoint(VPX_TABLE.flippers.right.center)
const FLIPPER_PARAMETERS: VpxFlipperParameters = {
  startAngle: FLIPPER_REST_ANGLE,
  endAngle: FLIPPER_END_ANGLE,
  length: FLIPPER_LENGTH,
  mass: VPX_FLIPPER.mass,
  // Torque scales with distance squared so angular acceleration matches VPX
  // after mapping table coordinates into the canvas coordinate system.
  strength: VPX_FLIPPER.strength * VPX_PLAYFIELD_SCALE * VPX_PLAYFIELD_SCALE,
  returnRatio: VPX_FLIPPER.returnStrength,
  rampUp: VPX_FLIPPER.rampUp,
  torqueDamping: VPX_FLIPPER.torqueDamping,
  torqueDampingAngle: VPX_FLIPPER.torqueDampingAngle * Math.PI / 180,
  elasticity: VPX_FLIPPER.elasticity,
  elasticityFalloff: VPX_FLIPPER.elasticityFalloff,
  friction: VPX_FLIPPER.friction,
}

type FlipperPolarityState = {
  fireAt: number
  partialFlipCoefficient: number
  pressed: boolean
}

type FlipperScriptState = {
  parameters: VpxFlipperParameters
  phase: 0 | 1 | 2 | 3
  endReachedAt: number
  eosNudge: boolean
  lastCollisionEventAt: number
  pressed: boolean
}

// Exact values from RoboCop's active "Flipper Tricks" script. These are
// deliberately separate from the authored table properties above: the table
// rewrites these properties every millisecond while a game is running.
const FLIPPER_TRICKS = {
  endOfStrokeTorque: VPX_ROBOCOP_SCRIPT_PHYSICS.flipper.endOfStrokeTorque,
  endOfStrokeAngle: VPX_ROBOCOP_SCRIPT_PHYSICS.flipper.endOfStrokeAngleDegrees * Math.PI / 180,
  endOfStrokeRampUp: VPX_ROBOCOP_SCRIPT_PHYSICS.flipper.endOfStrokeRampUp,
  startOfStrokeRampUp: VPX_ROBOCOP_SCRIPT_PHYSICS.flipper.startOfStrokeRampUp,
  restElasticityMultiplier: VPX_ROBOCOP_SCRIPT_PHYSICS.flipper.restElasticityMultiplier,
  returnTorqueRatio: VPX_ROBOCOP_SCRIPT_PHYSICS.flipper.returnTorqueRatio,
  restEndAngleOffset: VPX_ROBOCOP_SCRIPT_PHYSICS.flipper.restEndAngleOffsetDegrees * Math.PI / 180,
  liveCatchMilliseconds: VPX_ROBOCOP_SCRIPT_PHYSICS.flipper.liveCatchMilliseconds,
  liveCatchDistanceMin: VPX_ROBOCOP_SCRIPT_PHYSICS.flipper.liveCatchDistanceMin,
  liveCatchDistanceMax: VPX_ROBOCOP_SCRIPT_PHYSICS.flipper.liveCatchDistanceMax,
} as const

const FLIPPER_DAMPENER_CURVE = VPX_ROBOCOP_SCRIPT_PHYSICS.flipper.dampenerCurve

const createFlipperScriptState = (): FlipperScriptState => ({
  parameters: { ...FLIPPER_PARAMETERS },
  phase: 0,
  endReachedAt: Number.NEGATIVE_INFINITY,
  eosNudge: false,
  lastCollisionEventAt: Number.NEGATIVE_INFINITY,
  pressed: false,
})

const FLIPPER_CORRECTION_TIME_MS = 60
const FLIPPER_CORRECTION_ENDPOINT_X: Record<FlipperSide, number> = {
  // EndPointLp / EndPointRp primitive VPOS values used by the VPX script.
  left: 385.1876525878906,
  right: 493.1711730957031,
}
const FLIPPER_CORRECTION_POLARITY = [
  [0, 0], [0.05, -5], [0.4, -5], [0.6, -4.5], [0.65, -4],
  [0.7, -3.5], [0.75, -3], [0.8, -2.5], [0.85, -2], [0.9, -1.5],
  [0.95, -1], [1, -0.5], [1.1, 0], [1.3, 0],
] as const
const FLIPPER_CORRECTION_VELOCITY = [
  [0, 1], [0.16, 1.06], [0.41, 1.05], [0.53, 1],
  [0.702, 0.968], [0.95, 0.968], [1.03, 0.945],
] as const
const FLIPPER_CORRECTION_TRIGGERS = {
  left: (() => {
    const source = VPX_TRIGGER_BY_NAME.get('TriggerLF')
    return source ? {
      source,
      center: scaleVpxPoint(source.center),
      points: sampleClosedVpxTrigger(source),
      radius: source.radius * VPX_PLAYFIELD_SCALE,
      hitHeight: source.hitHeight * VPX_PLAYFIELD_SCALE,
    } : null
  })(),
  right: (() => {
    const source = VPX_TRIGGER_BY_NAME.get('TriggerRF')
    return source ? {
      source,
      center: scaleVpxPoint(source.center),
      points: sampleClosedVpxTrigger(source),
      radius: source.radius * VPX_PLAYFIELD_SCALE,
      hitHeight: source.hitHeight * VPX_PLAYFIELD_SCALE,
    } : null
  })(),
} as const

const createFlipperPolarityState = (): FlipperPolarityState => ({
  fireAt: Number.NEGATIVE_INFINITY,
  partialFlipCoefficient: 1,
  pressed: false,
})

function linearEnvelope(value: number, points: readonly (readonly [number, number])[]) {
  if (value <= points[0][0]) return points[0][1]
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (value <= current[0]) {
      const progress = (value - previous[0]) / Math.max(1e-9, current[0] - previous[0])
      return previous[1] + (current[1] - previous[1]) * progress
    }
  }
  return points[points.length - 1][1]
}

function activateScriptedFlipper(state: FlipperScriptState) {
  state.pressed = true
  state.parameters.elasticity = FLIPPER_PARAMETERS.elasticity
  state.parameters.torqueDamping = FLIPPER_PARAMETERS.torqueDamping
  state.parameters.torqueDampingAngle = FLIPPER_PARAMETERS.torqueDampingAngle
}

function deactivateScriptedFlipper(
  state: FlipperScriptState,
  mover: VpxFlipperMover,
  balls: Ball[],
  center: { x: number; y: number },
) {
  state.pressed = false
  state.parameters.torqueDampingAngle = FLIPPER_PARAMETERS.torqueDampingAngle
  state.parameters.torqueDamping = FLIPPER_PARAMETERS.torqueDamping
    * FLIPPER_TRICKS.returnTorqueRatio / FLIPPER_PARAMETERS.returnRatio

  // The source table gives a cradled ball a tiny upward velocity when a held
  // flipper is released, preventing the ball from sticking to the bat.
  if (Math.abs(mover.angle - state.parameters.endAngle) > 0.1 * Math.PI / 180) return
  for (const ball of balls) {
    if (!ball.active || ball.finished || ball.parked || ball.heldInShooterLane) continue
    if (Math.hypot(ball.x - center.x, ball.y - center.y) >= 55 * VPX_PLAYFIELD_SCALE) continue
    if (ball.vy * BALL_TO_VPX_VELOCITY_SCALE >= -0.4) {
      ball.vy = -0.4 / BALL_TO_VPX_VELOCITY_SCALE
    }
  }
}

function updateScriptedFlipper(
  state: FlipperScriptState,
  mover: VpxFlipperMover,
  pressed: boolean,
  time: number,
) {
  const atRest = Math.abs(mover.angle - FLIPPER_PARAMETERS.startAngle) < 0.05 * Math.PI / 180
  const atEnd = Math.abs(mover.angle - FLIPPER_PARAMETERS.endAngle) < 0.02 * Math.PI / 180

  if (atRest) {
    if (state.phase !== 1) {
      state.parameters.rampUp = FLIPPER_TRICKS.startOfStrokeRampUp
      state.parameters.endAngle = FLIPPER_PARAMETERS.endAngle - FLIPPER_TRICKS.restEndAngleOffset
      state.parameters.elasticity = FLIPPER_PARAMETERS.elasticity * FLIPPER_TRICKS.restElasticityMultiplier
      state.endReachedAt = Number.NEGATIVE_INFINITY
      state.phase = 1
    }
  } else if (atEnd && pressed) {
    if (!Number.isFinite(state.endReachedAt)) state.endReachedAt = time
    if (state.phase !== 2) {
      state.parameters.torqueDampingAngle = FLIPPER_TRICKS.endOfStrokeAngle
      state.parameters.torqueDamping = FLIPPER_TRICKS.endOfStrokeTorque
      state.parameters.rampUp = FLIPPER_TRICKS.endOfStrokeRampUp
      state.parameters.endAngle = FLIPPER_PARAMETERS.endAngle
      state.phase = 2
    }
  } else if (pressed && state.phase !== 3) {
    state.parameters.torqueDamping = FLIPPER_PARAMETERS.torqueDamping
    state.parameters.torqueDampingAngle = FLIPPER_PARAMETERS.torqueDampingAngle
    state.parameters.rampUp = FLIPPER_PARAMETERS.rampUp
    state.parameters.elasticity = FLIPPER_PARAMETERS.elasticity
    state.parameters.endAngle = FLIPPER_PARAMETERS.endAngle
    state.phase = 3
  }
}

function applyScriptedFlipperContact(
  ball: Ball,
  side: FlipperSide,
  state: FlipperScriptState,
  mover: VpxFlipperMover,
  impactSpeed: number,
  time: number,
  dispatchCollide: boolean,
) {
  // HitFlipper only dispatches the scripted Collide event for a meaningful
  // impact and throttles that event to once per flipper every 250 ms.
  if (impactSpeed <= 0.25 || time - state.lastCollisionEventAt <= 250) return
  state.lastCollisionEventAt = time
  if (!dispatchCollide) return
  const center = side === 'left' ? FLIPPER_LEFT_CENTER : FLIPPER_RIGHT_CENTER
  const catchTime = time - state.endReachedAt
  const horizontalDistance = Math.abs(ball.x - center.x) / VPX_PLAYFIELD_SCALE
  if (
    catchTime >= 0
    && catchTime <= FLIPPER_TRICKS.liveCatchMilliseconds
    && impactSpeed > 6
    && horizontalDistance > FLIPPER_TRICKS.liveCatchDistanceMin
    && horizontalDistance < FLIPPER_TRICKS.liveCatchDistanceMax
  ) {
    const catchBounce = catchTime <= FLIPPER_TRICKS.liveCatchMilliseconds * 0.5
      ? 0
      : Math.abs(FLIPPER_TRICKS.liveCatchMilliseconds * 0.5 - catchTime)
    const direction = side === 'left' ? 1 : -1
    if (catchBounce === 0 && ball.vx * direction > 0) ball.vx = 0
    ball.vy = catchBounce * (32 / FLIPPER_TRICKS.liveCatchMilliseconds)
      / BALL_TO_VPX_VELOCITY_SCALE
    ball.angularVelocity = 0
    ball.angularVelocityX = 0
    ball.angularVelocityY = 0
    return
  }

  // FlippersD.Dampenf: the table only rubberizes gentle upward contacts at
  // end-of-stroke. corSpeed is the same 10 ms pre-impact sample used by VPX.
  if (Math.abs(mover.angle - FLIPPER_PARAMETERS.endAngle) > Math.PI / 180) return
  const velocityX = ball.vx * BALL_TO_VPX_VELOCITY_SCALE
  const velocityY = ball.vy * BALL_TO_VPX_VELOCITY_SCALE
  if (Math.abs(velocityX) >= 2 || velocityY >= 0 || velocityY <= -3.75) return
  const outgoingSpeed = Math.hypot(velocityX, velocityY)
  const desiredCor = linearEnvelope(ball.corSpeed, FLIPPER_DAMPENER_CURVE)
  const realCor = outgoingSpeed / (ball.corSpeed + 0.0001)
  const coefficient = desiredCor / Math.max(realCor, 0.0001)
  ball.vx *= coefficient
  ball.vy *= coefficient
}

function ballInFlipperNudgeTrigger(ball: Ball, rail: Rail) {
  if (!ball.active || ball.finished || ball.parked || ball.heldInShooterLane) return false
  const axisX = rail.x2 - rail.x1
  const axisY = rail.y2 - rail.y1
  const lengthSquared = axisX * axisX + axisY * axisY
  if (lengthSquared <= 1e-6) return false
  const offsetX = ball.x - rail.x1
  const offsetY = ball.y - rail.y1
  const projection = (offsetX * axisX + offsetY * axisY) / lengthSquared
  if (projection < 0 || projection > 1) return false
  const perpendicularDistance = Math.abs(offsetX * axisY - offsetY * axisX) / Math.sqrt(lengthSquared)
  return perpendicularDistance < 48 * VPX_PLAYFIELD_SCALE
}

function applyScriptedFlipperNudge(
  primaryState: FlipperScriptState,
  primaryMover: VpxFlipperMover,
  primaryRail: Rail,
  otherMover: VpxFlipperMover,
  otherRail: Rail,
  balls: Ball[],
) {
  const atEnd = Math.abs(primaryMover.angle - FLIPPER_PARAMETERS.endAngle) < 0.001
  if (atEnd && !primaryState.eosNudge) {
    primaryState.eosNudge = true
    if (Math.abs(otherMover.angle - FLIPPER_PARAMETERS.endAngle) >= 0.001) return
    if (balls.some((ball) => ballInFlipperNudgeTrigger(ball, primaryRail))) return
    for (const ball of balls) {
      if (!ballInFlipperNudgeTrigger(ball, otherRail)) continue
      ball.vx /= 1.3
      ball.vy -= 0.5 / BALL_TO_VPX_VELOCITY_SCALE
    }
  } else if (Math.abs(primaryMover.angle - FLIPPER_PARAMETERS.endAngle) > 30 * Math.PI / 180) {
    primaryState.eosNudge = false
  }
}

const RUBBER_DAMPENER_CURVE = VPX_ROBOCOP_SCRIPT_PHYSICS.rubber.dampenerCurve

function applyVpxTargetBouncer(ball: Ball, objectFactor: number) {
  if (!VPX_ROBOCOP_SCRIPT_PHYSICS.targetBouncer.enabled) return
  // VPX Ball.Z is its centre height; this port stores the lower contact
  // height, so add the radius before applying the script's Z < 30 guard.
  if ((ball.z + ball.radius) / VPX_PLAYFIELD_SCALE >= 30) return
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz)
  if (speed <= 1e-7) return
  const multipliers = [0.2, 0.25, 0.3, 0.4, 0.45, 0.5] as const
  const zMultiplier = multipliers[Math.floor(Math.random() * multipliers.length)]
    * objectFactor * VPX_ROBOCOP_SCRIPT_PHYSICS.targetBouncer.factor
  const velocityRatio = ball.vx === 0 ? 1 : ball.vy / ball.vx
  ball.vz = Math.abs(speed * zMultiplier)
  ball.vx = Math.sign(ball.vx) * Math.sqrt(Math.abs(
    (speed * speed - ball.vz * ball.vz) / (1 + velocityRatio * velocityRatio),
  ))
  ball.vy = ball.vx * velocityRatio
}

function applyVpxCollectionHit(ball: Ball, objectName: string, time: number) {
  const isPost = VPX_DAMPENED_POSTS.has(objectName)
  const isSleeve = VPX_DAMPENED_SLEEVES.has(objectName)
  if (!isPost && !isSleeve) return
  const cooldownKey = `collection-hit-${objectName}`
  if ((ball.objectCooldowns[cooldownKey] ?? 0) > time) return
  ball.objectCooldowns[cooldownKey] = time + 20

  // dPosts_Hit / dSleeves_Hit run after native collision. Their Dampener
  // compares the resulting speed with CoRTracker's latest 10 ms sample and
  // scales planar velocity to the authored data-mined coefficient of return.
  const currentSpeedVpx = Math.hypot(ball.vx, ball.vy, ball.vz)
    * BALL_TO_VPX_VELOCITY_SCALE
  const desiredCor = linearEnvelope(ball.corSpeed, RUBBER_DAMPENER_CURVE)
    * (isSleeve ? VPX_ROBOCOP_SCRIPT_PHYSICS.rubber.sleeveMultiplier : 1)
  const realCor = currentSpeedVpx / (ball.corSpeed + 0.0001)
  if (realCor > 1e-7) {
    const coefficient = desiredCor / realCor
    ball.vx *= coefficient
    ball.vy *= coefficient
  }
  applyVpxTargetBouncer(ball, isSleeve ? 0.7 : 1)
}

const VPX_STANDUP_TARGETS = new Set<string>(VPX_ROBOCOP_SCRIPT_PHYSICS.standup.names)
const VPX_STANDUP_TARGET_SEGMENTS = new Map<string, VpxSegment>(
  VPX_TABLE.contacts
    .filter((contact) => VPX_STANDUP_TARGETS.has(contact.name))
    .map((contact) => [contact.name, contact]),
)
const VPX_STANDUP_TARGET_MASS = VPX_ROBOCOP_SCRIPT_PHYSICS.standup.mass
const VPX_STANDUP_DISABLED_MILLISECONDS = VPX_ROBOCOP_SCRIPT_PHYSICS.standup.disabledMilliseconds

/** Port of RoboCop's STCheckHit followed by DTBallPhysics. */
function applyVpxStandupTargetPhysics(ball: Ball, rail: Rail, incomingNormalSpeed: number) {
  if (!rail.wallName || !VPX_STANDUP_TARGETS.has(rail.wallName)) return null
  const source = VPX_STANDUP_TARGET_SEGMENTS.get(rail.wallName)
  if (!source) return null
  if (Math.abs(incomingNormalSpeed) * BALL_TO_VPX_VELOCITY_SCALE <= (source.threshold ?? 0)) return false
  const faceAngle = Math.atan2(source.to[1] - source.from[1], source.to[0] - source.from[0])
  // The VPX target orientation follows its face. The table script subtracts
  // 90 degrees to obtain the direction normal to that face.
  const responseAngle = faceAngle - Math.PI / 2
  const incomingX = ball.corVelocityX * BALL_TO_VPX_VELOCITY_SCALE
  const incomingY = ball.corVelocityY * BALL_TO_VPX_VELOCITY_SCALE
  const outgoingX = ball.vx * BALL_TO_VPX_VELOCITY_SCALE
  const outgoingY = ball.vy * BALL_TO_VPX_VELOCITY_SCALE
  const incomingAngle = Math.atan2(incomingY, incomingX)
  const outgoingAngle = Math.atan2(outgoingY, outgoingX)
  const outgoingSpeed = Math.hypot(ball.vx, ball.vy, ball.vz) * BALL_TO_VPX_VELOCITY_SCALE
  const normalX = Math.cos(responseAngle)
  const normalY = Math.sin(responseAngle)
  const parallelX = Math.cos(responseAngle + Math.PI / 2)
  const parallelY = Math.sin(responseAngle + Math.PI / 2)
  const perpendicularBefore = ball.corSpeed * Math.cos(incomingAngle - responseAngle)
  const parallelBefore = ball.corSpeed * Math.sin(incomingAngle - responseAngle)
  const perpendicularAfter = outgoingSpeed * Math.cos(outgoingAngle - responseAngle)
  const parallelAfter = outgoingSpeed * Math.sin(outgoingAngle - responseAngle)
  const struckFace = perpendicularBefore > 0 && (
    perpendicularAfter <= 0
    || (parallelBefore > 0 && parallelAfter > 0)
    || (parallelBefore < 0 && parallelAfter < 0)
  )
  if (!struckFace) return false

  const normalAfter = perpendicularBefore
    * (1 - VPX_STANDUP_TARGET_MASS) / (1 + VPX_STANDUP_TARGET_MASS)
  ball.vx = (normalAfter * normalX + parallelBefore * parallelX)
    / BALL_TO_VPX_VELOCITY_SCALE
  ball.vy = (normalAfter * normalY + parallelBefore * parallelY)
    / BALL_TO_VPX_VELOCITY_SCALE
  return true
}

function ballInsideFlipperCorrectionTrigger(ball: Ball, side: FlipperSide) {
  const trigger = FLIPPER_CORRECTION_TRIGGERS[side]
  if (!trigger || !trigger.source.enabled || ball.z > trigger.hitHeight) return false
  if (trigger.points.length > 2) {
    return pointInPolygon(ball.x, ball.y, trigger.points)
  }
  return Math.hypot(ball.x - trigger.center.x, ball.y - trigger.center.y) <= trigger.radius
}

function beginFlipperPolarityCorrection(
  side: FlipperSide,
  balls: Ball[],
  mover: VpxFlipperMover,
  state: FlipperPolarityState,
  time: number,
) {
  state.fireAt = time
  state.partialFlipCoefficient = Math.max(0, Math.min(1, Math.abs(
    (FLIPPER_PARAMETERS.startAngle - mover.angle)
      / (FLIPPER_PARAMETERS.startAngle - FLIPPER_PARAMETERS.endAngle) - 1,
  )))
  const volumeKey = `flipper-correction-${side}`
  balls.forEach((ball) => {
    if (ball.activeRuleVolumes[volumeKey]) {
      ball.flipperCorrectionSamples[side] = { x: ball.x, y: ball.y }
    }
  })
}

function applyFlipperPolarityCorrection(
  ball: Ball,
  side: FlipperSide,
  state: FlipperPolarityState,
  time: number,
) {
  const sample = ball.flipperCorrectionSamples[side] ?? { x: ball.x, y: ball.y }
  delete ball.flipperCorrectionSamples[side]
  if (time >= state.fireAt + FLIPPER_CORRECTION_TIME_MS
    || ball.vy * BALL_TO_VPX_VELOCITY_SCALE > -8) return

  const startX = side === 'left' ? VPX_TABLE.flippers.left.center[0] : VPX_TABLE.flippers.right.center[0]
  const sampleX = sample.x / VPX_PLAYFIELD_SCALE
  const ballPosition = (sampleX - startX) / (FLIPPER_CORRECTION_ENDPOINT_X[side] - startX)
  const rawVelocityCoefficient = linearEnvelope(ballPosition, FLIPPER_CORRECTION_VELOCITY)
  const velocityCoefficient = 1
    + state.partialFlipCoefficient * (rawVelocityCoefficient - 1)
  ball.vx *= velocityCoefficient
  ball.vy *= velocityCoefficient

  const handedness = startX > FLIPPER_CORRECTION_ENDPOINT_X[side] ? -1 : 1
  const polarityVpx = linearEnvelope(ballPosition, FLIPPER_CORRECTION_POLARITY)
    * handedness * state.partialFlipCoefficient
  ball.vx += polarityVpx / BALL_TO_VPX_VELOCITY_SCALE
}

function processFlipperPolarityVolumes(
  ball: Ball,
  time: number,
  states: Record<FlipperSide, FlipperPolarityState>,
) {
  ;(['left', 'right'] as const).forEach((side) => {
    const volumeKey = `flipper-correction-${side}`
    const wasInside = Boolean(ball.activeRuleVolumes[volumeKey])
    const isInside = ballInsideFlipperCorrectionTrigger(ball, side)
    if (wasInside && !isInside) applyFlipperPolarityCorrection(ball, side, states[side], time)
    ball.activeRuleVolumes[volumeKey] = isInside
  })
}

// VPX renders moving objects slightly ahead of the last completed physics
// state to keep input-to-photon latency from adding a whole display frame.
// Keep the real mover/collision state untouched and advance a copy in 1 ms
// increments so this uses the same coil, inertia, damping, and stop model.
const FLIPPER_RENDER_PREDICTION_MS = 8

function predictedFlipperAngle(
  mover: VpxFlipperMover,
  parameters: VpxFlipperParameters,
  pressed: boolean,
  enabled: boolean,
) {
  if (!enabled) return mover.angle
  const predicted = { ...mover }
  for (let millisecond = 0; millisecond < FLIPPER_RENDER_PREDICTION_MS; millisecond += 1) {
    stepVpxFlipperMover(predicted, parameters, pressed, 0.1)
  }
  return predicted.angle
}

const MODES: Mode[] = [
  {
    id: 'rapid-fire',
    name: 'Rapid Fire',
    description: 'Every machine is randomized and fired up the plunger lane in quick succession.',
    accent: '#d71920',
  },
  {
    id: 'start-at-top',
    name: 'Start at Top',
    description: 'Every machine begins together in a randomized cluster on the upper playfield.',
    accent: '#3a86ff',
  },
  {
    id: 'pour-from-top',
    name: 'Pour from Top',
    description: 'Every machine falls from a randomized 3D cloud above the upper playfield.',
    accent: '#8338ec',
  },
  {
    id: 'rules-picker',
    name: '1 Ball Rules',
    description: 'Use RoboCop rules to lock three named games, then let a drain or jackpot make the pick.',
    accent: '#06d6a0',
  },
  {
    id: 'full-game',
    name: 'Full Game',
    description: 'Play a normal three-ball game of RoboCop with scoring, locks, multiball, and extra balls.',
    accent: '#f59e0b',
  },
]

/**
 * Whether a ball's vertical extent overlaps a collision object's height band.
 *
 * VPX measures heights from the playfield and a ball resting on it spans
 * 0..50 (diameter), with its centre one radius up. This port keeps ball.z as
 * the *contact* height -- 0 on the playfield, the surface height on a ramp --
 * so the ball occupies [z, z + 2r], not [z - r, z + r]. Testing it as a
 * centre put a playfield ball's top at 16.81 canvas units, just under the
 * 17.48 where the slingshot band begins, so the slingshots never collided.
 */
function ballOverlapsHeightBand(ball: Ball, heightBottom?: number, heightTop?: number) {
  // VPX builds the horizontal top/bottom polygons and the vertical side as
  // separate colliders. Keep the side's endpoints open here: when a ball is
  // exactly tangent to a horizontal face it must not also be trapped by the
  // 2D side approximation.
  if (ball.z >= (heightTop ?? Number.POSITIVE_INFINITY) - 1e-4) return false
  if (ball.z + ball.radius * 2 <= (heightBottom ?? 0) + 1e-4) return false
  return true
}

/**
 * A VPX velocity (a kicker Kick force, say) in this canvas's units.
 *
 * BALL_TO_VPX_VELOCITY_SCALE is the whole canvas->VPX velocity conversion --
 * VPX_CONTACT_VELOCITY is compared through it with no length factor -- so the
 * inverse is just a divide. Folding VPX_PLAYFIELD_SCALE in as well made every
 * saucer eject 33% weak, which is why the ball could not climb out.
 */
/**
 * Scatter angle for a collision, in degrees.
 *
 * VPX preserves an object's authored zero as "no scatter". Only a negative
 * value requests the table's DefaultScatter override, which is distinct from
 * the implicit playfield plane's own scatter. VPX then scales the selected
 * angle by the table difficulty before shaping the random distribution.
 */
const scatterDegrees = (scatter?: number) => (
  (scatter == null || scatter < 0 ? VPX_TABLE.playfield.defaultScatter : scatter)
  * VPX_TABLE.playfield.difficulty
)

const vpxVelocityToCanvas = (velocity: number) => velocity / BALL_TO_VPX_VELOCITY_SCALE

/** Flipper buttons are inert while the machine is tilted. */
const flipperHeld = (pressed: { left: boolean; right: boolean }, side: 'left' | 'right', tilted: boolean) => (
  !tilted && pressed[side]
)

function collideRail(ball: Ball, rail: Rail) {
  if (!ballOverlapsHeightBand(ball, rail.heightBottom, rail.heightTop)) return false
  const dx = rail.x2 - rail.x1
  const dy = rail.y2 - rail.y1
  const lengthSquared = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((ball.x - rail.x1) * dx + (ball.y - rail.y1) * dy) / lengthSquared))
  const closestX = rail.x1 + t * dx
  const closestY = rail.y1 + t * dy
  const nxRaw = ball.x - closestX
  const nyRaw = ball.y - closestY
  const distance = Math.hypot(nxRaw, nyRaw)
  const railThickness = rail.thickness ?? 5
  if (distance >= ball.radius + railThickness || distance === 0) return false
  const nx = nxRaw / distance
  const ny = nyRaw / distance
  const overlap = ball.radius + railThickness - distance
  ball.x += nx * overlap
  ball.y += ny * overlap
  const rubber = rail.kind !== 'wall'
  const firesSlingshot = !ball.rules.tilted && rail.kind === 'slingshot' && applyVpxSlingshotImpulse(ball, {
    x1: rail.x1,
    y1: rail.y1,
    x2: rail.x2,
    y2: rail.y2,
    normalX: nx,
    normalY: ny,
    threshold: rail.threshold ?? 0,
    force: rail.force ?? 0,
    velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
  })
  const contact = resolveVpxSurfaceContact(ball, {
    normalX: nx,
    normalY: ny,
    elasticity: rail.elasticity ?? (rubber ? 0.62 : 0.48),
    elasticityFalloff: rail.elasticityFalloff ?? 0,
    friction: rail.friction ?? (rubber ? 0.04 : 0.1),
    velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
  })
  if (contact) applyVpxScatter(
    ball,
    scatterDegrees(rail.scatter),
    contact.normalImpulse,
    BALL_TO_VPX_VELOCITY_SCALE,
  )
  // The caller uses this to decide whether the rail's switch closed. A
  // slingshot that did not reach its threshold bounced the ball but did not
  // fire, so it must not register a switch hit either.
  return contact != null && (rail.kind !== 'slingshot' || firesSlingshot)
}

function advanceThroughVpxWalls(
  ball: Ball,
  grid: RailGrid,
  pegs: readonly Peg[],
  step: number,
  externalVelocityDeltaX: number,
  externalVelocityDeltaY: number,
  time: number,
  standupDisabledUntil: Map<string, number>,
) {
  let remainingTime = step
  for (let iteration = 0; iteration < 4 && remainingTime > 1e-6; iteration += 1) {
    let earliest: { rail: Rail; time: number; normalX: number; normalY: number; penetration: number } | null = null
    let earliestPeg: { peg: Peg; time: number; normalX: number; normalY: number; penetration: number } | null = null
    // Box the ball's centre path for this slice of the step; the grid already
    // padded each rail by the ball radius when it was built.
    const sweptX = ball.x + ball.vx * remainingTime
    const sweptY = ball.y + ball.vy * remainingTime
    const candidates = grid.query(
      Math.min(ball.x, sweptX), Math.min(ball.y, sweptY),
      Math.max(ball.x, sweptX), Math.max(ball.y, sweptY),
    )
    for (let index = 0; index < candidates.length; index += 1) {
      const rail = grid.rails[candidates[index]]
      if (!ballOverlapsHeightBand(ball, rail.heightBottom, rail.heightTop)) continue
      if (rail.wallName && (standupDisabledUntil.get(rail.wallName) ?? 0) > time) continue
      if (rail.allowsInvertedEscape && externalVelocityDeltaY < 0) continue
      const hit = getVpxLineSegmentHit(ball, rail, remainingTime)
      if (hit && (!earliest || hit.time < earliest.time)) earliest = { rail, ...hit }
    }
    for (let index = 0; index < pegs.length; index += 1) {
      const peg = pegs[index]
      if (!ballOverlapsHeightBand(ball, 0, 90 * VPX_PLAYFIELD_SCALE)) continue
      const hit = getVpxCircleHit(
        ball,
        peg.x,
        peg.y,
        peg.r ?? 10,
        remainingTime,
        BALL_TO_VPX_VELOCITY_SCALE,
      )
      if (hit && (!earliestPeg || hit.time < earliestPeg.time)) earliestPeg = { peg, ...hit }
    }
    if (!earliest && !earliestPeg) break

    if (earliestPeg && (!earliest || earliestPeg.time < earliest.time)) {
      ball.x += ball.vx * earliestPeg.time
      ball.y += ball.vy * earliestPeg.time
      remainingTime -= earliestPeg.time
      const registersSwitch = resolvePegContact(
        ball,
        earliestPeg.peg,
        earliestPeg.normalX,
        earliestPeg.normalY,
        earliestPeg.penetration,
      )
      if (registersSwitch && earliestPeg.peg.switchNumber) {
        pulseBallRuleSwitch(ball, earliestPeg.peg.switchNumber, time)
      }
      continue
    }
    if (!earliest) break

    ball.x += ball.vx * earliest.time
    ball.y += ball.vy * earliest.time
    remainingTime -= earliest.time
    if (earliest.penetration > 0) {
      ball.x += earliest.normalX * earliest.penetration
      ball.y += earliest.normalY * earliest.penetration
    }

    const normalSpeed = ball.vx * earliest.normalX + ball.vy * earliest.normalY
    // LineSegSlingshot drives the ball into its rubber before the ordinary
    // wall response. Its parabolic force is strongest at the face midpoint.
    const firesSlingshot = !ball.rules.tilted
      && earliest.rail.kind === 'slingshot'
      && applyVpxSlingshotImpulse(ball, {
      x1: earliest.rail.x1,
      y1: earliest.rail.y1,
      x2: earliest.rail.x2,
      y2: earliest.rail.y2,
      normalX: earliest.normalX,
      normalY: earliest.normalY,
      threshold: earliest.rail.threshold ?? 0,
      force: earliest.rail.force ?? 0,
      velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
    })
    const isStaticContact = Math.abs(normalSpeed * BALL_TO_VPX_VELOCITY_SCALE) <= VPX_CONTACT_VELOCITY
    const contact = isStaticContact
      ? resolveVpxStaticContact(ball, {
          normalX: earliest.normalX,
          normalY: earliest.normalY,
          friction: earliest.rail.friction ?? 0.1,
          externalVelocityDeltaX,
          externalVelocityDeltaY,
          velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
        })
      : resolveVpxSurfaceContact(ball, {
          normalX: earliest.normalX,
          normalY: earliest.normalY,
          elasticity: earliest.rail.elasticity ?? 0.48,
          elasticityFalloff: earliest.rail.elasticityFalloff ?? 0,
          friction: earliest.rail.friction ?? 0.1,
          velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
        })
    const standupHit = contact && !isStaticContact
      ? applyVpxStandupTargetPhysics(ball, earliest.rail, normalSpeed)
      : null
    if (standupHit && earliest.rail.wallName) {
      standupDisabledUntil.set(earliest.rail.wallName, time + VPX_STANDUP_DISABLED_MILLISECONDS)
    }
    if (contact && !isStaticContact) {
      applyVpxScatter(
        ball,
        scatterDegrees(earliest.rail.scatter),
        contact.normalImpulse,
        BALL_TO_VPX_VELOCITY_SCALE,
      )
      if (earliest.rail.wallName) applyVpxCollectionHit(ball, earliest.rail.wallName, time)
    }
    // A sling that did not fire bounced the ball but closed no switch.
    const isStandup = Boolean(earliest.rail.wallName && VPX_STANDUP_TARGETS.has(earliest.rail.wallName))
    const registersSwitch = (earliest.rail.kind !== 'slingshot' || firesSlingshot)
      && (!isStandup || standupHit === true)
    if (contact && registersSwitch && earliest.rail.switchNumber) {
      pulseBallRuleSwitch(ball, earliest.rail.switchNumber, time)
    }
  }
  ball.x += ball.vx * remainingTime
  ball.y += ball.vy * remainingTime
}

function getTwoSidedMechanicalHit(ball: Ball, line: MechanicalLine, maximumTime: number) {
  const front = getVpxLineSegmentHit(ball, line, maximumTime)
  const back = getVpxLineSegmentHit(ball, {
    x1: line.x2, y1: line.y2, x2: line.x1, y2: line.y1,
  }, maximumTime)
  if (!front) return back ? { ...back, fromBack: true } : null
  if (!back) return { ...front, fromBack: false }
  return front.time <= back.time
    ? { ...front, fromBack: false }
    : { ...back, fromBack: true }
}

function pulseBallRuleSwitch(ball: Ball, switchNumber: number, time: number, cooldown = 80) {
  const key = `rule-switch-${switchNumber}`
  if ((ball.objectCooldowns[key] ?? 0) > time) return
  if (ball.rules.tilted) {
    ball.objectCooldowns[key] = time + cooldown
    return
  }
  const lockedBalls = ball.rules.lockedBalls
  const jackpotCollected = ball.rules.jackpotCollected
  pulseRoboCopSwitch(ball.rules, switchNumber, time)
  if (switchNumber === 44 || switchNumber === 46 || switchNumber === 47 || switchNumber === 48) {
    ball.pendingCandidateSteps += 1
  }
  if (ball.rules.lockedBalls > lockedBalls) ball.pendingRuleLock = true
  if (!jackpotCollected && ball.rules.jackpotCollected) ball.pendingJackpot = true
  ball.lastRuleSwitch = switchNumber
  ball.objectCooldowns[key] = time + cooldown
}

function pointInPolygon(x: number, y: number, points: readonly { x: number; y: number }[]) {
  let inside = false
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
    const a = points[current]
    const b = points[previous]
    if ((a.y > y) !== (b.y > y)
      && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function processRoboCopRuleTriggers(ball: Ball, time: number) {
  VPX_RULE_TRIGGERS.forEach((trigger) => {
    const isCorrectSurface = trigger.rampTrackIndex == null
      ? ball.z <= trigger.hitHeight
      : ball.rampTrackIndex === trigger.rampTrackIndex
    const insideShape = trigger.points
      ? pointInPolygon(ball.x, ball.y, trigger.points)
      : Math.hypot(ball.x - trigger.center.x, ball.y - trigger.center.y) <= trigger.radius
    const inside = isCorrectSurface && insideShape
    if (inside && !ball.activeRuleVolumes[trigger.source.name]) {
      pulseBallRuleSwitch(ball, trigger.source.switchNumber, time)
    }
    ball.activeRuleVolumes[trigger.source.name] = inside
  })
}

function hitVpxMechanicalObjects(
  ball: Ball,
  step: number,
  time: number,
  gateMovers: Record<string, VpxGateMover>,
  spinnerMovers: Record<string, VpxSpinnerMover>,
) {
  if (ball.rampTrackIndex != null || !ballOverlapsHeightBand(ball, 0, 65 * VPX_PLAYFIELD_SCALE)) return

  VPX_GATES.forEach((gate) => {
    if ((ball.objectCooldowns[gate.source.name] ?? 0) > time) return
    const hit = getTwoSidedMechanicalHit(ball, gate, step)
    if (!hit) return
    const normalSpeed = (ball.vx * hit.normalX + ball.vy * hit.normalY) * BALL_TO_VPX_VELOCITY_SCALE
    hitVpxGateMover(gateMovers[gate.source.name], gate.source, normalSpeed, hit.fromBack)
    ball.objectCooldowns[gate.source.name] = time + 28
  })

  VPX_SPINNERS.forEach((spinner) => {
    if ((ball.objectCooldowns[spinner.source.name] ?? 0) > time) return
    const hit = getTwoSidedMechanicalHit(ball, spinner, step)
    if (!hit) return
    const normalSpeed = (ball.vx * hit.normalX + ball.vy * hit.normalY) * BALL_TO_VPX_VELOCITY_SCALE
    hitVpxSpinnerMover(spinnerMovers[spinner.source.name], spinner.source, normalSpeed, hit.fromBack)
    ball.objectCooldowns[spinner.source.name] = time + 28
  })
}

function updateCapturedVpxKicker(ball: Ball, time: number) {
  if (!ball.capturedBy) return false
  const kicker = VPX_KICKERS.find((candidate) => candidate.source.name === ball.capturedBy)
  if (!kicker) {
    ball.capturedBy = null
    ball.kickerVolume = null
    return false
  }

  ball.x = kicker.center.x
  ball.y = kicker.center.y
  ball.z = 0
  ball.vx = 0; ball.vy = 0; ball.vz = 0
  ball.angularVelocity = 0; ball.angularVelocityX = 0; ball.angularVelocityY = 0
  if (time < ball.releaseAt) return true

  const angle = (
    kicker.source.ejectAngle
    + randomBetween(-(kicker.source.ejectAngleVariance ?? 0), kicker.source.ejectAngleVariance ?? 0)
  ) * Math.PI / 180
  const speedVpx = Math.max(0, kicker.source.ejectSpeed + randomBetween(
    -(kicker.source.ejectSpeedVariance ?? 0),
    kicker.source.ejectSpeedVariance ?? 0,
  ))
  const speed = vpxVelocityToCanvas(speedVpx)
  ball.x = kicker.ejectCenter.x
  ball.y = kicker.ejectCenter.y
  ball.vx = Math.sin(angle) * speed
  ball.vy = -Math.cos(angle) * speed
  ball.capturedBy = null
  ball.kickerVolume = null
  ball.objectCooldowns[kicker.source.name] = time + 240
  return false
}

function tryCaptureVpxKicker(ball: Ball, balls: Ball[], time: number) {
  if (ball.capturedBy || ball.rampTrackIndex != null) return false
  const previousVolume = ball.kickerVolume
  for (const kicker of VPX_KICKERS) {
    if ((ball.objectCooldowns[kicker.source.name] ?? 0) > time) continue
    if (balls.some((candidate) => (
      candidate !== ball
      && !candidate.finished
      && (candidate.capturedBy === kicker.source.name || candidate.parkedAt === kicker.source.name)
    ))) continue
    if (ball.z > kicker.hitHeight) continue
    const dx = ball.x - kicker.center.x
    const dy = ball.y - kicker.center.y
    const distance = Math.hypot(dx, dy)
    // Kicker::PhysicSetup reduces legacy, non-fall-through hit circles to 60%.
    const hitRadius = kicker.radius * (kicker.source.legacy ? 0.6 : 1)
    if (distance > hitRadius) continue

    ball.kickerVolume = kicker.source.name
    const grabDepth = -(1 - kicker.source.hitAccuracy) * ball.radius
    if (!kicker.source.legacy && ball.z > grabDepth) {
      if (previousVolume !== kicker.source.name) {
        // The top ring of VPX's 216-vertex kickerHitMesh uses an inward-facing
        // 0.491/0.871 bevel normal. KickerHitCircle removes velocity along that
        // mesh normal, which slows the approach and drives the ball into the cup.
        let outwardX = distance > 1e-6 ? dx / distance : -ball.vx
        let outwardY = distance > 1e-6 ? dy / distance : -ball.vy
        const outwardLength = Math.hypot(outwardX, outwardY) || 1
        outwardX /= outwardLength
        outwardY /= outwardLength
        resolveVpxKickerBevelContact(ball, {
          meshNormalX: -outwardX * 0.4909,
          meshNormalY: -outwardY * 0.4909,
          meshNormalZ: 0.8712,
          hitNormalX: outwardX,
          hitNormalY: outwardY,
          hitNormalZ: 0,
        })
      }
      return false
    }

    // VPX locks the ball at the surface-height-plus-radius position, zeros
    // linear and angular momentum, and lets the table script issue the kick.
    const kickerSwitch = /^sw\d+$/.test(kicker.source.name)
      ? Number(kicker.source.name.slice(2))
      : null
    if (kickerSwitch) pulseBallRuleSwitch(ball, kickerSwitch, time, 240)
    ball.capturedBy = kicker.source.name
    ball.releaseAt = time + kicker.source.holdMilliseconds
    ball.straightZDrop = false
    ball.rampTrackIndex = null
    ball.x = kicker.center.x
    ball.y = kicker.center.y
    ball.z = 0
    ball.vx = 0; ball.vy = 0; ball.vz = 0
    ball.angularVelocity = 0; ball.angularVelocityX = 0; ball.angularVelocityY = 0
    return true
  }
  if (previousVolume) {
    ball.kickerVolume = null
    if (ball.z < 0) ball.z = 0
    if (ball.vz < 0) ball.vz = 0
  }
  return false
}

function getFlipperRails(leftAngle: number, rightAngle: number): { left: Rail; right: Rail } {
  return {
    left: {
      x1: FLIPPER_LEFT_CENTER.x,
      y1: FLIPPER_LEFT_CENTER.y,
      x2: FLIPPER_LEFT_CENTER.x + Math.cos(leftAngle) * FLIPPER_LENGTH,
      y2: FLIPPER_LEFT_CENTER.y + Math.sin(leftAngle) * FLIPPER_LENGTH,
    },
    right: {
      x1: FLIPPER_RIGHT_CENTER.x,
      y1: FLIPPER_RIGHT_CENTER.y,
      x2: FLIPPER_RIGHT_CENTER.x - Math.cos(rightAngle) * FLIPPER_LENGTH,
      y2: FLIPPER_RIGHT_CENTER.y + Math.sin(rightAngle) * FLIPPER_LENGTH,
    },
  }
}

function collideFlipper(
  ball: Ball,
  rail: Rail,
  mover: VpxFlipperMover,
  parameters: VpxFlipperParameters,
  worldAngularDirection: 1 | -1,
  side: FlipperSide,
  scriptState: FlipperScriptState,
  time: number,
) {
  if (!ballOverlapsHeightBand(ball, 0, 50 * VPX_PLAYFIELD_SCALE)) return false
  const contact = getVpxFlipperProfileContact(
    ball,
    rail.x1,
    rail.y1,
    rail.x2,
    rail.y2,
    FLIPPER_BASE_RADIUS,
    FLIPPER_END_RADIUS,
  )
  if (!contact) return false
  const { normalX: nx, normalY: ny } = contact
  ball.x += nx * contact.penetration
  ball.y += ny * contact.penetration

  const radiusX = ball.x - ball.radius * nx - rail.x1
  const radiusY = ball.y - ball.radius * ny - rail.y1
  const result = resolveVpxFlipperContact(ball, mover, parameters, {
    normalX: nx,
    normalY: ny,
    radiusX,
    radiusY,
    worldAngularDirection,
    ballVelocityScale: BALL_TO_VPX_VELOCITY_SCALE,
  })
  if (!result) return false
  // VPX's circular pivot collider fires the generic Hit event; only the two
  // faces and the end cap dispatch the Collide(parm) callback used by the
  // live-catch script.
  applyScriptedFlipperContact(
    ball,
    side,
    scriptState,
    mover,
    Math.abs(result.normalSpeed),
    time,
    contact.part !== 'base',
  )
  return true
}

function resolvePegContact(ball: Ball, peg: Peg, nx: number, ny: number, penetration: number) {
  const radius = peg.r ?? 10
  if (penetration > 0) {
    ball.x += nx * penetration
    ball.y += ny * penetration
  }
  const isBumper = peg.kind === 'bumper' || (peg.kind !== 'post' && radius > 20)
  const incomingNormalSpeed = ball.vx * nx + ball.vy * ny
  const contact = resolveVpxSurfaceContact(ball, {
    normalX: nx,
    normalY: ny,
    elasticity: peg.elasticity ?? (isBumper ? 0.58 : 0.68),
    elasticityFalloff: peg.elasticityFalloff ?? 0,
    friction: peg.friction ?? (isBumper ? 0.025 : 0.075),
    velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
  })
  if (contact) applyVpxScatter(
    ball,
    scatterDegrees(peg.scatter),
    contact.normalImpulse,
    BALL_TO_VPX_VELOCITY_SCALE,
  )
  if (!contact) return false
  if (!isBumper) return true
  if (ball.rules.tilted) return true
  return applyVpxBumperCoil(ball, incomingNormalSpeed, {
    normalX: nx,
    normalY: ny,
    threshold: peg.threshold ?? 0,
    force: peg.force ?? 0,
    velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
  })
}

function collideBalls(first: Ball, second: Ball) {
  if (!first.active || !second.active || first.finished || second.finished || first.capturedBy || second.capturedBy) return false
  const dx = second.x - first.x
  const dy = second.y - first.y
  const dz = second.z - first.z
  const distance = Math.hypot(dx, dy, dz)
  const minimum = first.radius + second.radius
  if (distance >= minimum) return false
  const relativeVelocityX = second.vx - first.vx
  const relativeVelocityY = second.vy - first.vy
  const relativeVelocityZ = second.vz - first.vz
  const relativeSpeed = Math.hypot(relativeVelocityX, relativeVelocityY, relativeVelocityZ)
  // Exact coincident centers can occur when a mode creates several balls on
  // one source point. VPX's event solver never receives a zero normal; derive
  // a separating normal from relative motion rather than inventing a vertical
  // kick that launches one ball off the table.
  const nx = distance > 1e-6 ? dx / distance : relativeSpeed > 1e-6 ? -relativeVelocityX / relativeSpeed : 1
  const ny = distance > 1e-6 ? dy / distance : relativeSpeed > 1e-6 ? -relativeVelocityY / relativeSpeed : 0
  const nz = distance > 1e-6 ? dz / distance : relativeSpeed > 1e-6 ? -relativeVelocityZ / relativeSpeed : 0
  const overlap = minimum - distance
  first.x -= nx * overlap * 0.5
  first.y -= ny * overlap * 0.5
  first.z = Math.max(0, first.z - nz * overlap * 0.5)
  second.x += nx * overlap * 0.5
  second.y += ny * overlap * 0.5
  second.z = Math.max(0, second.z + nz * overlap * 0.5)

  const closingSpeed = relativeVelocityX * nx + relativeVelocityY * ny + relativeVelocityZ * nz
  if (closingSpeed >= 0) return true
  // VPX uses a fixed 0.8 coefficient of restitution for equal-mass balls.
  const impulse = -(1 + 0.8) * closingSpeed / 2
  first.vx -= impulse * nx
  first.vy -= impulse * ny
  first.vz -= impulse * nz
  second.vx += impulse * nx
  second.vy += impulse * ny
  second.vz += impulse * nz
  return true
}

function traceVpxFlipperProfile(ctx: CanvasRenderingContext2D, length: number, baseRadius: number, endRadius: number) {
  // Direct port of Flipper::SetVertices in VPX. The straight sides touch both
  // circles tangentially instead of merely connecting their widest points.
  const faceAngle = Math.asin((baseRadius - endRadius) / length)
  const normalX = Math.sin(faceAngle)
  const normalY = Math.cos(faceAngle)
  const baseTangentX = baseRadius * normalX
  const endTangentX = length + endRadius * normalX
  const upperAngle = faceAngle - Math.PI / 2
  const lowerAngle = Math.PI / 2 - faceAngle

  ctx.beginPath()
  ctx.moveTo(baseTangentX, -baseRadius * normalY)
  ctx.lineTo(endTangentX, -endRadius * normalY)
  ctx.arc(length, 0, endRadius, upperAngle, lowerAngle)
  ctx.lineTo(baseTangentX, baseRadius * normalY)
  ctx.arc(0, 0, baseRadius, lowerAngle, upperAngle)
  ctx.closePath()
}

function drawFlipper(ctx: CanvasRenderingContext2D, flipper: Rail, fill: string) {
  const dx = flipper.x2 - flipper.x1
  const dy = flipper.y2 - flipper.y1
  const angle = Math.atan2(dy, dx)
  const length = Math.hypot(dx, dy)
  ctx.save()
  ctx.translate(flipper.x1, flipper.y1)
  ctx.rotate(angle)
  traceVpxFlipperProfile(ctx, length, FLIPPER_BASE_RADIUS, FLIPPER_END_RADIUS)
  ctx.fillStyle = '#b52f27'
  ctx.fill()
  ctx.strokeStyle = '#111827'
  ctx.lineWidth = 2
  ctx.stroke()
  traceVpxFlipperProfile(
    ctx,
    length,
    FLIPPER_BASE_RADIUS - FLIPPER_RUBBER_THICKNESS,
    FLIPPER_END_RADIUS - FLIPPER_RUBBER_THICKNESS,
  )
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()
}

function shortName(name: string) {
  return name.length > 16 ? `${name.slice(0, 14)}…` : name
}

function shuffled<T>(values: readonly T[]) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function randomBetween(minimum: number, maximum: number) {
  return minimum + Math.random() * (maximum - minimum)
}

function createTopCluster(count: number) {
  const centerX = randomBetween(WIDTH * 0.44, WIDTH * 0.56)
  const centerY = randomBetween(HEIGHT * 0.12, HEIGHT * 0.15)
  const radiusX = WIDTH * 0.29
  const radiusY = HEIGHT * 0.095
  const minimumDistance = VPX_BALL_RADIUS * 2.12
  const positions: Array<{ x: number; y: number }> = []

  for (let index = 0; index < count; index += 1) {
    let placed = false
    for (let attempt = 0; attempt < 1200; attempt += 1) {
      // sqrt produces an even random distribution inside the cluster rather
      // than concentrating every ball at its center.
      const distance = Math.sqrt(Math.random())
      const angle = Math.random() * Math.PI * 2
      const candidate = {
        x: centerX + Math.cos(angle) * radiusX * distance,
        y: centerY + Math.sin(angle) * radiusY * distance,
      }
      if (candidate.x < VPX_BALL_RADIUS || candidate.x > WIDTH - VPX_BALL_RADIUS) continue
      if (candidate.y < VPX_BALL_RADIUS || candidate.y > HEIGHT * 0.27) continue
      if (positions.every((position) => Math.hypot(candidate.x - position.x, candidate.y - position.y) >= minimumDistance)) {
        positions.push(candidate)
        placed = true
        break
      }
    }

    if (!placed) {
      // This is only a safety net for unusually large future venue lists.
      // Staggered rows preserve a traversable, non-overlapping ball cluster.
      const column = index % 6
      const row = Math.floor(index / 6)
      positions.push({
        x: centerX + (column - 2.5) * minimumDistance + (row % 2 ? minimumDistance * 0.5 : 0),
        y: centerY + (row - 2) * minimumDistance,
      })
    }
  }

  return positions
}

function closestPointOnRamp(track: RampTrack, x: number, y: number) {
  let closest: { distance: number; planarDistance: number } | null = null
  for (let index = 0; index < track.nodes.length - 1; index += 1) {
    const from = track.nodes[index]
    const to = track.nodes[index + 1]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const lengthSquared = dx * dx + dy * dy
    const progress = lengthSquared > 1e-6
      ? Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / lengthSquared))
      : 0
    const pointX = from.x + dx * progress
    const pointY = from.y + dy * progress
    const planarDistance = Math.hypot(x - pointX, y - pointY)
    if (!closest || planarDistance < closest.planarDistance) {
      closest = {
        distance: from.distance + (to.distance - from.distance) * progress,
        planarDistance,
      }
    }
  }
  return closest
}

function attachBallToRamp(ball: Ball, trackIndex: number, distance: number) {
  const sampled = sampleRamp(VPX_RAMP_TRACKS[trackIndex], distance)
  const offset = (ball.x - sampled.x) * sampled.normalX + (ball.y - sampled.y) * sampled.normalY
  const maximumOffset = Math.max(0, sampled.width / 2 - ball.radius)
  ball.rampTrackIndex = trackIndex
  ball.rampDistance = distance
  ball.rampSpeed = ball.vx * sampled.tangentX + ball.vy * sampled.tangentY + ball.vz * sampled.tangentZ
  ball.rampOffset = Math.max(-maximumOffset, Math.min(maximumOffset, offset))
  ball.rampLateralSpeed = ball.vx * sampled.normalX + ball.vy * sampled.normalY
  ball.x = sampled.x + sampled.normalX * ball.rampOffset
  ball.y = sampled.y + sampled.normalY * ball.rampOffset
  ball.z = sampled.z
  ball.straightZDrop = false
}

/**
 * True when a playfield ball is passing beneath a raised ramp surface.
 *
 * The table renders as a flat pre-baked image, so nothing depth-sorts the ball
 * against the ramps drawn into it. The ramp tracks already carry per-node
 * heights for the physics, so ask them directly rather than baking a separate
 * occlusion layer.
 */
function isUnderVpxRamp(ball: Ball) {
  // A ball riding a ramp is on top of it, never under it.
  if (ball.rampTrackIndex != null) return false
  for (let index = 0; index < VPX_RAMP_TRACKS.length; index += 1) {
    const track = VPX_RAMP_TRACKS[index]
    if (ball.x < track.minX || ball.x > track.maxX) continue
    if (ball.y < track.minY || ball.y > track.maxY) continue
    const closest = closestPointOnRamp(track, ball.x, ball.y)
    if (!closest) continue
    const surface = sampleRamp(track, closest.distance)
    if (closest.planarDistance > surface.width / 2) continue
    // Clear the actual top of the ball before treating the ramp as an
    // overpass. z is the contact height, so the top is z + the diameter.
    if (surface.z > ball.z + ball.radius * 2 + 0.5) return true
  }
  return false
}

function tryEnterVpxRamp(ball: Ball, step: number) {
  if (ball.rampTrackIndex != null) return false
  let best: {
    trackIndex: number
    distance: number
    score: number
    crossingProgress: number
    crossesSurface: boolean
  } | null = null

  VPX_RAMP_TRACKS.forEach((track, trackIndex) => {
    // Each closestPointOnRamp call walks every sampled node, and this runs for
    // every ball on every substep. Skip tracks the ball's swept path misses.
    const sweptX = ball.x + ball.vx * step
    const sweptY = ball.y + ball.vy * step
    const margin = ball.radius * 1.35
    if (Math.min(ball.x, sweptX) - margin > track.maxX) return
    if (Math.max(ball.x, sweptX) + margin < track.minX) return
    if (Math.min(ball.y, sweptY) - margin > track.maxY) return
    if (Math.max(ball.y, sweptY) + margin < track.minY) return
    const currentClosest = closestPointOnRamp(track, ball.x, ball.y)
    const nextClosest = closestPointOnRamp(track, ball.x + ball.vx * step, ball.y + ball.vy * step)
    if (!currentClosest || !nextClosest) return
    const currentSurface = sampleRamp(track, currentClosest.distance)
    const nextSurface = sampleRamp(track, nextClosest.distance)
    const withinCurrentWidth = currentClosest.planarDistance <= currentSurface.width / 2 + ball.radius * 0.35
    const withinNextWidth = nextClosest.planarDistance <= nextSurface.width / 2 + ball.radius * 0.35
    if (!withinCurrentWidth && !withinNextWidth) return

    // Continuous ball-versus-ramp test. Comparing signed height above the
    // surface at both ends of the physics step prevents fast drops and steep
    // ramp entries from tunneling through the collision strip.
    const currentGap = ball.z - currentSurface.z
    const nextGap = ball.z + ball.vz * step - nextSurface.z
    const normalSpeed = ball.vx * currentSurface.surfaceNormalX
      + ball.vy * currentSurface.surfaceNormalY
      + ball.vz * currentSurface.surfaceNormalZ
    const crossesSurface = currentGap >= -1
      && currentGap <= ball.radius * 1.25
      && nextGap <= 1
      && normalSpeed <= 0.1
    const crossingProgress = crossesSurface && currentGap > nextGap
      ? Math.max(0, Math.min(1, currentGap / (currentGap - nextGap)))
      : 0
    const impactX = ball.x + ball.vx * step * crossingProgress
    const impactY = ball.y + ball.vy * step * crossingProgress
    const impactClosest = crossesSurface ? closestPointOnRamp(track, impactX, impactY) : currentClosest
    if (!impactClosest) return
    const sampled = sampleRamp(track, impactClosest.distance)
    if (impactClosest.planarDistance > sampled.width / 2 + ball.radius * 0.35) return

    const nearStart = impactClosest.distance <= ball.radius * 1.25
    const nearEnd = track.length - impactClosest.distance <= ball.radius * 1.25
    const longitudinalSpeed = ball.vx * sampled.tangentX + ball.vy * sampled.tangentY + ball.vz * sampled.tangentZ

    // closestPointOnRamp clamps to the polyline, so a ball that has run off an
    // end still projects onto the final node and passes the surface test.
    // Without this, advanceVpxRamp releases the ball at the tip and the very
    // next substep re-attaches it, trapping it there. Running off an end means
    // leaving the track, not landing on it.
    const runningOffEnd = track.length - impactClosest.distance <= 1e-3 && longitudinalSpeed > 0
    const runningOffStart = impactClosest.distance <= 1e-3 && longitudinalSpeed < 0
    if (runningOffEnd || runningOffStart) return

    const enteringEndpoint = Math.abs(ball.z - sampled.z) <= ball.radius * 0.85
      && ((nearStart && longitudinalSpeed > 0.12) || (nearEnd && longitudinalSpeed < -0.12))
    if (!crossesSurface && !enteringEndpoint) return

    const score = impactClosest.planarDistance + Math.abs(ball.z - sampled.z) * 0.5
    if (!best || score < best.score) {
      best = {
        trackIndex,
        distance: impactClosest.distance,
        score,
        crossingProgress,
        crossesSurface,
      }
    }
  })

  const selected = best as {
    trackIndex: number
    distance: number
    score: number
    crossingProgress: number
    crossesSurface: boolean
  } | null
  if (!selected) return false
  if (selected.crossesSurface) {
    const sampled = sampleRamp(VPX_RAMP_TRACKS[selected.trackIndex], selected.distance)
    const normalSpeed = ball.vx * sampled.surfaceNormalX
      + ball.vy * sampled.surfaceNormalY
      + ball.vz * sampled.surfaceNormalZ
    if (Math.abs(normalSpeed) * BALL_TO_VPX_VELOCITY_SCALE > VPX_CONTACT_VELOCITY) {
      ball.x += ball.vx * step * selected.crossingProgress
      ball.y += ball.vy * step * selected.crossingProgress
      ball.z = sampled.z
      resolveVpxSpatialSurfaceContact(ball, {
        normalX: sampled.surfaceNormalX,
        normalY: sampled.surfaceNormalY,
        normalZ: sampled.surfaceNormalZ,
        elasticity: sampled.elasticity,
        elasticityFalloff: 0,
        friction: sampled.friction,
        velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
      })
      return true
    }
  }
  attachBallToRamp(ball, selected.trackIndex, selected.distance)
  return true
}

function advanceVpxRamp(
  ball: Ball,
  step: number,
  vpxStep: number,
  accelerationX: number,
  accelerationY: number,
) {
  if (ball.rampTrackIndex == null) return false
  const track = VPX_RAMP_TRACKS[ball.rampTrackIndex]
  const current = sampleRamp(track, ball.rampDistance)

  // VPX ramps are 3D collision surfaces. Project the complete gravity vector
  // onto both the ramp centerline and its cross-table axis.
  const tangentAcceleration = (
    accelerationX * current.tangentX
    + accelerationY * current.tangentY
    - playfieldGravity.normal * current.tangentZ
  )
  const lateralAcceleration = accelerationX * current.normalX + accelerationY * current.normalY
  ball.rampSpeed += tangentAcceleration * step
  ball.rampLateralSpeed += lateralAcceleration * step

  ball.vx = current.tangentX * ball.rampSpeed + current.normalX * ball.rampLateralSpeed
  ball.vy = current.tangentY * ball.rampSpeed + current.normalY * ball.rampLateralSpeed
  ball.vz = current.tangentZ * ball.rampSpeed
  applyVpxSurfaceFriction(ball, {
    deltaTime: vpxStep,
    friction: current.friction,
    normalAcceleration: Math.max(0, playfieldGravity.normal * current.surfaceNormalZ
      - accelerationX * current.surfaceNormalX
      - accelerationY * current.surfaceNormalY),
    tangentAcceleration,
    lateralAcceleration,
    tangentX: current.tangentX,
    tangentY: current.tangentY,
    tangentZ: current.tangentZ,
    lateralX: current.normalX,
    lateralY: current.normalY,
    lateralZ: 0,
    normalX: current.surfaceNormalX,
    normalY: current.surfaceNormalY,
    normalZ: current.surfaceNormalZ,
  })
  ball.rampSpeed = ball.vx * current.tangentX + ball.vy * current.tangentY + ball.vz * current.tangentZ
  ball.rampLateralSpeed = ball.vx * current.normalX + ball.vy * current.normalY
  ball.rampDistance += ball.rampSpeed * step
  ball.rampOffset += ball.rampLateralSpeed * step

  const leftTrack = ball.rampDistance < 0
  const leftTop = ball.rampDistance > track.length
  const sampled = sampleRamp(track, ball.rampDistance)
  const maximumOffset = Math.max(0, sampled.width / 2 - ball.radius)
  const hitsLeftWall = ball.rampOffset > maximumOffset && sampled.leftWallHeight >= ball.radius
  const hitsRightWall = ball.rampOffset < -maximumOffset && sampled.rightWallHeight >= ball.radius
  if (hitsLeftWall || hitsRightWall) {
    ball.rampOffset = Math.max(-maximumOffset, Math.min(maximumOffset, ball.rampOffset))
    ball.vx = sampled.tangentX * ball.rampSpeed + sampled.normalX * ball.rampLateralSpeed
    ball.vy = sampled.tangentY * ball.rampSpeed + sampled.normalY * ball.rampLateralSpeed
    resolveVpxSurfaceContact(ball, {
      normalX: hitsLeftWall ? -sampled.normalX : sampled.normalX,
      normalY: hitsLeftWall ? -sampled.normalY : sampled.normalY,
      elasticity: sampled.elasticity,
      elasticityFalloff: 0,
      friction: sampled.friction,
      velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
    })
    ball.rampSpeed = ball.vx * sampled.tangentX + ball.vy * sampled.tangentY
      + ball.vz * sampled.tangentZ
    ball.rampLateralSpeed = ball.vx * sampled.normalX + ball.vy * sampled.normalY
  }

  const overflow = leftTrack ? ball.rampDistance : leftTop ? ball.rampDistance - track.length : 0
  ball.x = sampled.x + sampled.normalX * ball.rampOffset + sampled.tangentX * overflow
  ball.y = sampled.y + sampled.normalY * ball.rampOffset + sampled.tangentY * overflow
  ball.z = Math.max(0, sampled.z + sampled.tangentZ * overflow)
  ball.vx = sampled.tangentX * ball.rampSpeed + sampled.normalX * ball.rampLateralSpeed
  ball.vy = sampled.tangentY * ball.rampSpeed + sampled.normalY * ball.rampLateralSpeed
  ball.vz = sampled.tangentZ * ball.rampSpeed

  if (leftTrack || leftTop) {
    ball.rampTrackIndex = null
    const handoff = VPX_TABLE.rampHandoffs.find((entry) => entry.rampTrack === track.name
      && entry.atTrackStart === leftTrack)
    if (handoff) {
      const spot = scaleVpxPoint(handoff.center)
      const angle = handoff.ejectAngle * Math.PI / 180
      const speed = vpxVelocityToCanvas(handoff.ejectSpeed)
      ball.x = spot.x
      ball.y = spot.y
      ball.z = 0
      ball.vx = Math.sin(angle) * speed
      ball.vy = -Math.cos(angle) * speed
      ball.vz = 0
      ball.rampOffset = 0
    }
  }
  return true
}

function synchronizeRampBallAfterCollision(ball: Ball) {
  if (ball.rampTrackIndex == null) return
  const track = VPX_RAMP_TRACKS[ball.rampTrackIndex]
  const closest = closestPointOnRamp(track, ball.x, ball.y)
  if (closest && Math.abs(closest.distance - ball.rampDistance) <= ball.radius * 1.5) {
    ball.rampDistance = closest.distance
  }
  const sampled = sampleRamp(track, ball.rampDistance)
  const separatingNormalSpeed = ball.vx * sampled.surfaceNormalX
    + ball.vy * sampled.surfaceNormalY
    + ball.vz * sampled.surfaceNormalZ
  // A ball-to-ball impact can legitimately lift a ball off a ramp. Preserve
  // that 3D impulse instead of snapping it back to the surface next step.
  if (separatingNormalSpeed * BALL_TO_VPX_VELOCITY_SCALE > VPX_CONTACT_VELOCITY) {
    ball.rampTrackIndex = null
    return
  }

  ball.rampSpeed = ball.vx * sampled.tangentX + ball.vy * sampled.tangentY + ball.vz * sampled.tangentZ
  ball.rampLateralSpeed = ball.vx * sampled.normalX + ball.vy * sampled.normalY
  const offset = (ball.x - sampled.x) * sampled.normalX + (ball.y - sampled.y) * sampled.normalY
  const maximumOffset = Math.max(0, sampled.width / 2 - ball.radius)
  ball.rampOffset = Math.max(-maximumOffset, Math.min(maximumOffset, offset))
  ball.x = sampled.x + sampled.normalX * ball.rampOffset
  ball.y = sampled.y + sampled.normalY * ball.rampOffset
  ball.z = sampled.z
}

function findVpxWallHorizontalSurface(
  ball: Ball,
  previousZ: number,
  nextZ: number,
  step: number,
) {
  if (ball.rampTrackIndex != null) return null
  let selected: { surface: VpxWallHorizontalSurface; progress: number } | null = null
  const grid = nextZ <= previousZ ? VPX_WALL_TOP_SURFACE_GRID : VPX_WALL_BOTTOM_SURFACE_GRID
  const nextX = ball.x + ball.vx * step
  const nextY = ball.y + ball.vy * step
  const candidates = grid.query(
    Math.min(ball.x, nextX), Math.min(ball.y, nextY),
    Math.max(ball.x, nextX), Math.max(ball.y, nextY),
  )
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const surface = grid.surfaces[candidates[candidateIndex]]
    const contactZ = surface.normalZ > 0 ? surface.height : surface.height - ball.radius * 2
    // Top polygons catch a downward-moving ball by its bottom; a solid bottom
    // catches an upward-moving ball by its top. contactZ expresses both in this
    // port's bottom-of-ball z coordinate.
    if (surface.normalZ > 0) {
      if (previousZ < contactZ - 1e-4 || nextZ > contactZ + 1e-4) continue
    } else if (previousZ > contactZ + 1e-4 || nextZ < contactZ - 1e-4) continue
    const denominator = nextZ - previousZ
    const progress = Math.abs(denominator) > 1e-8
      ? Math.max(0, Math.min(1, (contactZ - previousZ) / denominator))
      : 0
    const impactX = ball.x + ball.vx * step * progress
    const impactY = ball.y + ball.vy * step * progress
    if (
      impactX < surface.minX || impactX > surface.maxX
      || impactY < surface.minY || impactY > surface.maxY
    ) continue
    if (!pointInPolygon(impactX, impactY, surface.points)) continue
    if (!selected || progress < selected.progress) selected = { surface, progress }
  }
  return selected?.surface ?? null
}

/**
 * Advances vertical motion and returns the static surface supporting the ball,
 * if any. A bouncing impact already receives VPX's collision friction here and
 * is therefore not returned for a second continuous-friction pass.
 */
function advanceBallHeight(ball: Ball, step: number): VpxWallHorizontalSurface | null {
  const kicker = ball.kickerVolume
    ? VPX_KICKERS.find((candidate) => candidate.source.name === ball.kickerVolume)
    : null
  const floorZ = kicker && !kicker.source.legacy
    ? -(1 - kicker.source.hitAccuracy) * ball.radius - 0.25
    : 0
  if (ball.z <= floorZ && ball.vz <= 0) return null
  const previousZ = ball.z
  ball.vz -= playfieldGravity.normal * step
  const nextZ = ball.z + ball.vz * step
  const wallSurface = findVpxWallHorizontalSurface(ball, previousZ, nextZ, step)
  if (wallSurface) {
    ball.z = wallSurface.normalZ > 0
      ? wallSurface.height
      : wallSurface.height - ball.radius * 2
    const impactSpeed = Math.abs(ball.vz)
    if (impactSpeed > 0.8) {
      const contact = resolveVpxSpatialSurfaceContact(ball, {
        normalX: 0,
        normalY: 0,
        normalZ: wallSurface.normalZ,
        elasticity: wallSurface.elasticity,
        elasticityFalloff: wallSurface.elasticityFalloff,
        friction: wallSurface.friction,
        velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
      })
      if (contact) applyVpxScatter(
        ball,
        scatterDegrees(wallSurface.scatter),
        contact.normalImpulse,
        BALL_TO_VPX_VELOCITY_SCALE,
      )
      return null
    }
    ball.vz = 0
    // Only an upward-facing polygon can continuously support a resting ball.
    return wallSurface.normalZ > 0 ? wallSurface : null
  }

  ball.z = nextZ
  if (ball.z >= floorZ) return null
  ball.z = floorZ
  if (floorZ < 0) {
    ball.vz = 0
    return null
  }
  const impactSpeed = Math.abs(ball.vz)
  if (impactSpeed > 0.8) {
    resolveVpxSpatialSurfaceContact(ball, {
      normalX: 0,
      normalY: 0,
      normalZ: 1,
      elasticity: VPX_TABLE.playfield.elasticity,
      elasticityFalloff: VPX_TABLE.playfield.elasticityFalloff,
      friction: VPX_TABLE.playfield.friction,
      velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
    })
  } else {
    ball.vz = 0
  }
  return null
}

/**
 * VPX surrounds every Surface top with HitLine3D cylinders and HitPoint end
 * caps (and repeats them at a solid bottom). A closest-point capsule is the
 * same contact shape, including the spherical endpoints, without rotating the
 * ball into a temporary cylinder coordinate system as the C++ implementation
 * does. The rail grid keeps this to nearby polygon edges only.
 */
function collideVpxWallHorizontalEdges(ball: Ball) {
  if (ball.rampTrackIndex != null || ball.capturedBy || ball.kickerVolume) return false
  let collided = false
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const candidateIndices = VPX_WALL_RAIL_GRID.query(ball.x, ball.y, ball.x, ball.y)
    let deepest: {
      rail: Rail
      normalX: number
      normalY: number
      normalZ: number
      penetration: number
    } | null = null

    for (let index = 0; index < candidateIndices.length; index += 1) {
      const rail = VPX_WALL_RAIL_GRID.rails[candidateIndices[index]]
      // Only Surface polygons receive the paired horizontal HitLine3D edges.
      // Rubbers, wire guides, and standalone one-way gate LineSegs have their
      // own collision shapes and deliberately carry no wallName.
      if (!rail.wallName) continue
      const dx = rail.x2 - rail.x1
      const dy = rail.y2 - rail.y1
      const length = Math.hypot(dx, dy)
      if (length < 1e-6) continue
      const unitX = dx / length
      const unitY = dy / length
      const along = Math.max(0, Math.min(length, (ball.x - rail.x1) * unitX + (ball.y - rail.y1) * unitY))
      const closestX = rail.x1 + unitX * along
      const closestY = rail.y1 + unitY * along
      const centerZ = ball.z + ball.radius
      const solidBottom = rail.wallName != null && vpxWallHasSolidBottom(rail.wallName)
      const heights = solidBottom
        ? [rail.heightTop, rail.heightBottom]
        : [rail.heightTop]

      for (let surfaceIndex = 0; surfaceIndex < heights.length; surfaceIndex += 1) {
        const height = heights[surfaceIndex]
        if (height == null) continue
        const isTop = surfaceIndex === 0
        // The vertical side owns the lower half of a top edge and the upper
        // half of a bottom edge. This prevents the approximated side and the
        // 3D capsule from applying the same corner impulse twice.
        if (isTop ? centerZ < height - 1e-4 : centerZ > height + 1e-4) continue
        const offsetX = ball.x - closestX
        const offsetY = ball.y - closestY
        const offsetZ = centerZ - height
        const distanceSquared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ
        if (distanceSquared >= ball.radius * ball.radius) continue
        const distance = Math.sqrt(distanceSquared)
        let normalX: number
        let normalY: number
        let normalZ: number
        if (distance > 1e-6) {
          normalX = offsetX / distance
          normalY = offsetY / distance
          normalZ = offsetZ / distance
        } else {
          // Exact center-on-edge is degenerate in VPX too. Use the component
          // of incoming velocity perpendicular to the finite edge to produce
          // a stable separating direction.
          const parallelSpeed = ball.vx * unitX + ball.vy * unitY
          const perpendicularX = ball.vx - parallelSpeed * unitX
          const perpendicularY = ball.vy - parallelSpeed * unitY
          const perpendicularLength = Math.hypot(perpendicularX, perpendicularY, ball.vz)
          normalX = perpendicularLength > 1e-6 ? -perpendicularX / perpendicularLength : -unitY
          normalY = perpendicularLength > 1e-6 ? -perpendicularY / perpendicularLength : unitX
          normalZ = perpendicularLength > 1e-6 ? -ball.vz / perpendicularLength : 0
        }
        const penetration = ball.radius - distance
        if (!deepest || penetration > deepest.penetration) {
          deepest = { rail, normalX, normalY, normalZ, penetration }
        }
      }
    }

    if (!deepest) break
    collided = true
    ball.x += deepest.normalX * deepest.penetration
    ball.y += deepest.normalY * deepest.penetration
    ball.z += deepest.normalZ * deepest.penetration
    const normalSpeed = ball.vx * deepest.normalX
      + ball.vy * deepest.normalY
      + ball.vz * deepest.normalZ
    if (normalSpeed >= 0) continue
    const staticContact = Math.abs(normalSpeed) * BALL_TO_VPX_VELOCITY_SCALE <= VPX_CONTACT_VELOCITY
    const contact = resolveVpxSpatialSurfaceContact(ball, {
      normalX: deepest.normalX,
      normalY: deepest.normalY,
      normalZ: deepest.normalZ,
      elasticity: staticContact ? 0 : deepest.rail.elasticity ?? 0.25,
      elasticityFalloff: deepest.rail.elasticityFalloff ?? 0,
      friction: deepest.rail.friction ?? VPX_TABLE.playfield.friction,
      velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
    })
    if (contact && !staticContact) applyVpxScatter(
      ball,
      scatterDegrees(deepest.rail.scatter),
      contact.normalImpulse,
      BALL_TO_VPX_VELOCITY_SCALE,
    )
  }
  return collided
}

function closestPointOnPrimitiveTriangle(
  px: number,
  py: number,
  pz: number,
  triangle: VpxPrimitiveTriangle,
  output: { x: number; y: number; z: number },
) {
  const abx = triangle.bx - triangle.ax
  const aby = triangle.by - triangle.ay
  const abz = triangle.bz - triangle.az
  const acx = triangle.cx - triangle.ax
  const acy = triangle.cy - triangle.ay
  const acz = triangle.cz - triangle.az
  const apx = px - triangle.ax
  const apy = py - triangle.ay
  const apz = pz - triangle.az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) {
    output.x = triangle.ax; output.y = triangle.ay; output.z = triangle.az
    return
  }

  const bpx = px - triangle.bx
  const bpy = py - triangle.by
  const bpz = pz - triangle.bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) {
    output.x = triangle.bx; output.y = triangle.by; output.z = triangle.bz
    return
  }

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const along = d1 / (d1 - d3)
    output.x = triangle.ax + abx * along
    output.y = triangle.ay + aby * along
    output.z = triangle.az + abz * along
    return
  }

  const cpx = px - triangle.cx
  const cpy = py - triangle.cy
  const cpz = pz - triangle.cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) {
    output.x = triangle.cx; output.y = triangle.cy; output.z = triangle.cz
    return
  }

  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const along = d2 / (d2 - d6)
    output.x = triangle.ax + acx * along
    output.y = triangle.ay + acy * along
    output.z = triangle.az + acz * along
    return
  }

  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const along = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    output.x = triangle.bx + (triangle.cx - triangle.bx) * along
    output.y = triangle.by + (triangle.cy - triangle.by) * along
    output.z = triangle.bz + (triangle.cz - triangle.bz) * along
    return
  }

  const denominator = 1 / (va + vb + vc)
  const v = vb * denominator
  const w = vc * denominator
  output.x = triangle.ax + abx * v + acx * w
  output.y = triangle.ay + aby * v + acy * w
  output.z = triangle.az + abz * v + acz * w
}

/** Discrete sphere contact against the exact collidable primitive triangles. */
function collideVpxPrimitiveMeshes(ball: Ball, time: number) {
  if (ball.rampTrackIndex != null || ball.capturedBy || ball.kickerVolume) return false
  const closest = { x: 0, y: 0, z: 0 }
  let collided = false
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const centerZ = ball.z + ball.radius
    const candidates = VPX_PRIMITIVE_TRIANGLE_GRID.query(ball.x, ball.y)
    let deepest: {
      triangle: VpxPrimitiveTriangle
      normalX: number
      normalY: number
      normalZ: number
      penetration: number
    } | null = null
    for (let index = 0; index < candidates.length; index += 1) {
      const triangle = VPX_PRIMITIVE_TRIANGLE_GRID.triangles[candidates[index]]
      if (centerZ + ball.radius < triangle.minZ || centerZ - ball.radius > triangle.maxZ) continue
      closestPointOnPrimitiveTriangle(ball.x, ball.y, centerZ, triangle, closest)
      const offsetX = ball.x - closest.x
      const offsetY = ball.y - closest.y
      const offsetZ = centerZ - closest.z
      const distanceSquared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ
      if (distanceSquared >= ball.radius * ball.radius) continue
      const distance = Math.sqrt(distanceSquared)
      let normalX: number
      let normalY: number
      let normalZ: number
      if (distance > 1e-6) {
        normalX = offsetX / distance
        normalY = offsetY / distance
        normalZ = offsetZ / distance
      } else {
        normalX = triangle.normalX
        normalY = triangle.normalY
        normalZ = triangle.normalZ
        if (ball.vx * normalX + ball.vy * normalY + ball.vz * normalZ > 0) {
          normalX = -normalX; normalY = -normalY; normalZ = -normalZ
        }
      }
      const penetration = ball.radius - distance
      if (!deepest || penetration > deepest.penetration) {
        deepest = { triangle, normalX, normalY, normalZ, penetration }
      }
    }
    if (!deepest) break

    collided = true
    ball.x += deepest.normalX * deepest.penetration
    ball.y += deepest.normalY * deepest.penetration
    ball.z += deepest.normalZ * deepest.penetration
    const normalSpeed = ball.vx * deepest.normalX
      + ball.vy * deepest.normalY
      + ball.vz * deepest.normalZ
    if (normalSpeed >= 0) continue
    const staticContact = Math.abs(normalSpeed) * BALL_TO_VPX_VELOCITY_SCALE <= VPX_CONTACT_VELOCITY
    const material = deepest.triangle.material
    const contact = resolveVpxSpatialSurfaceContact(ball, {
      normalX: deepest.normalX,
      normalY: deepest.normalY,
      normalZ: deepest.normalZ,
      elasticity: staticContact ? 0 : material.elasticity,
      elasticityFalloff: material.elasticityFalloff,
      friction: material.friction,
      velocityScale: BALL_TO_VPX_VELOCITY_SCALE,
    })
    if (contact && !staticContact) applyVpxScatter(
      ball,
      scatterDegrees(material.scatter),
      contact.normalImpulse,
      BALL_TO_VPX_VELOCITY_SCALE,
    )
    if (contact && !staticContact) applyVpxCollectionHit(ball, material.name, time)
  }
  return collided
}

export function VenuePinballPicker() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ballsRef = useRef<Ball[]>([])
  const frameRef = useRef<number | null>(null)
  const lastTimeRef = useRef(0)
  const runningRef = useRef(false)
  const finishingRef = useRef<string[]>([])
  const tiltRef = useRef(0)
  const verticalGravityRef = useRef(1)
  const motionBaselineRef = useRef<number | null>(null)
  const lastNudgeRef = useRef(0)
  const nudgeHistoryRef = useRef<number[]>([])
  const motionNoticeTimerRef = useRef<number | null>(null)
  const rouletteTimersRef = useRef<number[]>([])
  const plungerStartYRef = useRef(0)
  const plungerPullRef = useRef(0)
  const plungerDraggingRef = useRef(false)
  const tiltedRef = useRef(false)
  const rulesPickerRef = useRef<{
    candidate: string
    locked: string[]
    phase: RulesPickerPhase
    awaitingPlunge: boolean
    sharedRules: RoboCopRulesState
  }>({
    candidate: '',
    locked: [],
    phase: 'idle',
    awaitingPlunge: false,
    sharedRules: createRoboCopRulesState(),
  })
  const fullGameRef = useRef<{
    ballNumber: number
    phase: FullGamePhase
    multiballSpawned: boolean
    displayedScore: number
    sharedRules: RoboCopRulesState
  }>({
    ballNumber: 1,
    phase: 'idle',
    multiballSpawned: false,
    displayedScore: 0,
    sharedRules: createRoboCopRulesState(),
  })
  const candidateDeckRef = useRef<string[]>([])
  const flipperPressedRef = useRef({ left: false, right: false })
  const drawRef = useRef<() => void>(() => {})
  const flipperMoversRef = useRef({
    left: createVpxFlipperMover(FLIPPER_PARAMETERS),
    right: createVpxFlipperMover(FLIPPER_PARAMETERS),
  })
  const flipperScriptRef = useRef<Record<FlipperSide, FlipperScriptState>>({
    left: createFlipperScriptState(),
    right: createFlipperScriptState(),
  })
  const flipperPolarityRef = useRef<Record<FlipperSide, FlipperPolarityState>>({
    left: createFlipperPolarityState(),
    right: createFlipperPolarityState(),
  })
  const gateMoversRef = useRef<Record<string, VpxGateMover>>(Object.fromEntries(
    VPX_TABLE.gates.map((gate) => [gate.name, createVpxGateMover(gate)]),
  ))
  const spinnerMoversRef = useRef<Record<string, VpxSpinnerMover>>(Object.fromEntries(
    VPX_TABLE.spinners.map((spinner) => [spinner.name, createVpxSpinnerMover()]),
  ))
  const standupDisabledUntilRef = useRef(new Map<string, number>())
  const captiveBallRef = useRef<CaptiveBallState>({
    distance: 0,
    speed: 0,
    sourceRules: null,
    targetCooldownUntil: 0,
  })
  const { display } = useMachineCanon()
  const [venues, setVenues] = useState<Venue[]>([])
  const [venueKey, setVenueKey] = useState('')
  const [modeId, setModeId] = useState(MODES[0].id)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [ranking, setRanking] = useState<string[]>([])
  const [celebration, setCelebration] = useState<string | null>(null)
  const [rouletteBackglass, setRouletteBackglass] = useState<string | null>(null)
  const [rulesCandidate, setRulesCandidate] = useState('')
  const [rulesLocked, setRulesLocked] = useState<string[]>([])
  const [rulesPhase, setRulesPhase] = useState<RulesPickerPhase>('idle')
  const [fullGameBall, setFullGameBall] = useState(1)
  const [fullGameScore, setFullGameScore] = useState(0)
  const [fullGamePhase, setFullGamePhase] = useState<FullGamePhase>('idle')
  const [awaitingPlunge, setAwaitingPlunge] = useState(false)
  const [plungerOpen, setPlungerOpen] = useState(false)
  const [plungerPull, setPlungerPull] = useState(0)
  const [motionEnabled, setMotionEnabled] = useState(false)
  const [motionNotice, setMotionNotice] = useState<string | null>(null)
  const [tilted, setTilted] = useState(false)

  const venue = venues.find((item) => item.key === venueKey) ?? venues.find((item) => item.name === venueKey)
  const mode = MODES.find((item) => item.id === modeId) ?? MODES[0]
  const playfieldPegs = VPX_BUMPERS
  // Venue lists speak canonical short keys. Preserve those keys through the
  // entire race; long names are display-only and must never be fed back into
  // image or data lookups.
  const machineKeys = useMemo(() => venue?.machines ?? [], [venue])
  const getActiveRulesStates = useCallback(() => {
    const seen = new Set<RoboCopRulesState>()
    return ballsRef.current.flatMap((ball) => {
      if (ball.finished || seen.has(ball.rules)) return []
      seen.add(ball.rules)
      return [ball.rules]
    })
  }, [])

  const syncRulesPickerState = useCallback(() => {
    setRulesCandidate(rulesPickerRef.current.candidate)
    setRulesLocked([...rulesPickerRef.current.locked])
    setRulesPhase(rulesPickerRef.current.phase)
    setAwaitingPlunge(rulesPickerRef.current.awaitingPlunge)
  }, [])

  const nextRulesCandidate = useCallback(() => {
    if (machineKeys.length === 0) return ''
    if (candidateDeckRef.current.length === 0) {
      const previous = rulesPickerRef.current.candidate
      candidateDeckRef.current = shuffled(machineKeys)
      if (candidateDeckRef.current.length > 1 && candidateDeckRef.current[0] === previous) {
        ;[candidateDeckRef.current[0], candidateDeckRef.current[1]] = [candidateDeckRef.current[1], candidateDeckRef.current[0]]
      }
    }
    const next = candidateDeckRef.current.shift() ?? machineKeys[0]
    rulesPickerRef.current.candidate = next
    setRulesCandidate(next)
    return next
  }, [machineKeys])

  useEffect(() => {
    fetch('/api/venues')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not load venues')))
      .then((data) => {
        const next = (data.venues ?? []).filter((item: Venue) => item.machines?.length)
        setVenues(next)
        const defaultVenue = next.find((item: Venue) => item.name === 'Georgetown Pizza and Arcade') ?? next[0]
        if (defaultVenue) setVenueKey(defaultVenue.key || defaultVenue.name)
      })
      .finally(() => setLoading(false))
  }, [])

  const showMotionNotice = useCallback((message: string, duration = 500) => {
    setMotionNotice(message)
    if (motionNoticeTimerRef.current) window.clearTimeout(motionNoticeTimerRef.current)
    motionNoticeTimerRef.current = window.setTimeout(() => setMotionNotice(null), duration)
  }, [])

  useEffect(() => {
    if (!motionEnabled) return

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (tiltedRef.current) return
      if (event.gamma != null) {
        if (motionBaselineRef.current == null) motionBaselineRef.current = event.gamma
        const relativeTilt = event.gamma - motionBaselineRef.current
        tiltRef.current = Math.max(-1, Math.min(1, relativeTilt / 24))
      }
      // beta is ~90° when a portrait phone is upright, ~0° when it is face-up
      // and flat. Treat it as the table's pitch and split gravity by it, the
      // same way the fixed 6-degree slope is split. Vertical therefore means
      // planar = 1g and normal = 0: a frictionless free fall. cos is clamped
      // at 0 so tipping past vertical never produces a negative normal force.
      if (event.beta != null) {
        const pitch = event.beta * Math.PI / 180
        verticalGravityRef.current = Math.sin(pitch)
        const normal = Math.cos(pitch)
        playfieldGravity.planar = PLAYFIELD_TOTAL_GRAVITY * Math.sin(pitch)
        // Snap a near-vertical phone to exactly zero: Math.cos(PI/2) is 6e-17,
        // not 0, which would keep applyVpxPlayfieldFriction's early-out from
        // firing and leave a nominally frictionless fall running the friction
        // solver every substep.
        playfieldGravity.normal = normal > 0.001 ? PLAYFIELD_TOTAL_GRAVITY * normal : 0
      }
    }

    const handleMotion = (event: DeviceMotionEvent) => {
      if (tiltedRef.current) return
      const acceleration = event.acceleration
      if (!acceleration) return
      const magnitude = Math.hypot(acceleration.x ?? 0, acceleration.y ?? 0, acceleration.z ?? 0)
      const now = performance.now()
      if (magnitude < 7.5 || now - lastNudgeRef.current < 550) return
      lastNudgeRef.current = now
      nudgeHistoryRef.current = [...nudgeHistoryRef.current.filter((time) => now - time < 2400), now]

      if (nudgeHistoryRef.current.length >= 3) {
        tiltedRef.current = true
        setTilted(true)
        tiltRef.current = 0
        nudgeHistoryRef.current = []
        const seenRules = new Set<RoboCopRulesState>()
        ballsRef.current.forEach((ball) => {
          if (ball.finished || seenRules.has(ball.rules)) return
          seenRules.add(ball.rules)
          tiltRoboCopBall(ball.rules, now)
        })
        ballsRef.current.forEach((ball) => {
          ball.pendingCandidateSteps = 0
          ball.pendingRuleLock = false
          ball.pendingJackpot = false
        })
        showMotionNotice('TILT', 1800)
        return
      }

      const direction = (acceleration.x ?? 0) >= 0 ? 1 : -1
      ballsRef.current.forEach((ball) => {
        if (ball.active && !ball.finished && !ball.capturedBy) {
          ball.vx += direction * 2.2
          ball.vy -= 0.65
          if (ball.rampTrackIndex != null) {
            const ramp = sampleRamp(VPX_RAMP_TRACKS[ball.rampTrackIndex], ball.rampDistance)
            ball.rampSpeed = ball.vx * ramp.tangentX + ball.vy * ramp.tangentY + ball.vz * ramp.tangentZ
            ball.rampLateralSpeed = ball.vx * ramp.normalX + ball.vy * ramp.normalY
          }
        }
      })
      // Two warnings, then the tilt: DANGER, DANGER, TILT.
      showMotionNotice('DANGER')
    }

    window.addEventListener('deviceorientation', handleOrientation)
    window.addEventListener('devicemotion', handleMotion)
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation)
      window.removeEventListener('devicemotion', handleMotion)
      tiltRef.current = 0
      verticalGravityRef.current = 1
      playfieldGravity.planar = PLAYFIELD_PLANAR_GRAVITY
      playfieldGravity.normal = PLAYFIELD_NORMAL_GRAVITY
    }
  }, [motionEnabled, showMotionNotice, tilted])

  useEffect(() => () => {
    if (motionNoticeTimerRef.current) window.clearTimeout(motionNoticeTimerRef.current)
    rouletteTimersRef.current.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const setFlipperInput = useCallback((side: 'left' | 'right', pressed: boolean) => {
    if (flipperPressedRef.current[side] === pressed) return
    flipperPressedRef.current[side] = pressed
    // The 2-0-9 lanes are a rotating bank on the machine: every flip shifts
    // which of them are lit. Rotate on the press edge only, not on release.
    if (pressed && !tiltedRef.current) {
      const seen = new Set<RoboCopRulesState>()
      ballsRef.current.forEach((ball) => {
        if (ball.finished || seen.has(ball.rules)) return
        seen.add(ball.rules)
        rotateRoboCopTopLanes(ball.rules, side)
      })
    }
    // Drawing directly from the input event lets the browser include the
    // predicted flipper pose in its next paint instead of waiting for our
    // already-scheduled animation callback.
    drawRef.current()
  }, [])

  useEffect(() => {
    const setKey = (event: KeyboardEvent, pressed: boolean) => {
      if (event.key === 'ArrowLeft' || event.key === 'Shift') {
        setFlipperInput('left', pressed)
        event.preventDefault()
      }
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        setFlipperInput('right', pressed)
        event.preventDefault()
      }
    }
    const keyDown = (event: KeyboardEvent) => setKey(event, true)
    const keyUp = (event: KeyboardEvent) => setKey(event, false)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [setFlipperInput])

  const enableMotion = async () => {
    try {
      const orientationApi = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }
      const motionApi = DeviceMotionEvent as typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }
      const orientationPermission = orientationApi.requestPermission ? await orientationApi.requestPermission() : 'granted'
      const motionPermission = motionApi.requestPermission ? await motionApi.requestPermission() : 'granted'
      if (orientationPermission !== 'granted' || motionPermission !== 'granted') {
        showMotionNotice('MOTION DENIED', 1400)
        return
      }
      motionBaselineRef.current = null
      verticalGravityRef.current = 1
      nudgeHistoryRef.current = []
      setMotionEnabled(true)
      showMotionNotice('MOTION READY', 1000)
    } catch {
      showMotionNotice('MOTION UNAVAILABLE', 1400)
    }
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    const flippers = getFlipperRails(
      predictedFlipperAngle(flipperMoversRef.current.left, flipperScriptRef.current.left.parameters, flipperHeld(flipperPressedRef.current, 'left', tiltedRef.current), runningRef.current),
      predictedFlipperAngle(flipperMoversRef.current.right, flipperScriptRef.current.right.parameters, flipperHeld(flipperPressedRef.current, 'right', tiltedRef.current), runningRef.current),
    )
    ;([flippers.left, flippers.right] as Rail[]).forEach((flipper, index) => {
      const side = index === 0 ? 'left' : 'right'
      drawFlipper(ctx, flipper, flipperHeld(flipperPressedRef.current, side, tiltedRef.current) ? '#fff36a' : '#ffd92f')
    })
    drawCaptiveBall(ctx, captiveBallRef.current)

    ballsRef.current.forEach((ball, index) => {
      if ((!ball.active && !ball.heldInShooterLane) || ball.parked || ball.finished) return
      // The z axis points out of the screen toward the viewer. Very high pour
      // balls are beyond the near viewing plane and appear only as they fall
      // close enough to the table, all at the same x/y drop point.
      if (ball.straightZDrop && ball.z > 320) return
      // Balls travelling under a ramp read as a dim shape through it. The label
      // stays at full strength -- knowing which machine is where is the point.
      const occluded = isUnderVpxRamp(ball)
      if (occluded) {
        ctx.globalAlpha = 0.32
        ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2)
        ctx.fillStyle = ball.color; ctx.fill()
        ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.stroke()
        ctx.globalAlpha = 1
      } else {
        // A cached sprite instead of ctx.shadowBlur: the blur is re-run by the
        // rasteriser for every ball on every frame and is by far the most
        // expensive thing this draw loop can do.
        const glow = getBallGlowSprite(ball.color)
        const glowRadius = ball.radius + BALL_GLOW_SPREAD
        ctx.drawImage(glow, ball.x - glowRadius, ball.y - glowRadius, glowRadius * 2, glowRadius * 2)
        ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2)
        ctx.fillStyle = ball.color; ctx.fill()
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
      }
      // Only machine balls are captioned. The rules-picker ball is unnamed and
      // carries no text at all -- not its index, not its running score.
      const name = shortName(ball.label)
      const labelX = Math.max(52, Math.min(WIDTH - 52, ball.x))
      if (name) {
        ctx.fillStyle = '#fff'; ctx.font = '700 10px sans-serif'; ctx.textAlign = 'center'
        ctx.fillText(String(index + 1), ball.x, ball.y + 3)
        ctx.font = '600 11px sans-serif'
        const scoreLabel = ball.rules.score > 0 ? ` · ${formatRoboCopScore(ball.rules.score)}` : ''
        ctx.fillText(`${name}${scoreLabel}`, labelX, ball.y - ball.radius - 8)
      }
      if (name && ball.rules.lastAward && ball.rules.lastAwardUntil > performance.now()) {
        ctx.fillStyle = '#ffe45e'; ctx.font = '800 9px sans-serif'
        ctx.fillText(ball.rules.lastAward, labelX, ball.y - ball.radius - 21)
      }
    })
  }, [])

  useEffect(() => {
    drawRef.current = draw
    return () => { drawRef.current = () => {} }
  }, [draw])

  const stop = useCallback(() => {
    runningRef.current = false
    setRunning(false)
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    plungerDraggingRef.current = false
    plungerPullRef.current = 0
    setPlungerPull(0)
    setPlungerOpen(false)
  }, [])

  const clearRoulette = useCallback(() => {
    rouletteTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    rouletteTimersRef.current = []
    setRouletteBackglass(null)
  }, [])

  const makeRulesBall = useCallback((
    machineKey: string,
    rules: RoboCopRulesState,
    options: RulesBallOptions = {},
  ): Ball => ({
    machineKey,
    label: machineKey ? display(machineKey) : '',
    x: options.x ?? VPX_PLUNGER_REST.x,
    y: options.y ?? VPX_PLUNGER_REST.y,
    vx: 0,
    vy: 0,
    angularVelocity: 0,
    angularVelocityX: 0,
    angularVelocityY: 0,
    radius: VPX_BALL_RADIUS,
    color: machineKey ? PALETTE[(options.colorIndex ?? 0) % PALETTE.length] : '#f8fafc',
    z: 0,
    vz: 0,
    straightZDrop: false,
    rampTrackIndex: null,
    rampDistance: 0,
    rampSpeed: 0,
    rampOffset: 0,
    rampLateralSpeed: 0,
    active: options.active ?? false,
    launchAt: Number.POSITIVE_INFINITY,
    capturedBy: null,
    kickerVolume: null,
    releaseAt: 0,
    objectCooldowns: {},
    activeRuleVolumes: {},
    flipperCorrectionSamples: {},
    corSpeed: 0,
    corVelocityX: 0,
    corVelocityY: 0,
    corElapsedMilliseconds: 0,
    rules,
    isRegularBall: !machineKey,
    parked: options.parked ?? false,
    parkedAt: options.parkedAt ?? null,
    heldInShooterLane: options.heldInShooterLane ?? false,
    pendingCandidateSteps: 0,
    pendingRuleLock: false,
    pendingJackpot: false,
    lastRuleSwitch: null,
    finished: false,
  }), [display])

  const parkRulesBallAtLock = useCallback((ball: Ball, lockIndex: number) => {
    const kickerName = ['sw28', 'sw29', 'sw30'][Math.max(0, Math.min(2, lockIndex))]
    const kicker = VPX_KICKERS.find((candidate) => candidate.source.name === kickerName)
    ball.active = false
    ball.parked = true
    ball.parkedAt = kickerName
    ball.heldInShooterLane = false
    ball.capturedBy = null
    ball.kickerVolume = null
    ball.rampTrackIndex = null
    ball.vx = 0
    ball.vy = 0
    ball.vz = 0
    ball.angularVelocity = 0
    ball.angularVelocityX = 0
    ball.angularVelocityY = 0
    if (kicker) {
      ball.x = kicker.center.x
      ball.y = kicker.center.y
      ball.z = 0
    }
  }, [])

  const ejectRulesBall = useCallback((ball: Ball, kickerIndex: number, time: number) => {
    const kickerName = ball.parkedAt ?? ['sw28', 'sw29', 'sw30'][kickerIndex % 3]
    const kicker = VPX_KICKERS.find((candidate) => candidate.source.name === kickerName) ?? VPX_KICKERS[kickerIndex % VPX_KICKERS.length]
    const angle = kicker.source.ejectAngle * Math.PI / 180
    const speed = vpxVelocityToCanvas(kicker.source.ejectSpeed)
    ball.x = kicker.ejectCenter.x
    ball.y = kicker.ejectCenter.y
    ball.z = 0
    ball.vx = Math.sin(angle) * speed
    ball.vy = -Math.cos(angle) * speed
    ball.vz = 0
    ball.active = true
    ball.parked = false
    ball.parkedAt = null
    ball.heldInShooterLane = false
    ball.launchAt = time
    ball.objectCooldowns[kicker.source.name] = time + 300
  }, [])

  const selectRulesGame = useCallback((machineKey: string) => {
    if (!machineKey || rulesPickerRef.current.phase === 'selected') return
    rulesPickerRef.current.phase = 'selected'
    rulesPickerRef.current.awaitingPlunge = false
    setRulesPhase('selected')
    setAwaitingPlunge(false)
    setRanking([machineKey])
    stop()
  }, [stop])

  const runDrainRoulette = useCallback(() => {
    if (machineKeys.length === 0) return
    stop()
    clearRoulette()
    rulesPickerRef.current.phase = 'selected'
    setRulesPhase('selected')
    // Never show the same backglass twice in a row, so the cycle always reads
    // as moving.
    const steps = Math.max(12, Math.min(22, machineKeys.length * 3))
    const sequence: string[] = []
    for (let index = 0; index < steps; index += 1) {
      let pick = machineKeys[Math.floor(Math.random() * machineKeys.length)]
      if (machineKeys.length > 1) {
        while (pick === sequence[sequence.length - 1]) {
          pick = machineKeys[Math.floor(Math.random() * machineKeys.length)]
        }
      }
      sequence.push(pick)
    }
    // Ease out, so the wheel visibly slows into its answer instead of
    // stopping dead.
    let delay = 0
    sequence.forEach((machineKey, index) => {
      const timer = window.setTimeout(() => {
        setRouletteBackglass(machineKey)
        // The winner is the frame the wheel stops on. Hand it straight to
        // `ranking` while the same image is still on screen -- blanking the
        // overlay first is what made the pick flash away and come back.
        if (index === sequence.length - 1) setRanking([machineKey])
      }, delay)
      rouletteTimersRef.current.push(timer)
      delay += 45 + ((index + 1) / steps) ** 2.4 * 300
    })
  }, [clearRoulette, machineKeys, stop])

  const plungeRulesBalls = useCallback((power = 1) => {
    const isRulesPicker = modeId === 'rules-picker'
    const isFullGame = modeId === 'full-game'
    const waiting = isRulesPicker
      ? rulesPickerRef.current.awaitingPlunge
      : isFullGame && fullGameRef.current.phase === 'ready'
    if (!waiting) return
    const now = performance.now()
    const clampedPower = Math.max(0, Math.min(1, power))
    const fullLaunchSpeed = vpxPlungerLaunchSpeed(VPX_TABLE.plunger, 1)
      / BALL_TO_VPX_VELOCITY_SCALE
    // Preserve the requested useful floor of the former 100% launch, but map
    // the rest of the pull to the actual VPX Fire/Collide result. This is
    // equivalent to starting the virtual rod partway behind ParkPosition,
    // then following VPX's linear release-speed calculation to full pull.
    const minimumLaunchSpeed = Math.min(32, fullLaunchSpeed)
    const minimumPullFraction = minimumLaunchSpeed / Math.max(1e-9, fullLaunchSpeed)
    const effectivePullFraction = minimumPullFraction
      + clampedPower * (1 - minimumPullFraction)
    const startPosition = VPX_TABLE.plunger.parkPosition
      + (1 - VPX_TABLE.plunger.parkPosition) * effectivePullFraction
    const launchSpeed = vpxPlungerLaunchSpeed(VPX_TABLE.plunger, startPosition)
      / BALL_TO_VPX_VELOCITY_SCALE
    const shooterBall = ballsRef.current.find((ball) => ball.heldInShooterLane && !ball.finished)
    if (shooterBall) {
      shooterBall.heldInShooterLane = false
      shooterBall.active = true
      shooterBall.launchAt = now
      shooterBall.vx = 0
      shooterBall.vy = -launchSpeed
      shooterBall.objectCooldowns.BallRelease = now + 300
      shooterBall.objectCooldowns.PlungerRelease = now + 650
    }
    if (isRulesPicker && rulesPickerRef.current.phase === 'standard-multiball') {
      ballsRef.current.filter((ball) => ball.parked && !ball.finished).forEach((ball, index) => {
        ejectRulesBall(ball, index + 1, now)
      })
    }
    if (isRulesPicker) rulesPickerRef.current.awaitingPlunge = false
    if (isFullGame) {
      fullGameRef.current.phase = 'playing'
      setFullGamePhase('playing')
    }
    setAwaitingPlunge(false)
    setPlungerOpen(false)
    plungerPullRef.current = 0
    setPlungerPull(0)
    drawRef.current()
  }, [ejectRulesBall, modeId])

  const openPlunger = useCallback(() => {
    const waiting = modeId === 'rules-picker'
      ? rulesPickerRef.current.awaitingPlunge
      : modeId === 'full-game' && fullGameRef.current.phase === 'ready'
    if (!waiting) return
    plungerPullRef.current = 0
    setPlungerPull(0)
    setPlungerOpen(true)
  }, [modeId])

  const beginPlungerPull = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    plungerDraggingRef.current = true
    plungerStartYRef.current = event.clientY
    plungerPullRef.current = 0
    setPlungerPull(0)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const movePlunger = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!plungerDraggingRef.current) return
    const nextPull = Math.max(0, Math.min(1, (event.clientY - plungerStartYRef.current) / 150))
    plungerPullRef.current = nextPull
    setPlungerPull(nextPull)
  }, [])

  const releasePlunger = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!plungerDraggingRef.current) return
    plungerDraggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    plungeRulesBalls(plungerPullRef.current)
  }, [plungeRulesBalls])

  const tryRestageAtPlunger = useCallback((ball: Ball, time: number) => {
    const isRulesPicker = modeId === 'rules-picker'
    const isFullGame = modeId === 'full-game'
    const cannotRestage = isRulesPicker
      ? rulesPickerRef.current.phase === 'selected' || rulesPickerRef.current.awaitingPlunge
      : !isFullGame || fullGameRef.current.phase !== 'playing'
    if (cannotRestage
      || (ball.objectCooldowns.PlungerRelease ?? 0) > time
      || ball.rampTrackIndex != null
      || ball.capturedBy
      || ball.z > ball.radius * 0.5
      || ball.vy < 0) return false

    const insideShooterLane = ball.x >= RAPID_FIRE_LANE.left - ball.radius
      && ball.x <= RAPID_FIRE_LANE.right + ball.radius
      && ball.y >= RAPID_FIRE_LANE.top
      && ball.y <= RAPID_FIRE_LANE.bottom + ball.radius * 3
    if (!insideShooterLane) return false

    ball.x = VPX_PLUNGER_REST.x
    ball.y = VPX_PLUNGER_REST.y
    ball.z = 0
    ball.vx = 0
    ball.vy = 0
    ball.vz = 0
    ball.angularVelocity = 0
    ball.angularVelocityX = 0
    ball.angularVelocityY = 0
    ball.active = false
    ball.heldInShooterLane = true
    ball.activeRuleVolumes = {}
    ball.flipperCorrectionSamples = {}
    if (isRulesPicker) rulesPickerRef.current.awaitingPlunge = true
    if (isFullGame) {
      fullGameRef.current.phase = 'ready'
      setFullGamePhase('ready')
    }
    setAwaitingPlunge(true)
    setPlungerOpen(false)
    plungerPullRef.current = 0
    setPlungerPull(0)
    return true
  }, [modeId])

  const consumeRulesPickerEvents = useCallback((ball: Ball, time: number) => {
    if (modeId !== 'rules-picker' || rulesPickerRef.current.phase === 'selected') return

    const candidateSteps = ball.pendingCandidateSteps
    ball.pendingCandidateSteps = 0
    if (candidateSteps > 0 && ball.isRegularBall && rulesPickerRef.current.phase === 'normal') {
      for (let index = 0; index < candidateSteps; index += 1) nextRulesCandidate()
    }

    if (ball.pendingJackpot) {
      ball.pendingJackpot = false
      if (!ball.isRegularBall) selectRulesGame(ball.machineKey)
    }

    if (!ball.pendingRuleLock) return
    ball.pendingRuleLock = false
    if (!ball.isRegularBall || rulesPickerRef.current.phase !== 'normal') return

    let lockedMachine = rulesPickerRef.current.candidate || nextRulesCandidate()
    for (let attempt = 0; attempt < machineKeys.length && rulesPickerRef.current.locked.includes(lockedMachine); attempt += 1) {
      lockedMachine = nextRulesCandidate()
    }
    if (!lockedMachine) return
    const locked = [...rulesPickerRef.current.locked, lockedMachine].slice(0, 3)
    rulesPickerRef.current.locked = locked
    setRulesLocked(locked)
    nextRulesCandidate()

    if (locked.length < 3) {
      Object.assign(ball, makeRulesBall('', rulesPickerRef.current.sharedRules, {
        heldInShooterLane: true,
      }))
      rulesPickerRef.current.awaitingPlunge = true
      setAwaitingPlunge(true)
      return
    }

    rulesPickerRef.current.phase = 'multiball'
    rulesPickerRef.current.awaitingPlunge = false
    setRulesPhase('multiball')
    setAwaitingPlunge(false)
    const namedBalls = locked.map((machineKey, index) => makeRulesBall(
      machineKey,
      rulesPickerRef.current.sharedRules,
      { active: true, colorIndex: index },
    ))
    Object.assign(ball, namedBalls[0])
    ballsRef.current.push(...namedBalls.slice(1))
    namedBalls.forEach((namedBall, index) => {
      const target = index === 0 ? ball : ballsRef.current[ballsRef.current.length - (namedBalls.length - index)]
      ejectRulesBall(target, index, time)
    })
  }, [ejectRulesBall, machineKeys.length, makeRulesBall, modeId, nextRulesCandidate, selectRulesGame])

  const handleRulesPickerDrain = useCallback((ball: Ball) => {
    if (modeId !== 'rules-picker') return false
    ball.finished = true

    if (!ball.isRegularBall) {
      selectRulesGame(ball.machineKey)
      return true
    }

    const locked = rulesPickerRef.current.locked
    if (locked.length === 0) {
      runDrainRoulette()
      return true
    }

    const available = machineKeys.filter((machineKey) => !locked.includes(machineKey))
    const randomMachine = (available.length > 0 ? available : machineKeys)[Math.floor(
      Math.random() * Math.max(1, available.length > 0 ? available.length : machineKeys.length),
    )]
    if (!randomMachine) return true

    const sharedRules = rulesPickerRef.current.sharedRules
    // Three named balls go out, so this is a multiball proper: the jackpot is
    // lit and collecting it picks the ball that shot it. Draining first still
    // wins otherwise.
    sharedRules.multiballActive = true
    sharedRules.jackpotLit = true
    sharedRules.jackpotCollected = false
    rulesPickerRef.current.phase = 'standard-multiball'
    rulesPickerRef.current.awaitingPlunge = true
    setRulesPhase('standard-multiball')
    setAwaitingPlunge(true)

    const shooter = makeRulesBall(randomMachine, sharedRules, {
      heldInShooterLane: true,
      colorIndex: locked.length,
    })
    const heldBalls = locked.map((machineKey, index) => {
      const heldBall = makeRulesBall(machineKey, sharedRules, {
        parked: true,
        parkedAt: ['sw28', 'sw29', 'sw30'][index],
        colorIndex: index,
      })
      parkRulesBallAtLock(heldBall, index)
      return heldBall
    })
    Object.assign(ball, shooter)
    ballsRef.current.push(...heldBalls)
    return true
  }, [machineKeys, makeRulesBall, modeId, parkRulesBallAtLock, runDrainRoulette, selectRulesGame])

  const syncFullGameScore = useCallback((rules: RoboCopRulesState) => {
    if (rules.score === fullGameRef.current.displayedScore) return
    fullGameRef.current.displayedScore = rules.score
    setFullGameScore(rules.score)
  }, [])

  const consumeFullGameEvents = useCallback((ball: Ball, time: number) => {
    if (modeId !== 'full-game' || fullGameRef.current.phase === 'game-over') return
    ball.lastRuleSwitch = null
    // Picker-only signals still originate in the shared switch adapter. Clear
    // them here so a Full Game ball never carries stale selection work.
    ball.pendingCandidateSteps = 0
    ball.pendingJackpot = false

    const registeredLock = ball.pendingRuleLock
    const startedMultiball = registeredLock
      && ball.rules.multiballActive
      && !fullGameRef.current.multiballSpawned
    ball.pendingRuleLock = false
    if (startedMultiball) {
      fullGameRef.current.multiballSpawned = true
      const stagedBalls = ballsRef.current.filter((candidate) => candidate.parked && !candidate.finished)
      while (stagedBalls.length < 2) {
        const staged = makeRulesBall('', ball.rules, { parked: true })
        parkRulesBallAtLock(staged, stagedBalls.length)
        ballsRef.current.push(staged)
        stagedBalls.push(staged)
      }
      stagedBalls.forEach((stagedBall, index) => ejectRulesBall(stagedBall, index + 1, time))
      ball.rules.lastAward = 'ROBOCOP MULTIBALL'
      ball.rules.lastAwardUntil = time + 1400
    } else if (registeredLock) {
      const lockIndex = Math.max(0, Math.min(2, ball.rules.lockedBalls - 1))
      parkRulesBallAtLock(ball, lockIndex)
      ballsRef.current.push(makeRulesBall('', ball.rules, { heldInShooterLane: true }))
      fullGameRef.current.phase = 'ready'
      setFullGamePhase('ready')
      setAwaitingPlunge(true)
      setPlungerOpen(false)
    }
    syncFullGameScore(ball.rules)
  }, [ejectRulesBall, makeRulesBall, modeId, parkRulesBallAtLock, syncFullGameScore])

  const handleFullGameDrain = useCallback((ball: Ball, time: number) => {
    if (modeId !== 'full-game') return false
    ball.finished = true
    const rules = fullGameRef.current.sharedRules
    const survivingBalls = ballsRef.current.filter((candidate) => !candidate.finished && !candidate.parked)

    // A multiball drain only removes that ball. Once one is left, normal
    // single-ball play resumes with the same score and rule progress.
    if (survivingBalls.length > 0) {
      if (rules.multiballActive && survivingBalls.length === 1) {
        endRoboCopMultiball(rules, time)
        fullGameRef.current.multiballSpawned = false
      }
      syncFullGameScore(rules)
      return true
    }

    const replayExtraBall = rules.extraBallAwarded
    if (replayExtraBall) rules.extraBallAwarded = false
    if (rules.multiballActive) {
      endRoboCopMultiball(rules, time)
      fullGameRef.current.multiballSpawned = false
    }
    endRoboCopBall(rules, time, tiltedRef.current)
    syncFullGameScore(rules)
    const nextBallNumber = replayExtraBall
      ? fullGameRef.current.ballNumber
      : fullGameRef.current.ballNumber + 1

    if (nextBallNumber <= 3) {
      tiltedRef.current = false
      setTilted(false)
      fullGameRef.current.ballNumber = nextBallNumber
      fullGameRef.current.phase = 'ready'
      fullGameRef.current.multiballSpawned = false
      setFullGameBall(nextBallNumber)
      setFullGamePhase('ready')
      setAwaitingPlunge(true)
      setPlungerOpen(false)
      const stagedLocks = ballsRef.current.filter((candidate) => candidate.parked && !candidate.finished)
      ballsRef.current = [...stagedLocks, makeRulesBall('', rules, { heldInShooterLane: true })]
      startRoboCopBall(rules, nextBallNumber, time)
      if (replayExtraBall) {
        rules.lastAward = 'SHOOT AGAIN'
        rules.lastAwardUntil = time + 1200
      }
      return true
    }

    fullGameRef.current.phase = 'game-over'
    setFullGamePhase('game-over')
    setAwaitingPlunge(false)
    syncFullGameScore(rules)
    stop()
    return true
  }, [makeRulesBall, modeId, stop, syncFullGameScore])

  const animate = useCallback((time: number) => {
    if (!runningRef.current) return
    const elapsed = Math.min(32, time - (lastTimeRef.current || time)) / 16.667 * GAME_SPEED
    lastTimeRef.current = time
    const balls = ballsRef.current
    // VPX targets a 1 ms physics step. Twelve subdivisions per nominal 60 Hz
    // frame keep the moving flipper tip from tunneling through a ball.
    const substeps = Math.max(1, Math.ceil(elapsed * 12))
    const step = elapsed / substeps
    for (let substep = 0; substep < substeps; substep += 1) {
      const vpxStep = step / BALL_TO_VPX_VELOCITY_SCALE
      const substepTime = time - (substeps - substep - 1) * step * 16.667 / GAME_SPEED
      const leftPressed = flipperHeld(flipperPressedRef.current, 'left', tiltedRef.current)
      const rightPressed = flipperHeld(flipperPressedRef.current, 'right', tiltedRef.current)
      if (leftPressed && !flipperPolarityRef.current.left.pressed) {
        beginFlipperPolarityCorrection('left', balls, flipperMoversRef.current.left, flipperPolarityRef.current.left, time)
      }
      if (rightPressed && !flipperPolarityRef.current.right.pressed) {
        beginFlipperPolarityCorrection('right', balls, flipperMoversRef.current.right, flipperPolarityRef.current.right, time)
      }
      flipperPolarityRef.current.left.pressed = leftPressed
      flipperPolarityRef.current.right.pressed = rightPressed
      const leftScript = flipperScriptRef.current.left
      const rightScript = flipperScriptRef.current.right
      if (leftPressed !== leftScript.pressed) {
        if (leftPressed) activateScriptedFlipper(leftScript)
        else deactivateScriptedFlipper(leftScript, flipperMoversRef.current.left, balls, FLIPPER_LEFT_CENTER)
      }
      if (rightPressed !== rightScript.pressed) {
        if (rightPressed) activateScriptedFlipper(rightScript)
        else deactivateScriptedFlipper(rightScript, flipperMoversRef.current.right, balls, FLIPPER_RIGHT_CENTER)
      }
      updateScriptedFlipper(leftScript, flipperMoversRef.current.left, leftPressed, substepTime)
      updateScriptedFlipper(rightScript, flipperMoversRef.current.right, rightPressed, substepTime)
      stepVpxFlipperMover(flipperMoversRef.current.left, leftScript.parameters, leftPressed, vpxStep)
      stepVpxFlipperMover(flipperMoversRef.current.right, rightScript.parameters, rightPressed, vpxStep)
      VPX_TABLE.gates.forEach((gate) => stepVpxGateMover(gateMoversRef.current[gate.name], gate, vpxStep))
      VPX_TABLE.spinners.forEach((spinner) => {
        const mover = spinnerMoversRef.current[spinner.name]
        const previousAngle = mover.angle
        stepVpxSpinnerMover(mover, spinner, vpxStep)
        const completedTurn = spinner.angleMin === spinner.angleMax
          && Math.abs(mover.angularVelocity) > SPINNER_TURN_MIN_SPEED
          && (
            (mover.angularVelocity >= 0 && mover.angle < previousAngle)
            || (mover.angularVelocity < 0 && mover.angle > previousAngle)
          )
        if (completedTurn && (modeId === 'rules-picker' || modeId === 'full-game')) {
          // VPX closes sw44 once per completed spinner rotation. The impact
          // that starts the blade moving is not an additional switch pulse.
          // All Full Game balls share one rules state, so any live ball is a
          // valid carrier while named picker balls may be in multiball.
          const rulesBall = balls.find((ball) => (
            ball.active && !ball.finished && !ball.parked && !ball.heldInShooterLane && !ball.rules.tilted
          ))
          if (rulesBall) {
            pulseRoboCopSwitch(rulesBall.rules, 44, time)
            if (
              modeId === 'rules-picker'
              && rulesPickerRef.current.phase === 'normal'
              && rulesBall.isRegularBall
            ) nextRulesCandidate()
          }
        }
      })
      stepCaptiveBall(captiveBallRef.current, step, time)
      const flippers = getFlipperRails(flipperMoversRef.current.left.angle, flipperMoversRef.current.right.angle)
      // Preserve the source script's paired EOS cradle nudge. If one held
      // flipper reaches the stop empty while the other holds a ball, VPX gives
      // that ball a small upward settling impulse.
      applyScriptedFlipperNudge(rightScript, flipperMoversRef.current.right, flippers.right, flipperMoversRef.current.left, flippers.left, balls)
      applyScriptedFlipperNudge(leftScript, flipperMoversRef.current.left, flippers.left, flipperMoversRef.current.right, flippers.right, balls)
      balls.forEach((ball) => {
        if (ball.finished) return
        ball.corElapsedMilliseconds += step * 16.667 / GAME_SPEED
        if (ball.corElapsedMilliseconds >= VPX_ROBOCOP_SCRIPT_PHYSICS.gameTimerIntervalMilliseconds) {
          ball.corElapsedMilliseconds %= VPX_ROBOCOP_SCRIPT_PHYSICS.gameTimerIntervalMilliseconds
          ball.corSpeed = Math.hypot(ball.vx, ball.vy, ball.vz) * BALL_TO_VPX_VELOCITY_SCALE
          ball.corVelocityX = ball.vx
          ball.corVelocityY = ball.vy
        }
        if (ball.parked || ball.heldInShooterLane) return
        if (!ball.active) {
          if (time < ball.launchAt) return
          ball.active = true
        }
        if (updateCapturedVpxKicker(ball, time)) return
        const gravityAccelerationY = playfieldGravity.planar
        const tiltAccelerationX = motionEnabled && !tiltedRef.current ? tiltRef.current * 0.035 : 0
        const gravityDeltaY = gravityAccelerationY * step
        const tiltDeltaX = tiltAccelerationX * step
        tryEnterVpxRamp(ball, step)
        if (advanceVpxRamp(ball, step, vpxStep, tiltAccelerationX, gravityAccelerationY)) {
          processRoboCopRuleTriggers(ball, time)
          consumeRulesPickerEvents(ball, time)
          consumeFullGameEvents(ball, time)
          return
        }
        const fallingStraightDown = ball.straightZDrop && ball.z > 0
        const wallTopSupport = advanceBallHeight(ball, step)
        if (wallTopSupport) {
          applyVpxPlayfieldFriction(ball, {
            deltaTime: vpxStep,
            friction: wallTopSupport.friction,
            normalAcceleration: playfieldGravity.normal,
            planarAccelerationX: tiltAccelerationX,
            planarAccelerationY: gravityAccelerationY,
          })
        } else if (ball.z <= 0 && !ball.kickerVolume) {
          applyVpxPlayfieldFriction(ball, {
            deltaTime: vpxStep,
            friction: VPX_TABLE.playfield.friction,
            normalAcceleration: playfieldGravity.normal,
            planarAccelerationX: tiltAccelerationX,
            planarAccelerationY: gravityAccelerationY,
          })
        }
        if (!fallingStraightDown) {
          ball.vy += gravityDeltaY
          ball.vx += tiltDeltaX
        }
        hitVpxMechanicalObjects(ball, step, time, gateMoversRef.current, spinnerMoversRef.current)
        advanceThroughVpxWalls(
          ball,
          VPX_WALL_RAIL_GRID,
          playfieldPegs,
          step,
          tiltDeltaX,
          gravityDeltaY,
          substepTime,
          standupDisabledUntilRef.current,
        )
        collideVpxWallHorizontalEdges(ball)
        collideVpxPrimitiveMeshes(ball, time)
        collideCaptiveBall(ball, captiveBallRef.current)
        for (let index = 0; index < VPX_LOOSE_RAILS.length; index += 1) {
          const rail = VPX_LOOSE_RAILS[index]
          if (collideRail(ball, rail) && rail.switchNumber) pulseBallRuleSwitch(ball, rail.switchNumber, time)
        }
        collideFlipper(ball, flippers.left, flipperMoversRef.current.left, leftScript.parameters, 1, 'left', leftScript, substepTime)
        collideFlipper(ball, flippers.right, flipperMoversRef.current.right, rightScript.parameters, -1, 'right', rightScript, substepTime)
        processFlipperPolarityVolumes(ball, time, flipperPolarityRef.current)
        processRoboCopRuleTriggers(ball, time)
        if (tryFireLaserKick(ball, time)) {
          consumeRulesPickerEvents(ball, time)
          consumeFullGameEvents(ball, time)
          return
        }
        if (tryCaptureVpxKicker(ball, balls, time)) {
          consumeRulesPickerEvents(ball, time)
          consumeFullGameEvents(ball, time)
          return
        }
        consumeRulesPickerEvents(ball, time)
        consumeFullGameEvents(ball, time)
        if (!runningRef.current || ball.parked || ball.heldInShooterLane) return
        if (ball.x < ball.radius) { ball.x = ball.radius; ball.vx = Math.abs(ball.vx) * 0.78 }
        if (ball.x > WIDTH - ball.radius) { ball.x = WIDTH - ball.radius; ball.vx = -Math.abs(ball.vx) * 0.78 }
        if (tryRestageAtPlunger(ball, time)) return
        if (ball.y > FINISH_Y && ball.x > FINISH_LEFT && ball.x < FINISH_RIGHT) {
          if (handleRulesPickerDrain(ball)) return
          if (handleFullGameDrain(ball, time)) return
          ball.finished = true
          finishingRef.current = [...finishingRef.current, ball.machineKey]
          setRanking([...finishingRef.current])
        }
        if (ball.y > HEIGHT + 40) {
          ball.y = 130; ball.x = VPX_DRAIN_CENTER.x; ball.z = 0
          ball.vy = 0; ball.vz = 0; ball.angularVelocity = 0
          ball.angularVelocityX = 0; ball.angularVelocityY = 0; ball.rampTrackIndex = null
        }
      })
      // VPX revisits simultaneous contacts until the active collision set is
      // separated. A single pair pass leaves later corrections pushing balls
      // back into earlier neighbours, especially in the clustered modes.
      for (let contactIteration = 0; contactIteration < 3; contactIteration += 1) {
        let resolvedContact = false
        for (let first = 0; first < balls.length; first += 1) {
          for (let second = first + 1; second < balls.length; second += 1) {
            resolvedContact = collideBalls(balls[first], balls[second]) || resolvedContact
          }
        }
        if (!resolvedContact) break
      }
      balls.forEach(synchronizeRampBallAfterCollision)
    }
    draw()
    if (!runningRef.current) return
    if (finishingRef.current.length >= balls.length) stop()
    else frameRef.current = requestAnimationFrame(animate)
  }, [consumeFullGameEvents, consumeRulesPickerEvents, draw, handleFullGameDrain, handleRulesPickerDrain, modeId, motionEnabled, nextRulesCandidate, playfieldPegs, stop, tryRestageAtPlunger])

  const reset = useCallback(() => {
    stop()
    clearRoulette()
    setCelebration(null)
    tiltedRef.current = false
    setTilted(false)
    nudgeHistoryRef.current = []
    finishingRef.current = []
    setRanking([])
    flipperPressedRef.current = { left: false, right: false }
    flipperMoversRef.current = {
      left: createVpxFlipperMover(FLIPPER_PARAMETERS),
      right: createVpxFlipperMover(FLIPPER_PARAMETERS),
    }
    flipperScriptRef.current = {
      left: createFlipperScriptState(),
      right: createFlipperScriptState(),
    }
    flipperPolarityRef.current = {
      left: createFlipperPolarityState(),
      right: createFlipperPolarityState(),
    }
    gateMoversRef.current = Object.fromEntries(
      VPX_TABLE.gates.map((gate) => [gate.name, createVpxGateMover(gate)]),
    )
    spinnerMoversRef.current = Object.fromEntries(
      VPX_TABLE.spinners.map((spinner) => [spinner.name, createVpxSpinnerMover()]),
    )
    standupDisabledUntilRef.current = new Map()
    captiveBallRef.current = {
      distance: 0,
      speed: 0,
      sourceRules: null,
      targetCooldownUntil: 0,
    }
    const sharedRules = createRoboCopRulesState()
    if (modeId === 'full-game') startRoboCopBall(sharedRules, 1, performance.now())
    rulesPickerRef.current = {
      candidate: '',
      locked: [],
      phase: modeId === 'rules-picker' ? 'normal' : 'idle',
      awaitingPlunge: false,
      sharedRules,
    }
    fullGameRef.current = {
      ballNumber: 1,
      phase: 'idle',
      multiballSpawned: false,
      displayedScore: 0,
      sharedRules,
    }
    setFullGameBall(1)
    setFullGameScore(0)
    setFullGamePhase('idle')
    candidateDeckRef.current = shuffled(machineKeys)
    if (modeId === 'rules-picker') nextRulesCandidate()
    syncRulesPickerState()

    if (modeId === 'rules-picker') {
      ballsRef.current = [makeRulesBall('', sharedRules, { heldInShooterLane: true })]
      requestAnimationFrame(draw)
      return
    }
    if (modeId === 'full-game') {
      ballsRef.current = [makeRulesBall('', sharedRules, { heldInShooterLane: true })]
      requestAnimationFrame(draw)
      return
    }

    const machines = shuffled(machineKeys.slice(0, 30))
    const startsAtTop = modeId === 'start-at-top'
    const poursFromTop = modeId === 'pour-from-top'
    const topCluster = startsAtTop ? createTopCluster(machines.length) : []
    const pourPoint = {
      x: randomBetween(WIDTH * 0.44, WIDTH * 0.56),
      y: randomBetween(HEIGHT * 0.11, HEIGHT * 0.14),
    }
    ballsRef.current = machines.map((machineKey, index) => ({
      machineKey,
      label: display(machineKey),
      x: startsAtTop ? topCluster[index].x : poursFromTop ? pourPoint.x : randomBetween(RAPID_FIRE_LANE.left + VPX_BALL_RADIUS, RAPID_FIRE_LANE.right - VPX_BALL_RADIUS),
      y: startsAtTop ? topCluster[index].y : poursFromTop ? pourPoint.y : randomBetween(RAPID_FIRE_LANE.top, RAPID_FIRE_LANE.bottom),
      vx: startsAtTop ? randomBetween(-0.18, 0.18) : poursFromTop ? 0 : randomBetween(-0.4, 0.25),
      vy: startsAtTop ? randomBetween(-0.05, 0.18) : poursFromTop ? 0 : -randomBetween(24, 30),
      angularVelocity: 0,
      angularVelocityX: 0,
      angularVelocityY: 0,
      radius: VPX_BALL_RADIUS,
      color: PALETTE[index % PALETTE.length],
      z: poursFromTop ? 800 + index * 85 + randomBetween(-12, 12) : 0,
      vz: 0,
      straightZDrop: poursFromTop,
      rampTrackIndex: null,
      rampDistance: 0,
      rampSpeed: 0,
      rampOffset: 0,
      rampLateralSpeed: 0,
      active: false,
      launchAt: Number.POSITIVE_INFINITY,
      capturedBy: null,
      kickerVolume: null,
      releaseAt: 0,
      objectCooldowns: {},
      activeRuleVolumes: {},
      flipperCorrectionSamples: {},
      corSpeed: 0,
      corVelocityX: 0,
      corVelocityY: 0,
      corElapsedMilliseconds: 0,
      rules: createRoboCopRulesState(),
      isRegularBall: false,
      parked: false,
      parkedAt: null,
      heldInShooterLane: false,
      pendingCandidateSteps: 0,
      pendingRuleLock: false,
      pendingJackpot: false,
      lastRuleSwitch: null,
      finished: false,
    }))
    requestAnimationFrame(draw)
  }, [clearRoulette, display, draw, machineKeys, makeRulesBall, modeId, nextRulesCandidate, stop, syncRulesPickerState])

  useEffect(() => { reset(); return stop }, [reset, stop])

  const start = () => {
    reset()
    const launchStart = performance.now()
    if (modeId === 'rules-picker') {
      rulesPickerRef.current.awaitingPlunge = true
      setAwaitingPlunge(true)
      setPlungerOpen(false)
      plungerPullRef.current = 0
      setPlungerPull(0)
    }
    if (modeId === 'full-game') {
      fullGameRef.current.phase = 'ready'
      setFullGamePhase('ready')
      setAwaitingPlunge(true)
      setPlungerOpen(false)
      plungerPullRef.current = 0
      setPlungerPull(0)
    }
    let nextLaunch = launchStart
    ballsRef.current.forEach((ball) => {
      if (modeId === 'rapid-fire') nextLaunch += randomBetween(80, 150)
      ball.launchAt = nextLaunch
      if (modeId === 'rapid-fire') ball.objectCooldowns.BallRelease = nextLaunch + 300
    })
    runningRef.current = true
    setRunning(true)
    lastTimeRef.current = launchStart
    frameRef.current = requestAnimationFrame(animate)
  }

  const winner = ranking[0]

  useEffect(() => {
    if (!winner) return
    setCelebration(winner)
  }, [winner])

  const dismissWinner = useCallback(() => {
    setCelebration(null)
    setRouletteBackglass(null)
  }, [])

  useEffect(() => {
    if (!celebration) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        dismissWinner()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [celebration, dismissWinner])

  const plungerSpringTop = 52
  const plungerSpringBottom = 142 + plungerPull * 92
  const plungerKnobY = plungerSpringBottom + 28
  const plungerSpringPoints = Array.from({ length: 23 }, (_, index) => {
    const progress = index / 22
    const x = index === 0 || index === 22 ? 60 : index % 2 === 0 ? 76 : 44
    return `${x},${plungerSpringTop + (plungerSpringBottom - plungerSpringTop) * progress}`
  }).join(' ')

  return (
    <div className="container flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden px-2 py-2 pb-20 md:px-4 xl:block xl:h-auto xl:overflow-visible xl:px-6 xl:py-8">
      {(celebration || rouletteBackglass) && (
        <div
          className={`winner-backglass-overlay ${celebration ? 'winner-backglass-overlay--winner' : 'winner-backglass-overlay--spinning'}`}
          role={celebration ? 'button' : undefined}
          tabIndex={celebration ? 0 : undefined}
          aria-label={celebration ? `${display(celebration)} selected. Tap to continue.` : undefined}
          aria-hidden={celebration ? undefined : true}
          onClick={celebration ? dismissWinner : undefined}
        >
          <Image
            src={getMachineImagePath(celebration || rouletteBackglass || '')}
            alt=""
            fill
            priority
            className="object-contain"
            unoptimized
            onError={dismissWinner}
          />
          {celebration && <div className="winner-backglass-dismiss">Tap to continue</div>}
        </div>
      )}
      {plungerOpen && awaitingPlunge && (
        <div className="fixed right-2 top-1/2 z-[70] w-28 -translate-y-1/2 rounded-2xl border border-slate-500/70 bg-slate-950/95 p-2 text-white shadow-2xl backdrop-blur md:right-5 md:w-36">
          <button
            type="button"
            onClick={() => { plungerDraggingRef.current = false; plungerPullRef.current = 0; setPlungerPull(0); setPlungerOpen(false) }}
            className="absolute right-1.5 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-sm text-white/80"
            aria-label="Close plunger"
          >
            ×
          </button>
          <div className="pb-1 text-center text-[9px] font-black uppercase tracking-[.18em] text-slate-300">Pull and release</div>
          <div
            role="slider"
            aria-label="Pinball plunger"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(plungerPull * 100)}
            tabIndex={0}
            className="h-[310px] touch-none select-none cursor-grab active:cursor-grabbing"
            onPointerDown={beginPlungerPull}
            onPointerMove={movePlunger}
            onPointerUp={releasePlunger}
            onPointerCancel={releasePlunger}
          >
            <svg viewBox="0 0 120 300" className="h-full w-full overflow-visible" aria-hidden="true">
              <defs>
                <linearGradient id="plunger-black" x1="0" x2="1">
                  <stop offset="0" stopColor="#050505" />
                  <stop offset=".45" stopColor="#53535a" />
                  <stop offset=".65" stopColor="#101014" />
                  <stop offset="1" stopColor="#000" />
                </linearGradient>
                <linearGradient id="plunger-steel" x1="0" x2="1">
                  <stop offset="0" stopColor="#6b7280" />
                  <stop offset=".42" stopColor="#f8fafc" />
                  <stop offset=".7" stopColor="#9ca3af" />
                  <stop offset="1" stopColor="#4b5563" />
                </linearGradient>
              </defs>
              {/* The cabinet flange is the top of the exposed mechanism. */}
              <rect x="27" y="20" width="66" height="18" rx="7" fill="url(#plunger-black)" />
              <rect x="50" y="31" width="20" height="25" rx="4" fill="url(#plunger-black)" />
              <line x1="60" y1="45" x2="60" y2={plungerKnobY + 12} stroke="url(#plunger-steel)" strokeWidth="9" strokeLinecap="round" />
              <polyline points={plungerSpringPoints} fill="none" stroke="#4b5563" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" />
              <polyline points={plungerSpringPoints} fill="none" stroke="#d1d5db" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
              <g transform={`translate(0 ${plungerKnobY})`}>
                <rect x="44" y="-5" width="32" height="30" rx="8" fill="url(#plunger-black)" />
                <path d="M30 20 Q60 7 90 20 L98 35 Q87 58 60 62 Q33 58 22 35 Z" fill="url(#plunger-black)" />
                <ellipse cx="60" cy="34" rx="31" ry="8" fill="rgba(255,255,255,.12)" />
              </g>
            </svg>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500" style={{ width: `${Math.max(3, plungerPull * 100)}%` }} />
          </div>
          <div className="pt-1 text-center text-[9px] font-bold text-slate-400">{Math.round(plungerPull * 100)}% POWER</div>
        </div>
      )}
      <Card className="mb-2 shrink-0 xl:hidden">
        <CardContent className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2 p-2">
          <label className="min-w-0 text-[11px] font-semibold text-muted-foreground">
            Venue
            <select disabled={loading || running} value={venueKey} onChange={(event) => setVenueKey(event.target.value)} className="mt-1 block h-9 w-full truncate rounded-md border bg-background px-2 text-sm text-foreground">
              {venues.map((item) => <option key={item.key || item.name} value={item.key || item.name}>{item.name} ({item.machines.length})</option>)}
            </select>
          </label>
          <div className="min-w-0 text-[11px] font-semibold text-muted-foreground">
            Mode
            <div className="mt-1 grid h-9 grid-cols-5 gap-1">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={running}
                  onClick={() => setModeId(item.id)}
                  className={`min-w-0 rounded-md border px-1 text-[9px] font-bold leading-[1.05] text-foreground transition disabled:opacity-50 ${mode.id === item.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'}`}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
          {modeId === 'rules-picker' && rulesCandidate && (
            <div className="col-span-2 flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
              <div className="relative h-9 w-12 shrink-0 overflow-hidden rounded bg-slate-950">
                <Image src={getMachineImagePath(rulesCandidate)} alt="" fill sizes="48px" className="object-contain" unoptimized />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-black uppercase tracking-wide text-primary">Now: {display(rulesCandidate)}</div>
                <div className="truncate text-[9px] text-muted-foreground">
                  {rulesLocked.length ? `Locked: ${rulesLocked.map(display).join(' · ')}` : 'Spinner and pop hits change the game'}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid min-h-0 flex-1 gap-6 xl:h-auto xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid h-full min-h-0 w-full place-items-center [container-type:size] xl:h-[900px]">
        <div
          className="relative"
          style={{
            width: `min(100cqw, calc(100cqh * ${WIDTH} / ${HEIGHT}))`,
            height: `min(100cqh, calc(100cqw * ${HEIGHT} / ${WIDTH}))`,
          }}
        >
          <Card className="relative z-10 h-full w-full overflow-hidden border-slate-700 bg-slate-950 text-white shadow-2xl">
            <CardContent className="relative flex h-full items-center justify-center p-0">
              <VpxTableLamps className="absolute inset-0 h-full w-full" width={WIDTH} height={HEIGHT} getRulesStates={getActiveRulesStates} />
              <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="relative z-10 block h-full w-full" aria-label="Virtual pinball machine race" />
              {modeId === 'full-game' && (
                <div className="pointer-events-none absolute inset-x-[4%] top-[1.5%] z-20 flex items-start justify-between rounded-md border border-amber-300/35 bg-slate-950/80 px-3 py-2 font-mono text-amber-200 shadow-lg backdrop-blur-sm">
                  <div>
                    <div className="text-[7px] font-black uppercase tracking-[.22em] text-amber-400/80">Player 1</div>
                    <div className="text-sm font-black tabular-nums sm:text-base">{fullGameScore.toLocaleString()}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[7px] font-black uppercase tracking-[.18em] text-amber-400/80">Bonus</div>
                    <div className="text-[9px] font-bold tabular-nums sm:text-[10px]">
                      {formatRoboCopScore(fullGameRef.current.sharedRules.bonusValue)} × {fullGameRef.current.sharedRules.bonusMultiplier}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[7px] font-black uppercase tracking-[.22em] text-amber-400/80">{fullGamePhase === 'game-over' ? 'Game Over' : `Ball ${fullGameBall}`}</div>
                    <div className="text-[9px] font-bold uppercase tracking-wider sm:text-[10px]">
                      {fullGamePhase === 'ready' ? 'Ready to plunge' : fullGameRef.current.sharedRules.multiballActive ? 'Multiball' : 'RoboCop'}
                    </div>
                  </div>
                </div>
              )}
              {motionNotice && (
                <div className={`pointer-events-none absolute z-20 rounded-lg border px-5 py-2 text-lg font-black tracking-[.18em] shadow-2xl ${motionNotice === 'TILT' ? 'border-red-400 bg-red-600 text-white' : motionNotice === 'DANGER' ? 'border-amber-300 bg-amber-500 text-slate-950' : 'border-neon-blue/60 bg-slate-950/90 text-neon-blue'}`}>
                  {motionNotice}
                </div>
              )}
            </CardContent>
          </Card>
          {(modeId === 'rules-picker' || modeId === 'full-game') && awaitingPlunge && (
            <button
              type="button"
              onClick={openPlunger}
              aria-label="Open plunger control"
              className="absolute bottom-[1%] right-0 z-30 flex h-[27%] w-[14%] items-end justify-center rounded-l-lg border border-amber-300/60 bg-amber-300/5 pb-2 text-[7px] font-black uppercase tracking-wider text-amber-200 shadow-[0_0_18px_rgba(251,191,36,.22)]"
            >
              Plunger
            </button>
          )}
          <button
            type="button"
            aria-label="Left flipper"
            className="group absolute -left-20 bottom-[7%] z-0 flex h-[25%] min-h-36 max-h-52 w-24 touch-none select-none items-center justify-center border-0 bg-transparent xl:hidden"
            onPointerDown={(event) => { setFlipperInput('left', true); event.currentTarget.setPointerCapture(event.pointerId) }}
            onPointerUp={() => { setFlipperInput('left', false) }}
            onPointerCancel={() => { setFlipperInput('left', false) }}
            onLostPointerCapture={() => { setFlipperInput('left', false) }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span className="pointer-events-none relative block h-[4.5rem] w-[4.5rem] overflow-hidden rounded-full drop-shadow-[0_0_14px_rgba(239,68,68,.65)] transition-transform duration-75 group-active:scale-90 group-active:brightness-125">
              <Image src="/flipper-button.png" alt="" fill sizes="72px" className="scale-[1.24] object-cover" priority />
            </span>
          </button>
          <button
            type="button"
            aria-label="Right flipper"
            className="group absolute -right-20 bottom-[7%] z-0 flex h-[25%] min-h-36 max-h-52 w-24 touch-none select-none items-center justify-center border-0 bg-transparent xl:hidden"
            onPointerDown={(event) => { setFlipperInput('right', true); event.currentTarget.setPointerCapture(event.pointerId) }}
            onPointerUp={() => { setFlipperInput('right', false) }}
            onPointerCancel={() => { setFlipperInput('right', false) }}
            onLostPointerCapture={() => { setFlipperInput('right', false) }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span className="pointer-events-none relative block h-[4.5rem] w-[4.5rem] overflow-hidden rounded-full drop-shadow-[0_0_14px_rgba(239,68,68,.65)] transition-transform duration-75 group-active:scale-90 group-active:brightness-125">
              <Image src="/flipper-button.png" alt="" fill sizes="72px" className="scale-[1.24] object-cover" priority />
            </span>
          </button>
        </div>
        </div>

        <div className="hidden space-y-5 xl:block">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <label className="block text-sm font-medium">Venue</label>
              <select disabled={loading || running} value={venueKey} onChange={(event) => setVenueKey(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {venues.map((item) => <option key={item.key || item.name} value={item.key || item.name}>{item.name} ({item.machines.length})</option>)}
              </select>
              <div>
                <div className="mb-2 text-sm font-medium">Game mode</div>
                <div className="grid gap-2">
                  {MODES.map((item) => (
                    <button key={item.id} disabled={running} onClick={() => setModeId(item.id)} className={`rounded-lg border p-3 text-left transition ${mode.id === item.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'}`}>
                      <span className="flex items-center gap-2 font-semibold"><span className="h-3 w-3 rounded-full" style={{ background: item.accent }} />{item.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{item.description}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="hidden grid-cols-2 gap-2 pt-1 xl:grid">
                <Button onClick={awaitingPlunge ? openPlunger : start} disabled={loading || (running && !awaitingPlunge) || machineKeys.length < 2}><Play className="mr-2 h-4 w-4" /> {awaitingPlunge ? 'Open plunger' : mode.name}</Button>
                <Button variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" /> Reset</Button>
              </div>
              {machineKeys.length > 30 && <p className="text-xs text-muted-foreground">This venue has {machineKeys.length} machines. The race uses the first 30.</p>}
            </CardContent>
          </Card>

          {modeId === 'rules-picker' && (
            <Card className="overflow-hidden border-emerald-400/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Rules picker</CardTitle>
                <CardDescription>
                  {rulesPhase === 'multiball' ? 'Jackpot or drain chooses the named ball.'
                    : rulesPhase === 'standard-multiball' ? 'Jackpot or first drain chooses the named ball.'
                      : awaitingPlunge ? 'Ball ready in the shooter lane.'
                        : 'Pops and spinner spins scroll the live choice.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {rulesCandidate && (
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-2">
                    <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded bg-slate-950">
                      <Image src={getMachineImagePath(rulesCandidate)} alt="" fill sizes="128px" className="object-contain" unoptimized />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Live machine</div>
                      <div className="mt-1 font-bold leading-tight">{display(rulesCandidate)}</div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((index) => {
                    const machineKey = rulesLocked[index]
                    return (
                      <div key={index} className="min-w-0 rounded-md border p-2 text-center">
                        <div className="text-[9px] font-bold uppercase text-muted-foreground">Lock {index + 1}</div>
                        <div className="mt-1 truncate text-xs font-semibold">{machineKey ? display(machineKey) : '—'}</div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {modeId === 'full-game' && (
            <Card className="overflow-hidden border-amber-400/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">RoboCop — Player 1</CardTitle>
                <CardDescription>
                  {fullGamePhase === 'game-over' ? 'Game over'
                    : fullGamePhase === 'ready' ? `Ball ${fullGameBall} is ready in the shooter lane.`
                      : fullGameRef.current.sharedRules.multiballActive ? 'Multiball — the jackpot is on the right ramp.'
                        : `Ball ${fullGameBall} of 3`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="font-mono text-3xl font-black tabular-nums text-amber-600 dark:text-amber-300">{fullGameScore.toLocaleString()}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] font-bold uppercase text-muted-foreground">
                  <span>Bonus {formatRoboCopScore(fullGameRef.current.sharedRules.bonusValue)} × {fullGameRef.current.sharedRules.bonusMultiplier}</span>
                  <span>Arrests {fullGameRef.current.sharedRules.collectedArrests.size}/3</span>
                  <span>Spinner {fullGameRef.current.sharedRules.spinnerValue.toLocaleString()}</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {fullGameRef.current.sharedRules.lastAward ?? 'Complete directives, make arrests, and start multiball.'}
                </div>
              </CardContent>
            </Card>
          )}

          {winner && (
            <Card className="overflow-hidden border-neon-yellow/50 bg-gradient-to-br from-neon-yellow/15 to-neon-pink/10">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-md bg-slate-900">
                  <Image src={getMachineThumbnailPath(winner)} alt="" fill className="object-cover" unoptimized onError={(event) => { (event.target as HTMLImageElement).style.display = 'none' }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400"><Trophy className="h-4 w-4" /> Your machine</div>
                  <div className="mt-1 truncate text-xl font-bold">{display(winner)}</div>
                  <div className="text-sm text-muted-foreground">at {venue?.name}</div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{modeId === 'rules-picker' ? 'Selected game' : modeId === 'full-game' ? 'Game status' : 'Race order'}</CardTitle></CardHeader>
            <CardContent>
              {modeId === 'full-game' ? (
                <p className="text-sm text-muted-foreground">{fullGamePhase === 'game-over' ? `Final score: ${fullGameScore.toLocaleString()}` : 'Play all three balls. Extra balls do not advance the ball count.'}</p>
              ) : ranking.length === 0 ? <p className="text-sm text-muted-foreground">{modeId === 'rules-picker' ? 'Play until a named ball drains or scores the jackpot.' : 'Start the table to see the finish order.'}</p> : (
                <ol className="max-h-52 space-y-2 overflow-y-auto">
                  {ranking.map((machineKey, index) => <li key={machineKey} className="flex items-center gap-3 text-sm"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${index === 0 ? 'bg-amber-400 text-slate-950' : 'bg-muted'}`}>{index + 1}</span><span className="truncate">{display(machineKey)}</span></li>)}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,.18)] backdrop-blur xl:hidden">
        <div className="mx-auto grid max-w-md grid-cols-[1fr_auto_auto] gap-2">
          <Button size="lg" onClick={awaitingPlunge ? openPlunger : start} disabled={loading || (running && !awaitingPlunge) || machineKeys.length < 2}>
            <Play className="mr-2 h-5 w-5" /> {awaitingPlunge ? 'Open plunger' : mode.name}
          </Button>
          <Button size="lg" variant={motionEnabled ? 'default' : 'outline'} onClick={enableMotion} disabled={motionEnabled} aria-label={motionEnabled ? 'Motion controls enabled' : 'Enable motion controls'} title={motionEnabled ? 'Motion controls enabled' : 'Enable motion controls'}>
            <Smartphone className={`h-5 w-5 ${motionEnabled ? 'text-neon-green' : ''}`} />
          </Button>
          <Button size="lg" variant="outline" onClick={reset} aria-label="Reset race">
            <RotateCcw className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

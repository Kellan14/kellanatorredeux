'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Image from 'next/image'
import { MapPin, Play, RotateCcw, Smartphone, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { VpxTableLamps } from '@/components/vpx-table-lamps'
import { getMachineImagePath, getMachineThumbnailPath } from '@/lib/machine-images'
import { VPX_TABLE, type VpxGate, type VpxKicker, type VpxPoint, type VpxRamp, type VpxRuleTrigger, type VpxSegment, type VpxSpinner, type VpxWall } from '@/lib/vpx-robocop-table'
import {
  applyVpxPlayfieldFriction,
  applyVpxScatter,
  applyVpxSurfaceFriction,
  createVpxGateMover,
  createVpxFlipperMover,
  createVpxSpinnerMover,
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
  VPX_CONTACT_VELOCITY,
  type VpxFlipperMover,
  type VpxFlipperParameters,
  type VpxGateMover,
  type VpxSpinnerMover,
} from '@/lib/vpx-physics'
import { useMachineCanon } from '@/hooks/use-machine-canon'
import {
  createRoboCopRulesState,
  formatRoboCopScore,
  pulseRoboCopSwitch,
  rotateRoboCopTopLanes,
  type RoboCopRulesState,
} from '@/lib/robocop-rules'

type Venue = { key: string; name: string; machines: string[] }
type Peg = {
  x: number; y: number; r?: number; kind?: 'post' | 'bumper'
  elasticity?: number; elasticityFalloff?: number; friction?: number; scatter?: number; force?: number
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
  allowsInvertedEscape?: boolean
  switchNumber?: number
}
type Mode = {
  id: string
  name: string
  description: string
  accent: string
}
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
  rules: RoboCopRulesState
  isRegularBall: boolean
  parked: boolean
  heldInShooterLane: boolean
  pendingCandidateSteps: number
  pendingRuleLock: boolean
  pendingJackpot: boolean
  finished: boolean
}

type RulesPickerPhase = 'idle' | 'normal' | 'multiball' | 'standard-multiball' | 'selected'
type RulesBallOptions = {
  x?: number
  y?: number
  active?: boolean
  parked?: boolean
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

const scaleVpxPoint = ([x, y]: VpxPoint) => ({
  x: x * WIDTH / VPX_TABLE.playableWidth,
  y: y * HEIGHT / VPX_TABLE.height,
})

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
// Kick strength calibration. VPX bumper FORC and surface SLGF are different
// scales -- this table is FORC 10 for the pops and SLGF 65-70 for the slings --
// so they get separate factors. Turn these two numbers to change how hard the
// pops and slings hit; everything else about them comes from the VPX.
//   pops:   FORC 10 * 0.38  = 3.80 canvas units/frame
//   slings: SLGF 70 * 0.115 = 8.05
// Global pace of the simulation. 1 runs at the VPX-derived rate; higher makes
// the whole table quicker without touching any value taken from the .vpx --
// the ball, flippers, gates and spinner all scale together, and the substep
// count scales with it so collision accuracy is unchanged. Real-time holds
// (kicker dwell, award flashes) are deliberately not scaled.
const GAME_SPEED = 1.2
const BUMPER_FORCE_SCALE = 0.38
const SLINGSHOT_FORCE_SCALE = 0.115
// Fraction of the VPX SLTH value to enforce: 1 is the literal table value,
// 0 disables the gate. Lower this if glancing inlane hits feel like they
// should be firing the sling and are not.
const SLINGSHOT_THRESHOLD_ENFORCEMENT = 1
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

function railsFromVpxWall(wall: VpxWall, excludedEdge?: number): Rail[] {
  const isSlingBody = wall.name === 'LeftSlingShot' || wall.name === 'RightSlingShot'
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
      heightBottom: (isSlingBody ? 26 : 0) * VPX_PLAYFIELD_SCALE,
      heightTop: (isSlingBody ? 36 : 55) * VPX_PLAYFIELD_SCALE,
      vpxWall: true,
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
    switchNumber: /^sw\d+$/.test(segment.name) ? Number(segment.name.slice(2)) : undefined,
  }
  return segment.oneWay ? [rail] : [rail, { ...rail, x1: end.x, y1: end.y, x2: start.x, y2: start.y }]
}

const VPX_PLAYFIELD_RAILS: Rail[] = [
  ...VPX_TABLE.walls.flatMap(railsFromVpxWall),
  ...VPX_TABLE.rubbers.flatMap(railsFromVpxWall),
  ...VPX_TABLE.slingBodies.flatMap((wall) => railsFromVpxWall(wall, wall.slingshotEdge)),
  ...VPX_TABLE.contacts.flatMap(railsFromVpxSegment),
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
      friction: face.friction, scatter: face.scatter, force: face.force, thickness: 4,
      threshold: face.threshold,
      // The face is the missing edge of the sling body polygon (railsFromVpxWall
      // excludes it via slingshotEdge). It has to be swept in the same
      // continuous pass as the body, or a ball can be pushed through the gap
      // into the body's interior and wedge against Wall004 with no way out.
      vpxWall: true,
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

// advanceThroughVpxWalls only ever looks at VPX walls and the post-collision
// sweep only ever looks at the handful of non-wall rails (the slingshot
// faces). Split them once rather than re-filtering ~1600 entries per substep.
const VPX_WALL_RAILS = VPX_PLAYFIELD_RAILS.filter((rail) => rail.vpxWall)
const VPX_WALL_RAIL_GRID = new RailGrid(VPX_WALL_RAILS)
const VPX_LOOSE_RAILS = VPX_PLAYFIELD_RAILS.filter((rail) => !rail.vpxWall)

const VPX_BUMPERS: Peg[] = VPX_TABLE.bumpers.map((bumper, index) => {
  const center = scaleVpxPoint(bumper.center)
  return {
    x: center.x, y: center.y, r: bumper.radius * VPX_PLAYFIELD_SCALE, kind: 'bumper',
    elasticity: 1, elasticityFalloff: 0, friction: 0, scatter: bumper.scatter, force: bumper.force,
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

const VPX_RULE_TRIGGERS = (VPX_TABLE.ruleTriggers as readonly VpxRuleTrigger[]).map((trigger) => ({
  source: trigger,
  center: scaleVpxPoint(trigger.center),
  radius: trigger.radius * VPX_PLAYFIELD_SCALE,
  hitHeight: trigger.hitHeight * VPX_PLAYFIELD_SCALE,
  points: trigger.points?.map(scaleVpxPoint),
  rampTrackIndex: trigger.rampTrack
    ? VPX_RAMP_TRACKS.findIndex((track) => track.name === trigger.rampTrack)
    : null,
}))

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

// VPX renders moving objects slightly ahead of the last completed physics
// state to keep input-to-photon latency from adding a whole display frame.
// Keep the real mover/collision state untouched and advance a copy in 1 ms
// increments so this uses the same coil, inertia, damping, and stop model.
const FLIPPER_RENDER_PREDICTION_MS = 8

function predictedFlipperAngle(mover: VpxFlipperMover, pressed: boolean, enabled: boolean) {
  if (!enabled) return mover.angle
  const predicted = { ...mover }
  for (let millisecond = 0; millisecond < FLIPPER_RENDER_PREDICTION_MS; millisecond += 1) {
    stepVpxFlipperMover(predicted, FLIPPER_PARAMETERS, pressed, 0.1)
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
  if (ball.z > (heightTop ?? Number.POSITIVE_INFINITY)) return false
  if (ball.z + ball.radius * 2 < (heightBottom ?? 0)) return false
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
 * A zero on a VPX object does not mean "no scatter" -- Collide3DWall
 * substitutes the table's global scatter (GameData SCAT, 2 degrees here).
 * Both RoboCop slingshot faces are authored with 0, so treating that as
 * "skip scatter" made every sling bounce perfectly deterministic and let a
 * sling-to-sling rally retrace the same path forever. applyVpxScatter
 * self-guards on weak impacts, so this is safe to call unconditionally.
 */
const scatterDegrees = (scatter?: number) => (scatter && scatter > 0 ? scatter : VPX_TABLE.playfield.scatter)

const vpxVelocityToCanvas = (velocity: number) => velocity / BALL_TO_VPX_VELOCITY_SCALE

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
  const contact = resolveVpxSurfaceContact(ball, {
    normalX: nx,
    normalY: ny,
    elasticity: rail.elasticity ?? (rubber ? 0.62 : 0.48),
    elasticityFalloff: rail.elasticityFalloff ?? 0,
    friction: rail.friction ?? (rubber ? 0.04 : 0.1),
  })
  if (contact) applyVpxScatter(ball, scatterDegrees(rail.scatter), contact.normalImpulse)
  // VPX gates a slingshot on impact speed (Surface SLTH, 2.5 on both of
  // RoboCop's): a hit under the threshold bounces off the rubber without
  // firing. Together with scatter and the elasticity loss, this is what stops
  // a sling-to-sling rally sustaining itself -- VPX has no other brake.
  const triggersSlingshot = rail.kind === 'slingshot'
    && Math.abs(contact?.normalSpeed ?? 0) * BALL_TO_VPX_VELOCITY_SCALE
      >= (rail.threshold ?? 0) * SLINGSHOT_THRESHOLD_ENFORCEMENT
  if (contact && triggersSlingshot) {
    const kick = (rail.force ?? 40) * SLINGSHOT_FORCE_SCALE
    ball.vx += nx * kick
    ball.vy += ny * kick
  }
  // The caller uses this to decide whether the rail's switch closed. A
  // slingshot that did not reach its threshold bounced the ball but did not
  // fire, so it must not register a switch hit either.
  return rail.kind !== 'slingshot' || triggersSlingshot
}

function advanceThroughVpxWalls(
  ball: Ball,
  grid: RailGrid,
  step: number,
  externalVelocityDeltaX: number,
  externalVelocityDeltaY: number,
  time: number,
) {
  let remainingTime = step
  for (let iteration = 0; iteration < 4 && remainingTime > 1e-6; iteration += 1) {
    let earliest: { rail: Rail; time: number; normalX: number; normalY: number; penetration: number } | null = null
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
      if (rail.allowsInvertedEscape && externalVelocityDeltaY < 0) continue
      const hit = getVpxLineSegmentHit(ball, rail, remainingTime)
      if (hit && (!earliest || hit.time < earliest.time)) earliest = { rail, ...hit }
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
    const isStaticContact = Math.abs(normalSpeed * BALL_TO_VPX_VELOCITY_SCALE) <= VPX_CONTACT_VELOCITY
    const contact = isStaticContact
      ? resolveVpxStaticContact(ball, {
          normalX: earliest.normalX,
          normalY: earliest.normalY,
          friction: earliest.rail.friction ?? 0.1,
          externalVelocityDeltaX,
          externalVelocityDeltaY,
        })
      : resolveVpxSurfaceContact(ball, {
          normalX: earliest.normalX,
          normalY: earliest.normalY,
          elasticity: earliest.rail.elasticity ?? 0.48,
          elasticityFalloff: earliest.rail.elasticityFalloff ?? 0,
          friction: earliest.rail.friction ?? 0.1,
        })
    if (contact && !isStaticContact) {
      applyVpxScatter(ball, scatterDegrees(earliest.rail.scatter), contact.normalImpulse)
    }
    // A slingshot only fires on a real impact above its SLTH threshold; a
    // resting contact never does.
    const firesSlingshot = earliest.rail.kind === 'slingshot'
      && contact != null
      && !isStaticContact
      && Math.abs(contact.normalSpeed) * BALL_TO_VPX_VELOCITY_SCALE
        >= (earliest.rail.threshold ?? 0) * SLINGSHOT_THRESHOLD_ENFORCEMENT
    if (firesSlingshot) {
      const kick = (earliest.rail.force ?? 40) * SLINGSHOT_FORCE_SCALE
      ball.vx += earliest.normalX * kick
      ball.vy += earliest.normalY * kick
    }
    // A sling that did not fire bounced the ball but closed no switch.
    const registersSwitch = earliest.rail.kind !== 'slingshot' || firesSlingshot
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
  const lockedBalls = ball.rules.lockedBalls
  const jackpotCollected = ball.rules.jackpotCollected
  pulseRoboCopSwitch(ball.rules, switchNumber, time)
  if (switchNumber === 44 || switchNumber === 46 || switchNumber === 47 || switchNumber === 48) {
    ball.pendingCandidateSteps += 1
  }
  if (ball.rules.lockedBalls > lockedBalls) ball.pendingRuleLock = true
  if (!jackpotCollected && ball.rules.jackpotCollected) ball.pendingJackpot = true
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
      ? ball.z - ball.radius <= trigger.hitHeight
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
  if (ball.rampTrackIndex != null || ball.z - ball.radius > 65 * VPX_PLAYFIELD_SCALE) return

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
    pulseBallRuleSwitch(ball, 44, time, 24)
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
    if (balls.some((candidate) => candidate !== ball && candidate.capturedBy === kicker.source.name)) continue
    if (ball.z - ball.radius > kicker.hitHeight) continue
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
  worldAngularDirection: 1 | -1,
) {
  if (ball.z - ball.radius > 50 * VPX_PLAYFIELD_SCALE) return
  const dx = rail.x2 - rail.x1
  const dy = rail.y2 - rail.y1
  const lengthSquared = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((ball.x - rail.x1) * dx + (ball.y - rail.y1) * dy) / lengthSquared))
  const closestX = rail.x1 + t * dx
  const closestY = rail.y1 + t * dy
  const nxRaw = ball.x - closestX
  const nyRaw = ball.y - closestY
  const distance = Math.hypot(nxRaw, nyRaw)
  // Pinball flippers are tapered bats rather than constant-width rails.
  const flipperRadius = FLIPPER_BASE_RADIUS + (FLIPPER_END_RADIUS - FLIPPER_BASE_RADIUS) * t
  if (distance >= ball.radius + flipperRadius) return

  // If a fast-moving tip reaches the exact ball center, VPX still produces a
  // separating contact normal. Do the same instead of dropping the contact.
  const railLength = Math.sqrt(lengthSquared)
  let nx = distance > 1e-6 ? nxRaw / distance : -dy / railLength
  let ny = distance > 1e-6 ? nyRaw / distance : dx / railLength
  if (distance <= 1e-6 && ball.vx * nx + ball.vy * ny > 0) { nx = -nx; ny = -ny }
  const overlap = ball.radius + flipperRadius - distance
  ball.x += nx * overlap
  ball.y += ny * overlap

  const radiusX = ball.x - ball.radius * nx - rail.x1
  const radiusY = ball.y - ball.radius * ny - rail.y1
  resolveVpxFlipperContact(ball, mover, FLIPPER_PARAMETERS, {
    normalX: nx,
    normalY: ny,
    radiusX,
    radiusY,
    worldAngularDirection,
    ballVelocityScale: BALL_TO_VPX_VELOCITY_SCALE,
  })
}

function collidePeg(ball: Ball, peg: Peg) {
  if (ball.z - ball.radius > 90 * VPX_PLAYFIELD_SCALE) return false
  const radius = peg.r ?? 10
  const dx = ball.x - peg.x
  const dy = ball.y - peg.y
  const distance = Math.hypot(dx, dy)
  if (distance >= ball.radius + radius || distance === 0) return false
  const nx = dx / distance
  const ny = dy / distance
  const overlap = ball.radius + radius - distance
  ball.x += nx * overlap
  ball.y += ny * overlap
  const isBumper = peg.kind === 'bumper' || (peg.kind !== 'post' && radius > 20)
  const contact = resolveVpxSurfaceContact(ball, {
    normalX: nx,
    normalY: ny,
    elasticity: peg.elasticity ?? (isBumper ? 0.58 : 0.68),
    elasticityFalloff: peg.elasticityFalloff ?? 0,
    friction: peg.friction ?? (isBumper ? 0.025 : 0.075),
  })
  if (contact) applyVpxScatter(ball, scatterDegrees(peg.scatter), contact.normalImpulse)
  if (isBumper) {
    // VPX bumper FORC and surface SLGF are NOT the same scale: RoboCop's pops
    // are FORC 10 while its slings are SLGF 65-70. Running both through the
    // slingshot factor made a pop kick 0.61 units -- 6x weaker than the tuned
    // fallback below, which is why the pops felt dead. BUMPER_FORCE_SCALE is
    // calibrated so this table's FORC 10 lands on that tuned 3.8.
    const kick = peg.force == null ? (radius >= 45 ? 3.8 : 3.1) : peg.force * BUMPER_FORCE_SCALE
    ball.vx += nx * kick
    ball.vy += ny * kick
  }
  return true
}

function collideBalls(first: Ball, second: Ball) {
  if (!first.active || !second.active || first.finished || second.finished || first.capturedBy || second.capturedBy) return
  const dx = second.x - first.x
  const dy = second.y - first.y
  const dz = second.z - first.z
  const distance = Math.hypot(dx, dy, dz)
  const minimum = first.radius + second.radius
  if (distance >= minimum) return
  const nx = distance > 1e-6 ? dx / distance : 0
  const ny = distance > 1e-6 ? dy / distance : 0
  const nz = distance > 1e-6 ? dz / distance : 1
  const overlap = minimum - distance
  first.x -= nx * overlap * 0.5
  first.y -= ny * overlap * 0.5
  first.z = Math.max(0, first.z - nz * overlap * 0.5)
  second.x += nx * overlap * 0.5
  second.y += ny * overlap * 0.5
  second.z = Math.max(0, second.z + nz * overlap * 0.5)

  const closingSpeed = (second.vx - first.vx) * nx
    + (second.vy - first.vy) * ny
    + (second.vz - first.vz) * nz
  if (closingSpeed >= 0) return
  // VPX uses a fixed 0.8 coefficient of restitution for equal-mass balls.
  const impulse = -(1 + 0.8) * closingSpeed / 2
  first.vx -= impulse * nx
  first.vy -= impulse * ny
  first.vz -= impulse * nz
  second.vx += impulse * nx
  second.vy += impulse * ny
  second.vz += impulse * nz
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
    // Clear the top of the ball before treating the ramp as an overpass.
    if (surface.z > ball.z + ball.radius * 1.5) return true
  }
  return false
}

function tryEnterVpxRamp(ball: Ball, step: number) {
  if (ball.rampTrackIndex != null) return false
  let best: { trackIndex: number; distance: number; score: number } | null = null

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
    if (!best || score < best.score) best = { trackIndex, distance: impactClosest.distance, score }
  })

  const selected = best as { trackIndex: number; distance: number; score: number } | null
  if (!selected) return false
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
    - PLAYFIELD_NORMAL_GRAVITY * current.tangentZ
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
    normalAcceleration: Math.max(0, PLAYFIELD_NORMAL_GRAVITY * current.surfaceNormalZ
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
  if (separatingNormalSpeed > VPX_CONTACT_VELOCITY) {
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

function advanceBallHeight(ball: Ball, step: number) {
  const kicker = ball.kickerVolume
    ? VPX_KICKERS.find((candidate) => candidate.source.name === ball.kickerVolume)
    : null
  const floorZ = kicker && !kicker.source.legacy
    ? -(1 - kicker.source.hitAccuracy) * ball.radius - 0.25
    : 0
  if (ball.z <= floorZ && ball.vz <= 0) return
  ball.vz -= PLAYFIELD_NORMAL_GRAVITY * step
  ball.z += ball.vz * step
  if (ball.z >= floorZ) return
  ball.z = floorZ
  if (floorZ < 0) {
    ball.vz = 0
    return
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
    })
  } else {
    ball.vz = 0
  }
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
  const candidateDeckRef = useRef<string[]>([])
  const flipperPressedRef = useRef({ left: false, right: false })
  const drawRef = useRef<() => void>(() => {})
  const flipperMoversRef = useRef({
    left: createVpxFlipperMover(FLIPPER_PARAMETERS),
    right: createVpxFlipperMover(FLIPPER_PARAMETERS),
  })
  const gateMoversRef = useRef<Record<string, VpxGateMover>>(Object.fromEntries(
    VPX_TABLE.gates.map((gate) => [gate.name, createVpxGateMover(gate)]),
  ))
  const spinnerMoversRef = useRef<Record<string, VpxSpinnerMover>>(Object.fromEntries(
    VPX_TABLE.spinners.map((spinner) => [spinner.name, createVpxSpinnerMover()]),
  ))
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
      // beta is ~90° when a portrait phone is upright, ~0° when it is
      // face-up and flat, and ~-90° when it is inverted. Projecting earth
      // gravity with sin(beta) gives exactly the requested 1g → 0g → -1g.
      if (event.beta != null) {
        const projectedGravity = Math.sin(event.beta * Math.PI / 180)
        verticalGravityRef.current = Math.abs(projectedGravity) < 0.025 ? 0 : projectedGravity
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
        showMotionNotice('TILT', 1800)
        window.setTimeout(() => {
          tiltedRef.current = false
          setTilted(false)
        }, 1800)
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
      showMotionNotice('NUDGE')
    }

    window.addEventListener('deviceorientation', handleOrientation)
    window.addEventListener('devicemotion', handleMotion)
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation)
      window.removeEventListener('devicemotion', handleMotion)
      tiltRef.current = 0
      verticalGravityRef.current = 1
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
    if (pressed) {
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
      predictedFlipperAngle(flipperMoversRef.current.left, flipperPressedRef.current.left, runningRef.current),
      predictedFlipperAngle(flipperMoversRef.current.right, flipperPressedRef.current.right, runningRef.current),
    )
    ;([flippers.left, flippers.right] as Rail[]).forEach((flipper, index) => {
      drawFlipper(ctx, flipper, flipperPressedRef.current[index === 0 ? 'left' : 'right'] ? '#fff36a' : '#ffd92f')
    })

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
    rules,
    isRegularBall: !machineKey,
    parked: options.parked ?? false,
    heldInShooterLane: options.heldInShooterLane ?? false,
    pendingCandidateSteps: 0,
    pendingRuleLock: false,
    pendingJackpot: false,
    finished: false,
  }), [display])

  const ejectRulesBall = useCallback((ball: Ball, kickerIndex: number, time: number) => {
    const kickerName = ['sw28', 'sw29', 'sw30'][kickerIndex % 3]
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
    const sequence = Array.from({ length: 10 }, () => machineKeys[Math.floor(Math.random() * machineKeys.length)])
    sequence.forEach((machineKey, index) => {
      const timer = window.setTimeout(() => {
        setRouletteBackglass(machineKey)
        if (index === sequence.length - 1) {
          const finalTimer = window.setTimeout(() => {
            setRouletteBackglass(null)
            setRanking([machineKey])
          }, 70)
          rouletteTimersRef.current.push(finalTimer)
        }
      }, index * 55)
      rouletteTimersRef.current.push(timer)
    })
  }, [clearRoulette, machineKeys, stop])

  const plungeRulesBalls = useCallback((power = 1) => {
    if (modeId !== 'rules-picker' || !rulesPickerRef.current.awaitingPlunge) return
    const now = performance.now()
    const clampedPower = Math.max(0, Math.min(1, power))
    // The former full-pull speed (32) was only enough for the weakest useful
    // launch on this full-height VPX playfield. Make that the spring's floor
    // and let a complete pull deliver twice the linear launch velocity.
    const launchSpeed = 32 + clampedPower * 32
    const shooterBall = ballsRef.current.find((ball) => ball.heldInShooterLane && !ball.finished)
    if (shooterBall) {
      shooterBall.heldInShooterLane = false
      shooterBall.active = true
      shooterBall.launchAt = now
      shooterBall.vx = randomBetween(-0.18, 0.12) * clampedPower
      shooterBall.vy = -launchSpeed
      shooterBall.objectCooldowns.BallRelease = now + 300
      shooterBall.objectCooldowns.PlungerRelease = now + 650
    }
    if (rulesPickerRef.current.phase === 'standard-multiball') {
      ballsRef.current.filter((ball) => ball.parked && !ball.finished).forEach((ball, index) => {
        ejectRulesBall(ball, index + 1, now)
      })
    }
    rulesPickerRef.current.awaitingPlunge = false
    setAwaitingPlunge(false)
    setPlungerOpen(false)
    plungerPullRef.current = 0
    setPlungerPull(0)
    drawRef.current()
  }, [ejectRulesBall, modeId])

  const openPlunger = useCallback(() => {
    if (modeId !== 'rules-picker' || !rulesPickerRef.current.awaitingPlunge) return
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
    if (modeId !== 'rules-picker'
      || rulesPickerRef.current.phase === 'selected'
      || rulesPickerRef.current.awaitingPlunge
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
    rulesPickerRef.current.awaitingPlunge = true
    setAwaitingPlunge(true)
    setPlungerOpen(false)
    plungerPullRef.current = 0
    setPlungerPull(0)
    return true
  }, [modeId])

  const consumeRulesPickerEvents = useCallback((ball: Ball, time: number) => {
    if (modeId !== 'rules-picker' || rulesPickerRef.current.phase === 'selected') return

    if (rulesPickerRef.current.phase === 'standard-multiball') {
      ball.rules.multiballActive = false
      ball.rules.jackpotLit = false
      ball.rules.jackpotCollected = false
      ball.pendingRuleLock = false
      ball.pendingJackpot = false
    }

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
    sharedRules.multiballActive = false
    sharedRules.jackpotLit = false
    sharedRules.jackpotCollected = false
    rulesPickerRef.current.phase = 'standard-multiball'
    rulesPickerRef.current.awaitingPlunge = true
    setRulesPhase('standard-multiball')
    setAwaitingPlunge(true)

    const shooter = makeRulesBall(randomMachine, sharedRules, {
      heldInShooterLane: true,
      colorIndex: locked.length,
    })
    const heldBalls = locked.map((machineKey, index) => makeRulesBall(machineKey, sharedRules, {
      parked: true,
      colorIndex: index,
    }))
    Object.assign(ball, shooter)
    ballsRef.current.push(...heldBalls)
    return true
  }, [machineKeys, makeRulesBall, modeId, runDrainRoulette, selectRulesGame])

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
      stepVpxFlipperMover(flipperMoversRef.current.left, FLIPPER_PARAMETERS, flipperPressedRef.current.left, vpxStep)
      stepVpxFlipperMover(flipperMoversRef.current.right, FLIPPER_PARAMETERS, flipperPressedRef.current.right, vpxStep)
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
        if (completedTurn && modeId === 'rules-picker' && rulesPickerRef.current.phase === 'normal') {
          const rulesBall = balls.find((ball) => ball.active && ball.isRegularBall && !ball.finished)
          if (rulesBall) {
            pulseRoboCopSwitch(rulesBall.rules, 44, time)
            nextRulesCandidate()
          }
        }
      })
      const flippers = getFlipperRails(flipperMoversRef.current.left.angle, flipperMoversRef.current.right.angle)
      balls.forEach((ball) => {
        if (ball.finished) return
        if (ball.parked || ball.heldInShooterLane) return
        if (!ball.active) {
          if (time < ball.launchAt) return
          ball.active = true
        }
        if (updateCapturedVpxKicker(ball, time)) return
        const gravityAccelerationY = PLAYFIELD_PLANAR_GRAVITY * (motionEnabled ? verticalGravityRef.current : 1)
        const tiltAccelerationX = motionEnabled && !tiltedRef.current ? tiltRef.current * 0.035 : 0
        const gravityDeltaY = gravityAccelerationY * step
        const tiltDeltaX = tiltAccelerationX * step
        tryEnterVpxRamp(ball, step)
        if (advanceVpxRamp(ball, step, vpxStep, tiltAccelerationX, gravityAccelerationY)) {
          processRoboCopRuleTriggers(ball, time)
          consumeRulesPickerEvents(ball, time)
          return
        }
        const fallingStraightDown = ball.straightZDrop && ball.z > 0
        advanceBallHeight(ball, step)
        if (ball.z <= 0 && !ball.kickerVolume) {
          applyVpxPlayfieldFriction(ball, {
            deltaTime: vpxStep,
            friction: VPX_TABLE.playfield.friction,
            normalAcceleration: PLAYFIELD_NORMAL_GRAVITY,
            planarAccelerationX: tiltAccelerationX,
            planarAccelerationY: gravityAccelerationY,
          })
        }
        if (!fallingStraightDown) {
          ball.vy += gravityDeltaY
          ball.vx += tiltDeltaX
        }
        hitVpxMechanicalObjects(ball, step, time, gateMoversRef.current, spinnerMoversRef.current)
        advanceThroughVpxWalls(ball, VPX_WALL_RAIL_GRID, step, tiltDeltaX, gravityDeltaY, time)
        for (let index = 0; index < playfieldPegs.length; index += 1) {
          const peg = playfieldPegs[index]
          if (collidePeg(ball, peg) && peg.switchNumber) pulseBallRuleSwitch(ball, peg.switchNumber, time)
        }
        for (let index = 0; index < VPX_LOOSE_RAILS.length; index += 1) {
          const rail = VPX_LOOSE_RAILS[index]
          if (collideRail(ball, rail) && rail.switchNumber) pulseBallRuleSwitch(ball, rail.switchNumber, time)
        }
        collideFlipper(ball, flippers.left, flipperMoversRef.current.left, 1)
        collideFlipper(ball, flippers.right, flipperMoversRef.current.right, -1)
        processRoboCopRuleTriggers(ball, time)
        if (tryCaptureVpxKicker(ball, balls, time)) {
          consumeRulesPickerEvents(ball, time)
          return
        }
        consumeRulesPickerEvents(ball, time)
        if (!runningRef.current || ball.parked || ball.heldInShooterLane) return
        if (ball.x < ball.radius) { ball.x = ball.radius; ball.vx = Math.abs(ball.vx) * 0.78 }
        if (ball.x > WIDTH - ball.radius) { ball.x = WIDTH - ball.radius; ball.vx = -Math.abs(ball.vx) * 0.78 }
        if (tryRestageAtPlunger(ball, time)) return
        if (ball.y > FINISH_Y && ball.x > FINISH_LEFT && ball.x < FINISH_RIGHT) {
          if (handleRulesPickerDrain(ball)) return
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
      for (let first = 0; first < balls.length; first += 1) {
        for (let second = first + 1; second < balls.length; second += 1) collideBalls(balls[first], balls[second])
      }
      balls.forEach(synchronizeRampBallAfterCollision)
    }
    draw()
    if (!runningRef.current) return
    if (finishingRef.current.length >= balls.length) stop()
    else frameRef.current = requestAnimationFrame(animate)
  }, [consumeRulesPickerEvents, draw, handleRulesPickerDrain, modeId, motionEnabled, nextRulesCandidate, playfieldPegs, stop, tryRestageAtPlunger])

  const reset = useCallback(() => {
    stop()
    clearRoulette()
    setCelebration(null)
    finishingRef.current = []
    setRanking([])
    flipperPressedRef.current = { left: false, right: false }
    flipperMoversRef.current = {
      left: createVpxFlipperMover(FLIPPER_PARAMETERS),
      right: createVpxFlipperMover(FLIPPER_PARAMETERS),
    }
    gateMoversRef.current = Object.fromEntries(
      VPX_TABLE.gates.map((gate) => [gate.name, createVpxGateMover(gate)]),
    )
    spinnerMoversRef.current = Object.fromEntries(
      VPX_TABLE.spinners.map((spinner) => [spinner.name, createVpxSpinnerMover()]),
    )
    const sharedRules = createRoboCopRulesState()
    rulesPickerRef.current = {
      candidate: '',
      locked: [],
      phase: modeId === 'rules-picker' ? 'normal' : 'idle',
      awaitingPlunge: false,
      sharedRules,
    }
    candidateDeckRef.current = shuffled(machineKeys)
    if (modeId === 'rules-picker') nextRulesCandidate()
    syncRulesPickerState()

    if (modeId === 'rules-picker') {
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
      rules: createRoboCopRulesState(),
      isRegularBall: false,
      parked: false,
      heldInShooterLane: false,
      pendingCandidateSteps: 0,
      pendingRuleLock: false,
      pendingJackpot: false,
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
    const timer = window.setTimeout(() => setCelebration(null), 1000)
    return () => window.clearTimeout(timer)
  }, [winner])

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
        <div className="winner-backglass-overlay" aria-hidden="true">
          <Image
            src={getMachineImagePath(celebration || rouletteBackglass || '')}
            alt=""
            fill
            priority
            className="object-contain"
            unoptimized
            onError={() => { setCelebration(null); setRouletteBackglass(null) }}
          />
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
            <div className="mt-1 grid h-9 grid-cols-4 gap-1">
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
              {motionNotice && (
                <div className={`pointer-events-none absolute z-20 rounded-lg border px-5 py-2 text-lg font-black tracking-[.18em] shadow-2xl ${motionNotice === 'TILT' ? 'border-red-400 bg-red-600 text-white' : 'border-neon-blue/60 bg-slate-950/90 text-neon-blue'}`}>
                  {motionNotice}
                </div>
              )}
            </CardContent>
          </Card>
          {modeId === 'rules-picker' && awaitingPlunge && (
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
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg"><MapPin className="h-5 w-5" /> Set up the race</CardTitle>
              <CardDescription>Machine lists come from the current venue data.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                    : rulesPhase === 'standard-multiball' ? 'Standard play: the first named ball to drain is chosen.'
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
            <CardHeader className="pb-2"><CardTitle className="text-base">{modeId === 'rules-picker' ? 'Selected game' : 'Race order'}</CardTitle></CardHeader>
            <CardContent>
              {ranking.length === 0 ? <p className="text-sm text-muted-foreground">{modeId === 'rules-picker' ? 'Play until a named ball drains or scores the jackpot.' : 'Start the table to see the finish order.'}</p> : (
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

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { MapPin, Play, RotateCcw, Smartphone, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getMachineImagePath, getMachineThumbnailPath } from '@/lib/machine-images'
import { VPX_TABLE, type VpxPoint, type VpxWall } from '@/lib/vpx-example-playfield'
import { useMachineCanon } from '@/hooks/use-machine-canon'

type Venue = { key: string; name: string; machines: string[] }
type Peg = { x: number; y: number; r?: number; kind?: 'post' | 'bumper' }
type Rail = {
  x1: number; y1: number; x2: number; y2: number
  kind?: 'rubber' | 'wall' | 'slingshot'
  elasticity?: number; elasticityFalloff?: number; friction?: number; scatter?: number; force?: number; thickness?: number
}
type Layout = {
  id: string
  name: string
  description: string
  accent: string
  pegs: Peg[]
  rails: Rail[]
}
type Ball = {
  machineKey: string
  label: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
  finished: boolean
}

const WIDTH = 640
const HEIGHT = 900
const FINISH_Y = 842
const FINISH_LEFT = 286
const FINISH_RIGHT = 354
const PALETTE = ['#ff006e', '#3a86ff', '#06d6a0', '#ffbe0b', '#8338ec', '#fb5607', '#00b4d8', '#ef476f']

const scaleVpxPoint = ([x, y]: VpxPoint) => ({
  x: x * WIDTH / VPX_TABLE.playableWidth,
  y: y * HEIGHT / VPX_TABLE.height,
})

function railsFromVpxWall(wall: VpxWall): Rail[] {
  return wall.points.map((point, index) => {
    const start = scaleVpxPoint(point)
    const end = scaleVpxPoint(wall.points[(index + 1) % wall.points.length])
    return {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y, kind: 'wall',
      elasticity: wall.elasticity,
      elasticityFalloff: wall.elasticityFalloff,
      friction: wall.friction,
      scatter: wall.scatter,
      thickness: 0,
    }
  })
}

const VPX_SLING_POLYGONS = VPX_TABLE.slingBodies.map((wall) => wall.points.map(scaleVpxPoint))
const LOWER_PLAYFIELD_RAILS: Rail[] = [
  ...VPX_TABLE.lowerWalls.flatMap(railsFromVpxWall),
  ...VPX_TABLE.slingBodies.flatMap(railsFromVpxWall),
  ...VPX_TABLE.slingFaces.map((face) => {
    const start = scaleVpxPoint(face.from)
    const end = scaleVpxPoint(face.to)
    return {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y, kind: 'slingshot' as const,
      elasticity: face.elasticity, elasticityFalloff: face.elasticityFalloff,
      friction: face.friction, scatter: face.scatter, force: face.force, thickness: 4,
    }
  }),
  ...VPX_TABLE.cabinetEdges.map(([from, to]) => {
    const start = scaleVpxPoint(from)
    const end = scaleVpxPoint(to)
    return { x1: start.x, y1: Math.max(630, start.y), x2: end.x, y2: end.y, kind: 'wall' as const, thickness: 0 }
  }),
]

const VPX_FLIPPER = VPX_TABLE.flippers.left
const FLIPPER_LENGTH = VPX_FLIPPER.length * WIDTH / VPX_TABLE.playableWidth
const FLIPPER_BASE_RADIUS = VPX_FLIPPER.baseRadius * WIDTH / VPX_TABLE.playableWidth
const FLIPPER_END_RADIUS = VPX_FLIPPER.endRadius * WIDTH / VPX_TABLE.playableWidth
const FLIPPER_RUBBER_THICKNESS = VPX_FLIPPER.rubberThickness * WIDTH / VPX_TABLE.playableWidth
const FLIPPER_REST_ANGLE = (VPX_FLIPPER.startAngle - 90) * Math.PI / 180
const FLIPPER_END_ANGLE = (VPX_FLIPPER.endAngle - 90) * Math.PI / 180
const FLIPPER_LEFT_CENTER = scaleVpxPoint(VPX_TABLE.flippers.left.center)
const FLIPPER_RIGHT_CENTER = scaleVpxPoint(VPX_TABLE.flippers.right.center)

function isOldDrainGuide(rail: Rail) {
  return (rail.x2 === FINISH_LEFT || rail.x2 === FINISH_RIGHT || rail.x1 === FINISH_LEFT || rail.x1 === FINISH_RIGHT)
    || (Math.min(rail.y1, rail.y2) >= 650 && (rail.x1 === 34 || rail.x1 === 606))
}

function pegGrid(rows: number, columns: number, top: number, gapY: number): Peg[] {
  return Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const gapX = 480 / Math.max(1, columns - 1)
    return { x: 80 + column * gapX + (row % 2 ? gapX / 2 : 0), y: top + row * gapY, r: 10 }
  }).filter((peg) => peg.x < WIDTH - 45)
}

const LAYOUTS: Layout[] = [
  {
    id: 'peg-drop',
    name: 'Peg Drop',
    description: 'A fast, chaotic plunge through a classic field of pins.',
    accent: '#3a86ff',
    pegs: [...pegGrid(7, 6, 190, 72), { x: 180, y: 690, r: 28 }, { x: 460, y: 690, r: 28 }],
    rails: [
      { x1: 34, y1: 120, x2: 34, y2: 790 }, { x1: 606, y1: 120, x2: 606, y2: 790 },
      { x1: 34, y1: 790, x2: FINISH_LEFT, y2: 842 }, { x1: 606, y1: 790, x2: FINISH_RIGHT, y2: 842 },
    ],
  },
  {
    id: 'bumper-run',
    name: 'Bumper Run',
    description: 'Big bumpers launch the field into unpredictable rebounds.',
    accent: '#ff006e',
    pegs: [
      { x: 190, y: 250, r: 42 }, { x: 450, y: 250, r: 42 }, { x: 320, y: 410, r: 54 },
      { x: 155, y: 565, r: 38 }, { x: 485, y: 565, r: 38 },
      { x: 320, y: 585, r: 32 }, { x: 255, y: 655, r: 24 }, { x: 385, y: 655, r: 24 },
      ...pegGrid(2, 6, 720, 68),
    ],
    rails: [
      { x1: 34, y1: 120, x2: 34, y2: 790 }, { x1: 606, y1: 120, x2: 606, y2: 790 },
      { x1: 35, y1: 365, x2: 205, y2: 440 }, { x1: 605, y1: 365, x2: 435, y2: 440 },
      { x1: 34, y1: 790, x2: FINISH_LEFT, y2: 842 }, { x1: 606, y1: 790, x2: FINISH_RIGHT, y2: 842 },
    ],
  },
  {
    id: 'switchbacks',
    name: 'Switchbacks',
    description: 'Slanted rails trade the lead all the way to the finish.',
    accent: '#06d6a0',
    pegs: [{ x: 550, y: 275, r: 18 }, { x: 90, y: 470, r: 18 }, { x: 550, y: 665, r: 18 }],
    rails: [
      { x1: 34, y1: 120, x2: 34, y2: 790 }, { x1: 606, y1: 120, x2: 606, y2: 790 },
      { x1: 34, y1: 245, x2: 515, y2: 330 }, { x1: 606, y1: 440, x2: 125, y2: 525 },
      { x1: 34, y1: 635, x2: 515, y2: 720 },
      { x1: 34, y1: 790, x2: FINISH_LEFT, y2: 842 }, { x1: 606, y1: 790, x2: FINISH_RIGHT, y2: 842 },
    ],
  },
  {
    id: 'arcade-gauntlet',
    name: 'Arcade Gauntlet',
    description: 'A traditional playfield silhouette with lanes, rings, and flipper-shaped exits.',
    accent: '#fb5607',
    pegs: [
      { x: 175, y: 235, r: 34 }, { x: 320, y: 205, r: 26 }, { x: 465, y: 235, r: 34 },
      { x: 245, y: 390, r: 18 }, { x: 395, y: 390, r: 18 }, { x: 320, y: 505, r: 48 },
      { x: 120, y: 590, r: 14 }, { x: 520, y: 590, r: 14 },
    ],
    rails: [
      { x1: 34, y1: 120, x2: 34, y2: 650 }, { x1: 606, y1: 120, x2: 606, y2: 650 },
      { x1: 34, y1: 650, x2: 150, y2: 785 }, { x1: 606, y1: 650, x2: 490, y2: 785 },
      { x1: 150, y1: 785, x2: FINISH_LEFT, y2: 825 }, { x1: 490, y1: 785, x2: FINISH_RIGHT, y2: 825 },
      { x1: 70, y1: 330, x2: 195, y2: 355 }, { x1: 570, y1: 330, x2: 445, y2: 355 },
      { x1: 145, y1: 510, x2: 225, y2: 555 }, { x1: 495, y1: 510, x2: 415, y2: 555 },
    ],
  },
]

function resolveSurface(ball: Ball, nx: number, ny: number, elasticity: number, friction: number, surfaceVx = 0, surfaceVy = 0, elasticityFalloff = 0) {
  const relativeVx = ball.vx - surfaceVx
  const relativeVy = ball.vy - surfaceVy
  const normalSpeed = relativeVx * nx + relativeVy * ny
  if (normalSpeed >= 0) return
  const tangentX = -ny
  const tangentY = nx
  const tangentSpeed = relativeVx * tangentX + relativeVy * tangentY
  const effectiveElasticity = elasticity / (1 + elasticityFalloff * Math.abs(normalSpeed) / 18.53)
  ball.vx -= (1 + effectiveElasticity) * normalSpeed * nx + tangentSpeed * friction * tangentX
  ball.vy -= (1 + effectiveElasticity) * normalSpeed * ny + tangentSpeed * friction * tangentY
}

function collideRail(ball: Ball, rail: Rail) {
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
  let nx = nxRaw / distance
  let ny = nyRaw / distance
  const overlap = ball.radius + railThickness - distance
  ball.x += nx * overlap
  ball.y += ny * overlap
  if (rail.scatter) {
    const scatterAngle = (Math.random() - 0.5) * rail.scatter * Math.PI / 180
    const cos = Math.cos(scatterAngle)
    const sin = Math.sin(scatterAngle)
    ;[nx, ny] = [nx * cos - ny * sin, nx * sin + ny * cos]
  }
  const rubber = rail.kind !== 'wall'
  resolveSurface(
    ball, nx, ny,
    rail.elasticity ?? (rubber ? 0.62 : 0.48),
    rail.friction ?? (rubber ? 0.04 : 0.1),
    0, 0, rail.elasticityFalloff ?? 0,
  )
  if (rail.kind === 'slingshot') {
    const kick = (rail.force ?? 40) * 0.06125
    ball.vx += nx * kick
    ball.vy += ny * kick
  }
  return true
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

function collideFlipper(ball: Ball, rail: Rail, angularVelocity: number) {
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

  // A point on a rotating flipper moves perpendicular to its pivot radius.
  // Resolve the ball against that moving surface rather than adding a fixed
  // kick. This naturally makes fast tip hits stronger than hits near the bat.
  const radiusX = closestX - rail.x1
  const radiusY = closestY - rail.y1
  const surfaceVx = -angularVelocity * radiusY
  const surfaceVy = angularVelocity * radiusX
  // Flipper rubber is deliberately low-elasticity. The bat's powered surface
  // supplies the shot energy; a stationary bat should not trampoline the ball.
  resolveSurface(
    ball, nx, ny,
    VPX_FLIPPER.elasticity * 0.425,
    VPX_FLIPPER.friction * 0.094,
    surfaceVx, surfaceVy, VPX_FLIPPER.elasticityFalloff,
  )
}

function collidePeg(ball: Ball, peg: Peg) {
  const radius = peg.r ?? 10
  const dx = ball.x - peg.x
  const dy = ball.y - peg.y
  const distance = Math.hypot(dx, dy)
  if (distance >= ball.radius + radius || distance === 0) return
  const nx = dx / distance
  const ny = dy / distance
  const overlap = ball.radius + radius - distance
  ball.x += nx * overlap
  ball.y += ny * overlap
  const isBumper = peg.kind === 'bumper' || (peg.kind !== 'post' && radius > 20)
  resolveSurface(ball, nx, ny, isBumper ? 0.58 : 0.68, isBumper ? 0.025 : 0.075)
  // Large pegs are active pop bumpers: add a consistent kick so even a
  // glancing, low-speed hit launches the ball back into the playfield.
  if (isBumper) {
    const kick = radius >= 45 ? 3.8 : 3.1
    ball.vx += nx * kick
    ball.vy += ny * kick
  }
}

function collideBalls(first: Ball, second: Ball) {
  if (first.finished || second.finished) return
  const dx = second.x - first.x
  const dy = second.y - first.y
  const distance = Math.hypot(dx, dy)
  const minimum = first.radius + second.radius
  if (distance === 0 || distance >= minimum) return
  const nx = dx / distance
  const ny = dy / distance
  const overlap = minimum - distance
  first.x -= nx * overlap * 0.5
  first.y -= ny * overlap * 0.5
  second.x += nx * overlap * 0.5
  second.y += ny * overlap * 0.5
  const closingSpeed = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny
  if (closingSpeed >= 0) return
  const impulse = -(1 + 0.9) * closingSpeed * 0.5
  first.vx -= impulse * nx
  first.vy -= impulse * ny
  second.vx += impulse * nx
  second.vy += impulse * ny
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
  const tiltedRef = useRef(false)
  const flipperPressedRef = useRef({ left: false, right: false })
  const flipperAnglesRef = useRef({ left: FLIPPER_REST_ANGLE, right: FLIPPER_REST_ANGLE })
  const flipperVelocityRef = useRef({ left: 0, right: 0 })
  const { display } = useMachineCanon()
  const [venues, setVenues] = useState<Venue[]>([])
  const [venueKey, setVenueKey] = useState('')
  const [layoutId, setLayoutId] = useState(LAYOUTS[0].id)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [ranking, setRanking] = useState<string[]>([])
  const [celebration, setCelebration] = useState<string | null>(null)
  const [motionEnabled, setMotionEnabled] = useState(false)
  const [motionNotice, setMotionNotice] = useState<string | null>(null)
  const [tilted, setTilted] = useState(false)

  const venue = venues.find((item) => item.key === venueKey) ?? venues.find((item) => item.name === venueKey)
  const layout = LAYOUTS.find((item) => item.id === layoutId) ?? LAYOUTS[0]
  const layoutRails = useMemo(
    () => layout.rails.filter((rail) => !isOldDrainGuide(rail)).map((rail) => (
        rail.x1 === rail.x2 && (rail.x1 === 34 || rail.x1 === 606) && rail.y2 > 630
          ? { ...rail, y2: 630 }
          : rail
      )),
    [layout],
  )
  const playfieldRails = useMemo(() => [...layoutRails, ...LOWER_PLAYFIELD_RAILS], [layoutRails])
  // The imported VPX lower field owns this space; layout-specific objects
  // must not overlap its lanes, sling plastics, or flippers.
  const playfieldPegs = useMemo(() => layout.pegs.filter((peg) => peg.y < 590), [layout])
  // Venue lists speak canonical short keys. Preserve those keys through the
  // entire race; long names are display-only and must never be fed back into
  // image or data lookups.
  const machineKeys = useMemo(() => venue?.machines ?? [], [venue])

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
        if (!ball.finished) {
          ball.vx += direction * 2.2
          ball.vy -= 0.65
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
  }, [])

  useEffect(() => {
    const setKey = (event: KeyboardEvent, pressed: boolean) => {
      if (event.key === 'ArrowLeft' || event.key === 'Shift') {
        flipperPressedRef.current.left = pressed
        event.preventDefault()
      }
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        flipperPressedRef.current.right = pressed
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
  }, [])

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
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT)
    gradient.addColorStop(0, '#111827')
    gradient.addColorStop(1, '#020617')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    ctx.strokeStyle = `${layout.accent}55`
    ctx.lineWidth = 1
    for (let x = 0; x <= WIDTH; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke()
    }
    for (let y = 0; y <= HEIGHT; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke()
    }

    ctx.lineCap = 'round'
    const drawRail = (rail: Rail) => {
      ctx.beginPath(); ctx.moveTo(rail.x1, rail.y1); ctx.lineTo(rail.x2, rail.y2)
      const bodyWidth = rail.kind === 'slingshot' ? 9 : rail.thickness === 0 ? 5 : 11
      ctx.strokeStyle = rail.kind === 'slingshot' ? layout.accent : '#94a3b8'; ctx.lineWidth = bodyWidth; ctx.stroke()
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = Math.min(3, bodyWidth); ctx.stroke()
    }
    layoutRails.forEach(drawRail)
    playfieldPegs.forEach((peg) => {
      const radius = peg.r ?? 10
      ctx.beginPath(); ctx.arc(peg.x, peg.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = radius > 20 ? layout.accent : '#cbd5e1'; ctx.fill()
      ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 3; ctx.stroke()
      if (radius > 20) {
        ctx.beginPath(); ctx.arc(peg.x, peg.y, Math.max(5, radius - 10), 0, Math.PI * 2)
        ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 4; ctx.stroke()
      }
    })

    // Draw the exact Wall30/Wall31 polygons from exampleTable.vpx.
    VPX_SLING_POLYGONS.forEach((points) => {
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y))
      ctx.closePath()
      ctx.fillStyle = '#f8fafc'
      ctx.fill()
      ctx.strokeStyle = '#111827'
      ctx.lineWidth = 7
      ctx.stroke()
    })
    LOWER_PLAYFIELD_RAILS.forEach(drawRail)
    ctx.font = '700 11px sans-serif'
    ctx.fillStyle = '#f8fafc99'
    ctx.textAlign = 'center'
    ctx.fillText('OUT', 43, 718); ctx.fillText('IN', 95, 654)
    ctx.fillText('IN', 545, 654); ctx.fillText('OUT', 597, 718)

    const flippers = getFlipperRails(flipperAnglesRef.current.left, flipperAnglesRef.current.right)
    ;([flippers.left, flippers.right] as Rail[]).forEach((flipper, index) => {
      drawFlipper(ctx, flipper, flipperPressedRef.current[index === 0 ? 'left' : 'right'] ? '#fff36a' : '#ffd92f')
    })

    ctx.setLineDash([14, 10]); ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 4
    ctx.beginPath(); ctx.moveTo(FINISH_LEFT, FINISH_Y); ctx.lineTo(FINISH_RIGHT, FINISH_Y); ctx.stroke(); ctx.setLineDash([])
    ctx.font = '700 14px sans-serif'; ctx.fillStyle = '#f8fafc'; ctx.textAlign = 'center'
    ctx.fillText('FINISH', 320, FINISH_Y + 28)

    ballsRef.current.forEach((ball, index) => {
      if (ball.finished) return
      ctx.shadowColor = ball.color; ctx.shadowBlur = 15
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2)
      ctx.fillStyle = ball.color; ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.shadowBlur = 0
      ctx.fillStyle = '#fff'; ctx.font = '700 10px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(String(index + 1), ball.x, ball.y + 3)
      ctx.font = '600 11px sans-serif'
      ctx.fillText(shortName(ball.label), Math.max(52, Math.min(WIDTH - 52, ball.x)), ball.y - ball.radius - 8)
    })
  }, [layout, layoutRails, playfieldPegs, playfieldRails])

  const stop = useCallback(() => {
    runningRef.current = false
    setRunning(false)
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  const animate = useCallback((time: number) => {
    if (!runningRef.current) return
    const elapsed = Math.min(32, time - (lastTimeRef.current || time)) / 16.667
    lastTimeRef.current = time
    const balls = ballsRef.current
    const updateFlipper = (side: 'left' | 'right', step: number) => {
      const pressed = flipperPressedRef.current[side]
      const desiredVelocity = pressed ? -0.31 : 0.18
      // The ported table uses RampUp=0: full coil power is immediate.
      const ramp = (pressed ? 1 : 0.08) * step
      const velocityDelta = desiredVelocity - flipperVelocityRef.current[side]
      flipperVelocityRef.current[side] += Math.max(-ramp, Math.min(ramp, velocityDelta))
      flipperAnglesRef.current[side] += flipperVelocityRef.current[side] * step

      const endStop = FLIPPER_END_ANGLE
      const restStop = FLIPPER_REST_ANGLE
      if (flipperAnglesRef.current[side] <= endStop) {
        flipperAnglesRef.current[side] = endStop
        flipperVelocityRef.current[side] = 0
      } else if (flipperAnglesRef.current[side] >= restStop) {
        flipperAnglesRef.current[side] = restStop
        flipperVelocityRef.current[side] = 0
      }
    }
    // VPX targets a 1 ms physics step. Twelve subdivisions per nominal 60 Hz
    // frame keep the moving flipper tip from tunneling through a ball.
    const substeps = Math.max(1, Math.ceil(elapsed * 12))
    const step = elapsed / substeps
    for (let substep = 0; substep < substeps; substep += 1) {
      updateFlipper('left', step)
      updateFlipper('right', step)
      const flippers = getFlipperRails(flipperAnglesRef.current.left, flipperAnglesRef.current.right)
      balls.forEach((ball) => {
        if (ball.finished) return
        ball.vy += 0.115 * (motionEnabled ? verticalGravityRef.current : 1) * step
        if (motionEnabled && !tiltedRef.current) ball.vx += tiltRef.current * 0.035 * step
        ball.vx *= Math.pow(0.997, step)
        ball.vy *= Math.pow(0.999, step)
        ball.x += ball.vx * step
        ball.y += ball.vy * step
        playfieldPegs.forEach((peg) => collidePeg(ball, peg))
        playfieldRails.forEach((rail) => collideRail(ball, rail))
        collideFlipper(ball, flippers.left, flipperVelocityRef.current.left)
        collideFlipper(ball, flippers.right, -flipperVelocityRef.current.right)
        if (ball.x < ball.radius) { ball.x = ball.radius; ball.vx = Math.abs(ball.vx) * 0.78 }
        if (ball.x > WIDTH - ball.radius) { ball.x = WIDTH - ball.radius; ball.vx = -Math.abs(ball.vx) * 0.78 }
        if (ball.y > FINISH_Y && ball.x > FINISH_LEFT && ball.x < FINISH_RIGHT) {
          ball.finished = true
          finishingRef.current = [...finishingRef.current, ball.machineKey]
          setRanking([...finishingRef.current])
        }
        if (ball.y > HEIGHT + 40) { ball.y = 130; ball.x = 320; ball.vy = 0 }
      })
      for (let first = 0; first < balls.length; first += 1) {
        for (let second = first + 1; second < balls.length; second += 1) collideBalls(balls[first], balls[second])
      }
    }
    draw()
    if (finishingRef.current.length >= balls.length) stop()
    else frameRef.current = requestAnimationFrame(animate)
  }, [draw, layout, motionEnabled, playfieldPegs, playfieldRails, stop])

  const reset = useCallback(() => {
    stop()
    finishingRef.current = []
    setRanking([])
    flipperPressedRef.current = { left: false, right: false }
    flipperAnglesRef.current = { left: FLIPPER_REST_ANGLE, right: FLIPPER_REST_ANGLE }
    flipperVelocityRef.current = { left: 0, right: 0 }
    const machines = machineKeys.slice(0, 30)
    ballsRef.current = machines.map((machineKey, index) => ({
      machineKey,
      label: display(machineKey),
      x: 58 + (index % 10) * 58 + (Math.random() - 0.5) * 8,
      y: 58 - Math.floor(index / 10) * 34,
      vx: (Math.random() - 0.5) * 1.2,
      vy: Math.random() * 0.3,
      radius: machines.length > 20 ? 10 : machines.length > 12 ? 12 : 15,
      color: PALETTE[index % PALETTE.length],
      finished: false,
    }))
    requestAnimationFrame(draw)
  }, [display, draw, machineKeys, stop])

  useEffect(() => { reset(); return stop }, [reset, stop])

  const start = () => {
    reset()
    runningRef.current = true
    setRunning(true)
    lastTimeRef.current = performance.now()
    frameRef.current = requestAnimationFrame(animate)
  }

  const winner = ranking[0]

  useEffect(() => {
    if (!winner) return
    setCelebration(winner)
    const timer = window.setTimeout(() => setCelebration(null), 1000)
    return () => window.clearTimeout(timer)
  }, [winner])

  return (
    <div className="container h-[calc(100dvh-3.5rem)] overflow-hidden px-2 py-2 pb-20 md:px-4 xl:h-auto xl:overflow-visible xl:px-6 xl:py-8">
      {celebration && (
        <div className="winner-backglass-overlay" aria-hidden="true">
          <Image
            src={getMachineImagePath(celebration)}
            alt=""
            fill
            priority
            className="object-contain"
            unoptimized
            onError={() => setCelebration(null)}
          />
        </div>
      )}
      <Card className="mb-2 xl:hidden">
        <CardContent className="grid grid-cols-2 gap-2 p-2">
          <label className="min-w-0 text-[11px] font-semibold text-muted-foreground">
            Venue
            <select disabled={loading || running} value={venueKey} onChange={(event) => setVenueKey(event.target.value)} className="mt-1 block h-9 w-full truncate rounded-md border bg-background px-2 text-sm text-foreground">
              {venues.map((item) => <option key={item.key || item.name} value={item.key || item.name}>{item.name} ({item.machines.length})</option>)}
            </select>
          </label>
          <label className="min-w-0 text-[11px] font-semibold text-muted-foreground">
            Table
            <select disabled={running} value={layoutId} onChange={(event) => setLayoutId(event.target.value)} className="mt-1 block h-9 w-full truncate rounded-md border bg-background px-2 text-sm text-foreground">
              {LAYOUTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </CardContent>
      </Card>

      <div className="grid h-[calc(100%-4.25rem)] gap-6 xl:h-auto xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="h-full overflow-hidden border-slate-700 bg-slate-950 text-white shadow-2xl xl:h-[900px] xl:w-[640px] xl:justify-self-center">
          <CardContent className="relative flex h-full items-center justify-center p-0">
            <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="block h-auto max-h-full w-auto max-w-full bg-slate-950 xl:h-[900px] xl:w-[640px] xl:max-h-none xl:max-w-none" aria-label="Virtual pinball machine race" />
            <button
              type="button"
              aria-label="Left flipper"
              className="absolute bottom-0 left-0 h-[28%] w-1/2 touch-none select-none border-0 bg-gradient-to-t from-neon-pink/10 to-transparent text-left text-[10px] font-bold tracking-widest text-white/45 active:from-neon-yellow/25"
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); flipperPressedRef.current.left = true }}
              onPointerUp={() => { flipperPressedRef.current.left = false }}
              onPointerCancel={() => { flipperPressedRef.current.left = false }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <span className="absolute bottom-3 left-4">LEFT FLIP</span>
            </button>
            <button
              type="button"
              aria-label="Right flipper"
              className="absolute bottom-0 right-0 h-[28%] w-1/2 touch-none select-none border-0 bg-gradient-to-t from-neon-blue/10 to-transparent text-right text-[10px] font-bold tracking-widest text-white/45 active:from-neon-yellow/25"
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); flipperPressedRef.current.right = true }}
              onPointerUp={() => { flipperPressedRef.current.right = false }}
              onPointerCancel={() => { flipperPressedRef.current.right = false }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <span className="absolute bottom-3 right-4">RIGHT FLIP</span>
            </button>
            {motionNotice && (
              <div className={`pointer-events-none absolute rounded-lg border px-5 py-2 text-lg font-black tracking-[.18em] shadow-2xl ${motionNotice === 'TILT' ? 'border-red-400 bg-red-600 text-white' : 'border-neon-blue/60 bg-slate-950/90 text-neon-blue'}`}>
                {motionNotice}
              </div>
            )}
          </CardContent>
        </Card>

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
                <div className="mb-2 text-sm font-medium">Table layout</div>
                <div className="grid gap-2">
                  {LAYOUTS.map((item) => (
                    <button key={item.id} disabled={running} onClick={() => setLayoutId(item.id)} className={`rounded-lg border p-3 text-left transition ${layoutId === item.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'}`}>
                      <span className="flex items-center gap-2 font-semibold"><span className="h-3 w-3 rounded-full" style={{ background: item.accent }} />{item.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{item.description}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="hidden grid-cols-2 gap-2 pt-1 xl:grid">
                <Button onClick={start} disabled={loading || running || machineKeys.length < 2}><Play className="mr-2 h-4 w-4" /> Start</Button>
                <Button variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" /> Reset</Button>
              </div>
              {machineKeys.length > 30 && <p className="text-xs text-muted-foreground">This venue has {machineKeys.length} machines. The race uses the first 30.</p>}
            </CardContent>
          </Card>

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
            <CardHeader className="pb-2"><CardTitle className="text-base">Race order</CardTitle></CardHeader>
            <CardContent>
              {ranking.length === 0 ? <p className="text-sm text-muted-foreground">Start the table to see the finish order.</p> : (
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
          <Button size="lg" onClick={start} disabled={loading || running || machineKeys.length < 2}>
            <Play className="mr-2 h-5 w-5" /> Start race
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

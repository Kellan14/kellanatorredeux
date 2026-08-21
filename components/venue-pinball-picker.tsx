'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { MapPin, Play, RotateCcw, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getMachineImagePath, getMachineThumbnailPath } from '@/lib/machine-images'
import { useMachineCanon } from '@/hooks/use-machine-canon'

type Venue = { key: string; name: string; machines: string[] }
type Peg = { x: number; y: number; r?: number }
type Rail = { x1: number; y1: number; x2: number; y2: number }
type Layout = {
  id: string
  name: string
  description: string
  accent: string
  pegs: Peg[]
  rails: Rail[]
}
type Ball = {
  machine: string
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
const PALETTE = ['#ff006e', '#3a86ff', '#06d6a0', '#ffbe0b', '#8338ec', '#fb5607', '#00b4d8', '#ef476f']

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
      { x1: 34, y1: 790, x2: 210, y2: 842 }, { x1: 606, y1: 790, x2: 430, y2: 842 },
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
      { x1: 34, y1: 790, x2: 220, y2: 842 }, { x1: 606, y1: 790, x2: 420, y2: 842 },
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
      { x1: 34, y1: 790, x2: 220, y2: 842 }, { x1: 606, y1: 790, x2: 420, y2: 842 },
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
      { x1: 150, y1: 785, x2: 272, y2: 825 }, { x1: 490, y1: 785, x2: 368, y2: 825 },
      { x1: 70, y1: 330, x2: 195, y2: 355 }, { x1: 570, y1: 330, x2: 445, y2: 355 },
      { x1: 145, y1: 510, x2: 225, y2: 555 }, { x1: 495, y1: 510, x2: 415, y2: 555 },
    ],
  },
]

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
  if (distance >= ball.radius + 5 || distance === 0) return
  const nx = nxRaw / distance
  const ny = nyRaw / distance
  const overlap = ball.radius + 5 - distance
  ball.x += nx * overlap
  ball.y += ny * overlap
  const dot = ball.vx * nx + ball.vy * ny
  if (dot < 0) {
    ball.vx -= 1.72 * dot * nx
    ball.vy -= 1.72 * dot * ny
  }
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
  const dot = ball.vx * nx + ball.vy * ny
  if (dot < 0) {
    ball.vx -= 1.8 * dot * nx
    ball.vy -= 1.8 * dot * ny
  }
  // Large pegs are active pop bumpers: add a consistent kick so even a
  // glancing, low-speed hit launches the ball back into the playfield.
  if (radius > 20) {
    const kick = radius >= 45 ? 3.8 : 3.1
    ball.vx += nx * kick
    ball.vy += ny * kick
  }
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
  const { display } = useMachineCanon()
  const [venues, setVenues] = useState<Venue[]>([])
  const [venueKey, setVenueKey] = useState('')
  const [layoutId, setLayoutId] = useState(LAYOUTS[0].id)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [ranking, setRanking] = useState<string[]>([])
  const [celebration, setCelebration] = useState<string | null>(null)

  const venue = venues.find((item) => item.key === venueKey) ?? venues.find((item) => item.name === venueKey)
  const layout = LAYOUTS.find((item) => item.id === layoutId) ?? LAYOUTS[0]
  const machineNames = useMemo(() => venue?.machines.map((machine) => display(machine)) ?? [], [venue, display])

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
    layout.rails.forEach((rail) => {
      ctx.beginPath(); ctx.moveTo(rail.x1, rail.y1); ctx.lineTo(rail.x2, rail.y2)
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 11; ctx.stroke()
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 3; ctx.stroke()
    })
    layout.pegs.forEach((peg) => {
      const radius = peg.r ?? 10
      ctx.beginPath(); ctx.arc(peg.x, peg.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = radius > 20 ? layout.accent : '#cbd5e1'; ctx.fill()
      ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 3; ctx.stroke()
      if (radius > 20) {
        ctx.beginPath(); ctx.arc(peg.x, peg.y, Math.max(5, radius - 10), 0, Math.PI * 2)
        ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 4; ctx.stroke()
      }
    })

    ctx.setLineDash([14, 10]); ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 4
    ctx.beginPath(); ctx.moveTo(220, FINISH_Y); ctx.lineTo(420, FINISH_Y); ctx.stroke(); ctx.setLineDash([])
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
      ctx.fillText(shortName(ball.machine), Math.max(52, Math.min(WIDTH - 52, ball.x)), ball.y - ball.radius - 8)
    })
  }, [layout])

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
    balls.forEach((ball) => {
      if (ball.finished) return
      ball.vy += 0.115 * elapsed
      ball.vx *= Math.pow(0.997, elapsed)
      ball.vy *= Math.pow(0.999, elapsed)
      ball.x += ball.vx * elapsed
      ball.y += ball.vy * elapsed
      layout.pegs.forEach((peg) => collidePeg(ball, peg))
      layout.rails.forEach((rail) => collideRail(ball, rail))
      if (ball.x < ball.radius) { ball.x = ball.radius; ball.vx = Math.abs(ball.vx) * 0.78 }
      if (ball.x > WIDTH - ball.radius) { ball.x = WIDTH - ball.radius; ball.vx = -Math.abs(ball.vx) * 0.78 }
      if (ball.y > FINISH_Y && ball.x > 205 && ball.x < 435) {
        ball.finished = true
        finishingRef.current = [...finishingRef.current, ball.machine]
        setRanking([...finishingRef.current])
      }
      if (ball.y > HEIGHT + 40) { ball.y = 130; ball.x = 320; ball.vy = 0 }
    })
    draw()
    if (finishingRef.current.length >= balls.length) stop()
    else frameRef.current = requestAnimationFrame(animate)
  }, [draw, layout, stop])

  const reset = useCallback(() => {
    stop()
    finishingRef.current = []
    setRanking([])
    const machines = machineNames.slice(0, 30)
    ballsRef.current = machines.map((machine, index) => ({
      machine,
      x: 58 + (index % 10) * 58 + (Math.random() - 0.5) * 8,
      y: 58 - Math.floor(index / 10) * 34,
      vx: (Math.random() - 0.5) * 1.2,
      vy: Math.random() * 0.3,
      radius: machines.length > 20 ? 10 : machines.length > 12 ? 12 : 15,
      color: PALETTE[index % PALETTE.length],
      finished: false,
    }))
    requestAnimationFrame(draw)
  }, [draw, machineNames, stop])

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
    <div className="container px-4 py-8 md:px-6">
      {celebration && (
        <div className="winner-backglass-overlay" aria-hidden="true">
          <Image
            src={getMachineImagePath(celebration, celebration)}
            alt=""
            fill
            priority
            className="object-contain"
            unoptimized
            onError={(event) => { (event.target as HTMLImageElement).src = '/opdb_backglass_images/AFM.jpg' }}
          />
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden border-slate-700 bg-slate-950 text-white shadow-2xl">
          <CardContent className="p-0">
            <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="block h-auto w-full max-h-[78vh] bg-slate-950 object-contain" aria-label="Virtual pinball machine race" />
          </CardContent>
        </Card>

        <div className="space-y-5">
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
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button onClick={start} disabled={loading || running || machineNames.length < 2}><Play className="mr-2 h-4 w-4" /> Start</Button>
                <Button variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" /> Reset</Button>
              </div>
              {machineNames.length > 30 && <p className="text-xs text-muted-foreground">This venue has {machineNames.length} machines. The race uses the first 30.</p>}
            </CardContent>
          </Card>

          {winner && (
            <Card className="overflow-hidden border-neon-yellow/50 bg-gradient-to-br from-neon-yellow/15 to-neon-pink/10">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-md bg-slate-900">
                  <Image src={getMachineThumbnailPath(winner, winner)} alt="" fill className="object-cover" unoptimized onError={(event) => { (event.target as HTMLImageElement).src = '/opdb_backglass_images/thumbnails/AFM.jpg' }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400"><Trophy className="h-4 w-4" /> Your machine</div>
                  <div className="mt-1 truncate text-xl font-bold">{winner}</div>
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
                  {ranking.map((machine, index) => <li key={machine} className="flex items-center gap-3 text-sm"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${index === 0 ? 'bg-amber-400 text-slate-950' : 'bg-muted'}`}>{index + 1}</span><span className="truncate">{machine}</span></li>)}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

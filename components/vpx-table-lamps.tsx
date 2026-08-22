'use client'

import { useEffect, useRef } from 'react'
import { VPX_LAMPS } from '@/lib/vpx-robocop-lamps'
import { VPX_TABLE } from '@/lib/vpx-robocop-table'
import { getRoboCopLampLevel, type RoboCopRulesState } from '@/lib/robocop-rules'

type Props = {
  className?: string
  /** Canvas-space width the picker draws its playfield in. */
  width: number
  /** Canvas-space height the picker draws its playfield in. */
  height: number
  getRulesStates?: () => readonly RoboCopRulesState[]
}

// The glows are soft, so a half-resolution backing store is indistinguishable
// from a full one and costs a quarter of the fill.
const RESOLUTION_SCALE = 0.5
const SPRITE_SIZE = 64
const FRAME_INTERVAL = 1000 / 30
// Levels are compared between frames to skip idle repaints; quantising keeps
// the slow fade from forcing a repaint on every single frame.
const LEVEL_STEPS = 24

type LampSprite = { core: HTMLCanvasElement; halo: HTMLCanvasElement }

function makeGlowSprite(color: string, innerAlpha: number) {
  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_SIZE
  canvas.height = SPRITE_SIZE
  const context = canvas.getContext('2d')
  if (!context) return canvas
  const half = SPRITE_SIZE / 2
  // The sprite is tinted at bake time so the draw loop never has to recolour
  // anything. The alpha ramp reuses the falloff of the old 3D halo texture:
  // saturated core, long soft tail, nothing at the rim.
  const image = context.createImageData(SPRITE_SIZE, SPRITE_SIZE)
  const parsed = Number.parseInt(color.slice(1), 16)
  const red = (parsed >> 16) & 255
  const green = (parsed >> 8) & 255
  const blue = parsed & 255
  for (let y = 0; y < SPRITE_SIZE; y += 1) {
    for (let x = 0; x < SPRITE_SIZE; x += 1) {
      const distance = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half
      let alpha = 0
      if (distance < 1) {
        if (distance < 0.18) alpha = 0.92 - (0.92 - 0.62) * (distance / 0.18)
        else if (distance < 0.48) alpha = 0.62 - (0.62 - 0.18) * ((distance - 0.18) / 0.3)
        else alpha = 0.18 * (1 - (distance - 0.48) / 0.52)
      }
      const offset = (y * SPRITE_SIZE + x) * 4
      image.data[offset] = red
      image.data[offset + 1] = green
      image.data[offset + 2] = blue
      image.data[offset + 3] = Math.round(alpha * innerAlpha * 255)
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

const spriteCache = new Map<string, LampSprite>()
function getLampSprite(color: string) {
  let sprite = spriteCache.get(color)
  if (!sprite) {
    // The core reads as the lit insert itself; the halo is the bloom around it.
    sprite = { core: makeGlowSprite(color, 1), halo: makeGlowSprite(color, 0.55) }
    spriteCache.set(color, sprite)
  }
  return sprite
}

/**
 * Draws the RoboCop table's animated lamp inserts over the pre-rendered
 * playfield image.
 *
 * This replaces the live glTF scene (components/vpx-table-scene.tsx), which
 * cost ~30 MB of download and ~400 MB of texture memory to animate nothing but
 * these inserts through a camera that never moved. The scene is kept in the
 * tree for a possible desktop-only path; nothing imports it at runtime.
 */
export function VpxTableLamps({ className, width, height, getRulesStates }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const getStatesRef = useRef(getRulesStates)
  getStatesRef.current = getRulesStates

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) return

    const scale = (width / VPX_TABLE.playableWidth) * RESOLUTION_SCALE
    const lamps = VPX_LAMPS.map((lamp) => ({
      lampNumber: lamp.lampNumber,
      isFlasher: lamp.isFlasher,
      x: lamp.x * scale,
      y: lamp.y * scale,
      radius: lamp.radius * scale,
      sprite: getLampSprite(lamp.color),
    }))
    const levels = new Uint8Array(lamps.length)
    const previousLevels = new Uint8Array(lamps.length)
    let hasDrawn = false

    let frame: number | null = null
    let lastFrameTime = 0
    const tick = (time: number) => {
      frame = window.requestAnimationFrame(tick)
      if (time - lastFrameTime < FRAME_INTERVAL) return
      lastFrameTime = time

      const states = getStatesRef.current?.() ?? []
      const flasherActive = states.some((state) => state.lastAwardUntil > time)
        && Math.floor(time / 75) % 2 === 0
      let changed = false
      for (let index = 0; index < lamps.length; index += 1) {
        const lamp = lamps[index]
        let level = 0
        if (lamp.lampNumber != null) {
          for (const state of states) {
            const stateLevel = getRoboCopLampLevel(state, lamp.lampNumber, time)
            if (stateLevel > level) level = stateLevel
          }
        } else if (lamp.isFlasher && flasherActive) {
          level = 0.9
        }
        const quantised = Math.round(Math.min(1, Math.max(0, level)) * LEVEL_STEPS)
        levels[index] = quantised
        if (quantised !== previousLevels[index]) changed = true
      }
      if (!changed && hasDrawn) return
      previousLevels.set(levels)
      hasDrawn = true

      context.clearRect(0, 0, canvas.width, canvas.height)
      context.globalCompositeOperation = 'lighter'
      for (let index = 0; index < lamps.length; index += 1) {
        const level = levels[index] / LEVEL_STEPS
        if (level <= 0) continue
        const lamp = lamps[index]
        const halo = lamp.radius
        context.globalAlpha = level * 0.52
        context.drawImage(lamp.sprite.halo, lamp.x - halo, lamp.y - halo, halo * 2, halo * 2)
        // The insert footprint is the halo divided back out by the 2.3x bloom
        // the bake applied.
        const core = halo / 2.3
        context.globalAlpha = level * 0.78
        context.drawImage(lamp.sprite.core, lamp.x - core, lamp.y - core, core * 2, core * 2)
      }
      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'
    }
    frame = window.requestAnimationFrame(tick)

    return () => {
      if (frame != null) window.cancelAnimationFrame(frame)
    }
  }, [width, height])

  return (
    <canvas
      ref={canvasRef}
      width={Math.round(width * RESOLUTION_SCALE)}
      height={Math.round(height * RESOLUTION_SCALE)}
      aria-hidden="true"
      className={className}
      // The playfield never displays wider than ~400 CSS px, so the 1024px bake
      // is oversampled even at 3x DPR while decoding to less than half the
      // memory of the 1536px master (which render-vpx-table.mjs still emits).
      style={{ background: "#020617 url('/robocop-playfield-base-1024.webp') center / 100% 100% no-repeat" }}
    />
  )
}

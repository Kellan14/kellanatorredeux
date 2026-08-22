// One-shot regeneration of everything the picker needs from a VPX glTF export.
//
// Run this after every re-export from the .vpx sources in games/. It:
//   1. extracts the animated lamp inserts   -> lib/vpx-robocop-lamps.ts
//   2. serves a page that bakes the table   -> public/robocop-playfield-base.webp
//   3. downscales it for the runtime        -> public/robocop-playfield-base-1024.webp
//
// Step 2 needs a WebGL context, so it prints a URL to open in a browser and
// waits for the render to be posted back.

import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const MODEL_DIRECTORY = 'public/vpx/robocop'
const BASE = 'public/robocop-playfield-base.webp'
const RUNTIME = 'public/robocop-playfield-base-1024.webp'
// The picker never displays the playfield wider than ~400 CSS px, so this is
// still oversampled at 3x DPR while halving the decoded memory.
const RUNTIME_WIDTH = 1024

const run = (arguments_) => new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(process.execPath, arguments_, { stdio: 'inherit' })
  child.on('exit', (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(`exit ${code}`))))
})

const glb = (await readdir(MODEL_DIRECTORY)).find((name) => name.endsWith('.glb'))
if (!glb) throw new Error(`no .glb in ${MODEL_DIRECTORY}`)
const glbPath = join(MODEL_DIRECTORY, glb)
console.log(`table: ${glbPath}\n`)

console.log('[1/3] extracting lamp inserts')
await run(['scripts/extract-vpx-lamps.mjs', glbPath, 'lib/vpx-robocop-lamps.ts'])

console.log('\n[2/3] baking playfield -- open the URL below in a browser')
await run(['scripts/render-vpx-table.mjs', glbPath, BASE])

console.log('\n[3/3] downscaling for the runtime')
const info = await sharp(BASE).resize(RUNTIME_WIDTH).webp({ quality: 88 }).toFile(RUNTIME)
console.log(`${RUNTIME}: ${info.width}x${info.height}, ${(info.size / 1024).toFixed(0)}KB`)

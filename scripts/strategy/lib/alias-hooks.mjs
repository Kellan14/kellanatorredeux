// Lets plain Node import the project's TypeScript sources directly, so the
// sweep and backtest run the real lib/strategy code instead of a copy that
// could drift from it. Node >= 22 strips the types; this only fixes module
// resolution, in the two ways TS source differs from Node ESM:
//
//   1. the "@/..." path alias from tsconfig
//   2. extensionless relative imports ("./hungarian")

import { existsSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = process.env.PROJECT_ROOT ?? process.cwd()
const SUFFIXES = ['.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']

function probe(base, context, next) {
  for (const suffix of SUFFIXES) {
    const candidate = base + suffix
    if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context)
  }
  return null
}

export async function resolve(specifier, context, next) {
  let request = specifier
  if (request.startsWith('@/')) {
    const base = resolvePath(ROOT, request.slice(2))
    const hit = probe(base, context, next)
    if (hit) return hit
    request = pathToFileURL(base).href
  }

  try {
    return await next(request, context)
  } catch (error) {
    // Extensionless relative/absolute import: resolve it against the importer.
    let base = null
    if (request.startsWith('file:')) base = fileURLToPath(request)
    else if (request.startsWith('.') && context.parentURL?.startsWith('file:')) {
      base = resolvePath(dirname(fileURLToPath(context.parentURL)), request)
    }
    const hit = base ? probe(base, context, next) : null
    if (hit) return hit
    throw error
  }
}

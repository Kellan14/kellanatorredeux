import { supabase, fetchAllRecords } from '@/lib/supabase'
import { cache, TTL } from '@/lib/cache'

/**
 * The machine name canon.
 *
 * Every machine has exactly two names:
 *   key   short form  — what APIs, query strings and stored columns speak
 *   name  long form   — the default display name sitewide (sometimes identical)
 *
 * Source of truth is mondaynightpinball.com/machines (mirrored at
 * mnp-data-archive/machines.json), seeded into machine_canon by
 * scripts/seed-machine-canon.ts. Machines MNP does not list carry source='local'.
 *
 * This module replaces the hand-maintained alias table and its four helpers
 * (machineMappings, getCanonicalMachineKey, getMachineVariations,
 * getMachineDisplayName). Those had no single output space — the table mapped
 * both key->name and name->key, so standardization was direction-dependent —
 * and the canonicalizer fuzzy-matched substrings, collapsing distinct machines
 * (CactusCanyon and Can Crusher both became "ca"). Here there is exactly one
 * output space: the canon key.
 */

export interface CanonMachine {
  key: string
  name: string
  displayName: string
  source: 'mnp' | 'local'
  active: boolean
}

export interface MachineCanonIndex {
  /** canon key -> machine */
  byKey: Map<string, CanonMachine>
  /** normalized key, normalized long form, and every alias -> canon key */
  lookup: Map<string, string>
}

const CACHE_KEY = 'machine-canon:index'

/** Normalize any raw spelling to its comparison form: lowercase, trimmed,
 *  internal whitespace collapsed, surrounding punctuation-only noise kept. */
export function normalizeMachineName(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.replace(/\s+/g, ' ').trim().toLowerCase()
}

export async function getMachineCanon(): Promise<MachineCanonIndex> {
  const cached = cache.get<MachineCanonIndex>(CACHE_KEY)
  if (cached) return cached

  const rows = await fetchAllRecords<{
    key: string
    name: string
    display_override: string | null
    source: 'mnp' | 'local'
    active: boolean
  }>(() =>
    supabase
      .from('machine_canon')
      .select('key, name, display_override, source, active')
      .order('key', { ascending: true })
  )

  const byKey = new Map<string, CanonMachine>()
  const lookup = new Map<string, string>()

  for (const r of rows) {
    byKey.set(r.key, {
      key: r.key,
      name: r.name,
      displayName: r.display_override || r.name,
      source: r.source,
      active: r.active,
    })
    // A machine answers to its own key and to its long form, in any casing.
    lookup.set(normalizeMachineName(r.key), r.key)
    const normName = normalizeMachineName(r.name)
    if (!lookup.has(normName)) lookup.set(normName, r.key)
  }

  // Explicit aliases only cover spellings the two rules above cannot reach.
  const aliases = await fetchAllRecords<{ alias: string; canon_key: string }>(() =>
    supabase.from('machine_aliases').select('alias, canon_key').order('alias', { ascending: true })
  )
  for (const a of aliases) {
    if (byKey.has(a.canon_key)) lookup.set(normalizeMachineName(a.alias), a.canon_key)
  }

  const index = { byKey, lookup }
  cache.set(CACHE_KEY, index, TTL.ONE_HOUR)
  return index
}

/**
 * Resolve any raw machine spelling to its canon key.
 * Returns null when the spelling is not in the canon — callers must decide
 * whether that is an error or an issue to report; it is never guessed at.
 */
export async function resolveMachineKey(raw: string | null | undefined): Promise<string | null> {
  if (!raw) return null
  const { byKey, lookup } = await getMachineCanon()
  if (byKey.has(raw)) return raw
  return lookup.get(normalizeMachineName(raw)) ?? null
}

/** Long form for a canon key (display_override wins). Falls back to the input
 *  so an unknown key still renders as something rather than blank. */
export async function getMachineDisplay(key: string | null | undefined): Promise<string> {
  if (!key) return ''
  const { byKey } = await getMachineCanon()
  return byKey.get(key)?.displayName ?? key
}

/** Synchronous variants for code that already holds the index. */
export function resolveWithIndex(index: MachineCanonIndex, raw: string | null | undefined): string | null {
  if (!raw) return null
  if (index.byKey.has(raw)) return raw
  return index.lookup.get(normalizeMachineName(raw)) ?? null
}

export function displayWithIndex(index: MachineCanonIndex, key: string | null | undefined): string {
  if (!key) return ''
  return index.byKey.get(key)?.displayName ?? key
}

/** All canon machines, long-form sorted — for pickers and dropdowns. */
export async function listMachines(includeInactive = false): Promise<CanonMachine[]> {
  const { byKey } = await getMachineCanon()
  return Array.from(byKey.values())
    .filter((m) => includeInactive || m.active)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

/** Drop the in-process cache (after a canon or alias edit). */
export function invalidateMachineCanon(): void {
  cache.clear(CACHE_KEY)
}

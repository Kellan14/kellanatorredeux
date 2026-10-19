// Pure planning helpers: suggestions never make identity decisions or write data.
export interface MachineIdentity {
  key: string
  name: string
  source?: 'mnp' | 'local'
  mnp_key?: string | null
  mnp_name?: string | null
  active?: boolean
}

export const normalizeIdentity = (value: string) =>
  value.replace(/\s+/g, ' ').trim().toLowerCase()

export function publishedIdentity(machine: MachineIdentity) {
  // Preserve the two documented exceptions used by the original canon seed.
  if (machine.key === 'Future Spa')
    return { key: 'FutureSpa', name: 'Future Spa' }
  if (machine.key === "Hotdoggin'")
    return { key: 'Hotdoggin', name: machine.name }
  return { key: machine.key, name: machine.name }
}

export function suggestMachine(
  rawValues: string[],
  upstream: MachineIdentity[],
  existing: MachineIdentity[],
) {
  const normalized = new Set(rawValues.map(normalizeIdentity))
  const published = upstream.filter(
    (m) =>
      normalized.has(normalizeIdentity(m.key)) ||
      normalized.has(normalizeIdentity(m.name)),
  )
  if (published.length === 1)
    return {
      ...publishedIdentity(published[0]),
      source: 'mnp' as const,
      evidence: 'Published MNP short and long forms',
      published: published[0],
    }
  if (published.length > 1)
    return {
      key: '',
      name: '',
      source: 'local' as const,
      evidence:
        'These entries match different MNP machines. Review the selection before combining.',
      published: undefined,
    }
  // Prefer an actual readable title among the selected entries. Do not invent
  // an expansion of an acronym or automatically combine similar-looking names.
  const raw =
    [...rawValues].sort(
      (a, b) =>
        Number(/\s/.test(b)) - Number(/\s/.test(a)) || b.length - a.length,
    )[0] || ''
  const name = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  let key = name.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 56) || 'NewMachine'
  const occupied = new Set(existing.map((m) => normalizeIdentity(m.key)))
  const base = key
  for (let suffix = 2; occupied.has(normalizeIdentity(key)); suffix++)
    key = `${base}${suffix}`
  return {
    key,
    name,
    source: 'local' as const,
    evidence: /\s/.test(name)
      ? 'Suggested from selected source text; review before saving'
      : 'Only a source identifier is available; enter the full title if known',
    published: undefined,
  }
}

export function planMnpSync(
  upstream: MachineIdentity[],
  existing: MachineIdentity[],
) {
  return upstream.flatMap((published) => {
    const official = publishedIdentity(published)
    const known = existing.find(
      (m) => m.source === 'mnp' && (m.mnp_key || m.key) === published.key,
    )
    const locals = existing.filter(
      (m) =>
        m.source === 'local' &&
        (normalizeIdentity(m.key) === normalizeIdentity(official.key) ||
          normalizeIdentity(m.name) === normalizeIdentity(official.name)),
    )
    const target = existing.find(
      (m) => normalizeIdentity(m.key) === normalizeIdentity(official.key),
    )
    if (
      known &&
      (known.mnp_name || known.name) === published.name &&
      locals.length === 0
    )
      return []
    const blocked =
      locals.length > 1 ||
      (locals.length === 1 &&
        normalizeIdentity(locals[0].name) !==
          normalizeIdentity(official.name)) ||
      (!!target && target !== known && !locals.includes(target))
    return [
      {
        key: official.key,
        name: official.name,
        mnpKey: published.key,
        mnpName: published.name,
        previousKey: locals.length === 1 ? locals[0].key : null,
        candidates: locals.map((m) => ({ key: m.key, name: m.name })),
        action: blocked
          ? ('review' as const)
          : locals.length === 1
            ? ('promote' as const)
            : known
              ? ('update' as const)
              : ('add' as const),
      },
    ]
  })
}

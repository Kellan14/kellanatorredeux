import { fetchMNPData } from '@/lib/fetch-mnp-data'
import { invalidateMachineCanon } from '@/lib/machines-canon'
import {
  planMnpSync,
  publishedIdentity,
  type MachineIdentity,
} from '@/lib/machine-canon-plans'

export async function canonEditingReady(): Promise<boolean> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return false
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: 'no-store',
      },
    )
    if (!response.ok) return false
    const schema = await response.json()
    return !!schema.paths?.['/rpc/manage_machine_canon']
  } catch {
    return false
  }
}

export async function loadMnpMachines(
  fresh = false,
): Promise<MachineIdentity[]> {
  const json = await fetchMNPData('machines.json', { fresh })
  const rows = Object.values(json) as MachineIdentity[]
  if (
    rows.length < 100 ||
    rows.some(
      (m) => !m || typeof m.key !== 'string' || typeof m.name !== 'string',
    )
  ) {
    throw new Error(
      'MNP returned an incomplete machine list; no canon changes were made',
    )
  }
  return rows
}

export async function applyCanonChange(
  supabase: any,
  change: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc('manage_machine_canon', {
    p_change: change,
  })
  if (error) {
    if (error.code === 'PGRST202')
      throw new Error(
        'Canon editing needs the database migration installed. Existing canon data is unchanged.',
      )
    throw new Error(error.message)
  }
  invalidateMachineCanon()
  return data
}

export async function syncMnpCanon(supabase: any, actor: string) {
  const upstream = await loadMnpMachines(true)
  const { data: stored, error } = await supabase
    .from('machine_canon')
    .select('*')
  if (error) throw error
  const plan = planMnpSync(upstream, stored || [])
  const applied = []
  const review = []
  for (const item of plan) {
    if (item.action === 'review') {
      review.push(item)
      continue
    }
    // Each machine is a transaction; a conflicting spelling is a review item,
    // not permission to steal aliases or discard saved user settings.
    try {
      applied.push(
        await applyCanonChange(supabase, {
          key: item.key,
          name: item.name,
          source: 'mnp',
          previousKey: item.previousKey,
          mnpKey: item.mnpKey,
          mnpName: item.mnpName,
          rawValues: [item.mnpKey, item.mnpName],
          actor,
          reason:
            'MNP published this short and long form; exact identity match adopted from the official machine list.',
        }),
      )
    } catch (error: any) {
      review.push({ ...item, error: error.message })
    }
  }
  return { applied, review }
}

export function officialChoice(upstream: MachineIdentity[], key: string) {
  return upstream.find((m) => publishedIdentity(m).key === key)
}

// Server-side data loader
// Cache for loaded data to avoid reading files multiple times
const dataCache = new Map<string, any>()

async function fetchData(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const response = await fetch(`${baseUrl}${path}`, { cache: 'force-cache' })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.statusText}`)
  }
  return response.json()
}

export async function getMachinesData() {
  const cacheKey = 'machines'

  if (dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey)
  }

  const data = await fetchData('/mnp-data-archive/machines.json')
  dataCache.set(cacheKey, data)
  return data
}

export async function getSeasonData(season: number) {
  const cacheKey = `season-${season}`

  if (dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey)
  }

  const data = await fetchData(`/mnp-data-archive/${season}.json`)
  dataCache.set(cacheKey, data)
  return data
}

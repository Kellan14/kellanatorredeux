// Server-side data loader - fetches from GitHub instead of bundling files
import { fetchMNPData } from './fetch-mnp-data'

// Cache for loaded data to avoid reading files multiple times
const dataCache = new Map<string, any>()

export async function getMachinesData() {
  const cacheKey = 'machines'

  if (dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey)
  }

  const data = await fetchMNPData('machines.json')
  dataCache.set(cacheKey, data)
  return data
}

export async function getSeasonData(season: number) {
  const cacheKey = `season-${season}`

  if (dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey)
  }

  const data = await fetchMNPData(`${season}.json`)
  dataCache.set(cacheKey, data)
  return data
}

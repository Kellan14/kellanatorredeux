// Server-side data loader using filesystem
import fs from 'fs'
import path from 'path'

// Cache for loaded data to avoid reading files multiple times
const dataCache = new Map<string, any>()

export function getMachinesData() {
  const cacheKey = 'machines'

  if (dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey)
  }

  const filePath = path.join(process.cwd(), 'public', 'mnp-data-archive', 'machines.json')
  const fileContents = fs.readFileSync(filePath, 'utf8')
  const data = JSON.parse(fileContents)

  dataCache.set(cacheKey, data)
  return data
}

export function getSeasonData(season: number) {
  const cacheKey = `season-${season}`

  if (dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey)
  }

  const filePath = path.join(process.cwd(), 'public', 'mnp-data-archive', `${season}.json`)
  const fileContents = fs.readFileSync(filePath, 'utf8')
  const data = JSON.parse(fileContents)

  dataCache.set(cacheKey, data)
  return data
}

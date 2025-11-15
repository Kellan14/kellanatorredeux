// Fetch MNP data from GitHub instead of bundling it
const DATA_BASE_URL = process.env.MNP_DATA_URL || 'https://raw.githubusercontent.com/Kellan14/kellanatorredeux/main/mnp-data-archive'

export async function fetchMNPData(path: string) {
  const url = `${DATA_BASE_URL}/${path}`

  try {
    const response = await fetch(url, {
      next: { revalidate: 3600 } // Cache for 1 hour
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error(`Error fetching MNP data from ${url}:`, error)
    throw error
  }
}

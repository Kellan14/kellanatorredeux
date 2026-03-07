// Fetch MNP data as text (for CSV files) from GitHub
const DATA_BASE_URL = process.env.MNP_DATA_URL || 'https://raw.githubusercontent.com/Invader-Zim/mnp-data-archive/main'

export async function fetchMNPText(path: string) {
  const url = `${DATA_BASE_URL}/${path}`

  try {
    const response = await fetch(url, {
      next: { revalidate: 3600 } // Cache for 1 hour
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.statusText}`)
    }

    return await response.text()
  } catch (error) {
    console.error(`Error fetching MNP text from ${url}:`, error)
    throw error
  }
}

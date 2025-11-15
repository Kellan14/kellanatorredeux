const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf-8')
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) {
    process.env[match[1]] = match[2]
  }
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function diagnoseSeasons() {
  console.log('Checking match data structure across all seasons...\n')

  for (let season of [14, 15, 16, 17, 18, 19, 20, 21, 22]) {
    const { data, error } = await supabase
      .from('matches')
      .select('data')
      .eq('season', season)
      .limit(1)
      .single()

    if (error) {
      console.log(`Season ${season}: NO MATCHES FOUND`)
      continue
    }

    const hasHomeKey = !!data?.data?.home?.key
    const hasAwayKey = !!data?.data?.away?.key
    const homeLineupSize = data?.data?.home?.lineup?.length || 0
    const awayLineupSize = data?.data?.away?.lineup?.length || 0
    const firstPlayerHasKey = !!data?.data?.home?.lineup?.[0]?.key

    console.log(`Season ${season}:`, {
      homeKey: data?.data?.home?.key || 'MISSING',
      awayKey: data?.data?.away?.key || 'MISSING',
      homeLineup: homeLineupSize,
      awayLineup: awayLineupSize,
      playerHasKey: firstPlayerHasKey
    })
  }
}

diagnoseSeasons()

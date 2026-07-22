/**
 * Standalone rebuild of the cache_* tables from the games table.
 *
 * Mirrors the cache-build block of app/api/cron/sync-data/route.ts EXACTLY
 * (same aggregation, same machine/venue/name standardization + score limits),
 * but WITHOUT the GitHub archive re-import — so it can refresh caches after a
 * direct games-table change (e.g. the seasons 2-12 reconstruction) with no
 * GitHub token and no risk to modern-season data.
 *
 * Run:  npx tsx scripts/rebuild-caches.ts            (dry run: counts only)
 *       npx tsx scripts/rebuild-caches.ts --execute  (delete-all + repopulate)
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { machineMappings } from '../lib/machine-mappings'
import { standardizeVenueName } from '../lib/venue-mappings'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return env
}

async function main() {
  const execute = process.argv.includes('--execute')
  const env = loadEnv()
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

  // Standardization inputs (same as sync-data)
  const nameStdMap = new Map<string, string>()
  const { data: mappings } = await supabase.from('player_name_mappings').select('alias, canonical_name')
  for (const m of mappings || []) nameStdMap.set(m.alias, m.canonical_name)
  const stdName = (name: string | null) => {
    if (!name) return name
    return (nameStdMap.get(name) || name).replace(/\s*\(sub\)\s*$/i, '').trim()
  }
  const scoreLimitsMap: Record<string, number> = {}
  const { data: limits } = await supabase.from('score_limits').select('machine, max_score')
  for (const l of limits || []) scoreLimitsMap[(l.machine || '').toLowerCase()] = l.max_score

  // ---- page through ALL games ----
  const PAGE = 1000
  let lastId = 0
  const allHistoryGames: any[] = []
  for (;;) {
    const { data: page, error } = await supabase
      .from('games').select('*').gt('id', lastId).order('id', { ascending: true }).limit(PAGE)
    if (error) throw error
    if (!page || page.length === 0) break
    allHistoryGames.push(...page)
    lastId = page[page.length - 1].id
    if (page.length < PAGE) break
  }
  console.log(`Scanned ${allHistoryGames.length} games.`)

  // ---- aggregations (verbatim from sync-data) ----
  const teamMachineAgg = new Map<string, any>()
  const playerMachineAgg = new Map<string, any>()
  const topScoresAgg = new Map<string, any[]>()

  for (const game of allHistoryGames) {
    const rawMachine = (game.machine || '').toLowerCase()
    if (!rawMachine) continue
    const machine = ((machineMappings as Record<string, string>)[rawMachine] || rawMachine).toLowerCase()
    const venue = standardizeVenueName(game.venue) || null
    const season = game.season
    if (season == null) continue
    const machineLimit = scoreLimitsMap[machine]
    const playerCount = (game.player_1_key ? 1 : 0) + (game.player_2_key ? 1 : 0) +
      (game.player_3_key ? 1 : 0) + (game.player_4_key ? 1 : 0)
    const possiblePts = playerCount === 4 ? 2.5 : 3

    for (let i = 1; i <= 4; i++) {
      const playerKey = game[`player_${i}_key`]
      const playerName = stdName(game[`player_${i}_name`])
      const score = game[`player_${i}_score`]
      const points = game[`player_${i}_points`] || 0
      const teamKey = game[`player_${i}_team`]
      const isPick = game[`player_${i}_is_pick`]
      if (!playerKey || !playerName || !teamKey) continue
      const scoreCounts = score != null && !(machineLimit && score > machineLimit)

      for (const v of [venue, null]) {
        const tmKey = `${teamKey}|${machine}|${v || '__ALL__'}|${season}`
        if (!teamMachineAgg.has(tmKey)) teamMachineAgg.set(tmKey, { team_key: teamKey, machine, venue: v, season, totalScore: 0, gameCount: 0, pickCount: 0, pickTotalPoints: 0, respCount: 0, respTotalPoints: 0, totalPoints: 0, possiblePoints: 0 })
        const tm = teamMachineAgg.get(tmKey)!
        if (scoreCounts) { tm.totalScore += score; tm.gameCount++ }
        tm.totalPoints += points; tm.possiblePoints += possiblePts
        if (isPick) { tm.pickCount++; tm.pickTotalPoints += points } else { tm.respCount++; tm.respTotalPoints += points }
      }
      for (const v of [venue, null]) {
        const pmKey = `${playerName}|${machine}|${v || '__ALL__'}|${season}`
        if (!playerMachineAgg.has(pmKey)) playerMachineAgg.set(pmKey, { player_name: playerName, player_key: playerKey, team_key: teamKey, machine, venue: v, season, totalScore: 0, gameCount: 0, totalPoints: 0, possiblePoints: 0 })
        const pm = playerMachineAgg.get(pmKey)!
        if (scoreCounts) { pm.totalScore += score; pm.gameCount++ }
        pm.totalPoints += points; pm.possiblePoints += possiblePts
      }
      if (score != null && score > 0 && !(machineLimit && score > machineLimit)) {
        const scoreEntry = { player_name: playerName, player_key: playerKey, team_key: teamKey, score, match_key: game.match_key, week: game.week, round_number: game.round_number }
        for (const v of [venue, null]) for (const s of [season, null]) {
          const tsKey = `${machine}|${v || '__ALL__'}|${s || '__ALL__'}`
          if (!topScoresAgg.has(tsKey)) topScoresAgg.set(tsKey, [])
          const arr = topScoresAgg.get(tsKey)!
          arr.push(scoreEntry)
          if (arr.length > 20) { arr.sort((a, b) => b.score - a.score); arr.length = 10 }
        }
      }
    }
  }

  const teamRows = Array.from(teamMachineAgg.values()).filter(a => !(a.gameCount === 0 && a.possiblePoints === 0)).map(a => ({
    team_key: a.team_key, machine: a.machine, venue: a.venue, season_start: a.season, season_end: a.season,
    total_score: a.totalScore, game_count: a.gameCount, avg_score: a.gameCount > 0 ? Math.round(a.totalScore / a.gameCount) : 0,
    pick_count: a.pickCount, pick_total_points: a.pickTotalPoints, resp_count: a.respCount, resp_total_points: a.respTotalPoints,
    total_points: a.totalPoints, possible_points: a.possiblePoints,
  }))
  const playerRows = Array.from(playerMachineAgg.values()).filter(a => !(a.gameCount === 0 && a.possiblePoints === 0)).map(a => ({
    player_name: a.player_name, player_key: a.player_key, team_key: a.team_key, machine: a.machine, venue: a.venue,
    season_start: a.season, season_end: a.season, total_score: a.totalScore, game_count: a.gameCount,
    avg_score: a.gameCount > 0 ? Math.round(a.totalScore / a.gameCount) : 0, total_points: a.totalPoints, possible_points: a.possiblePoints,
  }))
  const topRows: any[] = []
  for (const [key, scores] of Array.from(topScoresAgg.entries())) {
    const [machine, venueStr, seasonStr] = key.split('|')
    const venue = venueStr === '__ALL__' ? null : venueStr
    const season = seasonStr === '__ALL__' ? null : parseInt(seasonStr)
    scores.sort((a, b) => b.score - a.score)
    scores.slice(0, 10).forEach((s, idx) => topRows.push({ machine, venue, season, rank: idx + 1, player_name: s.player_name, player_key: s.player_key, team_key: s.team_key, score: s.score, match_key: s.match_key, week: s.week, round_number: s.round_number }))
  }

  console.log(`Computed: ${teamRows.length} team-machine, ${playerRows.length} player-machine, ${topRows.length} top-score rows.`)
  if (!execute) { console.log('\nDRY RUN — nothing written. Re-run with --execute.'); return }

  const insertAll = async (table: string, rows: any[], onConflict: string) => {
    await supabase.from(table).delete().neq('machine', '__never_match__')
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict })
      if (error) { console.error(`${table} batch ${i}:`, error.message); process.exit(1) }
    }
    console.log(`  ${table}: ${rows.length} rows`)
  }
  await insertAll('cache_team_machine_stats', teamRows, 'team_key,machine,venue,season_start,season_end')
  await insertAll('cache_player_machine_stats', playerRows, 'player_name,machine,venue,season_start,season_end')
  await insertAll('cache_machine_top_scores', topRows, 'machine,venue,season,rank')
  console.log('Done — caches rebuilt from games.')
}

main().catch(e => { console.error(e); process.exit(1) })

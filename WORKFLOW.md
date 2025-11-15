# Monday Night Pinball Stats Platform - Complete Workflow

## Architecture Overview

### The Problem We Solved
Initially, the app fetched JSON files directly from GitHub on every API request. This was:
- **Extremely slow** (making hundreds of HTTP requests per page load)
- **Inefficient** (fetching same data repeatedly)
- **Not scalable** (timeouts, rate limits)
- **The wrong approach** for a production app

### The Solution: Database-First Architecture
We migrated to a **Supabase PostgreSQL database** that:
- Stores all match data locally
- Imports from GitHub **once**
- Auto-updates weekly via cron job
- Provides instant query results

---

## Database Schema

### Tables

#### `matches` table
Stores complete match data for all seasons.

```sql
CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  match_key TEXT UNIQUE NOT NULL,        -- e.g., "mnp-22-1-TWC-KNR"
  season INT NOT NULL,                   -- Season number (14-22)
  week INT NOT NULL,                     -- Week number (1-13)
  home_team TEXT,                        -- Home team code (e.g., "TWC")
  away_team TEXT,                        -- Away team code (e.g., "KNR")
  venue_name TEXT,                       -- Venue name
  state TEXT,                            -- Match state (complete, playing, etc.)
  data JSONB NOT NULL,                   -- Full match JSON from GitHub
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX idx_matches_season_week ON matches(season, week);
CREATE INDEX idx_matches_match_key ON matches(match_key);
CREATE INDEX idx_matches_teams ON matches(home_team, away_team);
```

#### `player_stats` table
Denormalized player statistics for fast queries.

```sql
CREATE TABLE player_stats (
  id SERIAL PRIMARY KEY,
  player_name TEXT NOT NULL,             -- Player full name
  player_key TEXT,                       -- Player hash ID
  season INT NOT NULL,                   -- Season number
  team TEXT,                             -- Team name
  ipr DECIMAL,                           -- Individual Performance Rating
  matches_played INT DEFAULT 0,          -- Games played in season
  last_match_week INT,                   -- Most recent week played
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(player_name, season)            -- One record per player per season
);

-- Indexes for player lookups
CREATE INDEX idx_player_stats_name ON player_stats(player_name);
CREATE INDEX idx_player_stats_season ON player_stats(season);
```

---

## Data Source

### GitHub Repository Structure
- **Repo**: `Invader-Zim/mnp-data-archive`
- **Structure**:
  ```
  season-14/
    matches/
      mnp-14-1-TWC-KNR.json
      mnp-14-1-RMS-BOC.json
      ...
  season-15/
    matches/
      ...
  ...
  season-22/
    matches/
      ...
  ```

### Team Codes (34 total teams)
```
ADB, BAD, CPO, CRA, DIH, DOG, DSV, DTP, ETB, FBP,
HHS, ICB, JMF, KNR, LAS, NLT, NMC, PBR, PGN, PKT,
POW, PYC, RMS, RTR, SCN, SHK, SKP, SSD, SSS, SWL,
TBT, TRL, TTT, TWC
```

### Match File Naming Convention
Format: `mnp-{season}-{week}-{homeTeam}-{awayTeam}.json`

Examples:
- `mnp-22-1-TWC-KNR.json` - Season 22, Week 1, TWC (home) vs KNR (away)
- `mnp-14-6-RMS-BOC.json` - Season 14, Week 6, RMS (home) vs BOC (away)

---

## Initial Setup

### 1. Create Database Tables

Go to Supabase Dashboard → SQL Editor and run:

```bash
cat supabase-schema.sql
```

Copy the entire SQL schema and execute it in Supabase.

**What this creates:**
- `matches` and `player_stats` tables
- Indexes for performance
- Row Level Security policies
- Public read access

### 2. Get Supabase Credentials

**In Supabase Dashboard:**
1. Go to Settings → API
2. Copy `Project URL` (for NEXT_PUBLIC_SUPABASE_URL)
3. Copy `service_role` key (for SUPABASE_SERVICE_KEY)

**Add to `.env.local`:**
```bash
nano .env.local
```

Add:
```
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
```

### 3. Run Initial Import

Import all historical data (seasons 14-22):

```bash
node scripts/import-mnp-data.js
```

**What happens:**
- Fetches all match files from GitHub (9 seasons × ~200 matches = ~1800 matches)
- Inserts into `matches` table
- Extracts player stats and inserts into `player_stats` table
- Takes 15-30 minutes for initial import
- Uses `upsert` so it's safe to run multiple times

**Expected output:**
```
=== SEASON 14 ===
Processing Season 14 Week 1...
  Found: mnp-14-1-TWC-KNR
  Found: mnp-14-1-RMS-BOC
  ...
Season 14: Imported 187 matches

=== SEASON 15 ===
...

=== TOTAL: Imported 1847 matches across all seasons ===
Importing player stats for 3200 players...
=== Import complete! ===
```

---

## Automated Weekly Updates

### Cron Job Setup

**1. Create logs directory:**
```bash
mkdir -p logs
```

**2. Make sync script executable:**
```bash
chmod +x scripts/sync-mnp-data.sh
```

**3. Add to crontab:**
```bash
crontab -e
```

Add this line:
```
0 2 * * 2 /Users/kellankirkland/Documents/kellanator/kellanator/scripts/sync-mnp-data.sh
```

**Schedule:** Every Tuesday at 2 AM (day after Monday Night Pinball)

**What it does:**
- Loads environment variables from `.env.local`
- Runs `import-mnp-data.js`
- Upserts new matches (skips duplicates, adds new data)
- Logs to `logs/sync-YYYY-MM-DD.log`

**Test the sync manually:**
```bash
./scripts/sync-mnp-data.sh
```

**Check if cron is set up:**
```bash
crontab -l
```

**View sync logs:**
```bash
ls -la logs/
cat logs/sync-2025-11-14.log
```

---

## API Routes (Database-Powered)

All API routes now query Supabase instead of fetching from GitHub.

### `/api/player-ipr`
**Query:** Get player IPR from `player_stats` table

```typescript
const { data } = await supabase
  .from('player_stats')
  .select('*')
  .eq('player_name', playerName)
  .eq('season', 22)
  .single()
```

**Response:**
```json
{
  "name": "Kellan Kirkland",
  "ipr": 5,
  "matchesPlayed": 12,
  "currentSeason": 22,
  "lastMatchWeek": 6,
  "team": "The Wrecking Crew"
}
```

### `/api/latest-twc-match`
**Query:** Get most recent TWC match from `matches` table

```typescript
const { data } = await supabase
  .from('matches')
  .select('*')
  .eq('season', 22)
  .or('home_team.eq.TWC,away_team.eq.TWC')
  .order('week', { ascending: false })
  .limit(1)
  .single()
```

**Response:**
```json
{
  "venue": "Georgetown Pizza and Arcade",
  "opponent": "The Wrecking Crew",
  "matchKey": "mnp-22-6-RMS-TWC",
  "week": "6",
  "state": "complete"
}
```

### `/api/team-roster`
**Query:** Get team roster from `player_stats` table

```typescript
const { data } = await supabase
  .from('player_stats')
  .select('*')
  .eq('season', 22)
  .eq('team', teamName)
  .order('ipr', { ascending: false })
```

**Response:**
```json
{
  "players": [
    {
      "name": "Kellan Kirkland",
      "key": "ee3628b78bed241caed1a536e9da2d09b09863a5",
      "ipr": 5,
      "matchesPlayed": 12,
      "sub": false
    },
    ...
  ]
}
```

---

## Performance Improvements

### Before (GitHub Fetching)
- Player IPR lookup: **2000+ HTTP requests** (trying all team/week combinations)
- Load time: **30+ seconds**
- Frequent timeouts
- Rate limit issues

### After (Database)
- Player IPR lookup: **1 SQL query** (~10ms)
- Load time: **< 1 second**
- No timeouts
- Unlimited queries

**Speed improvement: 3000x faster** ⚡

---

## Deployment

### Deploy to Vercel

```bash
git add .
git commit -m "Database architecture migration"
git push origin main
npx vercel --prod
```

**Important:** Make sure Supabase environment variables are set in Vercel:
1. Go to Vercel Dashboard → Project Settings → Environment Variables
2. Add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Maintenance

### Manual Data Sync
Run anytime to pull latest data:
```bash
node scripts/import-mnp-data.js
```

### View Database
Check data in Supabase Dashboard → Table Editor:
- `matches` table - all match data
- `player_stats` table - all player stats

### Check Sync Logs
```bash
tail -f logs/sync-$(date +\%Y-\%m-\%d).log
```

### Clear and Reimport
If you need to start fresh:
```sql
-- In Supabase SQL Editor
TRUNCATE matches, player_stats;
```

Then run import script again.

---

## Troubleshooting

### Import fails with "table not found"
- Make sure you ran `supabase-schema.sql` in Supabase SQL Editor
- Check that tables exist in Supabase Table Editor

### No data showing in app
- Verify import completed successfully
- Check Supabase Table Editor has data
- Check Vercel environment variables are set
- Check browser console for errors

### Cron job not running
```bash
# Check cron is set up
crontab -l

# Check logs
ls -la logs/

# Test manually
./scripts/sync-mnp-data.sh
```

### Player IPR returns 0
- Check player name spelling matches exactly
- Verify player exists in `player_stats` table for that season
- Check Supabase logs for query errors

---

## Key Learnings

1. **Never fetch files from GitHub on every request** - Use a database
2. **Import once, query forever** - Much faster than repeated HTTP requests
3. **Denormalize for speed** - `player_stats` table duplicates data but enables instant queries
4. **Use upsert for idempotency** - Safe to run imports multiple times
5. **Automate with cron** - Set it and forget it
6. **Index everything you query** - Season, week, player name, team codes
7. **JSONB for flexibility** - Store full match data for future features

---

## Future Enhancements

- [ ] Add more player statistics (points per match, win rate, etc.)
- [ ] Create materialized views for complex queries
- [ ] Add full-text search for players and teams
- [ ] Create admin dashboard to trigger manual syncs
- [ ] Add webhook endpoint to trigger sync from GitHub
- [ ] Implement incremental imports (only fetch new weeks)
- [ ] Add player historical IPR trends
- [ ] Cache API responses with Redis

---

## File Structure

```
/
├── supabase-schema.sql          # Database schema
├── scripts/
│   ├── import-mnp-data.js       # Main import script
│   └── sync-mnp-data.sh         # Cron wrapper script
├── logs/                        # Sync logs (gitignored)
├── lib/
│   ├── supabase.ts              # Supabase client (singleton)
│   └── fetch-mnp-data.ts        # Legacy (deprecated)
├── app/api/
│   ├── player-ipr/route.ts      # Player IPR endpoint
│   ├── latest-twc-match/route.ts # Latest match endpoint
│   └── team-roster/route.ts     # Team roster endpoint
└── DATABASE_SETUP.md            # Initial setup instructions
```

---

**Last Updated:** 2025-11-14
**Database Version:** PostgreSQL 15 (Supabase)
**Data Source:** Invader-Zim/mnp-data-archive
**Seasons Imported:** 14-22
**Total Matches:** ~1800+
**Auto-update Schedule:** Every Tuesday 2 AM

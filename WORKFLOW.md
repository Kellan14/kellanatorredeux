# TWC Stats Platform - Workflow Documentation

**Platform**: The Wrecking Crew (TWC) team statistics and strategy platform
**Architecture**: Supabase PostgreSQL database with Next.js frontend
**Current Status**: Relational schema migration complete - 10-40x performance improvement achieved
**Last Updated**: February 16, 2026

---

## Current Architecture

### Database-First Design
- **Primary Storage**: Supabase PostgreSQL
- **Data Source**: GitHub repo `Invader-Zim/mnp-data-archive` (synced weekly)
- **Frontend**: Next.js 14 with TypeScript and Tailwind CSS
- **Deployment**: Vercel

### Why Database Architecture
- Single SQL query (~10ms) vs hundreds of HTTP requests
- No GitHub rate limits or API throttling
- Complex queries and aggregations in PostgreSQL
- Reliable weekly sync via cron job

### Data Flow Architecture

```
GitHub (mnp-data-archive)
    ↓
[unified-import.js] ← Fetches daily at 2am UTC
    ↓
┌─────────────────────────────────────────────┐
│         Supabase PostgreSQL                 │
│                                             │
│  ┌──────────┐                              │
│  │ matches  │ ← JSONB backup/reference     │
│  └──────────┘                              │
│       ↓                                     │
│  ┌──────────┐  ┌────────┐  ┌──────────┐   │
│  │  games   │  │ teams  │  │ player_  │   │
│  │ (PRIMARY)│  │        │  │  stats   │   │
│  └──────────┘  └────────┘  └──────────┘   │
│       ↓             ↓            ↓         │
│  ┌──────────────────────────────────────┐ │
│  │  player_match_participation          │ │
│  └──────────────────────────────────────┘ │
│                                             │
│  Fast SQL Queries with Indexes             │
└─────────────────────────────────────────────┘
    ↓
Next.js API Routes (/api/*)
    ↓
Frontend Components
    ↓
User Dashboard
```

**Key Points:**
- **Import**: `unified-import.js` runs daily at 2am UTC (or on-demand)
- **Primary Data**: `games` table - flattened, indexed, fast
- **Backup**: `matches` table - original JSONB preserved
- **Queries**: Direct SQL on indexed columns (50-200ms)
- **No JSONB Parsing**: All data pre-flattened

---

## Database Schema

### Core Tables (Optimized Relational Schema)

#### `games` Table ⭐ PRIMARY DATA SOURCE
Flattened individual games for fast SQL queries. **Use this table for all statistics.**

```sql
CREATE TABLE games (
  id SERIAL PRIMARY KEY,
  match_id INT REFERENCES matches(id),
  match_key TEXT NOT NULL,               -- "22-11-TWC-PKT"
  season INT NOT NULL,                   -- 22
  week INT NOT NULL,                     -- 11
  venue TEXT,                            -- "Corner Pocket"
  round_number INT,                      -- 1, 2, or 3
  game_number INT,                       -- 1-5 per round
  machine TEXT,                          -- "IronMaiden"

  -- Player 1
  player_1_key TEXT,                     -- Hash ID
  player_1_name TEXT,                    -- "Kellan Kirkland"
  player_1_score BIGINT,                 -- 230562630
  player_1_points DECIMAL,               -- 2.0
  player_1_team TEXT,                    -- "TWC"
  player_1_is_pick BOOLEAN,              -- true if playing for own team

  -- Player 2
  player_2_key TEXT,
  player_2_name TEXT,
  player_2_score BIGINT,
  player_2_points DECIMAL,
  player_2_team TEXT,
  player_2_is_pick BOOLEAN,

  -- Player 3
  player_3_key TEXT,
  player_3_name TEXT,
  player_3_score BIGINT,
  player_3_points DECIMAL,
  player_3_team TEXT,
  player_3_is_pick BOOLEAN,

  -- Player 4
  player_4_key TEXT,
  player_4_name TEXT,
  player_4_score BIGINT,
  player_4_points DECIMAL,
  player_4_team TEXT,
  player_4_is_pick BOOLEAN,

  -- Match context
  home_team TEXT,                        -- "TWC"
  away_team TEXT,                        -- "PKT"
  home_points DECIMAL,                   -- Team points
  away_points DECIMAL,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX idx_games_season ON games(season);
CREATE INDEX idx_games_player_1_key ON games(player_1_key) WHERE player_1_key IS NOT NULL;
CREATE INDEX idx_games_player_2_key ON games(player_2_key) WHERE player_2_key IS NOT NULL;
CREATE INDEX idx_games_player_3_key ON games(player_3_key) WHERE player_3_key IS NOT NULL;
CREATE INDEX idx_games_player_4_key ON games(player_4_key) WHERE player_4_key IS NOT NULL;
CREATE INDEX idx_games_machine ON games(machine);
CREATE INDEX idx_games_venue ON games(venue);
CREATE INDEX idx_games_home_team ON games(home_team);
CREATE INDEX idx_games_away_team ON games(away_team);
```

**Performance Improvement:**
- All statistics queryable with fast SQL
- No JSONB parsing required
- ~5KB data transfer vs 2MB
- 50-200ms queries vs 2-5 seconds

#### `teams` Table
Reference table for team names (normalized).

```sql
CREATE TABLE teams (
  team_key TEXT PRIMARY KEY,             -- "TWC"
  team_name TEXT NOT NULL,               -- "The Wrecking Crew"
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_teams_name ON teams(team_name);
```

**Purpose:**
- Avoid repeating team names in every game row
- Fast lookup: team_key → team_name
- ~28 teams across all seasons

#### `player_match_participation` Table
Tracks which players participated in each match.

```sql
CREATE TABLE player_match_participation (
  id SERIAL PRIMARY KEY,
  match_id INT REFERENCES matches(id),
  match_key TEXT NOT NULL,
  player_key TEXT NOT NULL,
  player_name TEXT NOT NULL,
  season INT NOT NULL,
  week INT NOT NULL,
  team TEXT,                             -- "TWC"
  ipr_at_match DECIMAL,                  -- IPR at time of match
  num_played INT DEFAULT 0,              -- Games played in match
  is_sub BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(match_key, player_key)
);

CREATE INDEX idx_pmp_player_key ON player_match_participation(player_key);
CREATE INDEX idx_pmp_season ON player_match_participation(season);
```

**Purpose:**
- Track match attendance and lineups
- Calculate matches played per player
- Distinguish subs from regular players

#### `player_stats` Table
Pre-calculated aggregate statistics (cache).

```sql
CREATE TABLE player_stats (
  id SERIAL PRIMARY KEY,
  player_name TEXT NOT NULL,
  player_key TEXT,
  season INT NOT NULL,
  team TEXT,
  ipr DECIMAL,
  matches_played INT DEFAULT 0,
  last_match_week INT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(player_name, season)
);
```

**Purpose:**
- Cache IPR calculations
- Quick roster lookups
- Avoid recalculating on every request

#### `matches` Table
Original JSONB storage (reference/backup).

```sql
CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  match_key TEXT UNIQUE NOT NULL,
  season INT NOT NULL,
  week INT NOT NULL,
  home_team TEXT,
  away_team TEXT,
  venue_name TEXT,
  state TEXT,
  data JSONB NOT NULL,                   -- Full match JSON (backup)
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Purpose:**
- Historical reference
- Backup of original data
- Edge cases not in relational schema

---

## Understanding the Data Format

### Supabase Data Structure (Source of Truth for Website)

The website queries Supabase, not GitHub directly. Here's exactly where all data lives:

#### **1. Player Identity & IPR**
**Location**: `matches.data` JSONB → `away.lineup[]` or `home.lineup[]`

```json
{
  "data": {
    "away": {
      "lineup": [
        {
          "name": "Kellan Kirkland",
          "key": "ee3628b78bed241caed1a536e9da2d09b09863a5",
          "IPR": 5,
          "sub": false,
          "num_played": 3
        }
      ]
    }
  }
}
```

#### **2. Game Results**
**Location**: `matches.data` JSONB → `rounds[].games[]`

```json
{
  "data": {
    "rounds": [
      {
        "n": 1,
        "games": [
          {
            "n": 1,
            "machine": "IronMaiden",
            "player_1": "90239d7e2085a450b8192701705676037e42262b",
            "player_2": "43300d683c92f1b88d847cb788b5632d549bbe73",
            "player_3": "d2fbc4f2e81da123cbc5cad3288588c13ea85668",
            "player_4": "b86f2d4ea220902d159a3ef271ba279681c05dd3",
            "score_1": 35894500,
            "score_2": 230562630,
            "score_3": 205807480,
            "score_4": 5567270,
            "points_1": 1.5,
            "points_2": 2,
            "points_3": 1.5,
            "points_4": 0,
            "away_points": 3,
            "home_points": 2
          }
        ]
      }
    ]
  }
}
```

#### **3. Match Metadata**
**Location**: Top-level columns in `matches` table

| Column | Example | Description |
|--------|---------|-------------|
| `match_key` | "mnp-22-3-TWC-ICB" | Unique match identifier |
| `season` | 22 | Season number |
| `week` | 3 | Week number |
| `home_team` | "ICB" | Home team code |
| `away_team` | "TWC" | Away team code |
| `venue_name` | "Admiral Pub" | Venue name |
| `state` | "complete" | Match state |
| `data` | {...} | Complete match JSONB |

#### **4. Venue & Machines**
**Location**: `matches.data` JSONB → `venue`

```json
{
  "data": {
    "venue": {
      "name": "Admiral Pub",
      "key": "ADM",
      "machines": [
        "DP",
        "IronMaiden",
        "SternWars",
        "StrangerThings",
        "Godzilla"
      ]
    }
  }
}
```

#### **5. Cached Player Stats** (TWC-only optimization)
**Location**: `player_stats` table

| Column | Example | Description |
|--------|---------|-------------|
| `player_name` | "Kellan Kirkland" | Player name |
| `player_key` | "ee362..." | Player hash ID |
| `season` | 22 | Season number |
| `team` | "TWC" | Team code |
| `ipr` | 5 | Current IPR |
| `matches_played` | 3 | Number of matches |
| `last_match_week` | 3 | Most recent week |

### The Critical Challenge: Player Hash Mapping

To extract a player's performance from a match, you must:

1. **Find the player's hash** from `data.away.lineup[]` or `data.home.lineup[]` using their name
2. **Search `data.rounds[].games[]`** for that hash in `player_1`, `player_2`, `player_3`, or `player_4`
3. **Map to scores/points** using the corresponding `score_N` and `points_N` fields

**Example**: Finding Kellan Kirkland's performance on "007" machine:
```
1. Find in lineup:
   data.away.lineup → name: "Kellan Kirkland"
   → hash: "ee3628b78bed241caed1a536e9da2d09b09863a5"

2. Search rounds:
   data.rounds[0].games[3].player_1 === "ee3628b78bed241caed1a536e9da2d09b09863a5"

3. Extract stats:
   machine: "007"
   score: data.rounds[0].games[3].score_1 → 935158550
   points: data.rounds[0].games[3].points_1 → 2.5
```

### How It's Stored in Supabase

The `matches` table stores:
- **Extracted fields**: `match_key`, `season`, `week`, `home_team`, `away_team`, `venue_name`, `state`
- **Complete JSON**: Entire match object in `data` JSONB column

This allows both:
1. Fast SQL queries on indexed fields (season, week, team)
2. Deep JSON parsing when needed for detailed stats

### Key Data Relationships

```
matches table
├── match_key (indexed)
├── season (indexed)
├── week (indexed)
├── home_team
├── away_team
├── venue_name
├── state
└── data (JSONB)
    ├── away.lineup[] → Player roster with IPR and hash IDs
    ├── home.lineup[] → Same structure
    ├── venue.machines[] → Available machines
    └── rounds[].games[] → Game results
        ├── machine → Machine name
        ├── player_1-4 → Hash IDs (must map to lineup)
        ├── score_1-4 → Actual scores
        └── points_1-4 → Points earned (0, 0.5, 1, 1.5, 2, 2.5, 3, 4, or 5)
```

---

## Current State & Next Steps

### ✅ What's Working
1. **Data Import**
   - All historical matches imported to Supabase
   - Weekly sync script ready for automation
   - TWC player stats extracted and cached

2. **Database Queries**
   - Basic API routes functional
   - Player IPR and roster queries working
   - Match data accessible via JSONB

### 🔍 Understanding Data Format (COMPLETED ✓)

We have mapped exactly where all data lives in Supabase. See "Understanding the Data Format" section above for complete details.

**Next Implementation Tasks:**

1. **Extract Player Performance**
   ```sql
   -- Example: Get all matches for a specific player
   SELECT
     match_key,
     season,
     week,
     venue_name,
     data->'rounds' as rounds,
     CASE
       WHEN data @> '{"away": {"lineup": [{"name": "Kellan Kirkland"}]}}'
       THEN data->'away'->'lineup'
       ELSE data->'home'->'lineup'
     END as player_lineup
   FROM matches
   WHERE data @> '{"home": {"lineup": [{"name": "Kellan Kirkland"}]}}'
      OR data @> '{"away": {"lineup": [{"name": "Kellan Kirkland"}]}}';
   ```

2. **Calculate Statistics** (To Build)
   - Points per match
   - Machine-specific performance
   - POPS (Percent of Points Scored)
   - Venue-specific stats
   - Win rate by opponent IPR

3. **Player Hash Resolution** (Implementation Strategy)
   - Create helper function to find player hash from lineup by name
   - Parse all games in rounds[] to find hash in player_1-4 positions
   - Extract corresponding score_N and points_N values
   - Consider caching player hash lookups

### 📋 Next Implementation Steps

1. **Data Exploration Scripts**
   - Create scripts to explore JSONB structure
   - Document all edge cases (substitutes, incomplete matches)
   - Verify data consistency across seasons

2. **Statistics Calculation Layer**
   - Build SQL functions for common calculations
   - Create views for complex queries
   - Consider materialized views for performance

3. **API Route Development**
   - `/api/player-performance` - Full game history
   - `/api/machine-stats` - Machine-specific data
   - `/api/venue-analysis` - Venue performance

4. **Frontend Components**
   - Dashboard with personal stats
   - Machine performance cards
   - Opponent analysis tools
   - Strategy calculators

---

## Import Scripts

### **PRIMARY**: `unified-import.js` ⭐ RECOMMENDED
Single-command import that fetches from GitHub and populates all relational tables.

```bash
# Import all seasons (20, 21, 22)
node scripts/unified-import.js

# Or import specific seasons
node scripts/unified-import.js 22
node scripts/unified-import.js 20 21 22
```

**What it does:**
1. Fetches matches from GitHub (`mnp-data-archive` repo)
2. Clears and rebuilds `games` and `player_match_participation` tables
3. Upserts `matches`, `teams`, and `player_stats` tables
4. Populates ALL fields needed by APIs:
   - Player keys, names, scores, points, team assignments
   - Machine names, venues, match metadata
   - Team relationships, is_pick flags
   - Pre-calculated statistics

**Performance:**
- Processes all 3 seasons in ~30-60 seconds
- Creates ~6,000+ game records
- Fully indexed for fast queries

### Legacy Import Scripts (Deprecated)

#### `import-mnp-data.js` (Old approach)
Fetches matches and stores as JSONB only. **Use `unified-import.js` instead.**

```bash
node scripts/import-mnp-data.js
```

#### `migrate-to-relational.js` (Old approach)
Migrates JSONB → relational tables. **No longer needed with `unified-import.js`.**

```bash
node scripts/migrate-to-relational.js
```

#### `import-twc-stats.js`
Updates TWC player stats only. **`unified-import.js` does this automatically.**

```bash
node scripts/import-twc-stats.js
```

### Weekly Sync: `sync-mnp-data.sh`
Automated Tuesday morning updates.

```bash
# Crontab entry - update to use unified-import.js
0 2 * * 2 cd /path/to/kellanator && node scripts/unified-import.js
```

---

## API Routes Structure

### Current Routes
- `/api/player-ipr` - Get player's current IPR
- `/api/team-roster` - Get TWC roster
- `/api/latest-twc-match` - Most recent match info

### Planned Routes
- `/api/player-analysis` - Detailed performance breakdown
- `/api/machine-rankings` - Best/worst machines
- `/api/opponent-scouting` - Opponent statistics
- `/api/strategy-recommendations` - AI-powered suggestions

---

## Development Environment

### Required Environment Variables
```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-key  # For import scripts
```

### Local Development
```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run import scripts
node scripts/import-mnp-data.js
node scripts/import-twc-stats.js
```

### Database Access
- Supabase Dashboard: Table editor and SQL console
- Local queries: Use Supabase client library
- Direct SQL: Via Supabase SQL Editor

---

## File Structure

```
/
├── app/
│   ├── page.tsx                     # Dashboard
│   ├── statistics/page.tsx          # Stats page
│   ├── strategy/page.tsx            # Strategy tools
│   └── api/
│       └── [various routes]
├── lib/
│   └── supabase.ts                  # Database client
├── scripts/
│   ├── import-mnp-data.js           # Full import
│   ├── import-twc-stats.js          # TWC stats update
│   └── sync-mnp-data.sh             # Cron wrapper
└── logs/                            # Sync logs
```

---

## Common Issues & Fixes

### Issue #1: API Routes Not Working with Supabase (FIXED - Nov 15, 2025)

**Problem**: The player-analysis API (and other APIs) were failing to query the `matches` and `player_stats` tables from Supabase.

**Root Cause**: Database type mismatch in `lib/supabase.ts`. The TypeScript `Database` type only included legacy tables (`profiles`, `user_stats`, `user_notes`) but was missing the actual MNP data tables (`matches`, `player_stats`).

**Why It Happened**: The APIs were originally built for local file-based data, then migrated to Supabase. The database type definitions were never updated to reflect the new schema.

**The Fix**: Updated `lib/supabase.ts` Database type to include:
- `matches` table with JSONB `data` column
- `player_stats` table with TWC roster cache

**Code Changes**:
```typescript
// lib/supabase.ts - Added to Database type:
export type Database = {
  public: {
    Tables: {
      matches: {
        Row: {
          id: number
          match_key: string
          season: number
          week: number
          home_team: string | null
          away_team: string | null
          venue_name: string | null
          state: string | null
          data: any // JSONB - contains full match data
          created_at: string
        }
        // Insert and Update types...
      }
      player_stats: {
        Row: {
          id: number
          player_name: string
          player_key: string | null
          season: number
          team: string | null
          ipr: number | null
          matches_played: number
          last_match_week: number | null
          created_at: string
          updated_at: string
        }
        // Insert and Update types...
      }
      // ... other tables (profiles, user_stats, user_notes)
    }
  }
}
```

**Result**: API routes can now properly query Supabase with full TypeScript support and autocomplete.

### Issue #2: APIs Using GitHub Fetching Instead of Supabase (FIXED - Nov 15, 2025)

**Problem**: Several API routes were either disabled or trying to fetch from GitHub instead of querying the Supabase database.

**Affected APIs**:
- `/api/teams` - Returned empty array, was trying to fetch from GitHub match files
- `/api/matches` - Returned "Feature temporarily disabled" message
- `/api/player-machine-stats` - Returned "Feature temporarily disabled" message

**Root Cause**: These APIs were still using the old local/GitHub file-based data fetching approach and hadn't been migrated to query Supabase.

**The Fix**: Updated all three APIs to query the `matches` table from Supabase:

1. **teams API** - Now queries matches table and extracts unique teams from JSONB data
2. **matches API** - Now queries matches table with season filtering and returns full match data
3. **player-machine-stats API** - Now queries matches table, finds player hash, and extracts machine-specific game stats

**Working APIs** (Already using Supabase correctly):
- ✅ `/api/player-analysis` - Full player performance analytics
- ✅ `/api/latest-twc-match` - Most recent TWC match info
- ✅ `/api/player-ipr` - Player IPR lookup
- ✅ `/api/team-roster` - Team roster with IPR data

**Working APIs** (Using GitHub data, which is fine):
- ✅ `/api/machines` - Fetches machines.json from GitHub
- ✅ `/api/venues` - Fetches venues.json from GitHub

**Result**: All core APIs now properly query Supabase for match and player data. The platform is fully functional on Vercel deployment.

### Issue #3: Homepage Only Showing IPR, Missing Stats (FIXED - Nov 15, 2025)

**Problem**: Homepage dashboard showed IPR correctly but displayed 0 for Points Won, Points/Match, and POPS.

**Root Cause**: The `/api/player-ipr` endpoint was only querying the `player_stats` table, which only contains IPR and matches_played. The frontend expected additional calculated stats:
- `pointsWon` - Total points scored
- `pointsPerMatch` - Average points per match
- `pops` - Percent of Points Scored

**The Fix**: Updated `/api/player-ipr` to:
1. Get IPR from `player_stats` table (cached value)
2. Query `matches` table to find all player's games in season
3. Parse JSONB match data to calculate:
   - Find player's hash key from lineup
   - Sum all points from `points_N` fields across all games
   - Count actual matches played (where `num_played > 0`)
   - Calculate total possible points from all games
   - Compute averages and percentages

**Key Insight**: The `player_stats` table is only needed for caching IPR values. All other statistics must be calculated from the `matches` table JSONB data because they require parsing individual game results.

**Result**: Homepage now displays complete player statistics including points won, points per match, and POPS percentage.

---

## Technical Decisions

### Why JSONB?
- Flexibility for varying match formats
- No schema migrations for data changes
- Rich querying with PostgreSQL operators
- Indexable for performance

### Why TWC-Only Stats Table?
- App is specifically for TWC team
- 45x faster imports (1 second vs 90 seconds)
- Opponent data queried on-demand from matches

### Why Supabase?
- Built-in authentication
- Real-time subscriptions (future feature)
- Generous free tier
- PostgreSQL with JSONB support

---

## Key Challenges to Solve

1. **Player Hash Mapping**
   - Games reference players by hash
   - Need efficient hash → name resolution
   - Consider caching or lookup table

2. **Historical Data Consistency**
   - Different JSON formats across seasons?
   - Missing or incomplete matches
   - Player name variations

3. **Performance Optimization**
   - Complex JSONB queries can be slow
   - Consider materialized views
   - Implement smart caching strategy

4. **Real-time Updates**
   - Currently weekly batch updates
   - Could use Supabase real-time features
   - WebSocket subscriptions for live matches?

---

## Resources

- **Data Source**: [github.com/Invader-Zim/mnp-data-archive](https://github.com/Invader-Zim/mnp-data-archive)
- **Database**: Supabase PostgreSQL
- **Frontend**: Next.js 14 + TypeScript + Tailwind
- **Deployment**: Vercel
- **MNP Website**: [mondaynightpinball.com](https://mondaynightpinball.com)

---

## Architecture Refactoring (Nov 15-16, 2025) ✅ COMPLETED

### **Problem Identified (Nov 15)**

**Old JSONB-Only Approach:**

```
matches table:
- data (JSONB) ← Contains EVERYTHING: lineups, rounds, games, scores, points
```

Every API call:
1. Download ~2MB of JSONB data from Supabase
2. Parse 100+ matches × 20 games each = 2000+ games in JavaScript
3. Loop through nested structures to calculate statistics
4. Response time: 2-5 seconds

**Performance Issues:**
- No SQL indexes on player keys, machines, venues (buried in JSONB)
- Network transfer bottleneck (2MB per request)
- All filtering/aggregation in JavaScript instead of PostgreSQL
- Can't use SQL JOINs, WHERE, GROUP BY on game data

### **Solution Implemented (Nov 16)** ✅

**New Relational Schema:**

```
✅ games table
   - Flattened individual games with all player data
   - Indexed columns: player keys, machine, venue, season, teams
   - ~6,000+ game records across seasons 20-22

✅ teams table
   - Normalized team reference (team_key → team_name)
   - ~28 teams total

✅ player_match_participation table
   - Flattened lineups for match attendance tracking
   - Indexed on player_key and season

✅ player_stats table
   - Pre-calculated IPR and aggregate stats cache

✅ matches table (kept)
   - Original JSONB preserved for reference/backup
```

**Created `unified-import.js`:**
- Single script replaces 3-step import process
- Fetches from GitHub → populates all relational tables
- Includes ALL fields needed by APIs
- Runs in ~30-60 seconds for all seasons

### **Performance Results** ✅

| Metric | Before (JSONB) | After (Relational) | Improvement |
|--------|----------------|-------------------|-------------|
| **Response Time** | 2-5 seconds | 50-200ms | **10-40x faster** |
| **Data Transfer** | ~2MB per request | ~5KB per request | **400x less** |
| **Query Method** | JavaScript loops | PostgreSQL SQL | Native DB speed |
| **Indexing** | None on game data | 9+ indexes | Full coverage |

### **API Query Examples**

**Before:**
```javascript
// Download 2MB, parse in JavaScript
for (match of matches) {
  for (round of match.data.rounds) {
    for (game of round.games) {
      if (game.player_1 === playerKey) {
        totalPoints += game.points_1
      }
    }
  }
}
```

**After:**
```sql
-- Single fast SQL query
SELECT
  SUM(player_1_points + player_2_points + player_3_points + player_4_points) as total
FROM games
WHERE player_1_key = ? OR player_2_key = ? OR player_3_key = ? OR player_4_key = ?
```

### **Migration Status** ✅

- ✅ Relational schema designed and created
- ✅ `unified-import.js` script written and tested
- ✅ All tables populated with indexed data
- ✅ APIs updated to use `games` table (teams, latest-twc-match, player-ipr)
- ✅ Documentation updated

**Next Steps:**
1. Run `unified-import.js` in production to populate all tables
2. Update remaining APIs to use SQL queries
3. Monitor performance improvements
4. Deprecate old JSONB-parsing approaches

## Recent Architecture Updates (Nov 16, 2025)

### Critical Fix: Team Name Mapping

**Problem Discovered**: The `/api/processed-scores` endpoint was returning team **keys** ("TWC") instead of team **names** ("The Wrecking Crew") in the `team_name` field. This caused statistics filtering to fail because the frontend compared team names while the data contained keys.

**Solution Implemented** (`app/api/processed-scores/route.ts:55-75`):
```typescript
// Build a map of team_key -> team_name from teams table
const teamKeys = new Set<string>();
gamesData.forEach((game: any) => {
  for (let i = 1; i <= 4; i++) {
    const team = game[`player_${i}_team`];
    if (team) teamKeys.add(team);
  }
});

const { data: teamsData } = await supabase
  .from('teams')
  .select('team_key, team_name')
  .in('team_key', Array.from(teamKeys));

const teamNameMap: Record<string, string> = {};
(teamsData || []).forEach((team: any) => {
  teamNameMap[team.team_key] = team.team_name;
});

// Now use actual team names
team_name: teamNameMap[teamKey] || teamKey || ''
```

### Teams API Enhancement

**Problem**: The `/api/teams` endpoint only returned teams with completed matches (from `games` table). Teams with upcoming matches weren't included in dropdowns.

**Solution** (`app/api/teams/route.ts:31-65`):
```typescript
// Check BOTH tables:
// 1. games table (completed matches)
const { data: gamesData } = await supabase
  .from('games')
  .select('home_team, away_team')
  .eq('season', parseInt(season));

// 2. player_match_participation (all matches including upcoming)
const { data: participationData } = await supabase
  .from('player_match_participation')
  .select('team')
  .eq('season', parseInt(season));

// Combine team keys from both sources
const seasonTeamKeys = new Set<string>();
for (const game of gamesData || []) {
  if (game.home_team) seasonTeamKeys.add(game.home_team);
  if (game.away_team) seasonTeamKeys.add(game.away_team);
}
for (const p of participationData || []) {
  if (p.team) seasonTeamKeys.add(p.team);
}
```

**Result**: Teams with upcoming matches now appear in dropdowns (e.g., "Pocketeers" for week 11).

### Server-Side Calculation Architecture

**Critical Limitation Discovered**: Vercel API routes have a **4.5MB response size limit**. When requesting multiple seasons (20-22), the `/api/processed-scores` endpoint returns ~8000 games worth of data, exceeding this limit and causing truncated JSON responses.

**Old Architecture** (Client-Side Calculation):
```
Database → API (all raw scores 8000+ games) → Client
           [4.5MB limit - TRUNCATED!]
                                              ↓
                               Client calculates statistics
```

**New Architecture** (Server-Side Calculation):
```
Database → API (calculates stats server-side) → Client
           [~50KB final stats only]
```

**Benefits**:
1. **No size limits**: Only return final statistics (~50KB), not raw data (4.5MB+)
2. **Faster**: PostgreSQL calculations vs JavaScript loops
3. **Less bandwidth**: 99% reduction in data transfer
4. **Scalable**: Works with any number of seasons

### API Endpoints

#### `/api/machine-stats` (NEW - Server-Side Calculations)
Calculates machine statistics directly in the database.

**Parameters**:
- `seasons`: Comma-separated season numbers (e.g., "20,21,22")
- `venue`: Venue name
- `opponent`: Opponent team name
- `teamVenueSpecific`: Boolean - filter opponent stats to venue only
- `twcVenueSpecific`: Boolean - filter TWC stats to venue only

**Returns**: Array of `MachineStats` objects (small payload ~50KB)

#### `/api/processed-scores` (LEGACY - Client-Side)
Returns raw game data for client-side processing.

**Limitations**:
- ⚠️ Single season only (response size limit)
- ⚠️ Multi-season queries get truncated (>4.5MB)
- Use `/api/machine-stats` instead for statistics

#### `/api/teams`
Returns teams that played OR have lineups in the specified season.

**Fixed**: Now includes teams with upcoming matches by checking `player_match_participation` table.

#### `/api/latest-twc-match`
Returns TWC's latest or upcoming match information.

**Fixed**: Now correctly identifies upcoming matches using `player_match_participation` table and marks them with `isUpcoming: true`.

### Data Processing Flow

**Statistics Page** (`app/stats/page.tsx`):

**Old Flow** (Broken for multiple seasons):
```typescript
// 1. Fetch ALL raw scores (8000+ games = 4.5MB+)
const processed = await tournamentDataService.getProcessedScores([20,21,22]);
// TRUNCATED - doesn't work!

// 2. Calculate on client
const stats = calculateMachineStats(processed, ...);
```

**New Flow** (Server-Side):
```typescript
// 1. Request final statistics only (~50KB)
const stats = await fetch('/api/machine-stats?seasons=20,21,22&venue=...');
// Returns calculated stats directly

// 2. Display immediately
```

### Key Implementation Files

**Server-Side**:
- `app/api/machine-stats/route.ts` - NEW server-side calculation endpoint
- `app/api/processed-scores/route.ts` - Fixed team name mapping
- `app/api/teams/route.ts` - Fixed to include upcoming matches
- `app/api/latest-twc-match/route.ts` - Updated to use player_match_participation

**Client-Side**:
- `app/stats/page.tsx` - Updated to use server-side API
- `lib/tournament-data.ts` - Calculation logic (used server-side now)
- `lib/data-service.ts` - Updated to call new endpoints

### Performance Metrics

**Before** (Client-Side, Multiple Seasons):
- Request size: 4.5MB+ (TRUNCATED)
- Processing time: FAILED
- Result: Broken

**After** (Server-Side):
- Request size: ~50KB (final stats only)
- Processing time: 200-500ms
- Database calculation: Fast PostgreSQL aggregations
- Result: ✅ Works perfectly

## Data Query Optimizations (Nov 16, 2025)

### Issue #4: Supabase 1000 Row Limit - Missing TWC Statistics (FIXED)

**Problem Discovered**: The `/api/machine-stats` endpoint was only showing 90 TWC scores when there should be 1,050+ scores across 96 machines. TWC data only appeared for Georgetown Pizza and Arcade venue.

**Root Cause**: Supabase has a default **1000 row limit** on queries without explicit pagination. With ~11,110 games across seasons 20-22, the API was only fetching the first 1000 rows, causing massive data loss.

**User Investigation**:
- Database query showed 374 games where `away_team='TWC'`
- 770 games with TWC players in `player_X_team` columns
- 35 unique TWC matches
- 0 NULL scores (data was complete, just not being fetched)

**Fix Attempt #1**: Added `.limit(100000)` to query
```typescript
.limit(100000)
```
**Result**: ❌ Failed - still only fetched 1000 rows

**Fix Attempt #2**: Implemented pagination with `.range()`
```typescript
// app/api/machine-stats/route.ts:74-107
let gamesData: any[] = [];
let hasMore = true;
let offset = 0;
const pageSize = 1000;

while (hasMore) {
  const { data: page, error } = await supabase
    .from('games')
    .select('*')
    .in('season', seasonList)
    .order('season', { ascending: false })
    .order('week', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    console.error('[machine-stats] Database error:', error);
    return NextResponse.json(
      { error: 'Failed to load games data', details: error.message },
      { status: 500 }
    );
  }

  if (!page || page.length === 0) {
    hasMore = false;
  } else {
    gamesData = gamesData.concat(page);
    offset += pageSize;
    hasMore = page.length === pageSize;
  }
}

console.log(`[machine-stats] Fetched ${gamesData.length} games total`);
```

**Result**: ✅ Success!
- Now fetches **all 11,110 games** across seasons 20-22
- TWC statistics show **1,050 scores across 96 machines**
- Pagination handles any data size

**Commits**: `64192a2`, `bd40217`

### Issue #5: Incorrect POPS Calculation (FIXED)

**Problem**: Dashboard POPS (Percent of Points Scored) showing incorrect value - should be ~74.4%.

**Root Cause**: API was not using the correct **fixed point totals** for singles vs doubles games:
- Singles (2 players): 3.0 points possible
- Doubles (4 players): 2.5 points possible

**User Clarification**:
- "no either 2 or 4 players play in each match"
- "when 2 players one is from each team, when 4 players 2 are from each team"
- "and there are 2.5 points possible in doubles and 3 in singles"
- "i know its wrong becuase i know my POPS should be approx 74.4 percent"

**Fix**: Updated `/api/player-ipr/route.ts` to count players per game and use appropriate point totals

```typescript
// app/api/player-ipr/route.ts:73-103
let totalPoints = 0
let totalPossiblePoints = 0
const uniqueMatches = new Set<string>()

for (const game of gamesData || []) {
  // Track unique matches
  if (game.match_key) {
    uniqueMatches.add(game.match_key)
  }

  // Find this player's points
  let playerPoints = 0
  if (game.player_1_key === playerKey) {
    playerPoints = game.player_1_points || 0
  } else if (game.player_2_key === playerKey) {
    playerPoints = game.player_2_points || 0
  } else if (game.player_3_key === playerKey) {
    playerPoints = game.player_3_points || 0
  } else if (game.player_4_key === playerKey) {
    playerPoints = game.player_4_points || 0
  }

  totalPoints += playerPoints

  // Count how many players in this game to determine if singles or doubles
  let playerCount = 0
  if (game.player_1_key) playerCount++
  if (game.player_2_key) playerCount++
  if (game.player_3_key) playerCount++
  if (game.player_4_key) playerCount++

  // Singles (2 players) = 3 points possible, Doubles (4 players) = 2.5 points possible
  const possiblePoints = playerCount === 4 ? 2.5 : 3
  totalPossiblePoints += possiblePoints
}

const matchesPlayedCount = uniqueMatches.size
const pointsPerMatch = matchesPlayedCount > 0 ? totalPoints / matchesPlayedCount : 0
const pops = totalPossiblePoints > 0 ? (totalPoints / totalPossiblePoints) * 100 : 0
```

**Result**: ✅ POPS now calculates correctly as ~74.4%

**Commit**: `496140d`

### Issue #6: Missing Venue Column in Statistics Details (FIXED)

**Problem**: When clicking on cells in the statistics table to see individual scores, the venue column was not appearing in the details table.

**Root Cause**: The `/api/cell-details` endpoint was not including the `venue` field in the response data.

**Fix**: Updated `ScoreDetail` interface and detail objects to include venue

```typescript
// app/api/cell-details/route.ts:96-109
interface ScoreDetail {
  season: number;
  week: number;
  match: string;
  round: number;
  player: string;
  team: string;
  score: number;
  points: number;
  isPick: boolean;
  opponent?: string;
  opponentScore?: number;
  venue: string;  // ADDED
}

// app/api/cell-details/route.ts:147-160
details.push({
  season: game.season || 0,
  week: game.week,
  match: game.match_key,
  round: game.round_number,
  player: playerName,
  team: teamName,
  score: score,
  points: points || 0,
  isPick: isPick,
  opponent: opponent || undefined,
  opponentScore: opponent ? opponentScore : undefined,
  venue: game.venue  // ADDED
});
```

**Result**: ✅ Venue column now displays in cell-details table

**Commit**: `f4e96d7`

### Issue #7: Torpedo Ranking Discrepancy - Missing Seasons in Achievements API (FIXED - Nov 21, 2025)

**Problem**: The achievements API (`/api/player-top10-achievements`) was showing incorrect Torpedo ranking - rank 2 instead of the correct rank 3. The `machine-top10` detail view correctly showed rank 3.

**Symptom**: Clicking on the Torpedo achievement showed the correct top 10 with:
- #1: Travis Maisch (sub): 7,434,610 (Season 11)
- #2: Alan Wiley: 6,375,780 (Season 9)
- #3: Kellan Kirkland: 6,127,380 (Season 11)

But the achievements card showed rank 2, suggesting Alan Wiley's score was being excluded.

**Investigation**:
1. Compared both APIs to find the discrepancy
2. `machine-top10` API: Found 47 Torpedo games correctly
3. `player-top10-achievements` API: Found 0 Torpedo games initially
4. Debug output showed seasons in data: 2, 3, 4, 6, 7, 8, 9, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22
5. **Missing seasons**: 5, 10, 11, 13

**Root Cause**: The achievements API was using `.gte('season', 2).lte('season', 22)` (range query) which was not returning all seasons due to data type issues in the database. The `machine-top10` API used a different query method that worked correctly.

**The Fix**: Changed from range query to explicit `.in()` with a season list:

```typescript
// app/api/player-top10-achievements/route.ts:66-71

// OLD (Broken):
.gte('season', 2)
.lte('season', 22)

// NEW (Fixed):
const allSeasons = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
// ...
.in('season', allSeasons)
```

**Additional Fix**: Had to rename a debug variable from `allSeasons` to `seasonsFound` to avoid duplicate identifier error at line 255.

**Result**:
- Now correctly fetches data from seasons 10 and 11 (where top Torpedo scores are)
- Torpedo shows 94 scores from 47 games
- Kellan Kirkland correctly ranks #3 with 6,127,380

**Key Lesson**: When querying for "all seasons" in Supabase/PostgreSQL, prefer `.in()` with an explicit list over `.gte().lte()` range queries, especially when season data may have type inconsistencies (some stored as strings vs integers).

**Commit**: `f15ef76`

## Machine Mapping Rules

**CRITICAL: Never delete machine mappings unless explicitly instructed by user.**

The `lib/machine-mappings.ts` file contains the single source of truth for machine name aliases. The long-form names (values) are EXACTLY what the machine APIs search for - DO NOT MODIFY them.

Rules:
1. **Never delete mappings** - Only add or update values when instructed
2. **Long-form names are sacred** - The values must match EXACTLY what's in STDmapping.xlsx
3. **Keep all existing keys** - When updating, preserve all existing aliases
4. **Case sensitivity matters** - "Batman Forever (SEGA)" is different from "Batman Forever"

---

## Machine Mapping Standardization Audit (Nov 22, 2025) - IN PROGRESS

### Problem Discovered
Machine mappings have inconsistent chained mappings (e.g., "pulp" -> "PULP" -> "Pulp Fiction") which causes `getMachineVariations()` to fail since it only follows ONE level.

### Audit Steps
- [x] **Step 1**: Audit all APIs to identify which machine name format they use
- [x] **Step 2**: Decide on canonical format (LONG FORM like "Pulp Fiction")
- [x] **Step 3**: Update all mappings to point directly to canonical format (no chaining)
- [x] **Step 4**: Update APIs to use consistent format

### Current Status: COMPLETED

**API Fix Applied:**
- `/api/machine-top10/route.ts`: Changed from `.ilike('machine', lowerMachineKey)` (single value) to `.or(machineVariations.map(...))` (all variations)
- This ensures queries match BOTH old data ("PULP") and new data ("Pulp Fiction")

**Mappings fixed (no more chaining):**
- "pulp" -> "Pulp Fiction" (was "PULP")
- "foo fighters" -> "Foo Fighters" (was "FOO")
- "guardians of the galaxy" -> "Guardians of the Galaxy" (was "guardians")
- "james bond" -> "James Bond 007" (was "007")
- "jurassic" -> "Stern Jurassic Park" (was "sternpark")
- "mandolorian" -> "Mandalorian" (was lowercase)
- Plus many lowercase values fixed to Title Case

### Previous: Step 1 - API Audit
**APIs to check:**
- [ ] `/api/machine-stats`
- [ ] `/api/machine-top10`
- [ ] `/api/machine-top-scores`
- [ ] `/api/player-machine-stats`
- [ ] `/api/player-top10-achievements`
- [ ] `/api/cell-details`
- [ ] `/api/processed-scores`
- [ ] `/api/machines`
- [ ] Any other APIs using machine names

### Findings

| API | Machine Name Handling | Uses Mappings? |
|-----|----------------------|----------------|
| `/api/machine-stats` | `game.machine.toLowerCase()` - raw from DB | NO |
| `/api/machine-top10` | `.ilike('machine', lowerMachineKey)` + `getMachineVariations()` | YES (1 level) |
| `/api/player-top10-achievements` | `standardizeMachineName()` follows mapping 1 level | YES (1 level) |
| `/api/cell-details` | `.ilike('machine', machine)` - raw query | NO |
| `/api/processed-scores` | `game.machine.toLowerCase()` - raw from DB | NO |

**Key Problems Identified:**
1. **Database stores inconsistent names**: "PULP" in old seasons, "Pulp Fiction" in new seasons
2. **Chained mappings break lookups**: "pulp" -> "PULP" -> "Pulp Fiction" only follows 1 level
3. **APIs inconsistent**: Some use raw DB values, some use mappings
4. **`getMachineVariations()` only follows 1 level of mapping**

### Decision: Use LONG FORM as Canonical

**Rationale:**
- STDmapping.xlsx uses long form as the "real" name
- Long form is human-readable ("Pulp Fiction" vs "PULP")
- Long form matches what users expect to see

**Implementation Plan:**
1. Update ALL mappings to point DIRECTLY to long form (no chaining)
2. Update APIs to normalize machine names using mappings when displaying
3. Ensure `getMachineVariations()` returns BOTH short and long forms for DB queries

---

### Issue #8: BKSoR/BlackKnight Mapping Inconsistency (FIXED - Nov 21, 2025)

**Problem**: Clicking on "BlackKnight" achievement at Shorty's returned empty `topScores` array. The achievements list showed a BlackKnight achievement at Shorty's, but the detail view returned no data.

**Symptom**:
```json
{
  "machine": "BlackKnight",
  "machineKey": "BlackKnight",
  "context": "Shorty's - all time",
  "topScores": []  // Empty!
}
```

**Investigation**:
1. Database query showed machine is stored as "bksor" at Shorty's (not "BlackKnight")
2. `lib/machine-mappings.ts` had mapping `"bksor": "BlackKnight"` on line 5
3. `public/machine_mapping.json` did NOT have this mapping
4. The two files were out of sync

**Root Cause**: The `player-top10-achievements` API imports from `lib/machine-mappings.ts` which was mapping "bksor" → "BlackKnight". When the user clicked the achievement, the `machine-top10` API searched for "blackknight" but the database only has "bksor".

**The Fix**: Removed `"bksor": "BlackKnight"` mapping from `lib/machine-mappings.ts` to keep BKSoR (Black Knight: Sword of Rage 2019) separate from BlackKnight (1980).

**Files Changed**:
- `lib/machine-mappings.ts` - Removed line 5: `"bksor": "BlackKnight",`

**Result**:
- Achievements now show "Bksor" at Shorty's (not "BlackKnight")
- Clicking on Bksor achievement returns correct top 10 scores
- Three Black Knight machines remain properly separated:
  - BlackKnight (1980)
  - bk2k (Black Knight 2000)
  - Bksor (Black Knight: Sword of Rage 2019)

**Key Lesson**: Machine mapping files must stay in sync. The `lib/machine-mappings.ts` file is bundled with serverless functions and imported directly, while `public/machine_mapping.json` is loaded at runtime.

**Commit**: `39c969f`

### Issue #9: UI Limiting Achievements to 20 (FIXED - Nov 21, 2025)

**Problem**: The achievements section on the homepage only displayed 20 achievements, even though the API was returning 82 total achievements.

**Root Cause**: Line 711 in `app/page.tsx` had `.slice(0, 20)` limiting the displayed achievements:
```typescript
{achievements.slice(0, 20).map((achievement, index) => (
```

**The Fix**: Removed the `.slice(0, 20)` to display all achievements:
```typescript
{achievements.map((achievement, index) => (
```

**Result**: All 82 achievements now display instead of being limited to 20.

**Commit**: `c788bdd`

### Issue #10: /machines Page Top Scores Not Working (PENDING)

**Problem**: Many machines on the `/machines` page are showing empty or incorrect top scores when clicked.

**Status**: Investigation pending - need to examine:
1. How the machines page fetches top scores
2. Which API endpoint is used (`/api/machine-top-scores` or `/api/machine-top10`)
3. Whether machine name matching is case-sensitive
4. If machine mappings are being applied correctly

**Files to Investigate**:
- `app/machines/page.tsx` - Main machines list page
- `app/machines/[machine]/page.tsx` - Individual machine detail page
- `app/api/machine-top-scores/route.ts` - Top scores API
- `app/api/machine-top10/route.ts` - Top 10 API with context support

### Deployment Workflow Update

**Change**: Switched to force deployment on every code change to ensure immediate updates without GitHub integration delays.

**Command**:
```bash
# Force redeploy to production
npx vercel --prod --yes
```

**Benefits**:
- Immediate deployment (no waiting for GitHub webhook)
- Guaranteed fresh build
- Predictable deployment timing
- Easier testing cycle

---

## Summary

The platform has successfully transitioned from JSONB-only storage to an optimized relational schema.

**Completed** ✅:
- ✓ Data format fully mapped and documented
- ✓ Player hash mapping challenge solved with relational schema
- ✓ Performance bottleneck identified and fixed
- ✓ Relational schema designed and implemented
- ✓ Unified import script created (`unified-import.js`)
- ✓ Core APIs migrated to SQL queries
- ✓ **10-40x performance improvement achieved**
- ✓ Supabase pagination implemented (handles 11,110+ games)
- ✓ POPS calculation fixed with correct point totals
- ✓ Venue field added to statistics details

**Architecture:**
- **Primary data source**: `games` table (flattened, indexed)
- **Reference tables**: `teams`, `player_match_participation`, `player_stats`
- **Backup**: `matches` table (original JSONB preserved)
- **Import method**: `unified-import.js` (single command, all seasons)
- **Deployment**: Force deploy with `npx vercel --prod --yes`

---

## Historical Data Import (MNPhistoryfull.xlsx)

### Overview

Historical MNP data (seasons 2-18) is stored in `MNPhistoryfull.xlsx` with each season on a separate sheet. This data must be converted to CSV and imported separately from the GitHub-sourced data (seasons 20+).

### File Structure

```
MNPhistoryfull.xlsx
├── Sheet "2" - Season 2 (1230 games)
├── Sheet "3" - Season 3 (1314 games)
├── Sheet "4" - Season 4 (1873 games)
├── Sheet "5" - Season 5 (2124 games)
├── Sheet "6" - Season 6 (2256 games)
├── Sheet "7" - Season 7 (2482 games)
├── Sheet "8" - Season 8 (2718 games)
├── Sheet "9" - Season 9 (3233 games)
├── Sheet "10" - Season 10 (3407 games)
├── Sheet "11" - Season 11 (3426 games)
├── Sheet "12" - Season 12 (3469 games)
├── Sheet "14" - Season 14 (3212 games)
├── Sheet "15" - Season 15 (3168 games)
├── Sheet "16" - Season 16 (3432 games)
├── Sheet "17" - Season 17 (3652 games)
└── Sheet "18" - Season 18 (4154 games)
```

Note: Season 13 and 19 are missing from historical data.

### CSV Format

The historical data CSV has these columns:
```
date,match,season,week,venue,home_team,away_team,round,machine,away_points,home_points,p1,p1_score,p1_points,p2,p2_score,p2_points
```

**Important:** Only 2 players per row (p1, p2), not 4. Even doubles rounds (1 & 4) store each matchup as a separate row. This matches how `games` table stores data - each game record can have up to 4 players but historical data typically only uses player_1 and player_2.

### Import Process

#### Step 1: Check Which Seasons to Import

```bash
# Check what sheets exist in the xlsx
node scripts/check-xlsx-sheets.js

# Check what's already in the database
node -e "
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function check() {
  const { data } = await supabase.from('games').select('season').then(r => r);
  const seasons = [...new Set(data?.map(g => g.season))].sort((a,b) => a-b);
  console.log('Seasons in DB:', seasons.join(', '));
}
check();
"
```

#### Step 2: Update Conversion Script

Edit `scripts/convert-seasons-3-12.js` to include desired seasons:

```javascript
// Seasons to import
const seasonsToImport = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
```

#### Step 3: Convert XLSX to CSV

```bash
node scripts/convert-xlsx-to-csv.js   # Creates MNPhistoryfull.csv (single sheet)
node scripts/convert-seasons-3-12.js  # Creates MNP-seasons-3-12.csv (multiple sheets)
```

#### Step 4: Import to Database

**For new seasons not yet in DB:**
1. Create a season-specific CSV: `grep "^[^,]*,[^,]*,5," MNP-seasons-3-12.csv > season-5-only.csv`
2. Temporarily modify `import-mnp-history.js` to read from that file
3. Run `node scripts/import-mnp-history.js` (dry run first)
4. Run `node scripts/import-mnp-history.js --execute`
5. Restore the original file path

**Full reimport (if needed):**
```bash
# WARNING: Deletes existing data for those seasons!
# 1. Delete existing data from DB first
# 2. Run import
node scripts/import-mnp-history.js --execute
```

### Scripts Reference

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| `check-xlsx-sheets.js` | List sheets and row counts | MNPhistoryfull.xlsx | Console output |
| `convert-xlsx-to-csv.js` | Convert first sheet to CSV | MNPhistoryfull.xlsx | MNPhistoryfull.csv |
| `convert-seasons-3-12.js` | Convert multiple sheets to CSV | MNPhistoryfull.xlsx | MNP-seasons-3-12.csv |
| `import-mnp-history.js` | Import CSV to database | MNP-seasons-3-12.csv | games & matches tables |

### Data Processing Rules

The import script (`import-mnp-history.js`) applies these rules:

**Player Team Assignment (by round and position):**
- Round 1 (doubles): p1/p3 = away, p2/p4 = home
- Round 2 (singles): p1 = home, p2 = away
- Round 3 (singles): p1 = away, p2 = home
- Round 4 (doubles): p1/p3 = home, p2/p4 = away

**Is Pick Determination:**
- Doubles (rounds 1 & 4): positions 2 and 4 are picks
- Singles (rounds 2 & 3): position 2 is pick

**Player Key Generation:**
- Lowercased, hyphenated: "David Rauschenberg" → "david-rauschenberg"
- If player exists in `player_stats` table, uses their existing key

### Troubleshooting

**"Missing Supabase environment variables":**
- Add `require('dotenv').config({ path: '.env.local' });` at top of script

**Duplicate key errors:**
- Season already imported - check DB first
- Create season-specific CSV and import only new data

**Wrong data format:**
- Verify CSV headers match expected format
- Check sheet names in xlsx match season numbers

### Season 5 Import (Nov 22, 2025)

Successfully imported season 5 from MNPhistoryfull.xlsx:
- 96 matches inserted
- 2124 games inserted
- Used existing `import-mnp-history.js` with temporary path change to `MNP-season-5.csv`

---

## Machine Mappings System - Complete Reference (Nov 22, 2025)

### Overview

The machine mappings system (`lib/machine-mappings.ts`) is the **single source of truth** for translating between:
- **Abbreviations**: "MM", "TAF", "AFM"
- **Display names**: "Medieval Madness", "The Addams Family", "Attack From Mars"
- **Database values**: The actual values stored in the `games.machine` column

### Critical Decision: Database Values are Canonical

**ALL mappings point to DATABASE VALUES**, not display names.

```typescript
// CORRECT - points to DB value
"medieval madness": "MM",
"eight ball deluxe": "EBD",
"iron maiden": "IronMaiden",

// WRONG - points to display name (old approach that broke everything)
"mm": "Medieval Madness",  // DB has "MM", not "Medieval Madness"
```

### Why This Matters

The database stores machine names in various formats across seasons:
- Season 20+: Often CamelCase like "IronMaiden", "BigGuns"
- Historical: Often abbreviations like "MM", "TAF", "EBD"
- Some machines: Full names like "Foo Fighters", "Pulp Fiction"

APIs must query the database using the **exact values** stored there. If mappings point to display names that don't exist in the DB, queries return zero results.

### Mapping Structure

The mappings file has ~680 entries organized as:

```typescript
export const machineMappings: Record<string, string> = {
  // Abbreviations → DB values
  "mm": "MM",
  "taf": "TAF",
  "afm": "AFM",

  // Display names (lowercase) → DB values
  "medieval madness": "MM",
  "the addams family": "TAF",
  "attack from mars": "AFM",

  // Title case display names → DB values
  "Medieval Madness": "MM",
  "The Addams Family": "TAF",

  // DB value variations → canonical DB value
  "Mm": "MM",
  "mm": "MM",
}
```

### Key Functions

#### `getMachineVariations(machineKey: string): string[]`

Returns ALL possible variations of a machine name for database queries.

```typescript
getMachineVariations("MM")
// Returns: ["MM", "mm", "Mm", "Medieval Madness", "medieval madness", ...]

getMachineVariations("Iron Maiden")
// Returns: ["IronMaiden", "ironmaiden", "Iron Maiden", "iron maiden", ...]
```

**Used by:**
- `/api/machine-top-scores` - Queries with `.in('machine', variations)`
- `/api/machine-top10` - Queries with `.in('machine', variations)`

#### `standardizeMachineName(machineName: string): string`

Converts any machine name to its canonical DB value.

```typescript
standardizeMachineName("medieval madness")  // Returns "MM"
standardizeMachineName("MM")                 // Returns "MM"
standardizeMachineName("Iron Maiden")        // Returns "IronMaiden"
```

**Used by:**
- `/api/player-top10-achievements` - Groups scores by canonical name

### API-Specific Implementation

| API | Function Used | Query Method |
|-----|--------------|--------------|
| `/api/machine-top-scores` | `getMachineVariations()` | `.in('machine', variations)` |
| `/api/machine-top10` | `getMachineVariations()` | `.in('machine', variations)` |
| `/api/player-top10-achievements` | `standardizeMachineName()` | Groups by canonical name |
| `/api/machines` | Returns from `/api/machines` endpoint | Returns `{key: dbValue, name: displayName}` |

### The /machines Page Flow

1. **User visits /machines page**
   - Fetches list from `/api/machines`
   - Returns `{key: "EBD", name: "Eight Ball Deluxe"}`

2. **User clicks "Eight Ball Deluxe"**
   - Page passes display name to `/api/machine-top-scores?machine=Eight%20Ball%20Deluxe`

3. **API looks up mapping**
   - `getMachineVariations("Eight Ball Deluxe")`
   - Finds `"eight ball deluxe": "EBD"` in mappings
   - Returns variations including "EBD"

4. **Query uses all variations**
   - `.in('machine', ['EBD', 'ebd', 'Eight Ball Deluxe', ...])`
   - Finds all games with machine="EBD"

### Adding New Mappings

**Rule: ONLY ADD, never modify or delete existing mappings** (unless they're completely wrong)

When adding a new machine:

```typescript
// 1. Find what's in the database
SELECT DISTINCT machine FROM games WHERE machine ILIKE '%newmachine%';

// 2. Add mappings pointing to the DB value
"newmachine": "DBValue",
"new machine": "DBValue",
"New Machine": "DBValue",
```

### Common Issues & Fixes

#### Issue: Machine shows no scores on /machines page

**Cause**: Display name has no mapping to DB value

**Fix**: Add mapping
```typescript
"display name": "DBValue",
```

#### Issue: Achievements show wrong machine name

**Cause**: `standardizeMachineName()` can't find mapping

**Fix**: Add mapping for the DB value's lowercase form
```typescript
"dbvalue": "DBValue",
```

#### Issue: Top 10 shows empty when clicking achievement

**Cause**: `getMachineVariations()` doesn't return the DB value

**Fix**: Ensure mapping exists for the canonical name
```typescript
"canonicalname": "DBValue",
```

### November 22, 2025 - Major Fix

**Problem Discovered**:
- Mappings pointed to display names like "Iron Maiden"
- DB stores values like "IronMaiden" (no space)
- APIs couldn't find any data

**Root Cause**:
- Historical approach was: abbreviation → display name → DB value (2 levels)
- `getMachineVariations()` only follows ONE level
- Result: Queries searched for "Iron Maiden" but DB has "IronMaiden"

**Fix Applied**:
1. Rewrote ALL 445+ mappings to point directly to DB values
2. Added 164 display name mappings (e.g., `"eight ball deluxe": "EBD"`)
3. Added 61 lowercase spacced mappings (e.g., `"iron maiden": "IronMaiden"`)

**Verification**:
- All machines on /machines page now show scores
- All achievements link to correct top 10
- APIs tested: machine-top-scores, machine-top10, player-top10-achievements

### Scripts for Mapping Analysis

```bash
# Find machines in DB that might need mappings
node scripts/analyze-machine-mappings.js

# Find display names that differ from DB keys
curl -s "https://kellanator.vercel.app/api/machines" | node -e "
const machines = require('/dev/stdin');
for (const [key, val] of Object.entries(machines)) {
  if (val.name !== key) console.log(val.name, '->', key);
}
"
```

### File Locations

- **Mappings**: `lib/machine-mappings.ts`
- **Analysis script**: `scripts/analyze-machine-mappings.js`
- **Machine list API**: `app/api/machines/route.ts`
- **Top scores API**: `app/api/machine-top-scores/route.ts`
- **Top 10 API**: `app/api/machine-top10/route.ts`
- **Achievements API**: `app/api/player-top10-achievements/route.ts`

---

## Pagination Fix - Critical Bug (Nov 22, 2025)

### Problem Discovered

The achievements API was returning incorrect rankings (e.g., TFTC showed rank 2 but detail view showed rank 10). Investigation revealed that **entire seasons were missing** from query results.

### Root Cause

**PostgreSQL pagination without `ORDER BY` returns rows in arbitrary order that changes between pages**, causing entire chunks of data to be skipped.

```
Query 1 (page 0-999): Returns rows A, B, C, D, E...
Query 2 (page 1000-1999): Returns rows F, G, H, I, J... (but skips some!)
```

The `fetchAllRecords()` helper function didn't add any ordering, so seasons stored in non-contiguous ID ranges (like Season 5 with IDs 139354-141477) were completely skipped during pagination.

### Symptoms

- Achievements showed wrong rankings
- Debug output: `Seasons in data: 2, 3, 4, 6, 7, 8, 9, 10, 11, 12...` (Season 5 MISSING)
- Top scores missing high scores from certain seasons
- Different results each time API was called

### The Fix

Added `.order('id', { ascending: true })` to ALL paginated queries:

```typescript
// BEFORE (broken):
await fetchAllRecords(() => supabase
  .from('games')
  .select('*')
  .gte('season', 2)
  .lte('season', 22)
)

// AFTER (fixed):
await fetchAllRecords(() => supabase
  .from('games')
  .select('*')
  .gte('season', 2)
  .lte('season', 22)
  .order('id', { ascending: true })  // Critical!
)
```

### APIs Fixed

| API | Fix Applied |
|-----|------------|
| `/api/player-top10-achievements` | Added `.order('id')` to both queries |
| `/api/machine-top10` | Added `.order('id')` |
| `/api/cell-details` | Added `.order('id')` |
| `/api/machine-stats` | Added `.order('id')` as tiebreaker |
| `/api/processed-scores` | Added `.order('id')` as tiebreaker |

### Key Lesson

**ALWAYS add `.order('id', { ascending: true })` to paginated Supabase queries.** Without a deterministic ordering, PostgreSQL may return different rows on each page, causing data loss.

---

## Venue Mappings System (Nov 22, 2025)

### Problem Discovered

Ghost machine at "Ice Box" venue showed only 4 scores instead of 35. Investigation revealed venue names are stored inconsistently:
- "Icebox" - 34 games
- "Ice Box" - 1 game

### Solution: Venue Mappings

Created `lib/venue-mappings.ts` with same pattern as machine mappings:

```typescript
export const venueMappings: Record<string, string> = {
  // Ice Box variations
  "ice box": "Icebox",
  "Ice Box": "Icebox",
  "icebox": "Icebox",

  // 4Bs variations
  "4bs": "4Bs",
  "4bs tavern": "4Bs",
  "4Bs Tavern": "4Bs",
  "four b's": "4Bs",
  "Four B's": "4Bs",

  // Another Castle variations
  "another castle": "Another Castle",
  "Another castle": "Another Castle",

  // Kraken variations
  "the kraken": "Kraken",
  "The Kraken": "Kraken",
  "kraken": "Kraken",
}

export function getVenueVariations(venueName: string): string[]
```

### APIs Updated

All APIs that filter by venue now use `getVenueVariations()`:

| API | Change |
|-----|--------|
| `/api/machine-top10` | `.in('venue', venueVariations)` |
| `/api/cell-details` | `.in('venue', venueVariations)` |
| `/api/player-machine-counts` | `.in('venue', venueVariations)` |
| `/api/machine-advantages` | `.in('venue', venueVariations)` |
| `/api/player-machine-stats` | `.in('venue', venueVariations)` |
| `/api/optimize-picks` | `.in('venue', venueVariations)` |
| `/api/machine-top-scores` | `.in('venue', venueVariations)` |
| `/api/player-analysis` | `.in('venue', venueVariations)` |
| `/api/optimize-assignments` | `.in('venue', venueVariations)` |

### Venue Inconsistencies Found

| Canonical | Variations in DB |
|-----------|-----------------|
| Icebox | "Icebox", "Ice Box" |
| 4Bs | "4Bs", "4Bs Tavern", "Four B's" |
| Another Castle | "Another Castle", "Another castle" |
| Kraken | "Kraken", "The Kraken" |

### File Locations

- **Venue mappings**: `lib/venue-mappings.ts`
- **Machine mappings**: `lib/machine-mappings.ts`

---

## Player Identity: Sub Handling (Nov 22, 2025)

### How Subs Are Identified

Players who sub have "(sub)" appended to their name but **retain the same player_key**:

```
"Kellan Kirkland" - player_key: ee3628b78bed241caed1...
"Kellan Kirkland (sub)" - player_key: ee3628b78bed241caed1... (SAME!)
```

### API Behavior

- **Rankings**: Use `player_key` to identify unique players (subs and regular names combined)
- **Display**: Show the name as-is, including "(sub)" suffix
- **Achievements**: Same player's best score counts regardless of whether it was as a sub

### Code Implementation

```typescript
// Extract player key, falling back to name for players without keys
playerKey: game.player_1_key || `name:${game.player_1_name}`
```

This ensures:
1. Players with keys are grouped correctly (even with "(sub)" suffix)
2. Players without keys fall back to name-based grouping

---

## Complete Database Schema (Nov 22, 2025)

### Consolidated Schema File

All database schema definitions have been consolidated into a single file:
**`scripts/complete-schema.sql`**

This file is the **single source of truth** for the database structure. It combines:
- `supabase-schema.sql` (original matches/player_stats)
- `create-relational-schema.sql` (games/player_match_participation)
- `add-team-columns-to-games.sql` (player_X_team columns)
- `add-is-pick-columns.sql` (player_X_is_pick columns)
- `create-teams-table.sql` (teams reference table)

### Table Overview

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `matches` | Original JSONB backup/reference | `id` (serial) |
| `teams` | Team key → name lookup | `team_key` (text) |
| `games` | **PRIMARY DATA SOURCE** - Flattened games | `id` (bigserial) |
| `player_match_participation` | Player lineups per match | `id` (bigserial) |
| `player_stats` | Pre-calculated stats cache | `id` (serial) |
| `user_machine_scores` | User-added scores | `id` (bigserial) |

### Games Table Schema

The `games` table is the primary data source for all statistics queries:

```sql
CREATE TABLE games (
  id BIGSERIAL PRIMARY KEY,

  -- Match context (match_id is OPTIONAL - not used by unified-import.js)
  match_id INTEGER REFERENCES matches(id),  -- Can be NULL
  match_key TEXT NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  venue TEXT,

  -- Game identification
  round_number INTEGER NOT NULL,
  game_number INTEGER NOT NULL,
  machine TEXT NOT NULL,

  -- Player 1
  player_1_key TEXT,
  player_1_name TEXT,
  player_1_score BIGINT,
  player_1_points DECIMAL,
  player_1_team TEXT,
  player_1_is_pick BOOLEAN,

  -- Player 2 (same structure)
  -- Player 3 (same structure)
  -- Player 4 (same structure)

  -- Match teams
  home_team TEXT,
  away_team TEXT,

  -- Team scoring
  away_points DECIMAL,
  home_points DECIMAL,

  created_at TIMESTAMP DEFAULT NOW()
);
```

### Player Match Participation Schema

```sql
CREATE TABLE player_match_participation (
  id BIGSERIAL PRIMARY KEY,

  -- Match reference (match_id is OPTIONAL)
  match_id INTEGER REFERENCES matches(id),  -- Can be NULL
  match_key TEXT NOT NULL,

  -- Player info
  player_key TEXT NOT NULL,
  player_name TEXT NOT NULL,

  -- Match context
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  team TEXT NOT NULL,

  -- Player stats at time of match
  ipr_at_match DECIMAL,
  num_played INTEGER DEFAULT 0,
  is_sub BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT NOW(),

  -- Unique constraint uses match_key, NOT match_id
  UNIQUE(match_key, player_key)
);
```

### Key Discovery: match_id vs match_key

**Important**: The `unified-import.js` script does NOT set `match_id`. It only uses `match_key`.

- **Original SQL schema**: `UNIQUE(match_id, player_key)` - references integer ID
- **Actual import behavior**: Uses `UNIQUE(match_key, player_key)` - references text key
- **Upsert conflict**: `onConflict: 'match_key,player_key'`

This means `match_id` must be nullable in the actual database, and all queries should use `match_key` for joins instead of `match_id`.

### TypeScript Types

The TypeScript types in `lib/supabase.ts` have been updated to match:

```typescript
// games.match_id is nullable
match_id: number | null

// All player team/pick columns are present
player_1_team: string | null
player_1_is_pick: boolean | null
// ... same for players 2, 3, 4

// Match team columns
home_team: string | null
away_team: string | null
```

### Import Script Compatibility

The `unified-import.js` script inserts these fields into `games`:

| Field | Included | Notes |
|-------|----------|-------|
| `match_id` | ❌ NO | Not set - must be nullable in DB |
| `match_key` | ✅ YES | Primary match identifier |
| `player_X_team` | ✅ YES | For all 4 players |
| `player_X_is_pick` | ✅ YES | For all 4 players |
| `home_team` | ✅ YES | Match home team |
| `away_team` | ✅ YES | Match away team |

### Running Schema Updates

To update the database schema:

```bash
# Option 1: Run in Supabase SQL Editor
# Copy contents of scripts/complete-schema.sql and run in SQL Editor

# Option 2: Use the migration runner (if exec_sql RPC is enabled)
node scripts/run-schema-migration.js
```

**Note**: The schema uses `IF NOT EXISTS` and `IF EXISTS` clauses, so it's safe to run multiple times.

### File Locations

| File | Purpose |
|------|---------|
| `scripts/complete-schema.sql` | **Single source of truth** for DB schema |
| `lib/supabase.ts` | TypeScript types for database tables |
| `scripts/unified-import.js` | Main import script (GitHub → Supabase) - CLI version |
| `scripts/import-mnp-history.js` | Historical data import (XLSX → Supabase) |
| `app/api/cron/sync-data/route.ts` | Vercel Cron API endpoint |
| `scripts/sync-mnp-data.sh` | Local shell script (backup for manual runs) |

---

## Automated Data Sync (Nov 22, 2025)

### Vercel Cron Setup

The database syncs automatically every **Tuesday at 2am UTC** via Vercel Cron.

**Configuration:**

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/sync-data",
      "schedule": "0 2 * * 2"
    }
  ]
}
```

### API Endpoint

**Path:** `/api/cron/sync-data`

**Authentication:** Requires `CRON_SECRET` environment variable
- Vercel Cron automatically sends: `Authorization: Bearer ${CRON_SECRET}`
- Manual testing: `?key=${CRON_SECRET}` query parameter

**Behavior:**
- Default: Imports only current season (22) - faster, for weekly updates
- Full import: Add `?full=true` to import seasons 20, 21, 22

**Timeout:** `maxDuration = 300` (5 minutes, requires Pro plan for >60s)

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | Yes | Authentication for cron endpoint |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |

### Manual Testing

```bash
# Test the cron endpoint (replace with your secret)
curl "https://kellanator.vercel.app/api/cron/sync-data?key=YOUR_CRON_SECRET"

# Full import (all seasons 20-22)
curl "https://kellanator.vercel.app/api/cron/sync-data?key=YOUR_CRON_SECRET&full=true"
```

### Local Backup Script

For manual runs on your local machine:

```bash
# Run the shell script
./scripts/sync-mnp-data.sh

# Or run unified-import.js directly
node scripts/unified-import.js

# Import specific season only
node scripts/unified-import.js 22
```

### Monitoring

- **Vercel Dashboard:** Logs → Functions → `/api/cron/sync-data`
- **Cron History:** Settings → Cron Jobs → View execution history
- **Local logs:** `logs/sync-YYYY-MM-DD.log` (if using shell script)

### Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Check `CRON_SECRET` is set in Vercel environment variables |
| Timeout | Upgrade to Vercel Pro for >60s functions, or use `?full=false` |
| Missing data | Check GitHub repo has new match data: `Invader-Zim/mnp-data-archive` |
| Partial import | Check Vercel function logs for specific errors |
| All players showing as subs | Check `player_match_participation` has data - cron may have failed silently |
| "null value in column match_id" | Both `games` and `player_match_participation` require `match_id` from matches table |

### Issue #11: All TWC Players Marked as Subs (FIXED - Nov 23, 2025)

**Problem**: The strategy page showed all TWC players marked as subs instead of regular roster players.

**Root Cause**: The `player_match_participation` table had **0 records** for season 22. The cron deleted the data but the insert failed silently due to two issues:
1. Using `.upsert()` with `onConflict: 'match_key,player_key'` but no unique constraint existed on those columns
2. The table has a `NOT NULL` constraint on `match_id` but the cron wasn't providing it

**Investigation Steps**:
1. Queried `player_match_participation` for season 22 - found 0 records
2. Checked constraint: `there is no unique or exclusion constraint matching the ON CONFLICT specification`
3. Tested insert: `null value in column "match_id" of relation "player_match_participation" violates not-null constraint`

**The Fix** (`app/api/cron/sync-data/route.ts`):

1. Changed from `.upsert()` to `.insert()` (lines 360-363):
```typescript
// Before:
.upsert(batch, { onConflict: 'match_key,player_key' })

// After:
.insert(batch)
```

2. Added loop to set `match_id` before insert (lines 347-353):
```typescript
// Add match_id to participations (same as games - required by NOT NULL constraint)
for (const participation of participationsBatch) {
  const matchId = matchKeyToId.get(participation.match_key)
  if (matchId) {
    participation.match_id = matchId
  }
}
```

**Result**:
- Season 22 now has **3677** participation records
- TWC has **110** records (100 non-subs, 10 subs)
- Team roster API correctly returns players with `sub: false` for regular roster players

### Issue #12: Strategy Page Dark Mode Styling (FIXED - Nov 23, 2025)

**Problem**: Multiple elements on the strategy page had white backgrounds with white text in dark mode.

**Root Cause**: Components used hardcoded light-mode colors like `bg-white`, `bg-gray-50`, `text-gray-700` instead of theme-aware CSS variables.

**Files Fixed**:

1. **`app/strategy/page.tsx`** - Added `bg-background` to:
   - Machine picking collapsible items (singles & doubles)
   - Opponent picks list items
   - Player assignment result boxes
   - Top machines for player list

2. **`components/strategy/MachinePicker.tsx`** - Full dark mode overhaul:
   - `bg-white` → `bg-background`
   - `bg-gray-50` → `bg-muted`
   - `text-gray-*` → `text-foreground` / `text-muted-foreground`
   - `border-gray-*` → `border-border`
   - `bg-blue-*` → `bg-primary/*`
   - `bg-green-*` → `bg-green-500/*` (with opacity)

### Issue #13: Subs Not Showing in Strategy Page (FIXED - Nov 23, 2025)

**Problem**: Sam Lund and other actual subs weren't appearing in the "Show Subs" list on the strategy page.

**Root Cause**: The `/api/machine-advantages` API had flawed logic for determining subs:
- It correctly identified season 22 subs (`is_sub = true`) but then **ignored them**
- It only showed players from seasons 20-21 who didn't play in season 22 as "subs"

**The Fix** (`app/api/machine-advantages/route.ts` line 229):

```typescript
// Before: Started with empty set
const subPlayers = new Set<string>()

// After: Start with actual season 22 subs
const subPlayers = new Set<string>(season22Subs)
```

**Result**: Sub players list now includes:
- **Season 22 subs** (Sam Lund, Gavin Carrol, Katie Janis, Jeffrey McIlvain, Ryan Newstrum, Ron Hudson)
- **Plus** players from seasons 20-21 who didn't play in season 22

---

## Player Name Standardization (Nov 23, 2025)

### Overview

The Player Name Standardization feature allows combining player name variations (e.g., "Wil Kirkland" and "Will Kirkland") into a single canonical name across the database.

### Components

| Component | Purpose |
|-----------|---------|
| `components/player-mapping-manager.tsx` | UI for selecting and combining player names |
| `app/api/player-mappings/route.ts` | API to fetch all unique player names |
| `app/api/update-player-names/route.ts` | API to update database with mappings |
| `player_name_update_log` table | Audit log for all forced updates |

### Database Tables Updated

When a player name is standardized, these tables are updated:

1. **`player_match_participation`** - `player_name` column
2. **`games`** - All player name columns:
   - `player_1_name`
   - `player_2_name`
   - `player_3_name`
   - `player_4_name`

### Audit Log Table

Create this table in Supabase to track all player name updates:

```sql
CREATE TABLE player_name_update_log (
  id SERIAL PRIMARY KEY,
  old_name TEXT NOT NULL,
  new_name TEXT NOT NULL,
  records_updated INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_player_name_update_log_created_at
  ON player_name_update_log(created_at DESC);
```

### Usage

1. Go to **Options** → **Standardize Player Names**
2. Search and select player name variations to combine
3. Set the canonical name (the "correct" name)
4. Click "Add Mapping" to stage the change (stored in localStorage)
5. Click "Update Database - All" or individual "Update" buttons
6. Confirm in the dialog ("Are you sure? This action cannot be undone.")

### Auto-fix Capitalization

The UI automatically detects names that differ only in capitalization (e.g., "John Smith" vs "JOHN SMITH") and offers a "Fix All" button to create mappings for all of them at once.

### API Details

#### GET `/api/player-mappings`

Returns all unique player names from both `player_match_participation` AND `games` tables.

**Response:**
```json
{
  "allPlayers": ["Adam Smith", "Bob Jones", ...],
  "count": 450
}
```

#### POST `/api/update-player-names`

Updates player names in the database.

**Request:**
```json
{
  "mappings": {
    "Wil Kirkland": "Will Kirkland",
    "JOHN SMITH": "John Smith"
  }
}
```

**Response:**
```json
{
  "success": true,
  "totalUpdated": 47,
  "results": [
    {"alias": "Wil Kirkland", "canonical": "Will Kirkland", "updated": 12},
    {"alias": "JOHN SMITH", "canonical": "John Smith", "updated": 35}
  ],
  "message": "Updated 47 records across 2 mappings"
}
```

### Query Update Log

To view all player name updates:

```sql
SELECT * FROM player_name_update_log ORDER BY created_at DESC;
```

### Important Notes

- **This action cannot be undone** - The database is directly modified
- Updates are logged to `player_name_update_log` for audit purposes
- Only updates records where the exact old name matches

### Tables Updated

The standardization API now updates ALL relevant tables:

1. **`player_match_participation`** - `player_name` column
2. **`games`** - All player name columns (`player_1_name` through `player_4_name`)
3. **`player_stats`** - `player_name` column (IPR cache table)

---

## Mobile-Friendly Player Selection (Nov 23, 2025)

### Problem

Standard `<Select>` dropdowns don't bring up the keyboard on mobile devices, making it difficult for users to search through hundreds of player names.

### Solution: PlayerCombobox Component

Created a new `PlayerCombobox` component (`components/ui/player-combobox.tsx`) that uses a text input with dropdown instead of a native select.

### Key Features

| Feature | Description |
|---------|-------------|
| **Mobile keyboard** | Uses `inputMode="search"` to trigger keyboard on mobile |
| **Type-ahead search** | Filters players as you type |
| **Performance** | Only shows first 50 matches for smooth scrolling |
| **Clear button** | X button to reset selection |
| **Disabled values** | Prevent selecting same player twice (head-to-head) |
| **Keyboard navigation** | Enter selects first match, Escape cancels |

### Component Props

```typescript
interface PlayerComboboxProps {
  players: string[]           // List of all player names
  value: string               // Currently selected player
  onValueChange: (value: string) => void  // Selection callback
  placeholder?: string        // Input placeholder text
  disabled?: boolean          // Disable the combobox
  disabledValues?: string[]   // Players that can't be selected
}
```

### Usage Example

```tsx
import { PlayerCombobox } from '@/components/ui/player-combobox'

<PlayerCombobox
  players={players}
  value={selectedPlayer}
  onValueChange={setSelectedPlayer}
  placeholder="Search players..."
  disabledValues={[otherPlayer]}  // Prevent duplicate selection
/>
```

### Pages Updated

| Page | Change |
|------|--------|
| `/head-to-head` | Replaced both player Select components |
| `/player-profile` | Replaced player Select component |

### Implementation Details

- **Text input** with `inputMode="search"` brings up mobile keyboard
- **Dropdown** appears on focus, shows filtered results
- **Click outside** closes dropdown
- **Select all on focus** for easy replacement of existing selection
- **Uses existing Input and Button components** from shadcn/ui

### File Location

- **Component**: `components/ui/player-combobox.tsx`

---

## Machine Image Lookup Fix (Nov 23, 2025)

### Problem

Machine images on the player profile page weren't loading correctly. The `getMachineImagePath` function only checked `machine_mapping.json` which had limited entries (~65 machines), so display names like "Iron Maiden" (with space) couldn't find the correct image file "IronMaiden.jpg".

### Solution

Updated `lib/machine-images.ts` to also use the comprehensive `machineMappings` from `lib/machine-mappings.ts` as a fallback.

**Lookup Order:**
1. Check `machine_mapping.json` for image-specific mappings (e.g., "pulp" → "PULP")
2. Check `machineMappings` for display name → DB value mappings (e.g., "iron maiden" → "IronMaiden")
3. Fall back to using the key directly

**Files Changed:**
- `lib/machine-images.ts` - Added import of `machineMappings` and fallback logic in both `getMachineImagePath` and `getMachineThumbnailPath`

---

## Player Profile Machine Dropdown Filter (Nov 23, 2025)

### Problem

The machine dropdown on `/player-profile` showed ALL machines (~200+), making it hard to find machines the player actually played.

### Solution

Created new API `/api/player-machines` that returns only machines a specific player has scores for.

### API: `/api/player-machines`

**Parameters:**
- `player` (required): Player name

**Returns:**
```json
{
  "player": "Kellan Kirkland",
  "machines": ["IronMaiden", "AFM", "TAF", ...],
  "count": 87
}
```

**Features:**
- Uses pagination with `ORDER BY id` to avoid missing data
- Loads player name mappings from `player_name_mappings` table to find all aliases
- Handles "(sub)" suffix matches
- Standardizes machine names for display using `machineMappings`

### Player Profile Page Changes

**Before:**
- `loadMachines()` called on mount, loaded ALL machines from `/api/machines`

**After:**
- `loadPlayerMachines(player)` called when player selected
- Only shows machines the player has played
- Clears machine list when player is deselected

**Files Changed:**
- `app/api/player-machines/route.ts` (NEW)
- `app/player-profile/page.tsx` - Updated to use new API

---

## Database-Backed Score Limits (Jan 30, 2026)

### Problem

Score limits were stored in two places:
1. Server-side: `score_limits.json` file (read-only, couldn't be updated without redeploying)
2. Client-side: `localStorage` in Options page (not shared, not used by server APIs)

This meant:
- Users couldn't update score limits that affect server APIs
- Vercel serverless can't write to filesystem
- Score limits weren't synced across all APIs

### Solution

Migrated score limits to Supabase database with shared helper library and caching.

### Implementation

**1. Created Database Table**
```sql
CREATE TABLE score_limits (
  machine TEXT PRIMARY KEY,
  max_score BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**2. Created `/api/score-limits` Endpoint**
- `GET` - Fetches all score limits from database
- `POST` - Saves score limits to database (replaces all)

**3. Created Helper Library** (`lib/score-limits.ts`)
- `getScoreLimits()` - Fetches with 1-minute caching
- `isScoreValid()` - Checks if score is under limit
- `clearScoreLimitsCache()` - Invalidates cache

**4. Updated All APIs to Use Database:**
- `player-top10-achievements` - Uses `getScoreLimits()` + machine standardization
- `machine-top10` - Uses `getScoreLimits()` + machine standardization
- `machine-top-scores` - Uses `getScoreLimits()` + machine standardization

**5. Updated Options Page** (`app/options/page.tsx`)
- Loads from `/api/score-limits` instead of localStorage/JSON file
- Saves via `POST /api/score-limits` (syncs to database immediately)
- Changes affect all server APIs in real-time (with 1-minute cache)

### Machine Name Standardization

All APIs use `machineMappings` to handle different name formats:
```typescript
const standardized = (machineMappings[machineName.toLowerCase()] || machineName).toLowerCase()
const limit = scoreLimits[standardized] || scoreLimits[machineName.toLowerCase()]
```

This ensures limits work regardless of:
- Display names ("Iron Maiden")
- Database values ("IronMaiden")
- Abbreviations ("IM")

### Files Changed
- `app/api/score-limits/route.ts` (NEW)
- `lib/score-limits.ts` (NEW)
- `sql/create_score_limits_table.sql` (NEW)
- `app/api/player-top10-achievements/route.ts` - Migrated to database
- `app/api/machine-top10/route.ts` - Migrated to database
- `app/api/machine-top-scores/route.ts` - Migrated to database
- `app/options/page.tsx` - Syncs with database

### Benefits
- Score limits editable via Options page without redeploying
- Shared across all users
- Immediately affects all server APIs (with 1-minute cache)
- Machine name standardization ensures consistent matching
- RLS policies allow read-all, modify via service role only

---

## Strategy Page Enhancements (Jan 2026)

### Venue Machine Lists - Source of Truth Change

**Critical Change**: Machine lists for venues are now sourced from `venues.json` (fetched from the Invader-Zim GitHub repo) with optional user overrides applied on top. Previously, APIs derived machine lists from historical game data in the database.

**Impact**: All APIs that accept a `machines` parameter now **require** it to be passed from the client. Without it, they return empty results or errors.

**APIs affected by this change**:
- `/api/machine-advantages` - Returns `{"error":"No machines provided"}` without `machines` param
- `/api/machine-stats` - Returns zeros without `machines` param
- `/api/player-analysis` - Returns empty `machinePerformance` without `machines` param

**How machines flow through the system**:
```
venues.json (GitHub) → /api/venues → Client state → Passed to APIs as query param
                              ↓
                    User overrides from venue_machine_lists table
```

### Machine Name Variation Handling

**Problem**: Machine names differ between venues.json (display names like "Iron Maiden") and the games database (various formats like "IronMaiden", "ironmaiden", "IRONMAIDEN"). Direct string comparison fails.

**Solution**: APIs now use `getAllMachineVariations()` and `machineMappings` from `lib/machine-mappings.ts` to build variation-to-canonical lookup maps.

**Implementation pattern used in `machine-advantages` and `player-analysis`**:
```typescript
import { getAllMachineVariations } from '@/lib/machine-mappings'

// Build a lookup from any DB variation to the canonical (venues.json) name
const machineVariationToCanonical = new Map<string, string>()
for (const machine of machinesAtVenue) {
  for (const variation of getAllMachineVariations([machine])) {
    machineVariationToCanonical.set(variation, machine)
  }
}

// When processing games, map DB names back to canonical
for (const game of gamesData) {
  const canonical = machineVariationToCanonical.get(game.machine)
  if (!canonical) continue
  game.machine = canonical  // Normalize to canonical name
}
```

**Implementation in `machine-stats`** (different because it lowercases all names internally):
```typescript
machines: machinesParam ? machinesParam.split(',').map(m => {
  const lower = m.toLowerCase();
  const mapped = machineMappings[lower] || machineMappings[m];
  return mapped ? mapped.toLowerCase() : lower;
}) : undefined,
```

**APIs updated**:
| API | Approach |
|-----|----------|
| `/api/machine-stats` | Lowercases through `machineMappings` to match internal normalization |
| `/api/machine-advantages` | Variation-to-canonical Map, normalizes `game.machine` in-place |
| `/api/player-analysis` | Variation-to-canonical Map, normalizes `game.machine` in-place |

### Dashboard Page Fixes (Jan 31, 2026)

**Problem**: The dashboard (`app/page.tsx`) opponent players section and performance profile were broken because they called APIs without the now-required `machines` parameter.

**Root cause**: `fetchOpponentPlayers()` called `/api/machine-advantages` without `machines`. Since the team roster fetch was nested inside the `response.ok` block, it also failed to load.

**Fixes applied to `app/page.tsx`**:

1. **Added `venueMachines` state** to store venue machine list
2. **Parallelized initial data loading**: `fetchNextMatch()` now fetches `/api/latest-twc-match` and `/api/venues` in parallel with `Promise.all`, setting `venueMachines` immediately
3. **Decoupled team roster from machine-advantages**: `fetchOpponentPlayers()` now fetches the team roster independently (not inside the machine-advantages response block)
4. **Pass machines to all API calls**: Both `fetchOpponentPlayers()` and `fetchPlayerPerformance()` now include `&machines=` parameter
5. **Dependency-gated effects**: `useEffect` hooks for opponent players and performance profile wait for `venueMachines.length > 0` before firing

**Data loading flow (after fix)**:
```
Mount → checkUser() + fetchNextMatch()
                           ↓
              Promise.all([latest-twc-match, venues])
                           ↓
              setVenue(), setOpponent(), setVenueMachines()
                           ↓
         ┌─────────────────┼────────────────────┐
         ↓                 ↓                    ↓
fetchOpponentPlayers() fetchPlayerPerformance() fetchAchievements()
(needs venueMachines)  (needs venueMachines)    (needs playerName)
```

### Customizable Score Factor Weights

**Feature**: The four score factors used by the Hungarian optimizer are now adjustable sliders instead of hardcoded values.

**Default weights** (unchanged from previous behavior):
- Win Rate: 40%
- Recent Form: 30%
- Score vs Venue Avg: 20%
- Data Confidence: 10%

**Implementation**:

1. **`ScoreWeights` interface** added to `lib/strategy/calculator.ts`:
```typescript
export interface ScoreWeights {
  winRate: number        // 0-1
  recentForm: number     // 0-1
  venueAdjustedAvg: number  // 0-1
  confidence: number     // 0-1
}
```

2. **Proportional adjustment**: When one slider moves, others scale proportionally to keep sum at 100%. Uses largest-remainder rounding for integer display.

3. **Score vs Venue Avg is derived** (read-only bar): `100 - winRate - recentForm - dataConfidence`

4. **Threaded through entire pipeline**:
   - `calculatePerformanceScore(stats, confidenceBoost, weights?)`
   - `buildCostMatrix(players, machines, statsMap, confidenceBoost, weights?)`
   - `optimize7x7()` / `optimize4x2()` accept `scoreWeights` param
   - All API routes (`/api/strategy/optimize`, `/api/strategy/score`, `/api/strategy/matrix`) accept and forward `scoreWeights`

**Note**: Score weights only affect the Hungarian optimizer and scoring/matrix APIs. The greedy optimizer (`/api/optimize-picks`) uses raw blended averages and is not affected.

### Apply Button (Replace Auto-Reoptimize)

**Change**: Moving sliders no longer auto-triggers optimization. An "Apply" button appears when slider values differ from the last optimization run.

**Implementation in `app/strategy/page.tsx`**:
- `appliedWeights` state tracks last-optimized values
- `isSlidersDirty` derived boolean compares current vs applied
- Removed auto-reoptimize `useEffect` that watched `venueWeight, userInputWeight, confidenceBoost`
- Removed `venueWeight` from `loadMachineAdvantages` and `loadMatrixData` dependency arrays

**Implementation in `components/strategy/MachinePicker.tsx`**:
- `lastOptimizedParams` ref tracks last-optimized slider values
- `isParamsDirty` derived boolean for "Apply Changes" button visibility
- Removed debounced auto-reoptimize useEffects

### Slider Persistence (localStorage)

**Feature**: All slider settings persist across page reloads via localStorage.

**Key**: `"strategySliderSettings"`

**Persisted values**: `venueWeight`, `userInputWeight`, `confidenceBoost`, `winRateWeight`, `recentFormWeight`, `dataConfidenceWeight`

**Reset button**: Restores defaults and clears localStorage entry.

### Venue Weight Labels

Added "All Venues" and "Venue Only" labels below the venue weight slider (both picking and assignment tabs) so users know which direction the slider goes.

### Info Button for Greedy Results

**Problem**: The inline Info icon next to "% of avg" on greedy optimizer result cards was not clickable on mobile because it was inside a `CollapsibleTrigger` (clicks bubbled up to expand/collapse the card).

**Solution**:
- **Mobile**: Section-level Info button next to "Recommended Machine Picks:" header. Toggles an expandable explanation panel. Uses `md:hidden` to hide on desktop.
- **Desktop**: Inline Info icons restored next to individual "% of avg" stats with hover tooltips. Uses `hidden md:inline` to hide on mobile.

### User Input Machine Name Fix

**Problem**: Confidence boost and user input data weren't being found because `user_machine_inputs` table stores display names (e.g., "Iron Maiden") but APIs queried with canonical keys (e.g., "IronMaiden").

**Fix**: All APIs that query `user_machine_inputs` now use `getAllMachineVariations()` for the query and map results back to canonical keys using `machineMappings`.

**Files fixed**:
- `app/api/optimize-picks/route.ts`
- `lib/strategy/optimizer.ts`
- `app/api/strategy/matrix/route.ts`
- `app/api/strategy/score/route.ts`
- `app/api/user-machine-inputs/route.ts`

---

## Updated API Routes (Jan 2026)

### Strategy APIs

| Route | Method | Purpose | Key Params |
|-------|--------|---------|------------|
| `/api/strategy/optimize` | POST | Hungarian optimizer | `format`, `playerNames`, `machines`, `scoreWeights` |
| `/api/strategy/score` | POST | Score manual assignments | `assignments`, `scoreWeights` |
| `/api/strategy/matrix` | GET | Player-machine performance matrix | `playerNames`, `machines`, `scoreWeights` (JSON) |
| `/api/optimize-picks` | POST | Greedy machine picker | `venue`, `players`, `numMachines`, `venueWeight`, `userInputWeight`, `confidenceBoost` |

### Dashboard APIs

| Route | Method | Purpose | Key Params |
|-------|--------|---------|------------|
| `/api/latest-twc-match` | GET | Next/current/last match info | none |
| `/api/venues` | GET | Venue list with machine lists | none |
| `/api/team-roster` | GET | Opponent team players | `team`, `season`, `showSubs` |
| `/api/machine-advantages` | GET | TWC vs opponent comparison | `venue`, `opponent`, `machines` (required) |
| `/api/player-analysis` | GET | Player performance profile | `player`, `venue`, `machines` (required) |
| `/api/machine-stats` | GET | Stats page machine data | `seasons`, `venue`, `teamName`, `machines` |

### Key Files Modified (Jan 2026)

| File | Changes |
|------|---------|
| `lib/strategy/calculator.ts` | Added `ScoreWeights` interface, optional weights params to all functions |
| `lib/strategy/optimizer.ts` | Threaded `scoreWeights` through, added machine variation imports |
| `app/strategy/page.tsx` | Weight sliders, Apply button, localStorage persistence, venue labels, info button |
| `components/strategy/MachinePicker.tsx` | `scoreWeights` prop, Apply button, removed auto-reoptimize |
| `app/page.tsx` | Parallelized loading, `venueMachines` state, pass `machines` to APIs |
| `app/api/machine-stats/route.ts` | Lowercase machines through `machineMappings` |
| `app/api/machine-advantages/route.ts` | Variation-to-canonical machine name mapping |
| `app/api/player-analysis/route.ts` | Variation-to-canonical machine name mapping |
| `app/api/strategy/optimize/route.ts` | Accept/forward `scoreWeights` |
| `app/api/strategy/score/route.ts` | Machine variations fix, `scoreWeights` |
| `app/api/strategy/matrix/route.ts` | Machine variations fix, `scoreWeights` |
| `app/api/optimize-picks/route.ts` | Per-player `computePlayerAdvantage`, team name map, advantage in results |
| `app/api/optimize-assignments/route.ts` | Per-player stats/advantage, full game fetch, machine name normalization |
| `app/api/active-venues/route.ts` | **New** — active venues from season CSV + Supabase overrides |
| `lib/fetch-mnp-text.ts` | **New** — text fetcher for CSV from GitHub |
| `app/options/page.tsx` | Active Venues button + Dialog editor |

### Database Tables Added (since Nov 2025)

| Table | Purpose |
|-------|---------|
| `user_machine_inputs` | User-reported averages and confidence per player/machine/venue |
| `score_limits` | Machine score limits (shared across users) |
| `venue_machine_lists` | User overrides for venue machine lists |
| `player_first_season` | Cache of earliest season per player (player_name TEXT PK, first_season INT) |
| `active_venue_overrides` | User overrides for active venue list (venue_name TEXT UNIQUE, action 'add'/'remove') |

### Changes (Jan 31, 2026)

#### Dashboard (app/page.tsx)
- IPR history graph: interactive Recharts Brush component for range selection, season quick-select buttons, dynamic Y-axis
- Player machine counts: fixed player_4_key bug, added machine name canonicalization via `machineMappings`, returns counts keyed by all name variations
- Player machine stats: fixed round_number display, added round_number to select query
- Season range inputs: persistent via localStorage, default current-1 to current season
- Mobile: `onOpenAutoFocus` prevention, table-layout:fixed with percentage column widths, compact text

#### Strategy (app/strategy/page.tsx)
- TWC Player Availability: horizontal flex-wrap layout instead of 2-column grid, smaller text on mobile
- Machine Advantage Table: abbreviated headers on mobile, smaller text/padding, all columns visible with truncation
- Tabs (Picking/Assignment/Analysis): always 3-column grid, shorter mobile labels
- Singles/Doubles tabs: centered with full-width grid
- Removed "number of machines to pick" inputs
- Centered optimize buttons
- Slider labels: smaller text on mobile (text-[10px]), narrower label width (w-24 md:w-48)
- Venue Weight slider: "All Venues"/"Venue Only" labels positioned directly under slider
- Removed description paragraphs from all three strategy tabs
- Exclude buttons: horizontal flex-wrap, shorter text ("Exclude {name}"), below player name instead of beside it
- Expanded card details: smaller text, abbreviated labels

#### Performance Heatmap (app/strategy/heatmap/)
- New standalone page at /strategy/heatmap with URL params (venue, players, machines, seasonStart, seasonEnd, venueWeight, userInputWeight)
- Opens in new window from strategy page button
- Requests fullscreen + landscape orientation via Screen Orientation API
- Custom layout.tsx hides nav/hamburger with fixed overlay
- Removed "Show all venues" toggle (uses venue weight slider instead)

#### Heatmap Component (components/strategy/PerformanceMatrix.tsx)
- Machine name headers rotated vertical using writing-mode: vertical-rl for narrow columns

#### Drag & Drop Optimizer (components/strategy/MachinePicker.tsx)
- Exclude X button moved below player name for more name visibility
- Stats cache (allStatsCache ref) persists player-machine stats across drag-drops
- machinePlayerStats rebuilds from cache + current assignments on every change

#### Score API (app/api/strategy/score/route.ts)
- Now returns venue_adjusted_avg, user_average, user_confidence per assignment (was missing, causing stats to disappear after drag-drop)

#### IPR History API (app/api/player-ipr-history/route.ts)
- Caches first season in player_first_season table
- Filters matches query by cached first_season for performance

#### Doubles Optimizer Stats Fix
- **Problem**: Doubles optimization (4x2) did not show % of venue average on initial optimize; stats only appeared after a drag-and-drop rescore.
- **Root cause**: `PairAssignment` type lacked per-player stat fields (`player1_venue_adjusted_avg`, `player2_venue_adjusted_avg`, etc.), the `optimize4x2` method didn't populate them, and the MachinePicker cache update skipped `PairAssignment` entries entirely.
- **Fix**:
  - Extended `PairAssignment` in `types/strategy.ts` with per-player `venue_adjusted_avg`, `user_average`, `user_confidence` fields
  - Added `userInputs` destructuring and `getExtraFields` helper to `optimize4x2` in `lib/strategy/optimizer.ts`
  - Updated MachinePicker cache effect to extract per-player stats from `PairAssignment` for both `player1` and `player2`

#### Singles Drag-Drop Stats Fix (resolved)
- **Problem**: % of venue average disappeared after dragging a player to a new machine in singles (7x7) mode.
- **Root cause**: `machinePlayerStats` was rebuilt solely from `optimizationResult`, which was stale between drop and API response. The score API also wasn't returning `venue_adjusted_avg`.
- **Fix**:
  - Score API (`/api/strategy/score`) now returns `venue_adjusted_avg`, `user_average`, `user_confidence`
  - Persistent `allStatsCache` (useRef) accumulates stats from every optimize/score response
  - `machinePlayerStats` rebuilds from cache + current assignments via `statsCacheVersion` state
  - Fixed stale closure in rescore effect by adding `assignments` to dependency array

#### Player Assignment - Machine Image Buttons
- Replaced dropdown select + "Add" button with a grid of clickable machine backglass images
- Images sourced from `/public/opdb_backglass_images/` via `getMachineImagePath()`
- Grid layout: 4 columns mobile, 5 tablet, 7 desktop
- Click to toggle selection: selected machines get highlighted border, ring, and checkmark badge; unselected are dimmed at 50% opacity
- Machine name label overlaid at bottom of each image
- Count display + Optimize button below grid (disabled when none selected)
- Removed `newMachine` state, `addOpponentPick`/`removeOpponentPick` functions, `Plus` icon import
- Both singles and doubles sub-tabs use the same pattern

#### Player Assignment - Exclusions
- **New feature**: Player exclusions in the Player Assignment tab, matching the Machine Picking tab pattern
- Exclude buttons on each assignment result card — click "Exclude {player}" to exclude them from that specific machine
- Exclusion badges displayed above results with X to remove
- Auto-reassigns: excluding a player immediately re-runs `optimizeSinglesAssignments` or `optimizeDoublesAssignments`
- Persistent via localStorage (`singlesAssignExclusions`, `doublesAssignExclusions`), separate from Machine Picking exclusions
- **API**: `app/api/optimize-assignments/route.ts` now accepts `exclusions` parameter (Record<string, string[]>) and skips excluded players per machine
- **State**: `singlesAssignExclusions` / `doublesAssignExclusions` in `app/strategy/page.tsx`
- **Functions**: `addAssignExclusion()`, `removeAssignExclusion()` — separate from Machine Picking's `addExclusion`/`removeExclusion`

#### Sat-Out / Must-Play Players
- Players toggled as "sat out" are passed as `mustPlay` to the optimizer — they are guaranteed a slot in the lineup
- Tracked via `satOutPlayers` state (Set) in `app/strategy/page.tsx`
- Visual toggle buttons in the TWC Player Availability section

#### Machine Advantage Table - Collapsible
- `showAdvantageTable` state with localStorage persistence (`strategyShowAdvantageTable`)
- ChevronUp/ChevronDown toggle on the table header
- Remembers collapsed/expanded state across sessions

#### Per-Player Advantage Calculation
- **Problem**: Expanded result cards showed team-wide advantage stats (all TWC players) instead of stats for the assigned player(s) only
- **Fix**: Added `computePlayerAdvantage()` function to both `optimize-picks/route.ts` and `optimize-assignments/route.ts`
- Computes TWC stats filtered to only the assigned player(s), not the whole team
- Returns: `twcPctOfVenue`, `opponentPctOfVenue`, `statisticalAdvantage`, `experienceAdvantage`, `advantageLevel`, `compositeScore`, `twcPlays`
- Each recommendation/assignment now includes an `advantage` object with these per-player stats
- All 4 result sections (picking singles/doubles, assignment singles/doubles) use `rec.advantage` / `assignment.advantage`
- Labels: "Edge: X" on collapsed cards, "Score Edge" / "Experience Edge" in expanded view
- Individual player % of venue shown in expanded card (doubles shows per-player breakdown)

#### Rich Player Assignment Results
- Player Assignment results now match Machine Picking results: collapsible cards with backglass images, data source badges, avg score, edge level, per-player stats in expanded view
- Removed "Assigned Player:" / "Assigned Players:" text from Machine Picking results
- `optimize-assignments/route.ts` enriched to return per-player stats (pctOfVenue, playsCount, avgScore, userAverage, userConfidence) and per-assignment advantage data
- Added team name map building and full game fetching with machine name normalization via `getAllMachineVariations`

#### Active Venues Filtering (Feb 2026)
- **Problem**: Strategy page venue dropdown showed all 36 venues from `venues.json`, including historical venues no longer in use
- **Solution**: New `/api/active-venues` endpoint filters venues to current season's `venues.csv` (from `season-23/venues.csv` in GitHub archive)
- **Matching**: Uses venue **keys** (e.g., `WAT`, `GPA`) from CSV to match against `venues.json` keys, since venue names may differ between sources (e.g., "Waterland Arcade" in CSV vs "Waterland" in venues.json)
- **User overrides**: Supabase `active_venue_overrides` table stores add/remove overrides
- **Options page editor**: "Active Venues" button opens a Dialog to add/remove venues from the active list
- **Strategy page**: `loadVenuesAndTeams` calls `/api/active-venues` instead of `/api/venues?season=22`
- **Default venue matching**: Fuzzy match (strip spaces, lowercase) when setting default venue from latest match to handle standardization differences (e.g., "Icebox" vs "Ice Box")
- **Unaffected**: Statistics page and Options page "Modify Venue Machine List" still use `/api/venues` (all venues)

**New files**:
- `lib/fetch-mnp-text.ts` — text fetcher for CSV files from GitHub (same as `fetchMNPData` but returns `.text()`)
- `app/api/active-venues/route.ts` — GET (filtered venue list), POST (save override), DELETE (remove override)

**Database table**: `active_venue_overrides` (id, venue_name UNIQUE, action CHECK 'add'/'remove', created_at)

#### Dynamic Season Dropdowns (Feb 2026)
- **Problem**: Season range dropdowns in Statistics and Strategy pages were hardcoded arrays (e.g., `[14, 15, ... 22]`), requiring manual code updates each new season
- **Solution**: New `/api/seasons` endpoint queries the `games` table for unique seasons with data
- **API response**: `{ seasons: [2, 3, ... 23], min: 2, max: 23 }`
- **Auto-update**: On page load, if `max` season from API is greater than current `seasonRange[1]`, the range auto-updates to include the new season
- **Dropdowns**: Both pages now use `availableSeasons.map()` instead of hardcoded arrays

**New file**: `app/api/seasons/route.ts`

**Modified files**:
- `app/stats/page.tsx` — Added `availableSeasons` state, fetches from `/api/seasons` on load, dynamic dropdown
- `app/strategy/page.tsx` — Same changes

#### Daily Data Sync (Feb 2026)
- **Change**: Cron schedule updated from weekly (Tuesdays) to daily at 2am UTC
- **File**: `vercel.json` — `"schedule": "0 2 * * 2"` → `"schedule": "0 2 * * *"`

#### Latest Match API Fix (Feb 2026)
- **Problem**: `/api/latest-twc-match` returned week 1 instead of week 2 because it sorted pregame matches ascending (earliest first), and week 1 was stuck in "pregame" state
- **Fix**: Changed to descending order to get the **latest** pregame match, not the earliest
- **File**: `app/api/latest-twc-match/route.ts` — `.order('season', { ascending: false }).order('week', { ascending: false })`

#### Deployment
- Always deploy manually: `npx vercel --prod --yes`
#### IPR Display Fix (Feb 2026)
- **Problem**: Dashboard showed IPR of 3 when match data showed 5
- **Root cause**: `/api/player-ipr` was returning `player_stats.ipr` which was incorrectly calculated as `totalPoints / matches_played` during import
- **Actual behavior**: IPR is a given value from match lineup data (`lineup[].IPR`), not calculated
- **Fix**: API now fetches IPR from `player_match_participation.ipr_at_match` for the most recent match
- **File**: `app/api/player-ipr/route.ts` — queries `player_match_participation` ordered by week desc, uses `ipr_at_match`

#### Statistics Page Race Condition Fix (Feb 2026)
- **Problem**: Northern Lights stats showed 0 at GPA intermittently
- **Root cause**: `loadStats()` effect fired when `selectedVenue` changed, but `venues` state wasn't populated yet, so `venueMachines = []` was passed to API, causing fallback machine list derivation that missed opponent data
- **Fix**: Added `venues` to useEffect dependencies and check `venues.length > 0` before loading stats
- **File**: `app/stats/page.tsx` — line ~325: `if (selectedVenue && selectedOpponent && venues.length > 0)` and added `venues` to dependency array

#### Next Match Auto-Update via season.json (Feb 2026)
- **Problem**: Dashboard "next match" only updated when database match states changed (via cron sync)
- **Solution**: `/api/latest-twc-match` now uses `season.json` from GitHub archive with actual match dates
- **Logic**: Compares current Pacific time against match dates (YYYYMMDD format). After midnight Monday (start of Tuesday), that week's match is considered "past" and the next match is shown
- **File**: `app/api/latest-twc-match/route.ts`
  - Fetches `season-{N}/season.json` from GitHub
  - Parses TWC schedule with `date` field (e.g., `"20260209"`)
  - Uses `getPacificDate()` for timezone-correct comparison
  - Falls back to database-only approach if season.json unavailable

#### POPS by Machine Feature (Feb 2026)
- **New section**: Player Profile page now shows POPS (Percentage of Points Scored) per machine
- **Location**: Above "Top 10 Rankings" section, collapsible with chevron
- **Filters**: Season range dropdowns, Venue dropdown (or "All Venues")
- **Table columns**: Machine, Games, Points, Possible, POPS %
- **Color coding**: Green >= 70%, Yellow >= 50%, Red < 50%
- **New API**: `/api/player-pops-by-machine`
  - Params: `player`, `seasonStart`, `seasonEnd`, `venue` (or "all")
  - Returns: `{ machines: [{ machine, games, totalPoints, totalPossible, pops }], ... }`
  - Uses player count (2 vs 4) to determine singles/doubles for accurate possible points calculation
- **Machine Scores section**: Added POPS to stats summary (Games, Average, Median, High, Low, **POPS**)
- **File**: `app/player-profile/page.tsx` — new state, effects, filters, and table

**POPS Calculation**:
- Singles (2 players): 3 points possible per game
- Doubles (4 players): 2.5 points possible per game
- POPS = (totalPoints / totalPossible) * 100

#### Login Tracking (Feb 2026)
- **New feature**: Track user logins with timestamps and counts
- **Table**: `login_history` (user_id, email, player_name, login_at, user_agent)
- **Email/password logins**: Tracked in `app/login/page.tsx` after successful auth
- **OAuth logins**: Tracked in `app/auth/callback/route.ts` (new file)
- **Stats API**: `/api/login-stats` returns:
  - `users`: Array sorted by login_count (email, player_name, login_count, first_login, last_login)
  - `totalLogins`: Total login count
  - `uniqueUsers`: Number of unique users
  - `recentLogins`: Last 20 logins

**Database table SQL**:
```sql
CREATE TABLE login_history (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  player_name TEXT,
  login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_login_history_user_id ON login_history(user_id);
CREATE INDEX idx_login_history_login_at ON login_history(login_at DESC);
ALTER TABLE login_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert own login history" ON login_history FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role can read all" ON login_history FOR SELECT USING (true);
```

**New files**:
- `app/auth/callback/route.ts` — OAuth callback handler with login tracking
- `app/api/login-stats/route.ts` — Login statistics API

#### Machine Name Normalization (Feb 2026)
- **Problem**: Inconsistent machine names across the system caused user scores and inputs to not match venue machines (e.g., "James Bond 007 (Thunderball/Dr No)" vs "007" vs "james bond 007")
- **Solution**: Centralized canonical key normalization for all saves, inclusive variation matching for all reads

**Core functions in `/lib/machine-mappings.ts`**:
- `getCanonicalMachineKey(input)` — Converts any machine name format to a short canonical key for storage
- `getMachineVariations(input)` — Returns all possible variations of a machine name for inclusive `.in()` queries
- `getAllMachineVariations(machines[])` — Batch version for multiple machines

**Normalization strategy** (in priority order):
1. Direct match in machineMappings
2. Lowercase match in machineMappings
3. Reverse lookup (display name → key)
4. Key in keySet
5. Fall back to trimmed input

**Updated endpoints**:
- `save-score/route.ts` — Uses `getCanonicalMachineKey()` for consistent storage
- `save-user-input/route.ts` — Uses `getCanonicalMachineKey()` for saves, `getMachineVariations()` for deletes
- `user-machine-inputs/route.ts` — Uses `getMachineVariations()` for both single and bulk lookups
- `user-machine-scores/route.ts` — Uses `getMachineVariations()` instead of `ilike` for comprehensive matching
- `stats-calculator.ts` — Uses `getMachineVariations()` and multiple fallback strategies for score matching

**Key principle**:
- **Saves** → Always normalize to canonical key
- **Reads** → Always use variations for inclusive matching

This ensures future data variations are handled automatically without code changes.


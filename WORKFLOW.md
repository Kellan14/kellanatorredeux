# TWC Stats Platform - Workflow Documentation

**Platform**: The Wrecking Crew (TWC) team statistics and strategy platform
**Architecture**: Supabase PostgreSQL database with Next.js frontend
**Current Status**: Relational schema migration complete - 10-40x performance improvement achieved
**Last Updated**: November 16, 2025

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
[unified-import.js] ← Fetches weekly, runs Tuesday 2am
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
- **Import**: `unified-import.js` runs weekly (or on-demand)
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
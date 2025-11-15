# TWC Stats Platform - Workflow Documentation

**Platform**: The Wrecking Crew (TWC) team statistics and strategy platform  
**Architecture**: Supabase PostgreSQL database with Next.js frontend  
**Current Status**: Data imported, understanding format differences  
**Last Updated**: November 15, 2025

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

---

## Database Schema

### Core Tables

#### `matches` Table
Stores complete match data with JSONB for flexibility.

```sql
CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  match_key TEXT UNIQUE NOT NULL,        -- "mnp-22-11-TWC-PKT"
  season INT NOT NULL,                   -- 22
  week INT NOT NULL,                     -- 11
  home_team TEXT,                        -- "TWC"
  away_team TEXT,                        -- "PKT"
  venue_name TEXT,                       -- "Corner Pocket"
  state TEXT,                            -- "complete"
  data JSONB NOT NULL,                   -- Full match JSON
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Current Data:**
- 1,452 matches (seasons 14-22)
- Complete match JSONs stored in `data` column

#### `player_stats` Table
Pre-calculated TWC player statistics for fast dashboard queries.

```sql
CREATE TABLE player_stats (
  id SERIAL PRIMARY KEY,
  player_name TEXT NOT NULL,
  player_key TEXT,                       -- Hash ID from match data
  season INT NOT NULL,
  team TEXT,                             -- "TWC"
  ipr DECIMAL,
  matches_played INT DEFAULT 0,
  last_match_week INT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(player_name, season)
);
```

**Current Data:**
- 16 TWC players for Season 22
- Updated weekly from most recent match data

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

### Primary Import: `import-mnp-data.js`
Fetches all match files from GitHub and stores in database.

```bash
node scripts/import-mnp-data.js
```

- Processes seasons 14-22
- Uses upsert to handle duplicates
- Stores complete JSON in JSONB column

### TWC Stats Update: `import-twc-stats.js`
Extracts TWC player data for quick access.

```bash
node scripts/import-twc-stats.js
```

- Queries existing matches table
- Extracts latest TWC lineup
- Updates player_stats table
- Runs in ~1 second

### Weekly Sync: `sync-mnp-data.sh`
Automated Tuesday morning updates.

```bash
# Crontab entry
0 2 * * 2 /path/to/sync-mnp-data.sh
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

## Architecture Refactoring (Nov 15, 2025)

### **Current Architecture - Performance Problem Identified**

**How It Works Now:**

The current system stores all match data as JSONB in a single `matches` table:

```
matches table:
- id, match_key, season, week, home_team, away_team, venue_name, state
- data (JSONB) ← Contains EVERYTHING: lineups, rounds, games, scores, points
```

**Problem with Current Approach:**

Every API call follows this pattern:
1. Query: `SELECT data FROM matches WHERE season = 22` → pulls 100+ matches
2. Download: ~2MB of JSONB data transferred from Supabase
3. Parse in JavaScript:
   ```javascript
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
4. Calculate and return

**Why This Is Slow:**
- Every request downloads megabytes of data
- No SQL indexes on player keys, machines, or venues (they're in JSONB)
- All filtering/aggregation happens in JavaScript instead of PostgreSQL
- Can't use SQL JOINs, WHERE clauses, or GROUP BY on game data
- Network transfer is the bottleneck

**Example:** Getting one player's total points:
- Current: Download 100 matches × 20 games each = 2000 games of JSONB → parse in JS
- Should be: SQL query returns one number

### **New Architecture - Relational Schema**

**What We're Going to Do:**

Flatten the JSONB into proper relational tables that PostgreSQL can index and query efficiently:

```sql
-- Keep matches table for reference
matches (existing)
  - id, match_key, season, week, home_team, away_team, venue_name, state
  - data (JSONB) ← keep for historical reference

-- NEW: Individual games table (flattened from data.rounds[].games[])
games
  - id (auto)
  - match_id → references matches(id)
  - season, week, venue
  - round_number, game_number
  - machine
  - player_1_key, player_1_name, player_1_score, player_1_points
  - player_2_key, player_2_name, player_2_score, player_2_points
  - player_3_key, player_3_name, player_3_score, player_3_points
  - player_4_key, player_4_name, player_4_score, player_4_points
  - Indexes on: player_*_key, machine, season, venue

-- NEW: Player match participation (flattened from data.home/away.lineup[])
player_match_participation
  - id (auto)
  - match_id → references matches(id)
  - player_key, player_name
  - team, season, week
  - ipr_at_match, num_played, is_sub
  - Index on: player_key, season, team
```

**Why This Will Be Fast:**

| Operation | Current (JSONB) | New (Relational) |
|-----------|----------------|------------------|
| Get player's total points | Download 2MB, parse 2000 games in JS | `SELECT SUM(points) FROM games WHERE player_1_key = ?` |
| Get machine stats | Download all matches, parse in JS | `SELECT machine, AVG(score) FROM games WHERE ... GROUP BY machine` |
| Player vs opponent | Download all matches, complex JS logic | `JOIN games ON player_key ... WHERE opponent_key = ?` |
| Data transferred | ~2MB per request | ~5KB per request |
| Query time | 2-5 seconds | 50-200ms |

**Migration Plan:**

1. **Create new schema** - Add `games` and `player_match_participation` tables
2. **Write import script** - Parse existing matches JSONB → insert into new tables (one-time)
3. **Update APIs** - Rewrite to use SQL queries instead of JSONB parsing
4. **Keep matches.data** - Preserve original JSONB for reference/debugging
5. **Update import-twc-stats.js** - Also populate new tables when importing new matches

**APIs to Rewrite:**
- `/api/player-ipr` - SQL aggregation instead of JS parsing
- `/api/player-analysis` - SQL GROUP BY machine
- `/api/player-machine-stats` - Direct SQL query
- `/api/machine-advantages` - SQL joins and aggregations
- All other stat-based APIs

**Expected Performance Improvement:**
- API response time: 2-5s → 50-200ms (10-40x faster)
- Data transfer: 2MB → 5KB per request (400x less)
- Server CPU: Moved to PostgreSQL (optimized C code) from JavaScript

## Summary

The platform has transitioned from file-based fetching to a proper database architecture using Supabase. All historical data (1,452 matches) is imported and accessible via JSONB queries.

**Completed**:
- ✓ Data format fully mapped and documented
- ✓ Player hash mapping challenge identified and documented
- ✓ All data locations in Supabase identified
- ✓ Performance bottleneck identified - JSONB parsing in JavaScript

**Current Focus**: Refactoring to relational schema for 10-40x performance improvement.

**In Progress**:
1. Create relational schema (games, player_match_participation tables)
2. Write migration script to flatten JSONB → relational rows
3. Rewrite APIs to use SQL queries instead of JavaScript parsing
4. Update import scripts to populate new tables
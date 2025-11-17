# Cleanup Guide - Remove Deprecated Scripts & Tables

**Date**: November 16, 2025
**Reason**: Consolidated to `unified-import.js` - all other import scripts are now redundant

---

## ✅ **KEEP - Active Files**

### Scripts (Keep)
- ✅ `unified-import.js` - **PRIMARY IMPORT** - Use this!
- ✅ `generate-thumbnails.js` - Still needed for image processing

### SQL (Keep)
- ✅ `create-relational-schema.sql` - Creates games & player_match_participation tables
- ✅ `create-teams-table.sql` - Creates teams reference table

---

## ❌ **DELETE - Deprecated Scripts**

### Import Scripts (DEPRECATED - replaced by unified-import.js)
```bash
rm scripts/import-mnp-data.js           # Old: imports to matches table only
rm scripts/import-season-22.js          # Old: season-specific import
rm scripts/import-twc-stats.js          # Old: TWC stats only
rm scripts/migrate-to-relational.js     # Old: separate migration step
```

### Diagnostic/One-Off Scripts (No longer needed)
```bash
rm scripts/verify-import.js
rm scripts/check-player-data.js
rm scripts/fix-player-stats.js
rm scripts/diagnose-seasons.js
rm scripts/run-schema-migration.js
rm scripts/check-tables.js
rm scripts/run-sql-with-pg.js
rm scripts/diagnose-match-structure.js
rm scripts/find-duplicate-lineups.js
rm scripts/check-week-11-data.js
```

### SQL (DEPRECATED)
```bash
rm scripts/add-team-columns-to-games.sql  # Now handled by unified-import.js
```

### Execute Cleanup
```bash
# Run this from project root to remove all deprecated scripts:
cd /Users/kellankirkland/Documents/kellanator/kellanator

# Remove deprecated imports
rm scripts/import-mnp-data.js \
   scripts/import-season-22.js \
   scripts/import-twc-stats.js \
   scripts/migrate-to-relational.js

# Remove one-off diagnostic scripts
rm scripts/verify-import.js \
   scripts/check-player-data.js \
   scripts/fix-player-stats.js \
   scripts/diagnose-seasons.js \
   scripts/run-schema-migration.js \
   scripts/check-tables.js \
   scripts/run-sql-with-pg.js \
   scripts/diagnose-match-structure.js \
   scripts/find-duplicate-lineups.js \
   scripts/check-week-11-data.js

# Remove deprecated SQL
rm scripts/add-team-columns-to-games.sql

echo "✅ Cleanup complete!"
```

---

## 🗄️ **SUPABASE CLEANUP - Tables & SQL Scripts**

### **📊 Step 1: Clean Up Tables**

**Where:** Supabase Dashboard → Table Editor → `public` schema

#### ✅ **KEEP These 5 Tables:**
- ✅ `games` - Primary data source (flattened, indexed)
- ✅ `teams` - Team reference (normalized)
- ✅ `player_match_participation` - Player lineups
- ✅ `player_stats` - Pre-calculated stats cache
- ✅ `matches` - Original JSONB (backup/reference)

#### ❌ **DELETE These If They Exist:**
Look for and delete any of these old experiment tables:
- ❌ Any tables with `_old` or `_backup` or `_test` suffix
- ❌ `profiles` (if empty/unused)
- ❌ `user_stats` (if empty/unused)
- ❌ `user_notes` (if empty/unused)
- ❌ Any other tables NOT in the "Keep" list above

**How to delete a table in Supabase:**
1. Go to Supabase Dashboard → Table Editor
2. Click on the table you want to delete
3. Click the "..." menu (top right) → Delete table
4. Confirm deletion

---

### **📝 Step 2: Clean Up SQL Snippets/Scripts**

**Where:** Supabase Dashboard → SQL Editor → Saved queries/snippets

You may have saved SQL scripts from previous migration attempts. Look for and **delete** any saved queries like:
- ❌ Old migration scripts
- ❌ Add column scripts (e.g., "Add team columns to games")
- ❌ One-off data fixes
- ❌ Test queries
- ❌ Diagnostic queries

#### ✅ **KEEP Only These 2 SQL Files** (run once during setup):
These should exist in your local `scripts/` folder, not saved in Supabase:
- ✅ `create-relational-schema.sql` - Creates games & player_match_participation tables
- ✅ `create-teams-table.sql` - Creates teams reference table

**Note:** You only need to run these SQL files ONCE during initial setup. After that, `unified-import.js` handles all data population.

---

### **🔍 Step 3: Verify Clean State**

After cleanup, your Supabase should have:

**Tables (5 total):**
```
✓ games (should have ~6000+ rows after import)
✓ teams (should have ~28-34 rows)
✓ player_match_participation (should have ~1000+ rows)
✓ player_stats (should have ~200+ rows)
✓ matches (should have ~300+ rows)
```

**SQL Editor:**
- No saved snippets needed (everything is managed by local scripts)

**To verify:**
1. Go to Table Editor - count tables (should be exactly 5)
2. Go to SQL Editor - delete all saved queries
3. Check that you have the 2 SQL files locally in `scripts/` folder

---

## 📋 **Final Clean Architecture**

```
scripts/
├── unified-import.js          ⭐ PRIMARY - Run this weekly
├── generate-thumbnails.js     (keep for images)
├── create-relational-schema.sql  (setup only)
└── create-teams-table.sql     (setup only)

Supabase Tables:
├── games                      ⭐ PRIMARY DATA SOURCE
├── teams                      (reference)
├── player_match_participation (lineups)
├── player_stats              (cache)
└── matches                   (JSONB backup)
```

---

## 🚀 **Going Forward**

**Weekly data updates:**
```bash
node scripts/unified-import.js
```

**That's it!** One command does everything:
- Fetches from GitHub
- Populates all tables
- Handles all seasons (14-22)
- Fast, indexed, optimized

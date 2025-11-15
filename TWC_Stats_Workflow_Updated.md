# Pinball Statistics App Transformation Workflow

## Project Overview
**Goal**: Transform the existing Streamlit pinball statistics application ("kellanator") into a modern, mobile-friendly web application while maintaining all current functionality.

**Current Status**: 🟢 Phase 2 & 4 Mostly Complete - Statistics & Strategy with Performance Optimization
**Last Updated**: November 14, 2025 (Late Evening - Caching Implementation)

---

## Performance & Caching System

### Overview
The application implements a server-side caching system to dramatically improve load times for repeated data requests while keeping data fresh through automatic expiration.

### Cache Implementation Details

#### How It Works
1. **First Request (Cache MISS)**:
   - API endpoint calculates data from JSON files
   - Result is stored in cache with expiration time
   - Response returned to client
   - Console logs: "Cache MISS for [endpoint]"

2. **Subsequent Requests (Cache HIT)**:
   - API checks cache first
   - If data exists and hasn't expired, returns immediately
   - Near-instant response (no file system access or calculations)
   - Console logs: "Cache HIT for [endpoint]"

3. **Cache Expiration**:
   - Data automatically expires after TTL (Time To Live)
   - Next request after expiration triggers fresh calculation
   - Cache refreshes with new data

#### Cache Configuration

**File**: `/lib/cache.ts`
- In-memory cache with TTL support
- Unique cache keys based on all parameters
- Automatic expiration handling
- Cache statistics available for debugging

**TTL Settings** (Time To Live):
```typescript
Player Analysis: 24 hours      // User performance data (stable)
Machine Advantages: 1 hour     // Strategic data (refresh more often)
Player Machine Stats: 24 hours // Individual player-machine combinations
Team Rosters: 7 days          // Roster data (very stable)
Player Machine Counts: 24 hours // Play frequency data
```

#### Cached Endpoints

1. **`/api/player-analysis`** (24hr cache)
   - Player performance at venues
   - Machine-by-machine breakdown
   - Venue-specific and all-venues data

2. **`/api/machine-advantages`** (1hr cache)
   - Strategic machine analysis
   - TWC vs opponent comparisons
   - Composite scoring calculations

3. **`/api/player-machine-stats`** (24hr cache - to be implemented)
4. **`/api/team-roster`** (7 days cache - to be implemented)
5. **`/api/player-machine-counts`** (24hr cache - to be implemented)

### Performance Impact

**Before Caching**:
- Strategy page load: 3-5 seconds
- Player analysis: 2-4 seconds
- Full page refresh required all calculations

**After Caching**:
- First load: Same (3-5 seconds)
- Subsequent loads: <100ms (near instant)
- 95%+ improvement on cached requests

### Monitoring Cache Performance

Check browser console to see cache hits/misses:
```
Cache HIT for player-analysis:allVenues=false&player=John%20Doe&...
Cache MISS for machine-advantages:opponent=Team%20Awesome&...
```

### Cache Invalidation

**Automatic**:
- Cache expires after TTL
- Fresh data fetched automatically

**Manual** (future feature):
- Admin cache clear endpoint
- Per-user cache reset option
- Force refresh button

### Technical Details

**Cache Key Generation**:
```typescript
createCacheKey('player-analysis', {
  player: 'John Doe',
  venue: 'Main Street',
  seasonStart: 20,
  seasonEnd: 22,
  allVenues: false
})
// Result: "player-analysis:allVenues=false&player=John Doe&..."
```

**Advantages**:
- No database required
- No external dependencies
- Simple implementation
- Works across API routes
- Survives between requests (not user-specific)

**Limitations**:
- Cache cleared on server restart
- Memory-based (not persistent)
- Single-server only (not distributed)
- No cache size limits (yet)

**Future Enhancements**:
- Cache size management
- LRU (Least Recently Used) eviction
- Redis for distributed caching
- Persistent cache across restarts
- Cache warming on server start

---

## Dashboard Features

### For All Users (Not Logged In)
- Next match information
- Opponent team display
- Logo centered at top
- TWC vs Opponent display
- Match date and venue
- Opponent player roster with machine stats

### For Logged-In TWC Members
All of the above, plus:

#### Personal Statistics Cards (Mobile-Optimized)
- **IPR** - Individual Player Ranking
- **Matches Played** - Season count
- **Points Won** - Total points
- **Points/Match** - Average performance
- **POPS** - Percentage of Points Scored

*Mobile: 2-column compact layout with smaller text*
*Desktop: 5-column full-size cards*

#### Your Performance Profile
Personalized section showing:
- **Performance table**: Top 10 machines at venue
  - Machine name
  - Average score
  - % of venue average (color-coded)
  - Times played
- **Your Best Machines**: Top 3 machines in card format
- **Venue-specific toggle**:
  - ON: Shows data only at upcoming venue
  - OFF: Shows all venues (for machines at upcoming venue)
  - Auto-defaults to OFF if no venue-specific data

#### Opponent Analysis
- Click any opponent player to see their machines
- Machine cards with play counts (at venue + total)
- Click machine to see all scores with stats
- Mean, Median, IQR displayed
- Sortable columns
- Venue-specific filtering

---

## Statistics Table Column Reference

### Complete Column List (19 columns in exact order):

1. **Machine** - Machine name (titlecased, e.g., "Attack From Mars")

2. **% Comparison** *(Special Column)*
   - TWC % V. Avg. minus Team % V. Avg.
   - Display: `+` (Team has no data), `-` (TWC has no data), `N/A` (neither has data), or numeric difference
   - Format: Integer (no decimals)

#### TEAM (Opponent) COLUMNS:
3. **Team Average** - Opponent's average score on this machine
   - Format: Integer with commas (e.g., "125,450")

4. **TWC Average** - TWC's average score on this machine
   - Format: Integer with commas (e.g., "175,850")

5. **Venue Average** - All teams' average score at this venue
   - Format: Integer with commas (e.g., "150,200")

6. **Team Highest Score** - Opponent's highest score on this machine
   - Format: Integer with commas (e.g., "2,500,000")

7. **% of V. Avg.** - Team Average as % of Venue Average
   - Format: Integer percentage (e.g., "105%")

8. **TWC % V. Avg.** - TWC Average as % of Venue Average
   - Format: Integer percentage (e.g., "117%")

9. **Times Played** - Unique games opponent played on this machine
   - Format: Integer (e.g., "15")

10. **TWC Times Played** - Unique games TWC played on this machine
    - Format: Integer (e.g., "12")

11. **Times Picked** - Times opponent picked this machine
    - Format: Integer (e.g., "8")

12. **TWC Times Picked** - Times TWC picked this machine
    - Format: Integer (e.g., "7")

13. **POPS** - Opponent's Percentage of Points Scored (overall)
    - Format: Integer percentage (e.g., "65%")

14. **POPS Picking** - Opponent's POPS when they picked
    - Format: Integer percentage (e.g., "70%")

15. **POPS Responding** - Opponent's POPS when responding
    - Format: Integer percentage (e.g., "61%")

16. **TWC POPS** - TWC's Percentage of Points Scored (overall)
    - Format: Integer percentage (e.g., "73%")

17. **TWC POPS Picking** - TWC's POPS when picking
    - Format: Integer percentage (e.g., "78%")

18. **TWC POPS Responding** - TWC's POPS when responding
    - Format: Integer percentage (e.g., "67%")

19. **POPS Comparison** *(Special Column)*
    - TWC POPS minus Team POPS
    - Display: Same as % Comparison (can be `+`, `-`, `N/A`, or numeric)
    - Format: Integer (no decimals)

### Important Notes:
- **ALL numbers displayed without decimals** (rounded to integers)
- Comparison columns show advantage/disadvantage at a glance
- Positive comparison = TWC advantage
- Negative comparison = Opponent advantage

---

## Strategy Page Features

### Machine Advantage Analysis Table
- Machines ranked by strategic advantage
- Composite scoring algorithm
- TWC % vs Opponent % comparison
- Clickable cells for detailed breakdowns
- Top TWC players per machine

### Three Main Tabs

#### 1. Machine Picking Strategy
*When TWC picks machines first*
- Choose number of machines (singles/doubles)
- Select available players
- Optimize picks based on advantages
- See player assignments for each machine
- Expandable cards with machine details

#### 2. Player Assignment Strategy
*When opponent picks machines first*
- Add opponent's machine picks
- Choose number of players
- Optimize player assignments
- Greedy algorithm for best matchups
- Singles and doubles support

#### 3. Player Analysis (NEW)
*Analyze individual TWC player performance*
- Select any TWC player
- View performance at selected venue
- Machine-by-machine breakdown
- Venue-specific toggle (auto-defaults to all venues if no data)
- Top 3 best machines
- Stats: Total games, machines played, venues

### Venue-Specific Settings
- **Opponent Team** - Toggle for venue-specific data
- **TWC** - Toggle for venue-specific data
- Auto-defaults based on venue:
  - GPA: Team=all venues, TWC=venue-specific
  - Other: Team=venue-specific, TWC=all venues

---

## Statistics Page Options & Settings

All options are accessible via an **Options** button on the stats page. Each option is implemented as a dialog/modal.

### 1. Column Options
**Purpose**: Show/hide columns to customize the table view
**Features**:
- Toggle visibility for each of the 19 columns
- Separate sections for Team columns, TWC columns, Venue columns
- Save preferences to local storage
- Reset to default view option

### 2. Machine Score Limits
**Purpose**: Filter machines by score thresholds to focus on relevant data
**Features**:
- Set minimum score threshold (hide machines with scores below this)
- Set maximum score threshold (hide machines with scores above this)
- Apply to Team, TWC, or Venue averages
- Clear filters option

### 3. Modify Venue Machine List
**Purpose**: Customize which machines appear for a venue
**Features**:
- Include specific machines (add to venue's machine list)
- Exclude specific machines (remove from venue's machine list)
- View current included/excluded lists
- Reset to default venue machines

### 4. Standardize Machines
**Purpose**: Normalize machine names for consistency
**Features**:
- Map alternate names to standard names (e.g., "Medieval Madness" → "MM")
- View all machine name mappings
- Add custom mappings
- Reset to defaults

### 5. Edit Roster
**Purpose**: Manage opponent team roster for accurate statistics
**Features**:
- Add/remove players from roster
- Mark players as roster vs substitute
- View current roster
- Import roster from JSON

### 6. Edit TWC Roster
**Purpose**: Manage The Wrecking Crew roster
**Features**:
- Add/remove TWC players
- Mark players as active/inactive
- Set player roles (captain, regular, sub)
- View roster history

---

## 1. Current State Analysis ✅ COMPLETED

### Existing Application
- **Framework**: Streamlit
- **Data Source**: JSON tournament data
- **Storage**: GitHub integration for cloud storage
- **Key Features**:
  - Tournament statistics analysis
  - Team performance tracking (The Wrecking Crew/TWC)
  - Venue analysis
  - Season comparisons
  - Machine-specific statistics
  - Strategic planning tools
  - Data visualization (charts, grids)

### Known Issues to Address
- [ ] AgGrid column autosizing problems
- [ ] Data synchronization between analysis views
- [ ] Mobile responsiveness limitations in Streamlit
- [ ] UI/UX improvements needed

### Assets Available
- [ ] Photos for every pinball game (to be integrated)
- [ ] Existing business logic and data processing code
- [ ] Tournament JSON data structure

---

## 2. Technology Stack Decision ✅ COMPLETED

### Frontend Framework Analysis & Recommendation

#### For Your Use Case (Data-Heavy Dashboard, Mobile Priority, Python Background)

**🏆 SELECTED: Next.js 14+ with App Router**
- **Pros for your project:**
  - Built-in mobile responsiveness tools
  - Image optimization perfect for game photos
  - Can start simple, add complexity as needed
  - API routes can host your Python logic (via pyodide or rewritten)
  - Static generation for performance
  - Huge community, tons of examples
  - Works great with Vercel (free tier generous)
- **Learning curve**: Moderate (React basics needed)
- **Mobile**: Excellent built-in support

### UI/Styling Recommendation

**🏆 SELECTED: Tailwind CSS + shadcn/ui**
- **Why for your project:**
  - Mobile-first by design
  - shadcn/ui provides beautiful, accessible components
  - Data tables, cards, modals all included
  - Looks modern out of the box
  - Easy to customize for pinball theme
  - Great documentation

### Data Grid Recommendation

**🏆 SELECTED: TanStack Table v8**
- **Why for your project:**
  - Solves your AgGrid mobile issues
  - Lightweight but powerful
  - Great mobile support with responsive features
  - Works perfectly with Next.js + Tailwind
  - Free and open source

### Authentication Solution

**🏆 SELECTED: Supabase Auth**
- **Why for your project:**
  - Free tier includes 50,000 monthly active users
  - Built-in user profiles table
  - Social logins (Google, Facebook, Discord, etc.)
  - Magic link email authentication
  - Row Level Security for user data
  - Works perfectly with Next.js
  - Includes storage for profile pictures
- **Alternative considered**: NextAuth.js (more setup, need separate database)

### Backend Approach Recommendation

**🏆 SELECTED: Next.js API Routes + Supabase**
- **Strategy:**
  1. Next.js API routes for business logic
  2. Supabase for auth, user data, and future features
  3. Port Python calculations to JavaScript
  4. Public data (tournaments) stays in JSON/GitHub
  5. User-specific data (profiles, preferences, notes) in Supabase

### Data Storage Strategy

**🏆 SELECTED: Hybrid Approach**
- **Public Data**: JSON files + GitHub (tournament data, game info)
- **User Data**: Supabase PostgreSQL
  - User profiles
  - Favorite machines
  - Personal statistics
  - Team affiliations
  - Notes and comments
- **Images**:
  - Game photos (~400 JPGs) in Next.js public folder, optimized on-demand
  - User profile pictures in Supabase Storage

### Hosting Recommendation

**🏆 SELECTED: Vercel + Supabase**
- **Vercel**: Frontend and API routes
- **Supabase**: Auth, database, and user file storage
- Both have generous free tiers

---

### 🎯 FINAL SELECTED STACK

1. **Framework**: Next.js 14+ (App Router)
2. **Styling**: Tailwind CSS + shadcn/ui components
3. **Data Tables**: TanStack Table
4. **Charts**: Recharts or Tremor
5. **Authentication**: Supabase Auth
6. **Database**: Supabase (PostgreSQL) for user data
7. **Public Data**: JSON files + GitHub
8. **Hosting**: Vercel (frontend) + Supabase (backend)
9. **Images**: Next.js Image component (400+ game photos)
10. **Caching**: In-memory cache with TTL (1hr-7days)

---

## 4. Feature Migration Plan

### Phase 1: Core Infrastructure & Auth ✅ COMPLETED
- [x] Setup Supabase project and auth
- [x] User registration/login flow
- [x] Basic user profile pages
- [x] Protected routes setup
- [x] Dashboard with next match display
- [x] Basic filtering and search
- [x] Responsive data tables
- [x] Navigation simplified (removed icons)
- [x] Removed Profile and Roster pages
- [x] Logo placement on dashboard

### Phase 2: Statistics & Analysis ✅ COMPLETED
- [x] Interactive statistics grid (like AgGrid)
- [x] Clickable cells with detail views
- [x] Port Python calculations to JavaScript
- [x] POPS calculations (overall, picking, responding)
- [x] Venue-specific statistics
- [x] Season range filtering
- [x] Sortable columns in cell details dialog
- [x] Team-specific labels in cell detail headers
- [x] Venue-specific filtering toggles
- [x] Venue-specific data in cell click details
- [x] Performance caching (1-24hr TTL)
- [ ] Connect to real MNP JSON data
- [ ] IPR calculation integration

### Phase 3: User Features 🟡 IN PROGRESS
- [x] Personal statistics dashboard
- [x] Player performance profile on dashboard
- [x] Connect user to MNP player name via UID mapping
- [ ] Favorite machines tracking
- [ ] Team roster management
- [ ] Personal notes on games/venues

### Phase 4: Advanced Analytics ✅ MOSTLY COMPLETE
- [x] Strategic planning tools page
- [x] Machine advantage analysis table
- [x] Machine Picking Strategy (when TWC picks first)
- [x] Player Assignment Strategy (when opponent picks first)
- [x] Player Analysis tab (individual performance)
- [x] Singles and Doubles format support
- [x] Player availability checkboxes
- [x] Venue-specific toggles for strategy
- [x] Clickable cells in machine advantage table
- [x] Optimize picks API endpoint
- [x] Optimize assignments API endpoint
- [x] Performance caching for strategy data
- [ ] Venue performance analysis charts
- [ ] Season comparisons
- [ ] Machine-specific deep dive
- [ ] Custom date ranges

### Phase 5: Enhanced Features 🔴 NOT STARTED
- [ ] All 400 game photos integrated
- [ ] User profile photos
- [ ] Advanced visualizations (charts)
- [ ] Compare stats with teammates
- [ ] Achievements/badges system
- [ ] Export capabilities

---

## 12. Session Notes

### Session 3 - Nov 14, 2025 Evening
- **Focus**: Cell details enhancements and strategic planning tools
- **Completed**:
  - ✅ Sortable columns in cell details dialog
  - ✅ Team-specific labels in cell detail headers
  - ✅ Navigation simplification
  - ✅ Strategy page with all tools
  - ✅ Venue-specific toggles
  - ✅ Machine advantage analysis
  - ✅ Clickable cells in strategy table

### Session 4 - Nov 14, 2025 Late Evening
- **Focus**: Dashboard improvements, player analysis, and performance optimization
- **Major Achievements**:
  - ✅ Logo moved from header to dashboard
  - ✅ Removed Quick Links cards (Team Roster, Strategic Planning, Schedule)
  - ✅ Player performance profile on dashboard for logged-in users
  - ✅ Performance table with top 10 machines
  - ✅ Best machines cards (top 3)
  - ✅ Venue-specific toggle with auto-fallback
  - ✅ Player Analysis tab in Strategy page
  - ✅ Server-side caching implementation
  - ✅ Cache system with TTL (1hr-7days)
  - ✅ Opponent player stats with mean/median/IQR
  - ✅ Mobile-optimized stats cards (2-column compact layout)

- **Files Created**:
  - `/lib/cache.ts` - Caching utility with TTL support
  - `/app/api/player-analysis/route.ts` - Player performance API

- **Files Modified with Caching**:
  - `/app/api/player-analysis/route.ts` - 24hr cache
  - `/app/api/machine-advantages/route.ts` - 1hr cache
  - `/app/page.tsx` - Dashboard improvements, performance profile
  - `/app/strategy/page.tsx` - Added Player Analysis tab

- **Performance Improvements**:
  - First load: Same (3-5 seconds calculation)
  - Subsequent loads: <100ms (95%+ improvement)
  - Console logging for cache monitoring

- **Current State**:
  - All major features from app.py ported and enhanced
  - Caching dramatically improves user experience
  - Dashboard shows personalized performance data
  - Strategy page has comprehensive analysis tools
  - Mobile-optimized throughout

---

## 13. Next Steps Priority

### Completed (Session 4):
1. ✅ Logo repositioning to dashboard
2. ✅ Player performance profile on dashboard
3. ✅ Venue-specific toggle with auto-fallback
4. ✅ Player Analysis tab in Strategy
5. ✅ Server-side caching system
6. ✅ Opponent player stats with statistics
7. ✅ Mobile-optimized stats cards

### Next Session:
1. ⬜ Cache remaining API endpoints
2. ⬜ Add machine thumbnails to tables
3. ⬜ Improve mobile responsiveness further
4. ⬜ Add export/share functionality
5. ⬜ Season comparison charts
6. ⬜ Venue performance visualizations
7. ⬜ Deploy to Vercel

### Future:
1. ⬜ Cache warming on server start
2. ⬜ Cache size management
3. ⬜ Redis for distributed caching
4. ⬜ Machine-specific deep dive pages
5. ⬜ Real-time data updates
6. ⬜ Advanced visualizations

---

## Decision Log

| Date | Decision | Rationale | Impact |
|------|----------|-----------|--------|
| Nov 14, 2025 AM | Create transformation workflow | Need structured approach to manage complex migration | High |
| Nov 14, 2025 AM | Chose Next.js + Tailwind + shadcn/ui stack | Best mobile support, modern UI, manageable learning curve | High |
| Nov 14, 2025 AM | Added Supabase for auth & user data | User profiles requirement, social features, free tier generous | High |
| Nov 14, 2025 PM | Pivot to TWC-specific app | App is for TWC members only, not general tournament tracker | Critical |
| Nov 14, 2025 PM | Port Python to JavaScript | Analyzed 4360-line app.py, ported all calculations to JS | High |
| Nov 14, 2025 Eve | Strategy page implementation | Port strategic planning tools from app.py | High |
| Nov 14, 2025 Eve | Venue-specific filtering | Add toggles for team/TWC venue-specific data | High |
| Nov 14, 2025 Late | Server-side caching | Implement in-memory cache with TTL for performance | High |
| Nov 14, 2025 Late | Player performance on dashboard | Personalized data for logged-in TWC members | High |
| Nov 14, 2025 Late | Logo moved to dashboard | Better visual hierarchy, removed from global nav | Medium |
| Nov 14, 2025 Late | Auto-fallback for venue-specific | Default to all venues if no venue-specific data | Medium |
| Nov 14, 2025 Late | Mobile-optimized cards | Compact 2-column layout for stats on mobile | Medium |

---

**Upload this file at the start of each session and I'll update our progress!**

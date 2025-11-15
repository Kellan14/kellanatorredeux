# Database Setup Instructions

## Step 1: Create Database Tables in Supabase

1. Go to your Supabase project: https://supabase.com/dashboard
2. Navigate to **SQL Editor**
3. Copy the entire contents of `supabase-schema.sql`
4. Paste into the SQL Editor and click **Run**

This creates:
- `matches` table - stores all match data
- `player_stats` table - stores player IPR and stats
- Indexes for fast queries
- RLS policies for security

## Step 2: Get Supabase Service Role Key

1. In Supabase dashboard, go to **Settings** > **API**
2. Copy the `service_role` key (NOT the anon key)
3. This key has full database access for the import script

## Step 3: Run the Import Script

```bash
# Set environment variables
export NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_KEY="your-service-role-key"

# Run the import script (this will take a few minutes)
node scripts/import-mnp-data.js
```

The script will:
- Fetch all match files from GitHub for Season 22
- Import match data into the `matches` table
- Extract and import player stats into `player_stats` table
- Show progress as it runs

## Step 4: Verify Data

Check that data was imported:

```bash
# Check in Supabase dashboard > Table Editor
# You should see:
# - matches table with ~50-100 rows
# - player_stats table with player data
```

## Step 5: Deploy to Production

```bash
git push origin main
npx vercel --prod
```

The app will now query the database instead of fetching from GitHub!

## Troubleshooting

**Import script fails:**
- Check that SUPABASE_SERVICE_KEY is the service_role key, not anon key
- Check that tables were created successfully in Step 1

**No data showing:**
- Verify tables have data in Supabase Table Editor
- Check Vercel deployment logs for errors
- Ensure environment variables are set in Vercel project settings

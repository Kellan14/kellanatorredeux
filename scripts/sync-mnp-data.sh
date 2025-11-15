#!/bin/bash

# Weekly MNP data sync script
# This runs automatically to keep the database updated

cd /Users/kellankirkland/Documents/kellanator/kellanator

# Load environment variables from .env.local
export $(cat .env.local | grep -v '^#' | xargs)

# Run the import script
node scripts/import-mnp-data.js >> logs/sync-$(date +\%Y-\%m-\%d).log 2>&1

echo "Sync completed at $(date)"

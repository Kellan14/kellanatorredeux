#!/bin/bash

# Daily MNP data sync script
# This runs automatically to keep the database updated
#
# Crontab entry (runs daily at 2am):
# 0 2 * * * /Users/kellankirkland/Documents/kellanator/kellanator/scripts/sync-mnp-data.sh

cd /Users/kellankirkland/Documents/kellanator/kellanator

# Create logs directory if it doesn't exist
mkdir -p logs

# Load environment variables from .env.local
export $(cat .env.local | grep -v '^#' | xargs)

# Run unified import (replaces old import-mnp-data.js + import-twc-stats.js)
echo "Starting unified import at $(date)" >> logs/sync-$(date +\%Y-\%m-\%d).log
node scripts/unified-import.js >> logs/sync-$(date +\%Y-\%m-\%d).log 2>&1

echo "Sync completed at $(date)" >> logs/sync-$(date +\%Y-\%m-\%d).log

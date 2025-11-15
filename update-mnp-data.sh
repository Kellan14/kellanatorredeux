#!/bin/bash

# Script to check for and pull MNP data updates
# Only pulls if there are new commits on the remote

REPO_DIR="/Users/kellankirkland/Documents/kellanator/kellanator/public/mnp-data-archive"
LOG_FILE="/Users/kellankirkland/Documents/kellanator/kellanator/mnp-data-update.log"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Change to repo directory
cd "$REPO_DIR" || {
    log "ERROR: Could not change to directory $REPO_DIR"
    exit 1
}

# Fetch latest changes from remote
git fetch origin main 2>&1 >> "$LOG_FILE"

# Check if there are new commits
NEW_COMMITS=$(git log HEAD..origin/main --oneline | wc -l | tr -d ' ')

if [ "$NEW_COMMITS" -gt 0 ]; then
    log "Found $NEW_COMMITS new commit(s). Pulling updates..."

    # Get the commit messages
    git log HEAD..origin/main --format="  - %s" >> "$LOG_FILE"

    # Pull the changes
    if git pull origin main 2>&1 >> "$LOG_FILE"; then
        log "Successfully pulled updates!"
    else
        log "ERROR: Failed to pull updates"
        exit 1
    fi
else
    log "No new commits found. Repository is up to date."
fi

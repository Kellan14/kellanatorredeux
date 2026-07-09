import { NextRequest, NextResponse } from 'next/server';
import { supabase, fetchAllRecords } from '@/lib/supabase';
import { getVenueVariations } from '@/lib/venue-mappings';
import { machineMappings } from '@/lib/machine-mappings';

export const dynamic = 'force-dynamic';

// Cache for 1 hour since match data updates weekly
export const revalidate = 3600;

/**
 * Cell details API - returns individual scores for a machine/column combination
 * Used when clicking on cells in the statistics table
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const machine = searchParams.get('machine');
    const column = searchParams.get('column');
    const venue = searchParams.get('venue');
    const team = searchParams.get('team');
    const twcTeam = searchParams.get('twcTeam') || 'The Wrecking Crew';
    const seasonStart = parseInt(searchParams.get('seasonStart') || '1');
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '999');
    const scoreLimitsParam = searchParams.get('scoreLimits');
    const twcPlayersParam = searchParams.get('twcPlayers');
    const twcPlayersFilter = twcPlayersParam
      ? new Set(twcPlayersParam.split(',').map(p => p.trim()).filter(Boolean))
      : null;
    const opponentRosterParam = searchParams.get('opponentRoster');
    const opponentRosterFilter = opponentRosterParam
      ? new Set(opponentRosterParam.split(',').map(p => p.trim()).filter(Boolean))
      : null;

    // Parse score limits
    let scoreLimit: number | undefined;
    if (scoreLimitsParam) {
      try {
        const limits: Record<string, number> = JSON.parse(scoreLimitsParam);
        const machineLower = (machine || '').toLowerCase();
        scoreLimit = limits[machineLower];
      } catch (e) {
        // ignore invalid JSON
      }
    }

    console.log('[cell-details] Request params:', {
      machine,
      column,
      venue,
      team,
      twcTeam,
      seasonStart,
      seasonEnd
    });

    if (!machine || !column || !venue) {
      return NextResponse.json(
        { error: 'Machine, column, and venue are required' },
        { status: 400 }
      );
    }

    // Determine which team to filter by based on the column
    const isTWCColumn = column.toLowerCase().includes('twc');
    const targetTeam = isTWCColumn ? twcTeam : team;

    // Respect venue-specific flags: if the relevant flag is false, query all venues
    const teamVenueSpecific = searchParams.get('teamVenueSpecific') === 'true';
    const twcVenueSpecific = searchParams.get('twcVenueSpecific') === 'true';
    const useVenueFilter = isTWCColumn ? twcVenueSpecific : teamVenueSpecific;

    console.log('[cell-details] Target team:', targetTeam, 'isTWCColumn:', isTWCColumn, 'venueFiltered:', useVenueFilter);

    // Query games from Supabase for the specified machine and seasons
    // Only filter by venue if the venue-specific flag is set for this team
    // Build list of possible machine name variations (DB key, display name, etc.)
    const machineVariations = new Set<string>([machine])
    const machineLower = machine.toLowerCase().trim()
    // Check if the machine name maps to a DB value
    const mapped = machineMappings[machineLower] || machineMappings[machine]
    if (mapped) machineVariations.add(mapped)
    // Also check if any mapping values match (reverse lookup)
    Object.entries(machineMappings).forEach(([alias, dbValue]) => {
      if (dbValue.toLowerCase() === machineLower || alias.toLowerCase().trim() === machineLower) {
        machineVariations.add(alias)
        machineVariations.add(dbValue)
      }
    })

    let gamesData
    try {
      const venueVariations = getVenueVariations(venue)
      // Use OR filter to match any machine name variation
      const machineFilter = Array.from(machineVariations)
        .map(m => {
          const needsQuoting = /[\s,()]/.test(m)
          return needsQuoting ? `machine.ilike."${m}"` : `machine.ilike.${m}`
        })
        .join(',')

      // fetchAllRecords needs a FRESH query builder per page, so build it
      // inside the closure (a supabase query builder mutates when awaited and
      // can't be safely re-ranged).
      gamesData = await fetchAllRecords(() => {
        let query = supabase
          .from('games')
          .select('*')
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
          .or(machineFilter)
          .order('id', { ascending: true }) // Required for consistent pagination

        if (useVenueFilter) {
          query = query.in('venue', venueVariations)
        }
        return query
      })
    } catch (error) {
      console.error('[cell-details] Database error:', error)
      return NextResponse.json(
        { error: 'Failed to load game data', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      )
    }

    if (!gamesData || gamesData.length === 0) {
      return NextResponse.json({
        machine,
        column,
        summary: `No data found for ${machine} at ${venue}`,
        details: [],
        count: 0
      });
    }

    // Build team name map
    const teamKeys = new Set<string>();
    gamesData.forEach((game: any) => {
      for (let i = 1; i <= 4; i++) {
        const teamKey = game[`player_${i}_team`];
        if (teamKey) teamKeys.add(teamKey);
      }
      if (game.home_team) teamKeys.add(game.home_team);
      if (game.away_team) teamKeys.add(game.away_team);
    });

    const { data: teamsData } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .in('team_key', Array.from(teamKeys));

    const teamNameMap: Record<string, string> = {};
    (teamsData || []).forEach((t: any) => {
      teamNameMap[t.team_key] = t.team_name;
    });

    // Determine pick filter based on column type
    // "Picked" columns should only show picks, "Resp" columns only responses
    const columnLower = column.toLowerCase();
    const filterPicks = columnLower.includes('picked') || columnLower.includes('pops pick');
    const filterResponses = columnLower.includes('pops resp');

    console.log('[cell-details] Column filter - picks only:', filterPicks, 'responses only:', filterResponses);

    // Extract individual scores for the target team
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
      venue: string;
    }

    const details: ScoreDetail[] = [];

    gamesData.forEach((game: any) => {
      for (let i = 1; i <= 4; i++) {
        const playerName = game[`player_${i}_name`];
        const score = game[`player_${i}_score`];
        const points = game[`player_${i}_points`];
        const teamKey = game[`player_${i}_team`];
        const teamName = teamNameMap[teamKey] || teamKey;

        if (!playerName || score === null || score === undefined) continue;

        // Only include scores from the target team
        if (!targetTeam || teamName.toLowerCase() !== targetTeam.toLowerCase()) {
          continue;
        }

        // Match the same TWC roster filter the parent stats call applied,
        // otherwise the drilldown can show players excluded from POPS.
        if (isTWCColumn && twcPlayersFilter && !twcPlayersFilter.has(playerName)) {
          continue;
        }
        // Same for opponent team — restrict to current roster players.
        if (!isTWCColumn && opponentRosterFilter && !opponentRosterFilter.has(playerName)) {
          continue;
        }

        // Per MNP rules: away team picks rounds 1 (doubles) and 3 (singles);
        // home team picks rounds 2 (singles) and 4 (doubles).
        const isHomeTeam = teamKey === game.home_team;
        const isPick = game.round_number % 2 === 1 ? !isHomeTeam : isHomeTeam;

        // Filter based on column type
        if (filterPicks && !isPick) continue;
        if (filterResponses && isPick) continue;

        // Filter by score limit
        if (scoreLimit && score > scoreLimit) continue;

        // Find opponent(s) in the same game. Singles has one; doubles has two
        // — collect both so the drilldown isn't misleading. opponentScore is
        // the opposing side's combined score (matches how MNP doubles is won).
        const oppNames: string[] = [];
        let opponentScore = 0;
        for (let j = 1; j <= 4; j++) {
          if (j !== i) {
            const oppTeamKey = game[`player_${j}_team`];
            const oppTeamName = teamNameMap[oppTeamKey] || oppTeamKey;
            const oppName = game[`player_${j}_name`];
            if (oppName && oppTeamName !== teamName) {
              oppNames.push(oppName);
              opponentScore += game[`player_${j}_score`] || 0;
            }
          }
        }
        const opponent = oppNames.join(' & ');

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
          venue: game.venue
        });
      }
    });

    // Calculate summary statistics
    const scores = details.map(d => d.score);
    const average = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;
    const highest = scores.length > 0 ? Math.max(...scores) : 0;
    const lowest = scores.length > 0 ? Math.min(...scores) : 0;

    console.log('[cell-details] Returning', details.length, 'scores for', targetTeam);

    return NextResponse.json({
      machine,
      column,
      team: targetTeam,
      venue,
      summary: `${details.length} scores - Avg: ${Math.round(average).toLocaleString()}, High: ${highest.toLocaleString()}, Low: ${lowest.toLocaleString()}`,
      stats: {
        count: details.length,
        average: average,
        highest: highest,
        lowest: lowest
      },
      details: details,
      count: details.length
    });
  } catch (error) {
    console.error('[cell-details] Error fetching cell details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cell details', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

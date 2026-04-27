import { NextRequest, NextResponse } from 'next/server';
import { supabase, fetchAllRecords } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { type MachineStats, type ProcessedScore, computePops } from '@/lib/tournament-data';
import { standardizeVenueName, venuesMatch } from '@/lib/venue-mappings';
import { machineMappings } from '@/lib/machine-mappings';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = 'force-dynamic';

// Cache for 1 hour since match data updates weekly
export const revalidate = 3600;

/**
 * Server-side machine statistics calculator
 *
 * This endpoint performs all statistics calculations on the server to avoid
 * Vercel's 4.5MB response size limit. Instead of returning ~8000 raw game scores,
 * it returns only the final calculated statistics (~50KB).
 *
 * Query Parameters:
 * - seasons (required): comma-separated list of seasons (e.g., "20,21,22")
 * - venue (required): venue name to filter by
 * - teamName (required): team name (usually "The Wrecking Crew")
 * - opponentTeam (optional): opponent team name for "Team" columns
 * - teamVenueSpecific (optional): filter opponent team by venue (default: true)
 * - twcVenueSpecific (optional): filter TWC stats by venue (default: false)
 * - scoreLimits (optional): JSON object mapping machine names to score limits
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const seasonsParam = searchParams.get('seasons');
  const venue = searchParams.get('venue');
  const teamName = searchParams.get('teamName');
  const opponentTeam = searchParams.get('opponentTeam');
  const teamVenueSpecific = searchParams.get('teamVenueSpecific') !== 'false'; // default true
  const twcVenueSpecific = searchParams.get('twcVenueSpecific') === 'true'; // default false
  const scoreLimitsParam = searchParams.get('scoreLimits');
  const includeManualScores = searchParams.get('includeManualScores') === 'true'; // default false
  const twcPlayersParam = searchParams.get('twcPlayers'); // optional comma-separated player names
  const machinesParam = searchParams.get('machines'); // optional comma-separated machine names from venues.json

  console.log('[machine-stats] Request params:', {
    seasons: seasonsParam,
    venue,
    teamName,
    opponentTeam,
    teamVenueSpecific,
    twcVenueSpecific,
    scoreLimits: scoreLimitsParam,
    includeManualScores
  });

  // Validate required parameters
  if (!seasonsParam || !venue || !teamName) {
    return NextResponse.json(
      { error: 'Missing required parameters: seasons, venue, and teamName are required' },
      { status: 400 }
    );
  }

  try {
    // Parse seasons parameter
    const seasonList = seasonsParam.split(',').map(s => parseInt(s.trim()));
    const minSeason = Math.min(...seasonList);
    const maxSeason = Math.max(...seasonList);

    // Parse score limits if provided
    let scoreLimits: Record<string, number> | undefined;
    if (scoreLimitsParam) {
      try {
        scoreLimits = JSON.parse(scoreLimitsParam);
      } catch (e) {
        return NextResponse.json(
          { error: 'Invalid scoreLimits JSON format' },
          { status: 400 }
        );
      }
    }

    // Fetch all games for the requested seasons from Supabase
    let gamesData: any[];
    try {
      gamesData = await fetchAllRecords(
        () => supabase
          .from('games')
          .select('*')
          .in('season', seasonList)
          .order('season', { ascending: false })
          .order('week', { ascending: false })
          .order('id', { ascending: true }) // Unique key ensures consistent pagination
      );
    } catch (error: any) {
      console.error('[machine-stats] Database error:', error);
      return NextResponse.json(
        { error: 'Failed to load games data', details: error.message },
        { status: 500 }
      );
    }

    console.log(`[machine-stats] Fetched ${gamesData.length} games total`);

    if (!gamesData || gamesData.length === 0) {
      console.log('[machine-stats] No games found for seasons:', seasonList);
      return NextResponse.json({
        stats: [],
        message: 'No games found for the specified seasons'
      });
    }

    // Build a map of team_key -> team_name from teams table
    const teamKeys = new Set<string>();
    gamesData.forEach((game: any) => {
      for (let i = 1; i <= 4; i++) {
        const team = game[`player_${i}_team`];
        if (team) teamKeys.add(team);
      }
      if (game.home_team) teamKeys.add(game.home_team);
      if (game.away_team) teamKeys.add(game.away_team);
    });

    const { data: teamsData } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .in('team_key', Array.from(teamKeys));

    const teamNameMap: Record<string, string> = {};
    (teamsData || []).forEach((team: any) => {
      teamNameMap[team.team_key] = team.team_name;
    });

    // Transform games data to ProcessedScore format (in-memory, not returned to client)
    const processedScores: ProcessedScore[] = [];

    gamesData.forEach((game: any) => {
      for (let i = 1; i <= 4; i++) {
        const playerKey = game[`player_${i}_key`];
        const playerName = game[`player_${i}_name`];
        const score = game[`player_${i}_score`];
        const points = game[`player_${i}_points`];
        const teamKey = game[`player_${i}_team`];

        if (!playerKey || score === null || score === undefined) continue;

        // Per MNP rules: away team picks rounds 1 (doubles) and 3 (singles);
        // home team picks rounds 2 (singles) and 4 (doubles).
        const isHomeTeam = teamKey === game.home_team;
        const isPick = game.round_number % 2 === 1 ? !isHomeTeam : isHomeTeam;

        // Normalize machine name using mappings
        const rawMachine = (game.machine || '').toLowerCase();
        const mappedMachine = machineMappings[rawMachine];
        const normalizedMachine = mappedMachine ? mappedMachine.toLowerCase() : rawMachine;

        processedScores.push({
          season: game.season || 0,
          week: game.week,
          match: game.match_key,
          round: game.round_number,
          venue: standardizeVenueName(game.venue) || '',
          machine: normalizedMachine,
          player_name: playerName || 'Unknown',
          team: teamKey || '',
          team_name: teamNameMap[teamKey] || teamKey || '',
          score: score,
          points: points || 0,
          is_pick: isPick,
          is_roster_player: true
        });
      }
    });

    console.log('[machine-stats] Processed scores from league games:', processedScores.length);

    // Fetch and include manual scores if enabled
    let manualScoresCount = 0;
    if (includeManualScores) {
      try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Fetch all manual scores from user_machine_scores
        const { data: manualScores, error: manualError } = await supabaseAdmin
          .from('user_machine_scores')
          .select('*')
          .order('score', { ascending: false });

        if (manualError) {
          console.error('[machine-stats] Error fetching manual scores:', manualError);
        } else if (manualScores && manualScores.length > 0) {
          console.log(`[machine-stats] Fetched ${manualScores.length} manual scores`);

          // Convert manual scores to ProcessedScore format
          // Manual scores are attributed to TWC
          for (const ms of manualScores) {
            // Normalize machine name using mappings to match league data format
            const inputMachine = ms.machine.toLowerCase();
            // Look up in mappings - if found, use the mapped value lowercase
            // This handles cases like "pulp fiction" -> "Pulp Fiction" -> "pulp fiction"
            // Or "pulp" -> "Pulp Fiction" -> "pulp fiction"
            const mappedMachine = machineMappings[inputMachine];
            const machineLower = mappedMachine ? mappedMachine.toLowerCase() : inputMachine;
            const venueName = standardizeVenueName(ms.venue) || ms.venue || '';

            console.log(`[machine-stats] Manual score: machine="${machineLower}", venue="${venueName}", score=${ms.score}, player=${ms.player_name}`);

            processedScores.push({
              season: maxSeason, // Use max season from selected range so it's included in stats
              week: 0,
              match: `manual-${ms.id}`,
              round: 0,
              venue: venueName,
              machine: machineLower,
              player_name: ms.player_name || 'Unknown',
              team: 'twc', // Attribute to TWC
              team_name: 'The Wrecking Crew', // Attribute to TWC
              score: ms.score,
              points: 0, // Manual scores don't have points
              is_pick: false,
              is_roster_player: false,
              is_manual: true // Mark as manual score
            });
            manualScoresCount++;
          }

          console.log(`[machine-stats] Added ${manualScoresCount} manual scores to processed scores`);
        }
      } catch (error) {
        console.error('[machine-stats] Error processing manual scores:', error);
      }
    }

    console.log('[machine-stats] Total processed scores:', processedScores.length);

    // Parse TWC players filter if provided
    const twcPlayers = twcPlayersParam
      ? twcPlayersParam.split(',').map(p => p.trim()).filter(Boolean)
      : undefined;

    // Now calculate machine stats server-side using the same logic as calculateMachineStats
    const stats = calculateMachineStatsServerSide(
      processedScores,
      teamName,
      venue,
      [minSeason, maxSeason],
      {
        includeVenueSpecific: true,
        includeTWCStats: true,
        opponentTeam: opponentTeam || undefined,
        scoreLimits,
        teamVenueSpecific,
        twcVenueSpecific,
        twcPlayers,
        machines: machinesParam ? machinesParam.split(',').map(m => {
          const lower = m.toLowerCase();
          const mapped = machineMappings[lower] || machineMappings[m];
          return mapped ? mapped.toLowerCase() : lower;
        }) : undefined,
      }
    );

    console.log('[machine-stats] Calculated stats for', stats.length, 'machines');

    // DEBUG: Add diagnostic info to response
    const uniqueTeams = new Set(processedScores.map(s => s.team_name));
    const twcScores = processedScores.filter(s => s.team_name.toLowerCase() === teamName.toLowerCase());
    const twcMachines = new Set(twcScores.map(s => s.machine));

    return NextResponse.json({
      stats,
      count: stats.length,
      processedScoresCount: processedScores.length,
      gamesCount: gamesData.length,
      debug: {
        teamNameSearching: teamName,
        uniqueTeamsInData: Array.from(uniqueTeams),
        twcScoresFound: twcScores.length,
        twcMachines: Array.from(twcMachines).sort(),
        sampleTwcScore: twcScores[0] || null
      }
    });
  } catch (error) {
    console.error('[machine-stats] Error calculating machine stats:', error);
    return NextResponse.json(
      { error: 'Failed to calculate machine stats', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Server-side implementation of calculateMachineStats
 * This is the same logic as in lib/tournament-data.ts but runs on the server
 */
function calculateMachineStatsServerSide(
  data: ProcessedScore[],
  teamName: string,
  venueName: string,
  seasons: [number, number],
  options: {
    includeVenueSpecific: boolean;
    includeTWCStats?: boolean;
    opponentTeam?: string;
    scoreLimits?: Record<string, number>;
    teamVenueSpecific?: boolean;
    twcVenueSpecific?: boolean;
    twcPlayers?: string[];
    machines?: string[];
  }
): MachineStats[] {
  // Filter data by seasons
  const seasonData = data.filter(d =>
    d.season >= seasons[0] && d.season <= seasons[1]
  );

  // Get venue-specific data (handles variations like "Ice Box" vs "Icebox")
  const venueData = seasonData.filter(d =>
    venuesMatch(d.venue, venueName)
  );

  // Determine opponent team name (used for "Team" columns)
  const opponentName = options.opponentTeam || teamName;

  // Get opponent team data (venue-specific or all venues based on teamVenueSpecific setting)
  const useTeamVenueSpecific = options.teamVenueSpecific !== undefined ? options.teamVenueSpecific : true;
  const teamData = useTeamVenueSpecific
    ? venueData.filter(d => d.team_name.toLowerCase() === opponentName.toLowerCase())
    : seasonData.filter(d => d.team_name.toLowerCase() === opponentName.toLowerCase());

  // Use machines passed from client if provided (sourced from venues.json with overrides already applied)
  // Otherwise fall back to deriving from venue data
  const machinesParam = options.machines;
  let machines: string[];
  if (machinesParam && machinesParam.length > 0) {
    machines = machinesParam;
  } else {
    const latestSeason = seasons[1];
    const latestSeasonVenueData = venueData.filter(d => d.season === latestSeason);
    const recentMachines = new Set(latestSeasonVenueData.map(d => d.machine));

    if (recentMachines.size === 0 && venueData.length > 0) {
      const allMachines = new Set(venueData.map(d => d.machine));
      machines = Array.from(allMachines).sort();
    } else {
      machines = Array.from(recentMachines).sort();
    }
  }

  const stats: MachineStats[] = [];

  machines.forEach(machine => {
    const machineVenueData = venueData.filter(d => d.machine === machine);
    const machineTeamData = teamData.filter(d => d.machine === machine);

    // Get score limit for this machine
    const machineLimit = options.scoreLimits?.[machine.toLowerCase()];

    // Helper to filter scores based on limit
    const filterScores = (scores: number[]) => {
      if (!machineLimit) return scores;
      return scores.filter(score => score <= machineLimit);
    };

    // Calculate venue average
    const allVenueScores = machineVenueData.map(d => d.score);
    const venueScores = filterScores(allVenueScores);
    const venueAverage = venueScores.length > 0
      ? venueScores.reduce((a, b) => a + b, 0) / venueScores.length
      : 0;

    // Calculate team stats
    const allTeamScores = machineTeamData.map(d => d.score);
    const teamScores = filterScores(allTeamScores);
    const teamAverage = teamScores.length > 0
      ? teamScores.reduce((a, b) => a + b, 0) / teamScores.length
      : 0;
    const teamHighestScore = teamScores.length > 0
      ? Math.max(...teamScores)
      : 0;

    // Calculate times played and picked
    const uniqueGames = new Set(
      machineTeamData.map(d => `${d.match}-${d.round}`)
    );
    const timesPlayed = uniqueGames.size;

    const pickedGames = new Set(
      machineTeamData
        .filter(d => d.is_pick)
        .map(d => `${d.match}-${d.round}`)
    );
    const timesPicked = pickedGames.size;

    // POPS uses 5 pts/game for doubles (R1, R4) and 3 for singles (R2, R3),
    // summed over unique games — see computePops().
    const pops = computePops(machineTeamData);
    const popsPicking = computePops(machineTeamData.filter(d => d.is_pick));
    const popsResponding = computePops(machineTeamData.filter(d => !d.is_pick));

    const percentOfVenueAvg = venueAverage > 0
      ? (teamAverage / venueAverage) * 100
      : 0;

    const machineStats: MachineStats = {
      machine,
      teamAverage,
      teamHighestScore,
      venueAverage,
      percentOfVenueAvg,
      timesPlayed,
      timesPicked,
      pops,
      popsPicking,
      popsResponding
    };

    // Add TWC stats if requested
    if (options.includeTWCStats) {
      const useTwcVenueSpecific = options.twcVenueSpecific !== undefined ? options.twcVenueSpecific : false;

      // DEBUG: Log what we're searching for
      const sourceData = useTwcVenueSpecific ? venueData : seasonData;
      const uniqueTeamsInData = new Set(sourceData.map(d => d.team_name));
      console.log(`[TWC DEBUG] Machine: ${machine}, Looking for team: "${teamName}", Venue-specific: ${useTwcVenueSpecific}`);
      console.log(`[TWC DEBUG] Available teams in ${useTwcVenueSpecific ? 'venue' : 'season'} data:`, Array.from(uniqueTeamsInData));
      console.log(`[TWC DEBUG] Source data count:`, sourceData.length, `Machine matches:`, sourceData.filter(d => d.machine === machine).length);

      const twcPlayerFilter = options.twcPlayers
        ? (d: ProcessedScore) => options.twcPlayers!.includes(d.player_name)
        : () => true;

      const twcData = useTwcVenueSpecific
        ? venueData.filter(d =>
            d.team_name.toLowerCase() === teamName.toLowerCase() && d.machine === machine && twcPlayerFilter(d)
          )
        : seasonData.filter(d =>
            d.team_name.toLowerCase() === teamName.toLowerCase() && d.machine === machine && twcPlayerFilter(d)
          );

      console.log(`[TWC DEBUG] TWC data found:`, twcData.length, `scores`);

      // Filter TWC scores by limit
      const allTwcScores = twcData.map(d => d.score);
      const twcScores = filterScores(allTwcScores);
      const twcAverage = twcScores.length > 0
        ? twcScores.reduce((a, b) => a + b, 0) / twcScores.length
        : 0;

      machineStats.twcAverage = twcAverage;
      machineStats.twcPercentOfVenueAvg = venueAverage > 0
        ? (twcAverage / venueAverage) * 100
        : 0;

      // TWC times played
      const twcUniqueGames = new Set(
        twcData.map(d => `${d.match}-${d.round}`)
      );
      machineStats.twcTimesPlayed = twcUniqueGames.size;

      // TWC times picked
      const twcPickedGames = new Set(
        twcData
          .filter(d => d.is_pick)
          .map(d => `${d.match}-${d.round}`)
      );
      machineStats.twcTimesPicked = twcPickedGames.size;

      machineStats.twcPops = computePops(twcData);
      machineStats.twcPopsPicking = computePops(twcData.filter(d => d.is_pick));
      machineStats.twcPopsResponding = computePops(twcData.filter(d => !d.is_pick));
    }

    stats.push(machineStats);
  });

  // Calculate comparison columns after all stats are computed
  if (options.includeTWCStats) {
    stats.forEach(stat => {
      // % Comparison: TWC % V. Avg. - Team % V. Avg.
      if (stat.twcPercentOfVenueAvg !== undefined && stat.percentOfVenueAvg !== undefined) {
        if (stat.twcPercentOfVenueAvg === 0 && stat.percentOfVenueAvg === 0) {
          stat.percentComparison = 'N/A';
        } else if (stat.twcPercentOfVenueAvg === 0) {
          stat.percentComparison = '-';
        } else if (stat.percentOfVenueAvg === 0) {
          stat.percentComparison = '+';
        } else {
          stat.percentComparison = stat.twcPercentOfVenueAvg - stat.percentOfVenueAvg;
        }
      }

      // POPS Comparison: TWC POPS - Team POPS
      if (stat.twcPops !== undefined && stat.pops !== undefined) {
        if (stat.twcPops === 0 && stat.pops === 0) {
          stat.popsComparison = 'N/A';
        } else if (stat.twcPops === 0) {
          stat.popsComparison = '-';
        } else if (stat.pops === 0) {
          stat.popsComparison = '+';
        } else {
          stat.popsComparison = stat.twcPops - stat.pops;
        }
      }
    });
  }

  return stats;
}

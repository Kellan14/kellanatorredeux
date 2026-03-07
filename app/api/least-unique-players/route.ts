import { NextRequest, NextResponse } from 'next/server';
import { supabase, fetchAllRecords } from '@/lib/supabase';
import { standardizeVenueName, venuesMatch } from '@/lib/venue-mappings';
import { machineMappings } from '@/lib/machine-mappings';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

/**
 * Finds 4 machines that minimize the total unique opponent players who have played them.
 * Uses a greedy algorithm: start with machine with fewest players, then add machines
 * that introduce the fewest NEW unique players.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const venue = searchParams.get('venue');
    const opponent = searchParams.get('opponent');
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20');
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '23');
    const machinesParam = searchParams.get('machines'); // comma-separated list of venue machines
    const excludedPlayersParam = searchParams.get('excludedPlayers'); // comma-separated player names to exclude
    const includedPlayersParam = searchParams.get('includedPlayers'); // comma-separated player names to include

    if (!venue || !opponent) {
      return NextResponse.json(
        { error: 'venue and opponent are required' },
        { status: 400 }
      );
    }

    // Build season list
    const seasons: number[] = [];
    for (let s = seasonStart; s <= seasonEnd; s++) {
      seasons.push(s);
    }

    // Get team key for opponent
    const { data: teamData } = await supabase
      .from('teams')
      .select('team_key')
      .ilike('team_name', opponent)
      .limit(1) as { data: { team_key: string }[] | null };

    const opponentTeamKey = teamData?.[0]?.team_key;
    if (!opponentTeamKey) {
      return NextResponse.json({
        machines: [],
        totalUniquePlayers: 0,
        playersByMachine: {},
        message: 'Opponent team not found'
      });
    }

    // Fetch roster players for the opponent team (non-subs only) from the most recent season in range
    const { data: rosterData } = await supabase
      .from('player_match_participation')
      .select('player_name, is_sub')
      .eq('team', opponentTeamKey)
      .eq('season', seasonEnd) as { data: { player_name: string; is_sub: boolean }[] | null };

    // Build set of roster player names (non-subs only)
    const rosterPlayers = new Set<string>();
    (rosterData || []).forEach(row => {
      if (!row.is_sub) {
        rosterPlayers.add(row.player_name);
      }
    });

    // Apply exclusions and inclusions (for hot swap feature)
    const excludedPlayers = excludedPlayersParam
      ? new Set(excludedPlayersParam.split(',').map(p => p.trim()).filter(Boolean))
      : new Set<string>();
    const includedPlayers = includedPlayersParam
      ? new Set(includedPlayersParam.split(',').map(p => p.trim()).filter(Boolean))
      : new Set<string>();

    // Final active players = (roster - excluded) + included
    const activePlayers = new Set<string>();
    rosterPlayers.forEach(p => {
      if (!excludedPlayers.has(p)) {
        activePlayers.add(p);
      }
    });
    includedPlayers.forEach(p => activePlayers.add(p));

    console.log('[least-unique-players] Active players for', opponent, ':', Array.from(activePlayers));

    if (activePlayers.size === 0) {
      return NextResponse.json({
        machines: [],
        totalUniquePlayers: 0,
        playersByMachine: {},
        rosterPlayers: Array.from(rosterPlayers),
        message: 'No active players after applying swaps'
      });
    }

    // Fetch all games for the opponent team at this venue
    const gamesData = await fetchAllRecords(
      () => supabase
        .from('games')
        .select('*')
        .in('season', seasons)
        .order('id', { ascending: true })
    );

    if (!gamesData || gamesData.length === 0) {
      return NextResponse.json({
        machines: [],
        totalUniquePlayers: 0,
        playersByMachine: {},
        message: 'No games found'
      });
    }

    // Build team name map
    const teamKeys = new Set<string>();
    gamesData.forEach((game: any) => {
      for (let i = 1; i <= 4; i++) {
        const teamKey = game[`player_${i}_team`];
        if (teamKey) teamKeys.add(teamKey);
      }
    });

    const { data: teamsData } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .in('team_key', Array.from(teamKeys));

    const teamNameMap: Record<string, string> = {};
    (teamsData || []).forEach((t: any) => {
      teamNameMap[t.team_key] = t.team_name;
    });

    // Parse venue machines if provided
    const venueMachines = machinesParam
      ? machinesParam.split(',').map(m => {
          const lower = m.trim().toLowerCase();
          const mapped = machineMappings[lower];
          return mapped ? mapped.toLowerCase() : lower;
        })
      : null;

    // Build a map of machine -> Set of unique players who played it
    const machinePlayersMap: Map<string, Set<string>> = new Map();

    gamesData.forEach((game: any) => {
      // Check if game is at this venue
      const gameVenue = standardizeVenueName(game.venue) || game.venue || '';
      if (!venuesMatch(gameVenue, venue)) return;

      // Normalize machine name
      const rawMachine = (game.machine || '').toLowerCase();
      const mappedMachine = machineMappings[rawMachine];
      const normalizedMachine = mappedMachine ? mappedMachine.toLowerCase() : rawMachine;

      // Skip if not in venue machines list
      if (venueMachines && !venueMachines.includes(normalizedMachine)) return;

      // Check each player slot
      for (let i = 1; i <= 4; i++) {
        const playerName = game[`player_${i}_name`];
        const teamKey = game[`player_${i}_team`];

        if (!playerName || teamKey !== opponentTeamKey) continue;

        // Only count active players (roster with swaps applied)
        if (!activePlayers.has(playerName)) continue;

        if (!machinePlayersMap.has(normalizedMachine)) {
          machinePlayersMap.set(normalizedMachine, new Set());
        }
        machinePlayersMap.get(normalizedMachine)!.add(playerName);
      }
    });

    // Convert to array for processing
    const machinePlayersList: { machine: string; players: Set<string> }[] = [];
    machinePlayersMap.forEach((players, machine) => {
      machinePlayersList.push({ machine, players });
    });

    // Add machines with 0 players (from venue list if provided)
    if (venueMachines) {
      venueMachines.forEach(m => {
        if (!machinePlayersMap.has(m)) {
          machinePlayersList.push({ machine: m, players: new Set() });
        }
      });
    }

    // Sort by number of players ascending
    machinePlayersList.sort((a, b) => a.players.size - b.players.size);

    if (machinePlayersList.length === 0) {
      return NextResponse.json({
        machines: [],
        totalUniquePlayers: 0,
        playersByMachine: {},
        message: 'No machine data found'
      });
    }

    // Greedy algorithm: pick 4 machines that minimize total unique players
    const selectedMachines: { machine: string; players: string[]; addedPlayers: number }[] = [];
    const allSelectedPlayers = new Set<string>();

    for (let i = 0; i < Math.min(4, machinePlayersList.length); i++) {
      let bestMachine: { machine: string; players: Set<string> } | null = null;
      let bestNewPlayers = Infinity;

      // Find machine that adds fewest NEW players
      for (const entry of machinePlayersList) {
        // Skip if already selected
        if (selectedMachines.some(s => s.machine === entry.machine)) continue;

        // Count how many NEW players this would add
        let newPlayers = 0;
        entry.players.forEach(p => {
          if (!allSelectedPlayers.has(p)) newPlayers++;
        });

        if (newPlayers < bestNewPlayers) {
          bestNewPlayers = newPlayers;
          bestMachine = entry;
        }
      }

      if (bestMachine) {
        const newPlayersAdded = bestNewPlayers;
        bestMachine.players.forEach(p => allSelectedPlayers.add(p));
        selectedMachines.push({
          machine: bestMachine.machine,
          players: Array.from(bestMachine.players),
          addedPlayers: newPlayersAdded
        });
      }
    }

    // Build response
    const playersByMachine: Record<string, string[]> = {};
    selectedMachines.forEach(m => {
      playersByMachine[m.machine] = m.players;
    });

    return NextResponse.json({
      machines: selectedMachines.map(m => ({
        machine: m.machine,
        playerCount: m.players.length,
        addedPlayers: m.addedPlayers,
        players: m.players
      })),
      totalUniquePlayers: allSelectedPlayers.size,
      allPlayers: Array.from(allSelectedPlayers),
      playersByMachine,
      rosterPlayers: Array.from(rosterPlayers),
      activePlayers: Array.from(activePlayers)
    });
  } catch (error) {
    console.error('[least-unique-players] Error:', error);
    return NextResponse.json(
      { error: 'Failed to calculate least unique players', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

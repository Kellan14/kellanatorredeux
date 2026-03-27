import { NextRequest, NextResponse } from 'next/server';
import { supabase, fetchAllRecords } from '@/lib/supabase';

import { machineMappings } from '@/lib/machine-mappings';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

/**
 * Finds 4 machines (from the venue's machine list) that minimize the total unique
 * opponent players who have played them ANYWHERE in the league (not just at this venue).
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

    // Parse venue machines if provided
    const venueMachines = machinesParam
      ? machinesParam.split(',').map(m => {
          const lower = m.trim().toLowerCase();
          const mapped = machineMappings[lower];
          return mapped ? mapped.toLowerCase() : lower;
        })
      : null;

    // Build a map of machine -> Set of unique players who played it ANYWHERE in the league
    // We only track machines that are at the selected venue, but count players from all venues
    const machinePlayersMap: Map<string, Set<string>> = new Map();

    // Try cache-first: use cache_player_machine_stats (venue=NULL = all-venues)
    let usedCache = false;
    if (venueMachines) {
      // Build all machine variations to search for
      const machineSearchKeys: string[] = [];
      for (const vm of venueMachines) {
        machineSearchKeys.push(vm);
        // Also add the raw form in case cache stored it differently
        const mapped = machineMappings[vm];
        if (mapped) machineSearchKeys.push(mapped.toLowerCase());
      }

      const { data: cacheData } = await supabase
        .from('cache_player_machine_stats' as any)
        .select('player_name, machine')
        .eq('team_key', opponentTeamKey)
        .is('venue', null)  // all-venues = played anywhere
        .eq('season_start', seasonStart)
        .eq('season_end', seasonEnd)
        .in('machine', machineSearchKeys) as { data: any[] | null };

      if (cacheData && cacheData.length > 0) {
        usedCache = true;
        for (const row of cacheData) {
          const normalizedMachine = row.machine.toLowerCase();
          // Map back to venue machine name
          const mappedBack = machineMappings[normalizedMachine];
          const key = mappedBack ? mappedBack.toLowerCase() : normalizedMachine;
          if (!venueMachines.includes(key) && !venueMachines.includes(normalizedMachine)) continue;
          const machineKey = venueMachines.includes(key) ? key : normalizedMachine;

          if (!activePlayers.has(row.player_name)) continue;

          if (!machinePlayersMap.has(machineKey)) {
            machinePlayersMap.set(machineKey, new Set());
          }
          machinePlayersMap.get(machineKey)!.add(row.player_name);
        }
      }
    }

    if (!usedCache) {
      // Fallback: full games scan
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

      gamesData.forEach((game: any) => {
        const rawMachine = (game.machine || '').toLowerCase();
        const mappedMachine = machineMappings[rawMachine];
        const normalizedMachine = mappedMachine ? mappedMachine.toLowerCase() : rawMachine;

        if (venueMachines && !venueMachines.includes(normalizedMachine)) return;

        for (let i = 1; i <= 4; i++) {
          const playerName = game[`player_${i}_name`];
          const teamKey = game[`player_${i}_team`];

          if (!playerName || teamKey !== opponentTeamKey) continue;
          if (!activePlayers.has(playerName)) continue;

          if (!machinePlayersMap.has(normalizedMachine)) {
            machinePlayersMap.set(normalizedMachine, new Set());
          }
          machinePlayersMap.get(normalizedMachine)!.add(playerName);
        }
      });
    }

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

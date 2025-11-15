// Data processing functions ported from Python app.py
// This handles all the tournament data analysis and statistics

import { applyVenueMachineListOverrides } from './venue-machine-lists'

// Real MNP JSON data structure
export interface MNPMatch {
  key: string;
  name: string;
  type: string;
  week: string;
  round: number;
  create_at: number;
  date: string;
  state: string;
  season?: number; // Added by our API
  venue: {
    key: string;
    name: string;
    machines: string[];
  };
  home: {
    name: string;
    key: string;
    captains: Array<{ key: string; name: string }>;
    lineup: Array<{
      key: string;
      name: string;
      sub: boolean;
      num_played: number;
      IPR: number;
    }>;
    ready: boolean;
    confirmed?: {
      by: string;
      at: number;
    };
  };
  away: {
    name: string;
    key: string;
    captains: Array<{ key: string; name: string }>;
    lineup: Array<{
      key: string;
      name: string;
      sub: boolean;
      num_played: number;
      IPR: number;
    }>;
    ready: boolean;
    confirmed?: {
      by: string;
      at: number;
    };
  };
  rounds: MNPRound[];
  players: any[];
}

export interface MNPRound {
  n: number;
  games: MNPGame[];
  done: boolean;
  left_confirmed?: {
    by: string;
    at: number;
  };
  right_confirmed?: {
    by: string;
    at: number;
  };
}

export interface MNPGame {
  n: number;
  machine: string;
  player_1?: string;
  player_2?: string;
  player_3?: string;
  player_4?: string;
  score_1?: number;
  score_2?: number;
  score_3?: number;
  score_4?: number;
  points_1?: number;
  points_2?: number;
  points_3?: number;
  points_4?: number;
  score_13?: number;
  score_24?: number;
  points_13?: number;
  points_24?: number;
  away_points?: number;
  home_points?: number;
  done: boolean;
  photos?: Array<{
    uploaded_by: string;
    url: string;
    rot: number;
    scale: number;
    dx: number;
    dy: number;
  }>;
}

// Legacy interface for backward compatibility
export interface Match {
  season: number;
  week: number;
  match: string;
  venue: {
    name: string;
    address?: string;
  };
  home: {
    name: string;
    key: string;
  };
  away: {
    name: string;
    key: string;
  };
  rounds: Round[];
}

export interface Round {
  round: number;
  games: Game[];
}

export interface Game {
  machine: string;
  players: Player[];
}

export interface Player {
  name: string;
  team: string;
  score: number;
  points: number;
}

export interface ProcessedScore {
  season: number;
  week: number;
  match: string;
  round: number;
  venue: string;
  machine: string;
  player_name: string;
  team: string;
  team_name: string;
  score: number;
  points: number;
  opponent_score?: number;
  is_pick?: boolean;
  is_roster_player?: boolean;
}

export interface MachineStats {
  machine: string;
  percentComparison?: string | number; // TWC % - Team %, can be "+", "-", "N/A" or number
  teamAverage: number;
  teamHighestScore: number;
  venueAverage: number;
  percentOfVenueAvg: number;
  timesPlayed: number;
  timesPicked: number;
  pops: number;
  popsPicking: number;
  popsResponding: number;
  twcAverage?: number;
  twcPercentOfVenueAvg?: number;
  twcTimesPlayed?: number;
  twcTimesPicked?: number;
  twcPops?: number;
  twcPopsPicking?: number;
  twcPopsResponding?: number;
  popsComparison?: string | number; // TWC POPS - Team POPS, can be "+", "-", "N/A" or number
}

// Helper function to get player name from lineup by player key
function getPlayerName(match: MNPMatch, playerKey: string): string {
  // Search in both home and away lineups
  const homePlayer = match.home.lineup.find(p => p.key === playerKey);
  if (homePlayer) return homePlayer.name;

  const awayPlayer = match.away.lineup.find(p => p.key === playerKey);
  if (awayPlayer) return awayPlayer.name;

  return playerKey; // Fallback to key if not found
}

// Helper function to determine which team a player belongs to
function getPlayerTeam(match: MNPMatch, playerKey: string): { key: string; name: string } {
  const homePlayer = match.home.lineup.find(p => p.key === playerKey);
  if (homePlayer) return { key: match.home.key, name: match.home.name };

  const awayPlayer = match.away.lineup.find(p => p.key === playerKey);
  if (awayPlayer) return { key: match.away.key, name: match.away.name };

  return { key: '', name: 'Unknown' };
}

// Process real MNP JSON match data into flat structure
export function processMNPMatchData(matches: MNPMatch[]): ProcessedScore[] {
  const processedScores: ProcessedScore[] = [];

  matches.forEach(match => {
    if (!match.season) return; // Skip if no season number

    const venueName = match.venue.name;
    const week = parseInt(match.week);

    match.rounds.forEach(round => {
      round.games.forEach(game => {
        if (!game.done) return; // Skip incomplete games

        // Process each player (1-4)
        for (let i = 1; i <= 4; i++) {
          const playerKey = (game as any)[`player_${i}`];
          const score = (game as any)[`score_${i}`];
          const points = (game as any)[`points_${i}`];

          if (!playerKey || score === undefined) continue;

          const playerName = getPlayerName(match, playerKey);
          const playerTeam = getPlayerTeam(match, playerKey);

          // Determine if this is a pick round (home picks odd rounds)
          const isPick = round.n % 2 === 1
            ? playerTeam.key === match.home.key
            : playerTeam.key === match.away.key;

          processedScores.push({
            season: match.season || 0,
            week: week,
            match: match.name,
            round: round.n,
            venue: venueName,
            machine: game.machine.toLowerCase(),
            player_name: playerName,
            team: playerTeam.key,
            team_name: playerTeam.name,
            score: score,
            points: points || 0,
            is_pick: isPick,
            is_roster_player: true // Could be enhanced to check sub status
          });
        }
      });
    });
  });

  return processedScores;
}

// Process raw JSON match data into flat structure (legacy)
export function processMatchData(matches: Match[]): ProcessedScore[] {
  const processedScores: ProcessedScore[] = [];

  matches.forEach(match => {
    const venueName = match.venue.name;
    
    match.rounds.forEach(round => {
      round.games.forEach(game => {
        game.players.forEach(player => {
          // Determine which team (home or away) the player belongs to
          const isHomeTeam = match.home.key === player.team;
          const teamData = isHomeTeam ? match.home : match.away;
          
          // Find opponent's score
          const opponent = game.players.find(p => p.team !== player.team);
          
          processedScores.push({
            season: match.season || 0,
            week: match.week,
            match: match.match,
            round: round.round,
            venue: venueName,
            machine: game.machine.toLowerCase(),
            player_name: player.name,
            team: player.team,
            team_name: teamData.name,
            score: player.score,
            points: player.points,
            opponent_score: opponent?.score,
            is_pick: round.round % 2 === 1 ? isHomeTeam : !isHomeTeam, // Home picks odd rounds
            is_roster_player: true // This would be determined by roster data
          });
        });
      });
    });
  });

  return processedScores;
}

// Calculate machine statistics for a team at a venue
export function calculateMachineStats(
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
  } = { includeVenueSpecific: true }
): MachineStats[] {

  // Filter data by seasons
  const seasonData = data.filter(d =>
    d.season >= seasons[0] && d.season <= seasons[1]
  );

  // Get venue-specific data
  const venueData = seasonData.filter(d =>
    d.venue.toLowerCase() === venueName.toLowerCase()
  );

  // Determine opponent team name (used for "Team" columns)
  const opponentName = options.opponentTeam || teamName;

  // Get opponent team data (venue-specific or all venues based on teamVenueSpecific setting)
  // Default to true if not specified (backward compatibility)
  const useTeamVenueSpecific = options.teamVenueSpecific !== undefined ? options.teamVenueSpecific : true;
  const teamData = useTeamVenueSpecific
    ? venueData.filter(d => d.team_name.toLowerCase() === opponentName.toLowerCase())
    : seasonData.filter(d => d.team_name.toLowerCase() === opponentName.toLowerCase());

  // Get machines that appear in the most recent season at this venue
  // This matches app.py logic: only show machines with games in the latest season
  const latestSeason = seasons[1]; // The end of the season range is the most recent
  const latestSeasonVenueData = venueData.filter(d => d.season === latestSeason);
  const recentMachines = new Set(latestSeasonVenueData.map(d => d.machine));

  // Get unique machines from venue, but only those that appear in the most recent season
  let machines = Array.from(recentMachines).sort();

  // Apply venue machine list overrides (included/excluded machines)
  machines = applyVenueMachineListOverrides(venueName, machines);
  
  const stats: MachineStats[] = [];
  
  machines.forEach(machine => {
    const machineVenueData = venueData.filter(d => d.machine === machine);
    const machineTeamData = teamData.filter(d => d.machine === machine);

    // Get score limit for this machine (normalize machine name to lowercase for matching)
    const machineLimit = options.scoreLimits?.[machine.toLowerCase()];

    // Helper to filter scores based on limit
    const filterScores = (scores: number[]) => {
      if (!machineLimit) return scores;
      return scores.filter(score => score <= machineLimit);
    };

    // Calculate venue average (filter scores by limit)
    const allVenueScores = machineVenueData.map(d => d.score);
    const venueScores = filterScores(allVenueScores);
    const venueAverage = venueScores.length > 0
      ? venueScores.reduce((a, b) => a + b, 0) / venueScores.length
      : 0;

    // Calculate team stats (filter scores by limit)
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
    
    // Calculate POPS (Percentage of Points Scored)
    const teamPoints = machineTeamData.reduce((sum, d) => sum + d.points, 0);
    const maxPoints = machineTeamData.length * 10; // Assuming max 10 points per game
    const pops = maxPoints > 0 ? (teamPoints / maxPoints) * 100 : 0;
    
    // POPS when picking
    const pickingData = machineTeamData.filter(d => d.is_pick);
    const pickingPoints = pickingData.reduce((sum, d) => sum + d.points, 0);
    const maxPickingPoints = pickingData.length * 10;
    const popsPicking = maxPickingPoints > 0 
      ? (pickingPoints / maxPickingPoints) * 100 
      : 0;
    
    // POPS when responding
    const respondingData = machineTeamData.filter(d => !d.is_pick);
    const respondingPoints = respondingData.reduce((sum, d) => sum + d.points, 0);
    const maxRespondingPoints = respondingData.length * 10;
    const popsResponding = maxRespondingPoints > 0
      ? (respondingPoints / maxRespondingPoints) * 100
      : 0;
    
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
      // Use twcVenueSpecific setting, default to false if not specified (backward compatibility)
      const useTwcVenueSpecific = options.twcVenueSpecific !== undefined ? options.twcVenueSpecific : false;
      const twcData = useTwcVenueSpecific
        ? venueData.filter(d =>
            d.team_name.toLowerCase() === teamName.toLowerCase() && d.machine === machine
          )
        : seasonData.filter(d =>
            d.team_name.toLowerCase() === teamName.toLowerCase() && d.machine === machine
          );

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
      
      // TWC POPS calculations
      const twcPoints = twcData.reduce((sum, d) => sum + d.points, 0);
      const maxTwcPoints = twcData.length * 10;
      machineStats.twcPops = maxTwcPoints > 0 
        ? (twcPoints / maxTwcPoints) * 100 
        : 0;
      
      // TWC POPS Picking
      const twcPickingData = twcData.filter(d => d.is_pick);
      const twcPickingPoints = twcPickingData.reduce((sum, d) => sum + d.points, 0);
      const maxTwcPickingPoints = twcPickingData.length * 10;
      machineStats.twcPopsPicking = maxTwcPickingPoints > 0
        ? (twcPickingPoints / maxTwcPickingPoints) * 100
        : 0;
      
      // TWC POPS Responding
      const twcRespondingData = twcData.filter(d => !d.is_pick);
      const twcRespondingPoints = twcRespondingData.reduce((sum, d) => sum + d.points, 0);
      const maxTwcRespondingPoints = twcRespondingData.length * 10;
      machineStats.twcPopsResponding = maxTwcRespondingPoints > 0
        ? (twcRespondingPoints / maxTwcRespondingPoints) * 100
        : 0;
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

// Get unique teams from match data
export function getUniqueTeams(matches: Match[]): string[] {
  const teams = new Set<string>();
  matches.forEach(match => {
    teams.add(match.home.name);
    teams.add(match.away.name);
  });
  return Array.from(teams).sort();
}

// Get unique venues from match data
export function getUniqueVenues(matches: Match[]): string[] {
  const venues = new Set<string>();
  matches.forEach(match => {
    venues.add(match.venue.name);
  });
  return Array.from(venues).sort();
}

// Get unique machines from match data
export function getUniqueMachines(matches: Match[]): string[] {
  const machines = new Set<string>();
  matches.forEach(match => {
    match.rounds.forEach(round => {
      round.games.forEach(game => {
        machines.add(game.machine.toLowerCase());
      });
    });
  });
  return Array.from(machines).sort();
}

// Calculate player statistics
export function calculatePlayerStats(
  data: ProcessedScore[],
  playerName: string,
  options: {
    teamFilter?: string;
    venueFilter?: string;
    seasonRange?: [number, number];
  } = {}
): {
  totalGames: number;
  averageScore: number;
  averagePoints: number;
  machinesPlayed: number;
  bestMachine: string | null;
  worstMachine: string | null;
} {
  let playerData = data.filter(d => d.player_name === playerName);
  
  if (options.teamFilter) {
    playerData = playerData.filter(d => 
      d.team_name.toLowerCase() === options.teamFilter!.toLowerCase()
    );
  }
  
  if (options.venueFilter) {
    playerData = playerData.filter(d => 
      d.venue.toLowerCase() === options.venueFilter!.toLowerCase()
    );
  }
  
  if (options.seasonRange) {
    playerData = playerData.filter(d => 
      d.season >= options.seasonRange![0] && 
      d.season <= options.seasonRange![1]
    );
  }
  
  const totalGames = playerData.length;
  const averageScore = playerData.length > 0
    ? playerData.reduce((sum, d) => sum + d.score, 0) / playerData.length
    : 0;
  const averagePoints = playerData.length > 0
    ? playerData.reduce((sum, d) => sum + d.points, 0) / playerData.length
    : 0;
  
  const uniqueMachines = new Set(playerData.map(d => d.machine));
  const machinesPlayed = uniqueMachines.size;
  
  // Find best and worst machines by average points
  const machinePoints: { [key: string]: number[] } = {};
  playerData.forEach(d => {
    if (!machinePoints[d.machine]) {
      machinePoints[d.machine] = [];
    }
    machinePoints[d.machine].push(d.points);
  });
  
  let bestMachine: string | null = null;
  let worstMachine: string | null = null;
  let bestAvg = 0;
  let worstAvg = 10;
  
  Object.entries(machinePoints).forEach(([machine, points]) => {
    const avg = points.reduce((a, b) => a + b, 0) / points.length;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestMachine = machine;
    }
    if (avg < worstAvg) {
      worstAvg = avg;
      worstMachine = machine;
    }
  });
  
  return {
    totalGames,
    averageScore,
    averagePoints,
    machinesPlayed,
    bestMachine,
    worstMachine
  };
}

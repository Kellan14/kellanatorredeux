// Data loading service for tournament JSON files
import { MNPMatch, Match, ProcessedScore, processMatchData, processMNPMatchData } from './tournament-data';

export class TournamentDataService {
  private static instance: TournamentDataService;
  private mnpMatchCache: Map<string, MNPMatch[]> = new Map();
  private matchCache: Map<string, Match[]> = new Map();
  private processedCache: Map<string, ProcessedScore[]> = new Map();

  private constructor() {}

  static getInstance(): TournamentDataService {
    if (!TournamentDataService.instance) {
      TournamentDataService.instance = new TournamentDataService();
    }
    return TournamentDataService.instance;
  }

  // Load MNP match data from the new API
  async loadMNPSeasonData(seasons: number[]): Promise<MNPMatch[]> {
    const cacheKey = `mnp-${seasons.join('-')}`;

    // Check cache first
    if (this.mnpMatchCache.has(cacheKey)) {
      return this.mnpMatchCache.get(cacheKey)!;
    }

    try {
      const seasonsParam = seasons.join(',');
      const response = await fetch(`/api/matches?seasons=${seasonsParam}`);

      if (!response.ok) {
        console.warn(`Failed to load MNP data for seasons ${seasons}`);
        return [];
      }

      const data = await response.json();
      const matches: MNPMatch[] = data.matches || [];

      this.mnpMatchCache.set(cacheKey, matches);
      return matches;
    } catch (error) {
      console.error(`Error loading MNP seasons ${seasons}:`, error);
      return [];
    }
  }

  // Load machine data
  async loadMachines(): Promise<Record<string, { key: string; name: string }>> {
    try {
      const response = await fetch('/api/machines');
      if (!response.ok) {
        throw new Error('Failed to load machines');
      }
      return await response.json();
    } catch (error) {
      console.error('Error loading machines:', error);
      return {};
    }
  }

  // Load venue data
  async loadVenues(): Promise<any> {
    try {
      const response = await fetch('/api/venues');
      if (!response.ok) {
        throw new Error('Failed to load venues');
      }
      return await response.json();
    } catch (error) {
      console.error('Error loading venues:', error);
      return {};
    }
  }

  // Load match data from JSON files (legacy)
  async loadSeasonData(season: number): Promise<Match[]> {
    const cacheKey = `season-${season}`;

    // Check cache first
    if (this.matchCache.has(cacheKey)) {
      return this.matchCache.get(cacheKey)!;
    }

    try {
      // In production, this would load from your GitHub repo or API
      // For now, we'll load from local JSON files
      const response = await fetch(`/data/season-${season}/matches.json`);

      if (!response.ok) {
        console.warn(`No data found for season ${season}`);
        return [];
      }

      const matches: Match[] = await response.json();
      this.matchCache.set(cacheKey, matches);
      return matches;
    } catch (error) {
      console.error(`Error loading season ${season}:`, error);
      return [];
    }
  }

  // Load multiple seasons (legacy)
  async loadSeasonsData(seasons: number[]): Promise<Match[]> {
    const allMatches: Match[] = [];

    for (const season of seasons) {
      const seasonMatches = await this.loadSeasonData(season);
      allMatches.push(...seasonMatches);
    }

    return allMatches;
  }

  // Load data from a specific file path (legacy)
  async loadFromPath(path: string): Promise<Match[]> {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to load data from ${path}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error loading from ${path}:`, error);
      return [];
    }
  }

  // Get processed scores for analysis (using real MNP data)
  async getProcessedScores(seasons: number[]): Promise<ProcessedScore[]> {
    const cacheKey = `processed-${seasons.join('-')}`;

    if (this.processedCache.has(cacheKey)) {
      return this.processedCache.get(cacheKey)!;
    }

    // Load real MNP data
    const mnpMatches = await this.loadMNPSeasonData(seasons);
    const processed = processMNPMatchData(mnpMatches);

    this.processedCache.set(cacheKey, processed);
    return processed;
  }

  // Load sample data for development
  async loadSampleData(): Promise<Match[]> {
    // Sample data structure matching your Python app
    const sampleMatches: Match[] = [
      {
        season: 20,
        week: 1,
        match: "Week 1 - Match 1",
        venue: {
          name: "Georgetown Pizza and Arcade",
          address: "123 Main St"
        },
        home: {
          name: "The Wrecking Crew",
          key: "TWC"
        },
        away: {
          name: "Ball Busters",
          key: "BBU"
        },
        rounds: [
          {
            round: 1,
            games: [
              {
                machine: "attack from mars",
                players: [
                  { name: "Player One", team: "TWC", score: 2500000000, points: 7 },
                  { name: "Player Two", team: "BBU", score: 1800000000, points: 3 }
                ]
              },
              {
                machine: "medieval madness",
                players: [
                  { name: "Player Three", team: "TWC", score: 18000000, points: 5 },
                  { name: "Player Four", team: "BBU", score: 25000000, points: 5 }
                ]
              }
            ]
          },
          {
            round: 2,
            games: [
              {
                machine: "twilight zone",
                players: [
                  { name: "Player One", team: "TWC", score: 450000000, points: 8 },
                  { name: "Player Four", team: "BBU", score: 320000000, points: 2 }
                ]
              }
            ]
          }
        ]
      },
      {
        season: 20,
        week: 2,
        match: "Week 2 - Match 1",
        venue: {
          name: "Georgetown Pizza and Arcade"
        },
        home: {
          name: "The Wrecking Crew",
          key: "TWC"
        },
        away: {
          name: "Pinball Wizards",
          key: "PWZ"
        },
        rounds: [
          {
            round: 1,
            games: [
              {
                machine: "the addams family",
                players: [
                  { name: "Player One", team: "TWC", score: 95000000, points: 6 },
                  { name: "Player Five", team: "PWZ", score: 88000000, points: 4 }
                ]
              }
            ]
          }
        ]
      }
    ];

    return sampleMatches;
  }

  // Clear cache
  clearCache(): void {
    this.matchCache.clear();
    this.processedCache.clear();
  }

  // Get available seasons from the MNP data API
  async getAvailableSeasons(): Promise<number[]> {
    try {
      const response = await fetch('/api/matches', { method: 'OPTIONS' });
      if (!response.ok) {
        // Default seasons if API fails
        return [14, 15, 16, 17, 18, 19, 20, 21, 22];
      }
      const data = await response.json();
      return data.seasons || [14, 15, 16, 17, 18, 19, 20, 21, 22];
    } catch (error) {
      console.error('Error fetching available seasons:', error);
      return [14, 15, 16, 17, 18, 19, 20, 21, 22]; // Default seasons
    }
  }
}

// Export singleton instance
export const tournamentDataService = TournamentDataService.getInstance();

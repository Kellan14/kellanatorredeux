export type SeasonRange = { start: number; end: number }

export function defaultDashboardRange(currentSeason: number): SeasonRange {
  return { start: Math.max(2, currentSeason - 2), end: currentSeason }
}

export function changeSeasonRange(range: SeasonRange, edge: 'start' | 'end', value: number): SeasonRange {
  return edge === 'start'
    ? { start: value, end: Math.max(value, range.end) }
    : { start: Math.min(range.start, value), end: value }
}

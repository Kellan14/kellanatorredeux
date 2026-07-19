/**
 * Helpers for safely building PostgREST filter strings from user input.
 *
 * PostgREST parses the value side of an `.or()` / `.filter()` string. Special
 * characters — commas (separate conditions), parentheses (grouping), dots
 * (separate column.op.value) — will break or alter the filter if they appear
 * raw in user-supplied values. Real pinball player names contain commas and
 * parentheses (e.g. "Smith, Jr." or "Name (sub)"), so this is a correctness
 * issue as well as a security one.
 *
 * PostgREST allows a value to be double-quoted, and a literal double quote
 * inside is escaped by doubling it. We quote whenever the value contains any
 * character that could be interpreted, which is always safe.
 */
export function escapeOrValue(value: string): string {
  // Double any embedded quotes, then wrap in quotes.
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Build an `.or()` filter matching a value against several columns with `eq`,
 * with the value safely quoted. e.g.
 *   orEqAcrossColumns(['player_1_name','player_2_name'], name)
 *   => 'player_1_name.eq."NAME",player_2_name.eq."NAME"'
 */
export function orEqAcrossColumns(columns: string[], value: string): string {
  const safe = escapeOrValue(value)
  return columns.map(col => `${col}.eq.${safe}`).join(',')
}

/**
 * Like orEqAcrossColumns but matches any of several values (e.g. a player's
 * name plus their "(sub)" variant) across the given columns. Empty/blank
 * values are skipped.
 */
export function orEqAcrossColumnsMulti(columns: string[], values: string[]): string {
  const parts: string[] = []
  for (const value of values) {
    if (!value) continue
    const safe = escapeOrValue(value)
    for (const col of columns) parts.push(`${col}.eq.${safe}`)
  }
  return parts.join(',')
}

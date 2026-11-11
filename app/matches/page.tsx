'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useMachineCanon } from '@/hooks/use-machine-canon'
import type { MatchDetail, MatchSummary, MatchTeam } from '@/lib/match-browser'

const number = (value: number | null) => value === null ? '—' : value.toLocaleString('en-US')
const matchLabel = (match: MatchSummary) => [
  `Season ${match.season} · Week ${match.week}`, match.date, match.venue,
].filter(Boolean).join(' · ')

async function read<T>(params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/match-browser?${new URLSearchParams(params)}`, { signal })
  if (!response.ok) throw new Error('Could not load match data. Try again.')
  return response.json()
}

export default function MatchesPage() {
  const [teams, setTeams] = useState<MatchTeam[]>([])
  const [team, setTeam] = useState('TWC')
  const [opponent, setOpponent] = useState('')
  const [matches, setMatches] = useState<MatchSummary[]>([])
  const [matchKey, setMatchKey] = useState('')
  const [detail, setDetail] = useState<MatchDetail | null>(null)
  const [loading, setLoading] = useState<'teams' | 'matches' | 'detail' | null>('teams')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState({ teams: 0, matches: 0, detail: 0 })
  const { display } = useMachineCanon()
  const teamName = (key: string | null) => teams.find(t => t.key === key)?.name || key || 'Unknown team'

  useEffect(() => {
    if (teams.length) return
    const controller = new AbortController()
    setLoading('teams')
    setError('')
    read<{ teams: MatchTeam[] }>({}, controller.signal)
      .then(data => { if (!controller.signal.aborted) setTeams(data.teams) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(null) })
    return () => controller.abort()
  }, [retry.teams, teams.length])

  useEffect(() => {
    if (!opponent || opponent === team) return
    const controller = new AbortController()
    setLoading('matches')
    setError('')
    read<{ matches: MatchSummary[] }>({ team, opponent }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setMatches(data.matches) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(null) })
    return () => controller.abort()
  }, [team, opponent, retry.matches])

  useEffect(() => {
    if (!matchKey) return
    const controller = new AbortController()
    setLoading('detail')
    setError('')
    read<{ match: MatchDetail }>({ match: matchKey }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setDetail(data.match) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(null) })
    return () => controller.abort()
  }, [matchKey, retry.detail])

  function resetMatch() {
    setMatches([])
    setMatchKey('')
    setDetail(null)
    setLoading(null)
    setError('')
  }

  return (
    <main className="container mx-auto min-w-0 space-y-4 px-2 py-4 sm:space-y-6 sm:px-6 sm:py-6">
      <div>
        <h1 className="text-3xl font-bold">Matches</h1>
        <p className="text-muted-foreground">Look up a completed match by team and see every recorded game.</p>
      </div>
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-3 sm:gap-4 sm:p-6 md:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <label htmlFor="match-team" className="text-sm font-medium">Team</label>
            <Select value={team} disabled={!teams.length} onValueChange={value => {
              resetMatch()
              setTeam(value)
            }}>
              <SelectTrigger id="match-team"><SelectValue placeholder="The Wrecking Crew" /></SelectTrigger>
              <SelectContent>
                {teams.map(t => <SelectItem key={t.key} value={t.key} disabled={t.key === opponent}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-2">
            <label htmlFor="match-opponent" className="text-sm font-medium">Opponent</label>
            <Select value={opponent} disabled={!teams.length} onValueChange={value => {
              resetMatch()
              setOpponent(value)
            }}>
              <SelectTrigger id="match-opponent"><SelectValue placeholder="Choose an opponent" /></SelectTrigger>
              <SelectContent>
                {teams.filter(t => t.key !== team).map(t => <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {matches.length > 0 && (
            <div className="min-w-0 space-y-2 md:col-span-2">
              <label htmlFor="match-result" className="text-sm font-medium">Recent matches</label>
              <Select value={matchKey} onValueChange={value => { setDetail(null); setMatchKey(value) }}>
                <SelectTrigger id="match-result"><SelectValue placeholder="Choose a match" /></SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-2rem)]">
                  {matches.map(match => (
                    <SelectItem key={match.key} value={match.key} className="whitespace-normal">
                      {matchLabel(match)} · {teamName(match.away)} at {teamName(match.home)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {loading && <p role="status" className="text-sm text-muted-foreground md:col-span-2">Loading {loading === 'detail' ? 'match results' : loading}…</p>}
          {error && <p role="alert" className="text-sm text-destructive md:col-span-2">{error} <button type="button" className="underline" onClick={() => {
            const section = matchKey ? 'detail' : opponent ? 'matches' : 'teams'
            setRetry(previous => ({ ...previous, [section]: previous[section] + 1 }))
          }}>Retry</button></p>}
          {!loading && !error && opponent && !matches.length && <p className="text-sm text-muted-foreground md:col-span-2">No completed matches found between these teams.</p>}
        </CardContent>
      </Card>
      {detail && (
        <>
          <Card>
            <CardHeader className="p-3 sm:p-6">
              <CardTitle className="text-lg leading-snug sm:text-2xl">{teamName(detail.away)} at {teamName(detail.home)}</CardTitle>
              <p className="text-sm text-muted-foreground">{matchLabel(detail)}</p>
            </CardHeader>
            <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
              <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div><p className="text-sm text-muted-foreground">Away · {teamName(detail.away)}</p><p className="text-3xl font-bold tabular-nums">{number(detail.points.away)}</p></div>
                <div><p className="text-sm text-muted-foreground">Home · {teamName(detail.home)}</p><p className="text-3xl font-bold tabular-nums">{number(detail.points.home)}</p></div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Recorded game points. Match bonuses and later adjustments are not included.</p>
            </CardContent>
          </Card>
          {!detail.rounds.length && <p className="text-muted-foreground">No game scores are available for this match.</p>}
          {detail.rounds.map(round => (
            <Card key={round.number}>
              <CardHeader className="p-3 sm:p-6">
                <CardTitle className="text-lg sm:text-2xl">Round {round.number}{round.type && ` · ${round.type}`}</CardTitle>
                <p className="text-sm text-muted-foreground">{detail.away} {number(round.points.away)} · {detail.home} {number(round.points.home)} points</p>
              </CardHeader>
              <CardContent className="px-0 pb-0 sm:px-6 sm:pb-6">
                <Table className="table-fixed text-xs sm:text-sm">
                  <colgroup>
                    <col />
                    <col className="w-11 sm:w-[14%]" />
                    <col className="w-[36%] sm:w-[27%]" />
                    <col className="w-12 sm:w-[13%]" />
                  </colgroup>
                  <TableHeader><TableRow>
                    <TableHead scope="col" className="h-8 px-2 sm:px-4">Player</TableHead>
                    <TableHead scope="col" className="h-8 px-1 sm:px-4">Team</TableHead>
                    <TableHead scope="col" className="h-8 px-1 text-right sm:px-4">Score</TableHead>
                    <TableHead scope="col" className="h-8 px-2 text-right sm:px-4">Points</TableHead>
                  </TableRow></TableHeader>
                  {round.games.map(game => (
                    <tbody key={game.number}>
                      <TableRow>
                        <th colSpan={4} scope="rowgroup" className="bg-muted/40 px-2 py-2 text-left font-medium sm:px-4">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                            <span className="min-w-0 break-words">Game {game.number} · <Link href={`/machines/${encodeURIComponent(game.machine)}`} className="hover:underline">{display(game.machine)}</Link></span>
                            <span className="whitespace-nowrap text-muted-foreground tabular-nums">{detail.away} {number(game.points.away)} · {detail.home} {number(game.points.home)}</span>
                          </div>
                        </th>
                      </TableRow>
                        {game.players.map(player => <TableRow key={player.slot}>
                          <TableCell className="break-words px-2 py-2 sm:px-4">{player.name}{player.picked && <span className="ml-1 whitespace-nowrap text-[10px] text-muted-foreground sm:text-xs">Pick</span>}</TableCell>
                          <TableCell className="break-words px-1 py-2 sm:px-4">{player.team || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap px-1 py-2 text-right tabular-nums sm:px-4">{number(player.score)}</TableCell>
                          <TableCell className="whitespace-nowrap px-2 py-2 text-right tabular-nums sm:px-4">{number(player.points)}</TableCell>
                        </TableRow>)}
                    </tbody>
                  ))}
                </Table>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </main>
  )
}

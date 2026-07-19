'use client'

import { useState, useEffect, useMemo } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PlayerCombobox } from '@/components/ui/player-combobox'
import { Loader2, RefreshCw, Wand2, Link2, Unlink } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

interface SubLink {
  slug_key: string
  sub_name: string
  stripped_name: string
  linked_player_key: string | null
  linked_player_name: string | null
  status: string // unlinked | linked | no_match
  auto: boolean
  game_count: number
  candidates: { player_key: string; player_name: string }[]
  updated_at: string | null
  updated_by: string | null
}

interface SubLinkLog {
  id: number
  slug_key: string
  sub_name: string | null
  action: string
  from_player_name: string | null
  to_player_name: string | null
  games_updated: number
  performed_by: string | null
  created_at: string
}

interface PlayerRef { player_key: string; player_name: string }

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SubLinkManager({ open, onOpenChange }: Props) {
  const [links, setLinks] = useState<SubLink[]>([])
  const [log, setLog] = useState<SubLinkLog[]>([])
  const [players, setPlayers] = useState<PlayerRef[]>([])
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState<string | null>(null) // slug_key or global action
  const [search, setSearch] = useState('')
  const [needsMigration, setNeedsMigration] = useState(false)
  // Per-row manual selection (slug_key -> chosen real player name)
  const [manual, setManual] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) loadData()
  }, [open])

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sub-links?players=true')
      const data = await res.json()
      setLinks(data.links || [])
      setLog(data.log || [])
      setPlayers(data.players || [])
      setNeedsMigration(!!data.needsMigration)
    } catch (e) {
      console.error('Error loading sub-links:', e)
    } finally {
      setLoading(false)
    }
  }

  const post = async (payload: any, workingKey: string) => {
    setWorking(workingKey)
    try {
      const res = await authFetch('/api/sub-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`Error: ${err.error || res.statusText}`)
        return false
      }
      await loadData()
      return true
    } catch (e) {
      console.error('Sub-link action failed:', e)
      alert('Action failed. Check console.')
      return false
    } finally {
      setWorking(null)
    }
  }

  const playerNames = useMemo(() => players.map(p => p.player_name), [players])
  const nameToKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of players) if (!m.has(p.player_name)) m.set(p.player_name, p.player_key)
    return m
  }, [players])

  const counts = useMemo(() => {
    let linked = 0, unlinked = 0, noMatch = 0, autoLinkable = 0
    for (const l of links) {
      if (l.status === 'linked') linked++
      else if (l.status === 'no_match') noMatch++
      else { unlinked++; if ((l.candidates || []).length === 1) autoLinkable++ }
    }
    return { linked, unlinked, noMatch, autoLinkable }
  }, [links])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return links
    return links.filter(l =>
      l.sub_name.toLowerCase().includes(q) ||
      (l.linked_player_name || '').toLowerCase().includes(q) ||
      l.status.toLowerCase().includes(q)
    )
  }, [links, search])

  const doLink = (slug: string, name: string) => {
    const key = nameToKey.get(name)
    if (!key) { alert('Pick a player from the list.'); return }
    post({ action: 'link', slug_key: slug, player_key: key, player_name: name }, slug)
  }

  const statusBadge = (l: SubLink) => {
    if (l.status === 'linked') return <Badge className="bg-green-600 hover:bg-green-600">linked</Badge>
    if (l.status === 'no_match') return <Badge variant="secondary">no match</Badge>
    if ((l.candidates || []).length > 1) return <Badge className="bg-orange-500 hover:bg-orange-500">review ({l.candidates.length})</Badge>
    return <Badge variant="outline">unlinked</Badge>
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sub Player Links</DialogTitle>
          <DialogDescription>
            Legacy substitute appearances (seasons 5–12) were sometimes stored under a throwaway key
            instead of the player&apos;s real one, so those games don&apos;t count toward them. Link each to the
            real player — the &quot;(sub)&quot; marker is preserved, and every link is reversible.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
        ) : needsMigration ? (
          <div className="space-y-4">
            <div className="border rounded-lg p-4 bg-yellow-500/10 text-sm">
              The <code>player_sub_links</code> tables don&apos;t exist yet. Run
              <code className="mx-1">scripts/create-player-sub-links.sql</code> in Supabase, then Scan.
            </div>
            <Button onClick={() => post({ action: 'scan' }, 'scan')} disabled={working === 'scan'}>
              {working === 'scan' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Scan for sub links
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge className="bg-green-600 hover:bg-green-600">{counts.linked} linked</Badge>
                <Badge variant="outline">{counts.unlinked} unlinked</Badge>
                <Badge variant="secondary">{counts.noMatch} no match</Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => post({ action: 'scan' }, 'scan')} disabled={!!working}>
                  {working === 'scan' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Rescan
                </Button>
                <Button
                  size="sm"
                  onClick={() => post({ action: 'auto' }, 'auto')}
                  disabled={!!working || counts.autoLinkable === 0}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {working === 'auto' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                  Auto-link all ({counts.autoLinkable})
                </Button>
              </div>
            </div>

            <Tabs defaultValue="links">
              <TabsList>
                <TabsTrigger value="links">Links ({links.length})</TabsTrigger>
                <TabsTrigger value="history">History ({log.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="links" className="space-y-2">
                <Input placeholder="Search sub name, linked player, or status…" value={search} onChange={e => setSearch(e.target.value)} />
                <ScrollArea className="h-[420px] border rounded-lg">
                  <div className="divide-y">
                    {filtered.map((l) => (
                      <div key={l.slug_key} className="p-3 flex flex-wrap items-center gap-3">
                        <div className="min-w-[180px] flex-1">
                          <div className="font-medium">{l.sub_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {l.game_count} game{l.game_count !== 1 ? 's' : ''}
                            {l.status === 'linked' && l.linked_player_name && (
                              <> · → <span className="text-foreground">{l.linked_player_name}</span>{l.auto ? ' (auto)' : ''}</>
                            )}
                          </div>
                        </div>
                        <div>{statusBadge(l)}</div>
                        <div className="flex items-center gap-2 min-w-[280px]">
                          {l.status === 'linked' ? (
                            <Button variant="outline" size="sm" onClick={() => post({ action: 'unlink', slug_key: l.slug_key }, l.slug_key)} disabled={working === l.slug_key}>
                              {working === l.slug_key ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Unlink className="h-4 w-4 mr-1" />Unlink</>}
                            </Button>
                          ) : (
                            <>
                              {(l.candidates || []).length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {l.candidates.map((c) => (
                                    <Button
                                      key={c.player_key}
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() => post({ action: 'link', slug_key: l.slug_key, player_key: c.player_key, player_name: c.player_name }, l.slug_key)}
                                      disabled={working === l.slug_key}
                                    >
                                      <Link2 className="h-3 w-3 mr-1" />{c.player_name}
                                    </Button>
                                  ))}
                                </div>
                              )}
                              <div className="w-[200px]">
                                <PlayerCombobox
                                  players={playerNames}
                                  value={manual[l.slug_key] || ''}
                                  onValueChange={(v) => setManual({ ...manual, [l.slug_key]: v })}
                                  placeholder="link to…"
                                  disabled={working === l.slug_key}
                                />
                              </div>
                              {manual[l.slug_key] && (
                                <Button size="sm" className="h-7" onClick={() => doLink(l.slug_key, manual[l.slug_key])} disabled={working === l.slug_key}>
                                  Link
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {filtered.length === 0 && (
                      <div className="p-6 text-center text-sm text-muted-foreground">No matching sub links.</div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="history">
                <ScrollArea className="h-[440px] border rounded-lg">
                  <div className="divide-y text-sm">
                    {log.map((e) => (
                      <div key={e.id} className="p-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground w-[140px]">{new Date(e.created_at).toLocaleString()}</span>
                        <Badge variant="outline" className="text-xs">{e.action}</Badge>
                        <span className="font-medium">{e.sub_name || e.slug_key}</span>
                        {e.to_player_name && <span className="text-muted-foreground">→ {e.to_player_name}</span>}
                        {e.action === 'unlink' && e.from_player_name && <span className="text-muted-foreground">was {e.from_player_name}</span>}
                        {e.games_updated > 0 && <span className="text-xs text-muted-foreground">({e.games_updated} games)</span>}
                        {e.performed_by && <span className="text-xs text-muted-foreground ml-auto">{e.performed_by}</span>}
                      </div>
                    ))}
                    {log.length === 0 && <div className="p-6 text-center text-muted-foreground">No history yet.</div>}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

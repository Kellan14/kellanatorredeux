'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { AlexLoader } from '@/components/alex-loader'
import { authFetch } from '@/lib/auth-fetch'
import {
  normalizeIdentity,
  suggestMachine,
  publishedIdentity,
  type MachineIdentity,
} from '@/lib/machine-canon-plans'

interface CanonMachine extends MachineIdentity {
  displayName: string
}
interface Alias {
  alias: string
  alias_raw: string | null
  canon_key: string
}
interface Issue {
  raw_value: string
  table_name: string
  occurrences: number
  issue_type: string
  suggested_key: string | null
  seasons: string | null
  venues: string | null
}
interface SyncItem {
  key: string
  name: string
  previousKey: string | null
  action: string
  error?: string
}
interface History {
  batch_id: string
  applied_at: string
  description: string
  reason: string
  source: string
  rows_affected: number
  details: unknown
}
const PAGE_SIZE = 25

export function MachineMappingManager({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [machines, setMachines] = useState<CanonMachine[]>([])
  const [aliases, setAliases] = useState<Alias[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [upstream, setUpstream] = useState<MachineIdentity[]>([])
  const [syncPlan, setSyncPlan] = useState<SyncItem[]>([])
  const [history, setHistory] = useState<History[]>([])
  const [scannedAt, setScannedAt] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selectionPage, setSelectionPage] = useState(0)
  const [selectionSearch, setSelectionSearch] = useState('')
  const [tab, setTab] = useState<'review' | 'canon' | 'edit' | 'history'>(
    'review',
  )
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editingReady, setEditingReady] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [shortName, setShortName] = useState('')
  const [longName, setLongName] = useState('')
  const [source, setSource] = useState<'local' | 'mnp'>('local')
  const [previousKey, setPreviousKey] = useState('')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const resultsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0
  }, [tab, page])

  useEffect(() => {
    if (open) void load()
  }, [open])
  useEffect(() => {
    setPage(0)
  }, [tab, search])
  useEffect(() => {
    setSelectionPage(0)
  }, [selectionSearch])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const responses = await Promise.all([
        fetch('/api/machine-mappings', { cache: 'no-store' }),
        fetch('/api/machine-name-issues', { cache: 'no-store' }),
      ])
      if (responses.some((res) => !res.ok))
        throw new Error('Could not load the machine canon. Try again.')
      const [canon, scan] = await Promise.all(
        responses.map((res) => res.json()),
      )
      setMachines(canon.machines || [])
      setEditingReady(canon.editingReady === true)
      setAliases(canon.aliases || [])
      setUpstream(canon.upstream || [])
      setSyncPlan(canon.syncPlan || [])
      setHistory(canon.history || [])
      setIssues(scan.issues || [])
      setScannedAt(scan.scannedAt || null)
      if (canon.upstreamError)
        setError(
          'MNP data is unavailable. Retry before adopting official names.',
        )
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function rescan() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/machine-name-issues?refresh=true', {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')
      setIssues(data.issues || [])
      setScannedAt(data.scannedAt || null)
      setPage(0)
      setNotice('Scan complete. Select entries to review or combine.')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function submit(action: 'save' | 'sync') {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await authFetch('/api/machine-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'sync'
            ? { action: 'sync' }
            : {
                key: shortName,
                name: longName,
                source,
                previousKey: previousKey || null,
                rawValues: selected,
                reason,
              },
        ),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the canon')
      if (action === 'sync')
        setNotice(
          `${data.applied.length} MNP updates applied. ${data.review.length} need review.${data.review[0]?.error ? ` ${data.review[0].error}` : ''}`,
        )
      else {
        setNotice(
          `Saved ${data.result.name} (${data.result.key}); ${data.result.rowsAffected} source rows updated. Change recorded in history.`,
        )
        setSelected([])
        setShortName('')
        setLongName('')
        setPreviousKey('')
        setReason('')
        setTab('canon')
      }
      window.dispatchEvent(new Event('machine-canon-updated'))
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const unknown = Array.from(
    new Set(
      issues.filter((i) => i.issue_type === 'unmapped').map((i) => i.raw_value),
    ),
  ).sort((a, b) => a.localeCompare(b))
  const locals = machines.filter((m) => m.source === 'local')
  const q = normalizeIdentity(search)
  const matches = (value: string) => !q || value.toLowerCase().includes(q)
  const shownMachines = machines.filter((m) =>
    matches(
      `${m.key} ${m.displayName} ${aliases
        .filter((a) => a.canon_key === m.key)
        .map((a) => a.alias_raw || a.alias)
        .join(' ')}`,
    ),
  )
  const reviewIssues = issues.filter((i) =>
    matches(`${i.raw_value} ${i.table_name} ${i.venues || ''}`),
  )
  const shownHistory = history.filter((h) =>
    matches(`${h.description} ${h.reason} ${h.source}`),
  )
  const count =
    tab === 'canon'
      ? shownMachines.length
      : tab === 'history'
        ? shownHistory.length
        : reviewIssues.length
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const activePage = Math.min(page, pages - 1)
  const pageItems = <T,>(items: T[]) =>
    items.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE)
  const selectable = unknown.filter(
    (v) =>
      !selectionSearch ||
      v.toLowerCase().includes(selectionSearch.toLowerCase()),
  )
  const selectionPages = Math.max(1, Math.ceil(selectable.length / PAGE_SIZE))
  const selectedPage = Math.min(selectionPage, selectionPages - 1)

  function toggle(value: string, checked: boolean) {
    setSelected((prev) =>
      checked
        ? Array.from(new Set([...prev, value]))
        : prev.filter((v) => v !== value),
    )
  }
  function suggestionLabel(raw: string) {
    const proposed = suggestMachine([raw], upstream, machines)
    return `${proposed.source === 'mnp' ? 'MNP names' : 'Provisional suggestion'}: ${proposed.name} (${proposed.key})`
  }
  function propose(values = selected) {
    const suggestion = suggestMachine(values, upstream, machines)
    setSelected(values)
    setShortName(suggestion.key)
    setLongName(suggestion.name)
    setSource(suggestion.source)
    setEvidence(suggestion.evidence)
    setPreviousKey('')
    setReason(
      suggestion.source === 'local'
        ? 'Provisional names based on selected source entries, pending publication by MNP.'
        : 'Use the short and long forms published by MNP for these selected source entries.',
    )
    setTab('edit')
  }
  function adopt(item: SyncItem, keepSelection = false) {
    setShortName(item.key)
    setLongName(item.name)
    setSource('mnp')
    setPreviousKey(item.previousKey || '')
    if (!keepSelection)
      setSelected(
        unknown.filter(
          (v) =>
            normalizeIdentity(v) === normalizeIdentity(item.key) ||
            normalizeIdentity(v) === normalizeIdentity(item.name),
        ),
      )
    setEvidence(
      'Published MNP names. Select a provisional record only if it is this same machine.',
    )
    setReason(
      'Adopt the official MNP short and long forms, preserving previous names as aliases.',
    )
    setTab('edit')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] max-h-[90dvh] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-3 overflow-hidden p-4 sm:gap-4 sm:p-6">
        <DialogHeader className="shrink-0 pr-5">
          <DialogTitle>Machine Canon</DialogTitle>
          <DialogDescription>
            <span className="sm:hidden">
              Suggest names, combine entries, and adopt MNP updates.
            </span>
            <span className="hidden sm:inline">
              Full names are displayed sitewide; APIs use short forms. New
              machines can use provisional names until MNP publishes its canon.
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
          <span>
            {machines.length} machines · {locals.length} provisional ·{' '}
            {unknown.length} uncanonized spellings
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || loading}
            onClick={rescan}
          >
            Rescan
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || loading || !upstream.length || !editingReady}
            onClick={() => submit('sync')}
          >
            Sync MNP ({syncPlan.length})
          </Button>
          {scannedAt && (
            <span className="hidden text-muted-foreground sm:inline">
              Scanned {new Date(scannedAt).toLocaleString()}
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="shrink-0 break-words text-sm text-red-600">
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="max-h-16 shrink-0 overflow-auto break-words text-xs sm:text-sm"
          >
            {notice}
          </p>
        )}
        {!loading && !editingReady && (
          <p className="shrink-0 text-xs text-muted-foreground">
            Canon editing is temporarily unavailable. You can still review
            entries and suggestions.
          </p>
        )}
        <div
          className="grid shrink-0 grid-cols-4 gap-1 sm:flex sm:gap-2"
          aria-label="Canon sections"
        >
          {(['review', 'canon', 'edit', 'history'] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={tab === t ? 'default' : 'outline'}
              className="px-1 text-xs sm:px-3 sm:text-sm"
              onClick={() => {
                setTab(t)
                setNotice('')
              }}
            >
              {t === 'review' ? (
                'Review'
              ) : t === 'edit' ? (
                <>
                  <span className="sm:hidden">Create</span>
                  <span className="hidden sm:inline">Create / combine</span>
                </>
              ) : t === 'history' ? (
                'History'
              ) : (
                'Canon'
              )}
            </Button>
          ))}
        </div>
        {tab !== 'edit' && (
          <Input
            aria-label="Search canon results"
            className="shrink-0"
            placeholder="Search names, spellings, or context…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        <div
          ref={resultsRef}
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
          data-testid="machine-canon-results"
        >
          {loading ? (
            <div className="flex justify-center p-8">
              <AlexLoader />
            </div>
          ) : tab === 'review' ? (
            <div className="space-y-4">
              {syncPlan
                .filter((p) => matches(`${p.key} ${p.name}`))
                .map((item) => (
                  <div
                    key={item.key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
                  >
                    <div className="min-w-0 break-words">
                      <strong>{item.name}</strong>{' '}
                      <span className="font-mono">{item.key}</span>
                      <p className="text-xs text-muted-foreground">
                        {item.action === 'promote'
                          ? `Replaces provisional ${item.previousKey}`
                          : item.action === 'review'
                            ? 'Possible provisional match — review identity'
                            : 'Published MNP update'}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => adopt(item)}
                    >
                      Review / adopt
                    </Button>
                  </div>
                ))}
              {pageItems(reviewIssues).map((issue, index) => (
                <div
                  key={`${issue.table_name}-${issue.raw_value}-${index}`}
                  className="flex items-start gap-2 rounded border p-3 text-sm"
                >
                  {issue.issue_type === 'unmapped' && (
                    <input
                      aria-label={`Select ${issue.raw_value} from ${issue.table_name}`}
                      type="checkbox"
                      checked={selected.includes(issue.raw_value)}
                      onChange={(e) =>
                        toggle(issue.raw_value, e.target.checked)
                      }
                      className="mt-1"
                    />
                  )}
                  <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                    <strong>{issue.raw_value}</strong>
                    <p className="text-xs text-muted-foreground">
                      {issue.table_name} · {issue.occurrences} rows{' '}
                      {issue.seasons} {issue.venues}
                    </p>
                    {issue.suggested_key && (
                      <p>Resolves to {issue.suggested_key}</p>
                    )}
                    {issue.issue_type === 'unmapped' && (
                      <p className="mt-1 text-xs">
                        {suggestionLabel(issue.raw_value)}
                      </p>
                    )}
                  </div>
                  {issue.issue_type === 'unmapped' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        propose(
                          unknown.filter(
                            (v) =>
                              normalizeIdentity(v) ===
                              normalizeIdentity(issue.raw_value),
                          ),
                        )
                      }
                    >
                      Suggest
                    </Button>
                  )}
                </div>
              ))}
              {!reviewIssues.length && !syncPlan.length && (
                <p className="p-4 text-sm">
                  No matching findings. Rescan to check the latest data.
                </p>
              )}
            </div>
          ) : tab === 'canon' ? (
            <table className="w-full table-fixed text-sm">
              <thead className="sticky top-0 bg-background">
                <tr>
                  <th className="w-1/4 p-2 text-left">Short form</th>
                  <th className="w-1/3 p-2 text-left">Long form</th>
                  <th className="p-2 text-left">Aliases</th>
                </tr>
              </thead>
              <tbody>
                {pageItems(shownMachines).map((machine) => (
                  <tr key={machine.key} className="border-b align-top">
                    <td className="break-words p-2 font-mono [overflow-wrap:anywhere]">
                      {machine.key}
                      <div>
                        <Badge variant="outline">
                          {machine.source === 'local' ? 'Provisional' : 'MNP'}
                        </Badge>
                      </div>
                    </td>
                    <td className="break-words p-2 [overflow-wrap:anywhere]">
                      {machine.displayName}
                    </td>
                    <td className="break-words p-2 text-xs [overflow-wrap:anywhere]">
                      {aliases
                        .filter((a) => a.canon_key === machine.key)
                        .map((a) => a.alias_raw || a.alias)
                        .join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === 'history' ? (
            <div className="space-y-3">
              {pageItems(shownHistory).map((entry) => (
                <details
                  key={entry.batch_id + entry.applied_at}
                  className="rounded border p-3 text-sm"
                >
                  <summary className="cursor-pointer break-words">
                    {entry.description} ·{' '}
                    {new Date(entry.applied_at).toLocaleString()}
                  </summary>
                  <p className="mt-2 break-words">{entry.reason}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    {entry.source} · {entry.rows_affected} rows
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap break-all text-xs">
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                </details>
              ))}
              {!shownHistory.length && (
                <p className="p-4 text-sm">No matching canon changes.</p>
              )}
            </div>
          ) : (
            <div className="space-y-4 p-1">
              <p className="text-sm">
                Select only spellings of the same physical game. Suggestions are
                editable; similar titles are never combined automatically.
              </p>
              <div className="flex flex-wrap gap-2">
                {selected.map((value) => (
                  <button
                    key={value}
                    className="max-w-full break-all rounded border px-2 py-1 text-xs"
                    onClick={() => toggle(value, false)}
                  >
                    {value} ×
                  </button>
                ))}
              </div>
              <Input
                aria-label="Search uncanonized entries"
                placeholder="Find existing uncanonized entries to combine…"
                value={selectionSearch}
                onChange={(e) => setSelectionSearch(e.target.value)}
              />
              <div className="space-y-2 rounded border p-3">
                {selectable
                  .slice(
                    selectedPage * PAGE_SIZE,
                    (selectedPage + 1) * PAGE_SIZE,
                  )
                  .map((value) => (
                    <label
                      key={value}
                      className="flex items-start gap-2 break-all text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(value)}
                        onChange={(e) => toggle(value, e.target.checked)}
                      />
                      <span>{value}</span>
                    </label>
                  ))}
                {!selectable.length && (
                  <p className="text-sm">No matching uncanonized entries.</p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedPage === 0}
                    onClick={() => setSelectionPage(selectedPage - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-xs">
                    {selectedPage + 1} / {selectionPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedPage + 1 >= selectionPages}
                    onClick={() => setSelectionPage(selectedPage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
              <Button
                variant="outline"
                disabled={!selected.length}
                onClick={() => propose()}
              >
                Suggest names from {selected.length} selected entries
              </Button>
              {evidence && (
                <p className="text-xs text-muted-foreground">{evidence}</p>
              )}
              <label className="block text-sm">
                Name source
                <select
                  className="mt-1 block w-full rounded border bg-background p-2"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value as 'mnp' | 'local')
                    setPreviousKey('')
                  }}
                >
                  <option value="local">
                    Provisional — MNP has not listed it
                  </option>
                  <option value="mnp">Published MNP canon</option>
                </select>
              </label>
              {source === 'mnp' && (
                <>
                  <label className="block text-sm">
                    Official MNP entry
                    <select
                      className="mt-1 block w-full rounded border bg-background p-2"
                      value={shortName}
                      onChange={(e) => {
                        const item = upstream.find(
                          (m) => publishedIdentity(m).key === e.target.value,
                        )
                        if (item)
                          adopt(
                            {
                              ...publishedIdentity(item),
                              previousKey: null,
                              action: 'review',
                            },
                            true,
                          )
                      }}
                    >
                      <option value="">Select a published machine…</option>
                      {upstream.map((m) => (
                        <option key={m.key} value={publishedIdentity(m).key}>
                          {m.name} ({m.key})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Provisional machine to replace (optional)
                    <select
                      className="mt-1 block w-full rounded border bg-background p-2"
                      value={previousKey}
                      onChange={(e) => setPreviousKey(e.target.value)}
                    >
                      <option value="">No provisional record to replace</option>
                      {locals.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.displayName} ({m.key})
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Short form
                  <Input
                    value={shortName}
                    readOnly={source === 'mnp'}
                    onChange={(e) => setShortName(e.target.value)}
                    maxLength={64}
                  />
                </label>
                <label className="text-sm">
                  Long form (displayed sitewide)
                  <Input
                    value={longName}
                    readOnly={source === 'mnp'}
                    onChange={(e) => setLongName(e.target.value)}
                    maxLength={200}
                  />
                </label>
              </div>
              <label className="block text-sm">
                Reason / evidence
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={2000}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Saving combines the selected spellings under this short form.
                Original game names and every change are kept in the audit log.
                Official MNP names can replace provisional names later,
                retaining temporary names as aliases. Conflicting saved settings
                require review. Statistics caches for renamed keys are rebuilt
                by the next data sync.
              </p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-3">
          {tab === 'edit' ? (
            <>
              <span className="text-xs">
                {selected.length} selected · Admin access required to save
              </span>
              <Button
                disabled={
                  busy ||
                  !editingReady ||
                  !shortName ||
                  !longName.trim() ||
                  !reason.trim()
                }
                onClick={() => submit('save')}
              >
                {busy
                  ? 'Saving…'
                  : source === 'mnp'
                    ? 'Adopt MNP canon'
                    : 'Create provisional canon'}
              </Button>
            </>
          ) : (
            <>
              <span className="text-xs">
                {count} results · Page {activePage + 1} of {pages}
              </span>
              {tab === 'review' && selected.length > 0 && (
                <Button size="sm" onClick={() => propose()}>
                  Combine {selected.length} selected
                </Button>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={activePage === 0}
                  onClick={() => setPage(activePage - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={activePage + 1 >= pages}
                  onClick={() => setPage(activePage + 1)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

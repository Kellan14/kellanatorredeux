'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * /reset — clears this site's cached data in the current browser only.
 *
 * Mobile browsers (Chrome on iOS in particular) can't clear one site's data,
 * so this page does it from inside the site. Visiting it clears the data
 * caches (the `mnp:` localStorage keys, sessionStorage, Cache Storage and any
 * service worker). Saved settings — Strategy sliders, added subs, collapsed
 * panels — are kept unless the second button is pressed.
 */

const CACHE_PREFIX = 'mnp:'

async function clearDataCaches(): Promise<string[]> {
  const cleared: string[] = []

  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key)
    }
    keys.forEach((key) => window.localStorage.removeItem(key))
    cleared.push(`${keys.length} cached data set${keys.length === 1 ? '' : 's'}`)
  } catch {
    /* storage blocked — nothing to clear */
  }

  try {
    window.sessionStorage.clear()
    cleared.push('session data')
  } catch {
    /* ignore */
  }

  try {
    if ('caches' in window) {
      const names = await window.caches.keys()
      await Promise.all(names.map((name) => window.caches.delete(name)))
      if (names.length > 0) cleared.push(`${names.length} browser cache${names.length === 1 ? '' : 's'}`)
    }
  } catch {
    /* ignore */
  }

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((reg) => reg.unregister()))
      if (regs.length > 0) cleared.push(`${regs.length} service worker${regs.length === 1 ? '' : 's'}`)
    }
  } catch {
    /* ignore */
  }

  return cleared
}

export default function ResetPage() {
  const [status, setStatus] = useState<'working' | 'done'>('working')
  const [cleared, setCleared] = useState<string[]>([])
  const [settingsCleared, setSettingsCleared] = useState(false)

  useEffect(() => {
    clearDataCaches().then((result) => {
      setCleared(result)
      setStatus('done')
    })
  }, [])

  const clearSettings = () => {
    try {
      window.localStorage.clear()
    } catch {
      /* ignore */
    }
    setSettingsCleared(true)
  }

  return (
    <div className="container py-8 px-4 md:px-6 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Reset this site</CardTitle>
          <CardDescription>
            Clears this site&apos;s saved data in this browser only. Other websites are not touched.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'working' ? (
            <p className="text-muted-foreground">Clearing cached data…</p>
          ) : (
            <p>
              Cached data cleared{cleared.length > 0 ? `: ${cleared.join(', ')}` : ''}. Your saved
              settings were kept.
            </p>
          )}

          {/* Plain <a> links force a full page load, so no in-memory cache survives. */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild>
              <a href="/player-profile">Go to Player Profile</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/">Go to Dashboard</a>
            </Button>
          </div>

          <div className="border-t pt-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              Still broken? This also clears saved settings: Strategy sliders, added subs, sat-out
              players and collapsed panels.
            </p>
            <Button variant="destructive" onClick={clearSettings} disabled={settingsCleared}>
              {settingsCleared ? 'Settings cleared' : 'Also clear my saved settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

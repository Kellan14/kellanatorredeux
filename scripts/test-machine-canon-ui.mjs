import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'

// Optional local tooling path keeps browser-test dependencies out of the app.
const require = createRequire(import.meta.url)
const { chromium } = require(process.argv[2] || 'playwright')
const machines = Array.from({ length: 350 }, (_, i) => ({
  key: `Game${i}`,
  name: `Canon Machine ${i}`,
  displayName: `Canon Machine ${i}`,
  source: i < 10 ? 'local' : 'mnp',
}))
const issues = Array.from({ length: 260 }, (_, i) => ({
  raw_value: `Source spelling ${String(i).padStart(3, '0')}`,
  table_name: 'games',
  column_name: 'machine',
  occurrences: 100 - i,
  issue_type: 'unmapped',
  suggested_key: null,
  venues: 'A venue with a very long name for wrapping checks, Another venue',
  seasons: 's20-s24',
}))
const upstream = Array.from({ length: 40 }, (_, i) => ({
  key: `OFFICIAL${i}`,
  name: `Official Machine ${i}`,
}))
const syncPlan = upstream.map((m, i) => ({
  ...m,
  previousKey: i === 0 ? 'Game0' : null,
  action: i === 0 ? 'promote' : 'add',
}))
const history = Array.from({ length: 50 }, (_, i) => ({
  batch_id: `batch-${i}`,
  applied_at: '2026-10-19T12:00:00Z',
  description: `Canon change ${i}`,
  reason: 'Reviewed evidence',
  source: 'MNP',
  rows_affected: 25,
  details: { from: 'Temporary', to: 'Official' },
}))
const browser = await chromium.launch({
  headless: true,
  executablePath:
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})
try {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 375, height: 667 },
  ]) {
    const page = await browser.newPage({ viewport })
    let saved
    await page.route('**/api/machine-mappings', async (route) => {
      if (route.request().method() === 'POST') {
        saved = route.request().postDataJSON()
        return route.fulfill({
          json: {
            result: { key: saved.key, name: saved.name, rowsAffected: 2 },
          },
        })
      }
      return route.fulfill({
        json: {
          machines,
          editingReady: true,
          aliases: machines.map((m) => ({
            canon_key: m.key,
            alias: `alias-${m.key}`,
            alias_raw: `a very long alias for ${m.name}`,
          })),
          upstream,
          syncPlan,
          history,
        },
      })
    })
    await page.route('**/api/machine-name-issues*', (route) =>
      route.fulfill({
        json: { issues, actionable: 260, scannedAt: '2026-10-19T12:00:00Z' },
      }),
    )
    await page.goto(
      (process.env.TEST_BASE_URL || 'http://localhost:3102') + '/options',
    )
    await page
      .getByRole('button', { name: /Machine Canon Short and long/ })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('350 machines', { exact: false }).waitFor()
    const box = await dialog.boundingBox()
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width + 1 &&
        box.y + box.height <= viewport.height + 1,
      'Dialog stays within the screen',
    )
    assert.ok(
      await dialog
        .locator('[data-testid="machine-canon-results"]')
        .evaluate((el) => el.scrollHeight > el.clientHeight),
      'Large result sets scroll inside the dialog',
    )
    assert.ok(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      'Long results do not widen the dialog',
    )
    await dialog.getByRole('checkbox').first().check()
    await dialog.getByRole('button', { name: 'Next', exact: true }).click()
    await dialog.getByRole('checkbox').first().check()
    await dialog.getByRole('button', { name: 'Combine 2 selected' }).click()
    await dialog.getByLabel('Short form', { exact: true }).fill('TempNewGame')
    await dialog
      .getByLabel('Long form (displayed sitewide)', { exact: true })
      .fill('A Proposed New Game')
    await dialog
      .getByLabel('Reason / evidence')
      .fill('The two selected source spellings represent this same game.')
    await dialog
      .getByRole('button', { name: 'Create provisional canon' })
      .click()
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Saved A Proposed New Game' })
      .waitFor()
    assert.deepEqual(
      saved.rawValues,
      ['Source spelling 000', 'Source spelling 025'],
      'Selections survive pagination and appear in the save payload',
    )
    assert.equal(saved.source, 'local')
    assert.equal(
      await dialog.locator('tbody tr').count(),
      25,
      'Canon results are paginated',
    )
    await dialog.getByRole('button', { name: 'Review', exact: true }).click()
    await dialog
      .getByRole('button', { name: 'Review / adopt', exact: true })
      .first()
      .click()
    assert.equal(
      await dialog.getByLabel('Short form', { exact: true }).inputValue(),
      'OFFICIAL0',
    )
    assert.equal(
      await dialog
        .getByLabel('Provisional machine to replace (optional)')
        .inputValue(),
      'Game0',
    )
    assert.ok(
      (await dialog
        .getByLabel('Long form (displayed sitewide)', { exact: true })
        .isEditable()) === false,
      'Published MNP forms cannot be silently edited',
    )
    const actionBox = await dialog
      .getByRole('button', { name: 'Adopt MNP canon', exact: true })
      .boundingBox()
    assert.ok(
      actionBox.y + actionBox.height <= box.y + box.height + 1,
      'Save control remains inside the dialog on small screens',
    )
    assert.ok(
      await dialog
        .locator('[data-testid="machine-canon-results"]')
        .evaluate((el) => el.clientHeight >= 150),
      'The results retain a usable reading area',
    )
    await page.screenshot({
      path: join(
        process.env.TEMP || '.',
        `machine-canon-${viewport.width}.png`,
      ),
    })
    console.log(
      `${viewport.width}px: large-result scrolling, pagination, selected-entry merge and MNP adoption controls passed`,
    )
    await page.close()
  }
} finally {
  await browser.close()
}

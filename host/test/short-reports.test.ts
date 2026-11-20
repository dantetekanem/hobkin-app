import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { initialize } from 'hobkin/src/cli/config.mjs'
import { COMMANDS, checkArguments } from '../../shared/commands/registry.ts'
import { reportHandlers } from '../src/reports.ts'
import { toWire } from '../src/state-sync.ts'

test('the switch is read and saved through hobkin\'s own functions', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-client-short-reports-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' })
  const handlers = reportHandlers({ app: () => ({ snapshot: { reports: [] }, runtime: { directory: root }, recordReportRead() {} }) })

  assert.deepEqual(await handlers['short-reports.read']!({}), { on: false })
  assert.deepEqual(await handlers['short-reports.set']!({ on: true }), { on: true })
  assert.deepEqual(await handlers['short-reports.read']!({}), { on: true })
  assert.equal(JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')).shortReports.enabled, true)
  assert.deepEqual(await handlers['short-reports.set']!({ on: false }), { on: false })
  assert.deepEqual(await handlers['short-reports.read']!({}), { on: false })

  // Each short version spends a model call, so only the user's click turns it on.
  assert.notEqual((COMMANDS['short-reports.set'] as { hobkin?: boolean }).hobkin, true)
  assert.equal(checkArguments('short-reports.set', {}).ok, false)
  assert.equal(checkArguments('short-reports.set', { on: 'yes' }).ok, false)
  assert.equal(checkArguments('short-reports.set', { on: true }).ok, true)

  // A report carries its short version only when it has one, and the host sends each row as hobkin gave it.
  const reports = [
    { id: 'run:1', title: 'Import', body: 'Useful: The long report.', outcome: 'completed', short: 'The point.' },
    { id: 'run:2', title: 'Import', body: 'Useful: A report from an older hobkin.', outcome: 'completed' },
  ]
  assert.deepEqual(toWire({ reports }).values.reports, reports)
})

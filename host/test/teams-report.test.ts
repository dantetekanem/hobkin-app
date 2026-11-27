import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runCommand } from '../src/commands.ts'
import { teamsReportHandlers } from '../src/teams-report.ts'
import { temporaryDirectory } from './support.ts'

test("a teams agent's report is read from its group's folder, and only from there", async (t) => {
  const reports = temporaryDirectory(t)
  mkdirSync(join(reports, 'session-abc'))
  writeFileSync(join(reports, 'session-abc', 'logic-lab.md'), '## Logic lab\n\nAll 24 cases are told apart.')
  writeFileSync(join(reports, 'secret.md'), 'Not a report')
  const handlers = teamsReportHandlers({ reports: () => reports })

  const read = await runCommand(handlers, 'teams.report', { team: 'session-abc', file: 'logic-lab.md' })
  const missing = await runCommand(handlers, 'teams.report', { team: 'session-abc', file: 'graph-lab.md' })

  assert.deepEqual(read, { ok: true, value: { text: '## Logic lab\n\nAll 24 cases are told apart.' } })
  assert.deepEqual(missing, { ok: true, value: null }, 'a report teams no longer keeps is no report')
  for (const args of [
    { team: '..', file: 'secret.md' },
    { team: 'session-abc/..', file: 'secret.md' },
    { team: 'session-abc', file: '../secret.md' },
    { team: 'session-abc', file: 'logic-lab.txt' },
  ]) {
    assert.equal((await runCommand(handlers, 'teams.report', args)).ok, false, `refused: ${JSON.stringify(args)}`)
  }
})

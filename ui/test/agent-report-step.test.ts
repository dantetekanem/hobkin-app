import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AGENT_REPORT, type ActivityEntry } from '#shared/protocol/activity.ts'
import { doingNow, stepsOf } from '../src/features/agent-activity/steps.ts'

const report = (id: string, name: string, state: 'completed' | 'failed', summary: string, output: string): ActivityEntry => ({
  id: `tool:report-${id}`,
  kind: 'tool',
  name: AGENT_REPORT,
  state,
  input: JSON.stringify({ name, ok: state === 'completed', summary }),
  output,
})

test("a report one of the agent's agents sent back is a step of its own: who sent it, its summary and the report to open", () => {
  const entries: ActivityEntry[] = [
    { id: 'message:1:0', kind: 'assistant', text: 'Asking two agents.' },
    report('2', 'scout', 'completed', 'The redirect drops the session', '## Findings\nThe redirect drops the cookie.'),
    report('3', 'lint', 'failed', 'Could not run the linter', 'eslint is missing'),
  ]

  const steps = stepsOf(entries)

  assert.deepEqual(
    steps.map((step) => (step.kind === 'report' ? { kind: step.kind, from: step.from, ok: step.ok, summary: step.summary, text: step.text } : { kind: step.kind })),
    [
      { kind: 'says' },
      { kind: 'report', from: 'scout', ok: true, summary: 'The redirect drops the session', text: '## Findings\nThe redirect drops the cookie.' },
      { kind: 'report', from: 'lint', ok: false, summary: 'Could not run the linter', text: 'eslint is missing' },
    ],
  )
})

test("the agent's line says whose report came in last, not that a tool was used", () => {
  const entries = [report('2', 'scout', 'completed', 'Found it', 'Body')]

  assert.deepEqual(doingNow(entries), { lead: 'Report from', subject: 'scout' })
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange, FinishedGroup, FinishedGroupName, YoloPart, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { partGroups, readinessRow, sampleReadiness, waitingChange, yoloAtAGlance } from '../src/features/work/yolo-page.ts'

const NOW = Date.parse('2026-11-20T15:00:00Z')
const project = (change: Partial<YoloProject> = {}): YoloProject => ({
  slug: 'api',
  name: 'api',
  ready: false,
  needs: ['Its readiness has not been checked yet.'],
  work: 'none',
  checkedAt: null,
  ...change,
})
const rowOf = (change: Partial<YoloProject>, workOn = true) => readinessRow(project(change), { workOn, now: NOW, zone: 'UTC' })
const yolo = (projects: YoloProject[], on = true): YoloState => ({ on, rate: 8, lowest: 6, highest: 10, ready: projects.filter(({ ready }) => ready).length, projects })

test("Work's header says at a glance how YOLO mode stands", () => {
  const five = yolo([project({ ready: true }), project({ ready: true }), project(), project(), project()])
  assert.equal(yoloAtAGlance(five), 'On · 2 of 5 ready')
  assert.equal(yoloAtAGlance({ ...five, on: false }), 'Off')
  assert.equal(yoloAtAGlance(yolo([])), 'On')
})

test('a project never checked offers Run readiness, and one checked offers Check again', () => {
  const never = rowOf({})
  assert.deepEqual([never.state, never.action, never.canRun, never.checked], ['Not started', 'Run readiness', true, 'Not checked yet'])

  const ready = rowOf({ ready: true, needs: [], work: 'landed', checkedAt: '2026-11-20T09:30:00Z' })
  assert.deepEqual([ready.state, ready.tone, ready.action, ready.canRun, ready.checked], ['Ready', 'ok', 'Check again', true, 'Checked today 09:30'])

  // What holds YOLO mode back is hobkin's own words.
  const held = rowOf({ needs: ['Tests: its PR waits for your merge.', 'Rollback: waits on you: Keep two releases.'], work: 'landed', checkedAt: '2026-11-19T09:30:00Z' })
  assert.deepEqual([held.state, held.tone, held.detail, held.action, held.canRun], ['Getting ready', 'warn', 'Tests: its PR waits for your merge. Rollback: waits on you: Keep two releases.', 'Check again', true])

  const closed = rowOf({ needs: ['Tests: You said no to its branch.'], work: 'closed', checkedAt: '2026-11-19T09:30:00Z' })
  assert.deepEqual([closed.state, closed.action, closed.canRun], ['Getting ready', 'Check again', true])
})

const PULL = 'https://github.com/acme/api/pull/7'
const part = (name: string, state: YoloPart['state'], change: Partial<YoloPart> = {}): YoloPart => ({ name, label: name, state, line: `What ${name} found.`, needed: false, blocks: false, ...change })
const PARTS: YoloPart[] = [
  part('tests', 'done', { needed: true }),
  part('errors', 'pr', { pr: PULL, branch: 'hobkin/r1-monitoring', item: 'p1' }),
  part('slowQueries', 'todo', { line: 'No slow query log yet.' }),
  part('logs', 'doing'),
  part('alerts', 'user', { line: 'Put SENTRY_DSN in production', pr: PULL, action: 'a1' }),
  part('rollback', 'done', { needed: true }),
  part('deploy', 'pr', { branch: 'hobkin/r1-deploy', item: 'p2', problem: 'api has no origin to push to, so no PR was opened.' }),
  part('models', 'doing', { needed: true }),
]

test('a ready project says what is still being set up, and each part says where it stands with its PR or its Action Item', () => {
  const ready = rowOf({ ready: true, needs: [], work: 'landed', checkedAt: '2026-11-20T09:30:00Z', parts: PARTS })
  assert.deepEqual([ready.state, ready.tone, ready.detail], ['Ready', 'ok', 'YOLO mode can run here. Still being set up: 2 waiting for your merge, 1 step for you, 2 in progress, 1 to do.'])
  assert.equal(rowOf({ ready: true, needs: [], work: 'landed', parts: [part('tests', 'done')] }).detail, 'Every part is in place.')

  const groups = partGroups(project({ work: 'landed', checkedAt: '2026-11-20T09:30:00Z', parts: PARTS }))
  assert.deepEqual(groups.map(({ heading, rows }) => [heading, rows.map(({ name }) => name)]), [
    ['Needed for YOLO mode', ['tests', 'rollback', 'models']],
    ['Improvements', ['errors', 'slowQueries', 'logs', 'alerts', 'deploy']],
  ])
  const row = Object.fromEntries(groups.flatMap(({ rows }) => rows).map((entry) => [entry.name, entry]))
  assert.deepEqual([row.tests.state, row.tests.tone, row.tests.open], ['Done', 'ok', null])
  assert.deepEqual([row.errors.state, row.errors.open], ['PR open', { to: 'pr', url: PULL, label: 'Open PR' }])
  assert.deepEqual([row.alerts.state, row.alerts.line, row.alerts.open], ['Waiting on you', 'Put SENTRY_DSN in production', { to: 'action', id: 'a1', label: 'Open item' }])
  assert.deepEqual([row.deploy.state, row.deploy.line, row.deploy.open], ['Branch for your yes', 'api has no origin to push to, so no PR was opened.', { to: 'work', key: 'api:p2', label: 'On Work' }])
  assert.deepEqual([row.logs.state, row.models.state, row.slowQueries.state, row.slowQueries.open], ['In progress', 'In progress', 'To do', null])

  // Before any check and with nothing running there is nothing to list yet.
  assert.deepEqual(partGroups(project({ parts: PARTS })), [])
  assert.equal(partGroups(project({ work: 'running', parts: PARTS })).length, 2)
})

test("readiness that runs or waits for the user's yes cannot be started again, and queued readiness can start now", () => {
  const running = rowOf({ work: 'running' })
  assert.deepEqual([running.state, running.tone, running.canRun], ['Running', 'live', false])

  const waiting = rowOf({ work: 'waiting', needs: ['Its readiness work waits for your yes.'] })
  assert.deepEqual([waiting.state, waiting.tone, waiting.press, waiting.action], ['Waits for your yes', 'warn', { do: 'open', key: null }, 'Open on Work'])

  const queued = rowOf({ work: 'queued' })
  assert.deepEqual([queued.state, queued.canRun], ['Queued', true])
  assert.match(rowOf({ work: 'queued' }, false).detail, /once work mode is on/)
})

test('an older hobkin that does not say where readiness work stands still offers to run it', () => {
  const { work: _work, checkedAt: _checkedAt, ...older } = project()
  const row = readinessRow(older, { workOn: true, now: NOW, zone: 'UTC' })
  assert.deepEqual([row.action, row.canRun], ['Run readiness', true])
})

test('with no host, running readiness queues it on the sample alone', () => {
  const before = yolo([project({ slug: 'api' }), project({ slug: 'web', work: 'landed', ready: true, needs: [] })], false)
  const after = sampleReadiness(before, 'api')
  assert.deepEqual(after.projects.map(({ slug, work }) => [slug, work]), [['api', 'queued'], ['web', 'landed']])
  assert.equal(after.on, false, 'the switch stays as it was')
})

const card = (choices: FinishedChange['choices'], change: Partial<FinishedChange> = {}) =>
  ({ key: 'api:r1', slug: 'api', item: 'r1', yes: 'Merge it puts hobkin/r1 into the default branch on this machine. Nothing is pushed.', reason: 'Rated risky.', choices, ...change }) as FinishedChange
const groups = (name: FinishedGroupName, change: FinishedChange): FinishedGroup[] => [{ name, heading: '', why: null, action: null, changes: [change] }]
const MERGE = [{ value: 'diff', label: 'Show the diff' }, { value: 'merge', label: 'Merge it' }] as FinishedChange['choices']

test("readiness that waits for the user's yes says it on its own row when hobkin rates its branch ready to merge", () => {
  const waits = project({ work: 'waiting', item: 'r1' })
  const change = card(MERGE)
  const found = waitingChange(waits, groups('merge', change))
  assert.equal(found?.change, change)
  assert.equal(waitingChange(project({ work: 'waiting', item: 'other' }), groups('merge', change)), null)
  assert.equal(waitingChange(project({ work: 'landed', item: 'r1' }), groups('merge', change)), null, 'only readiness that waits')

  const row = readinessRow(waits, { workOn: true, now: NOW, zone: 'UTC', waiting: found })
  assert.deepEqual([row.action, row.canRun, row.press, row.detail], ['Merge', true, { do: 'yes', change, choice: 'merge' }, change.yes])

  const pr = readinessRow(waits, { workOn: true, now: NOW, zone: 'UTC', waiting: waitingChange(waits, groups('refresh', card([{ value: 'refreshMerge', label: 'Refresh and merge the PR' }]))) })
  assert.deepEqual([pr.action, pr.press.do], ['Refresh, merge', 'yes'])
})

test('readiness whose branch needs the user opens its card on Work instead of merging from the row', () => {
  const waits = project({ work: 'waiting', item: 'r1' })
  for (const name of ['needs', 'left'] as const) {
    const row = readinessRow(waits, { workOn: true, now: NOW, zone: 'UTC', waiting: waitingChange(waits, groups(name, card(MERGE))) })
    assert.deepEqual([row.action, row.press, row.detail], ['Open on Work', { do: 'open', key: 'api:r1' }, 'Rated risky.'], name)
  }
})

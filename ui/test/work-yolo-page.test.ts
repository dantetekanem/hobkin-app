import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange, FinishedGroup, FinishedGroupName, YoloChange, YoloMerge, YoloPart, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { projectCard, type CardRead } from '../src/features/work/yolo-card.ts'
import { changeOpens, inPlace, reviewsOf, mergedDays, partGroups, projectOpens, stillToSetUp, readinessRow, sampleReadiness, waitingChange, yoloAtAGlance, yoloReportId } from '../src/features/work/yolo-page.ts'

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
  assert.deepEqual([held.state, held.tone, held.detail, held.action, held.canRun], ['Being set up', 'warn', 'Tests: its PR waits for your merge. Rollback: waits on you: Keep two releases.', 'Check again', true])

  const closed = rowOf({ needs: ['Tests: You said no to its branch.'], work: 'closed', checkedAt: '2026-11-19T09:30:00Z' })
  assert.deepEqual([closed.state, closed.action, closed.canRun], ['Being set up', 'Check again', true])
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

test("a project's YOLO report is the one hobkin lists as that project's yolo work", () => {
  const reports = [
    { id: 'run:1', scheduleId: 'work.api.do' },
    { id: 'yolo:web:1', scheduleId: 'work.web.yolo' },
    { id: 'yolo:api:2', scheduleId: 'work.api.yolo' },
  ]

  assert.equal(yoloReportId(project(), reports), 'yolo:api:2')
  assert.equal(yoloReportId(project({ slug: 'docs' }), reports), null)
})

// What YOLO mode does on a project, at a glance: whether it merges and deploys there, and if not, exactly why and the one press that moves it.
const READY: Partial<YoloProject> = { ready: true, needs: [], work: 'landed', checkedAt: '2026-11-21T04:45:00Z' }
const change = (title: string, rate: number | null, why: string | null, item = title.slice(0, 2)): YoloChange => ({ item, title, kind: rate === null ? null : 'a bug fix', rate, why })

test('what merged by itself is grouped by day, newest first, with how each deploy held', () => {
  const merge = (title: string, at: string, held: boolean | null, deploy: string): YoloMerge => ({ at, item: title.slice(0, 2), title, kind: 'a bug fix', rate: 9.2, head: 'abc1234', deploy, held })
  const days = mergedDays(project({ merged: [
    merge('Fix login', '2026-11-20T14:00:00Z', true, 'It deployed and held for 30 minutes: Nothing new.'),
    merge('Fix logout', '2026-11-20T09:00:00Z', false, 'Problem after its deploy: p95 doubled.'),
    merge('Fix search', '2026-11-18T09:00:00Z', null, 'Its deploy is with the main agent.'),
  ] }), { zone: 'UTC', now: NOW })
  assert.deepEqual(days.map(({ day, rows }) => [day, rows.map(({ title, what, held, tone }) => [title, what, held, tone])]), [
    ['Today', [['Fix login', 'a bug fix rated 9.2 at abc1234', 'Held', 'ok'], ['Fix logout', 'a bug fix rated 9.2 at abc1234', 'Regressed', 'bad']]],
    ['Wed, Nov 18', [['Fix search', 'a bug fix rated 9.2 at abc1234', null, 'quiet']]],
  ])
})

test('readiness lists only the parts that still need work, each with its PR or Action Item, and names the ones in place', () => {
  const shown = project({ ...READY, parts: PARTS })
  assert.deepEqual(stillToSetUp(shown).map(({ heading, rows }) => [heading, rows.map(({ name }) => name)]), [
    ['Needed for YOLO mode', ['models']],
    ['Improvements', ['errors', 'slowQueries', 'logs', 'alerts', 'deploy']],
  ])
  assert.equal(inPlace(shown), 'In place: tests and rollback.')
  assert.equal(inPlace(project({ ...READY, parts: [part('tests', 'todo')] })), null)
  assert.deepEqual(stillToSetUp(project({ ...READY, parts: [part('tests', 'done', { needed: true })] })), [])
})

test("a project card's name opens the project's page, and a change next to merge opens its review, or its card on Work when there is no review to name", () => {
  assert.deepEqual(projectOpens('api'), { to: 'project', slug: 'api' })
  assert.deepEqual(changeOpens('api', 'b4', true), { to: 'review', id: 'change:api:b4' })
  // With no host the sample has no review of its own to open, so the change's card on Work opens.
  assert.deepEqual(changeOpens('api', 'b4', false), { to: 'work', target: '[data-change="api:b4"]' })
  assert.deepEqual(changeOpens('bad:slug', 'b4', true), { to: 'work', target: '[data-change="bad:slug:b4"]' })
})

// The AI review's own answers to the user's five questions, as the host's review list carries them for a change (spec 058).
const HEAD = 'a'.repeat(40)

test('a change finds its AI review in the review list by the id its row opens, and only its own', () => {
  const shown = project({ slug: 'api', changes: [change('Fix login', 9, null, 'b4'), change('Fix logout', null, null, 'c5')] })
  const listed = [
    { id: 'change:api:b4', head: HEAD, needs: [] },
    { id: 'change:web:c5', head: HEAD, needs: [] },
    { id: 'pr:acme/api/7', head: HEAD, needs: [] },
  ]

  const found = reviewsOf(shown, listed)

  assert.deepEqual([...found.keys()], ['b4'])
  assert.equal(found.get('b4')?.head, HEAD)
})

// A card names the setting that holds its changes (063-yolo-settings-and-grades, A19).
const RULES = { lowestRate: 8, mergePulls: false, leftNoteMayMerge: false, testsPass: true }
const held = (item: string, rate: number | null, why: string | null, setting?: string | null): YoloChange => ({ item, title: `Change ${item}`, kind: null, rate, why, ...(setting === undefined ? {} : { setting }) })
const cardWith = (more: Partial<YoloProject>, rules: CardRead['rules'] | null = RULES) => {
  const shown: YoloProject = { slug: 'api', name: 'api', on: true, ready: true, needs: [], work: 'landed', checkedAt: '2026-11-21T14:09:00Z', ...more }
  const readRow = readinessRow(shown, { workOn: true, now: NOW, zone: 'UTC' })
  return projectCard(shown, { on: true, rate: 8, lowest: 1, waits: null, paused: false, readiness: readRow, ...(rules ? { rules } : {}) }, new Map())
}

test('a card says its verdict in a line, each holding setting once with its count, and a press opens that setting', () => {
  const card = cardWith({
    changes: [
      held('a', 8.4, 'its pull request merges by itself once that is turned on', 'mergePulls'),
      held('b', null, 'its pull request merges by itself once that is turned on', 'mergePulls'),
      held('c', 7.2, 'its general rate is 7.2, under 8', 'lowestRate'),
      held('d', 9, 'it still has work left: x', 'leftNoteMayMerge'),
    ],
  })
  assert.equal(card.verdict.text, 'Holding 4: pull requests off, left a note')
  assert.deepEqual(card.blockers.map(({ key, text, count }) => [key, text, count]), [
    ['setting:mergePulls', "Merge hobkin's own pull requests: off", 2],
    ['setting:leftNoteMayMerge', 'A change whose run left a note for me may merge: off', 1],
    ['setting:lowestRate', 'Lowest general rate: 8', 1],
  ].map(([key, text, count]) => [key, String(text).replace("'", '\u2019'), count]))
  assert.deepEqual(card.blockers[0]!.press?.press, { do: 'setting', name: 'mergePulls', slug: 'api' })
  assert.deepEqual(card.changes.map(({ state }) => state), ['Left a note', 'Pull requests off', 'Rate 7.2, under 8', 'Pull requests off'])
})

test('a switch that holds the whole project is one line by its setting, with the readiness part in its tooltip', () => {
  const card = cardWith({
    ready: false,
    needs: ['Tests: its PR waits for your merge.'],
    holds: ['testsPass'],
    parts: [{ name: 'tests', label: 'Tests', state: 'pr', line: 'bin/test runs the suite.', needed: true, blocks: true }],
    changes: [held('a', 9, null), held('b', 8.5, null)],
  })
  assert.equal(card.verdict.text, 'Holding 2: tests failing')
  assert.deepEqual(card.blockers.map(({ key, text, count }) => [key, text, count]), [['setting:testsPass', 'Tests pass on the default branch', 2]])
  assert.match(card.blockers[0]!.detail ?? '', /Tests: waiting for your merge/)
  assert.deepEqual(card.changes.map(({ state }) => state), ['Tests failing', 'Tests failing'])
})

test('with no setting sent, a card matches the runtime\'s sentence as before, and with no rules says nothing of settings', () => {
  const changes = [held('a', 7.2, 'its general rate is 7.2, under 8'), held('b', null, 'its pull request merges by itself once that is turned on')]
  const sentence = cardWith({ changes })
  assert.deepEqual(sentence.blockers.map(({ key }) => key), ['pulls', 'rate'])
  assert.equal(sentence.verdict.text, 'Holding 2')
  const old = cardWith({ changes: [held('a', 7.2, 'its general rate is 7.2, under 8', 'lowestRate')] }, null)
  assert.deepEqual([old.blockers[0]!.key, old.verdict.text], ['rate', 'Merging nothing: 0 of 1 can merge'])
})

test('a card never says getting ready', () => {
  const row = readinessRow({ slug: 'api', name: 'api', ready: false, needs: ['Tests: x.'], work: 'landed', checkedAt: '2026-11-20T09:30:00Z' }, { workOn: true, now: NOW, zone: 'UTC' })
  assert.equal(row.state, 'Being set up')
})

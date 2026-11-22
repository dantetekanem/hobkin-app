import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange, FinishedGroup, FinishedGroupName, YoloChange, YoloMerge, YoloPart, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { changeOpens, changeRows, inPlace, mergedDays, partGroups, projectOpens, stillToSetUp, readinessRow, sampleReadiness, waitingChange, yoloAtAGlance, yoloReportId, yoloVerdict, type VerdictContext } from '../src/features/work/yolo-page.ts'

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
const DEPLOY_TAKEN = part('deploy', 'doing', { line: 'You took its step, and the next check confirms it.', action: 'f0f8' })
const DEPLOY_ASKS = part('deploy', 'user', { line: 'Make space for the RpsLeague release build', action: 'f0f8' })
const DEPLOY_DONE = part('deploy', 'done', { line: 'bin/deploy from main.' })
const change = (title: string, rate: number | null, why: string | null, item = title.slice(0, 2)): YoloChange => ({ item, title, kind: rate === null ? null : 'a bug fix', rate, why })
const verdictOf = (change: Partial<YoloProject>, context: Partial<VerdictContext> = {}) => {
  const shown = project({ ...READY, ...change })
  return yoloVerdict(shown, { on: true, rate: 8, lowest: 6, waits: null, paused: false, prMode: 'off', readiness: readinessRow(shown, { workOn: true, now: NOW, zone: 'UTC' }), ...context })
}

test("rpsleague's case: ready, nothing waiting, and its deploys wait for the check that confirms the step the user took", () => {
  const verdict = verdictOf({ name: 'rpsleague', parts: [part('tests', 'done', { needed: true }), DEPLOY_TAKEN], changes: [], merged: [] })
  assert.deepEqual(verdict.merges, { state: 'Idle', tone: 'quiet', text: 'Nothing waits to merge. The next small change rated 8 or more merges by itself.' })
  assert.deepEqual(verdict.deploys, { state: 'Not set up', tone: 'warn', text: 'Nothing deploys yet. You took its step, and the next check confirms it.' })
  // Said apart from a model's own Check again, which sits on the same card.
  assert.deepEqual(verdict.action, { label: 'Check readiness', press: { do: 'readiness' } })

  // Before the user took the step, the step itself is the one press.
  assert.deepEqual(verdictOf({ parts: [DEPLOY_ASKS] }).action, { label: 'Answer item', press: { do: 'action', id: 'f0f8' } })
  assert.equal(verdictOf({ parts: [DEPLOY_ASKS] }).deploys.text, 'Nothing deploys yet. It waits on you: Make space for the RpsLeague release build.')
})

test("changes that cannot merge by themselves say hobkin's exact reason, with their rate against the user's", () => {
  const landing = 'it still has work left: The independent review still needs to cover the committed range'
  const stuck = verdictOf({ parts: [DEPLOY_DONE], changes: [change('Difficulty multipliers', 7.4, landing, 'fd'), change('Selling more than owned', 7.6, landing, '0c')] })
  assert.deepEqual(stuck.merges, { state: 'Stuck', tone: 'warn', text: `Nothing can merge by itself. "Selling more than owned" asks you: ${landing}.` })
  assert.deepEqual(stuck.action, { label: 'Open review', press: { do: 'review', slug: 'api', item: '0c' } })
  assert.deepEqual(stuck.deploys, { state: 'Ready', tone: 'ok', text: 'Each merge goes to the main agent to deploy by its recorded path.' })

  const rows = changeRows(project({ ...READY, changes: [change('Difficulty multipliers', 7.4, landing), change('Fix login', 9.2, null), change('No review', null, 'no review has scored it')] }), { rate: 8, holds: null })
  assert.deepEqual(rows.map(({ title, rate, against, tone, why }) => [title, rate, against, tone, why]), [
    ['Fix login', '9.2', 'merges next pass', 'ok', 'It merges by itself on the next pass.'],
    ['Difficulty multipliers', '7.4', '0.6 under 8', 'warn', `It asks you: ${landing}.`],
    ['No review', '–', 'no rate yet', 'quiet', 'It asks you: no review has scored it.'],
  ])

  // A change that would merge by itself says what it still waits for: the project's readiness, or what holds every merge.
  const would = [change('Fix login', 9.2, null)]
  const gettingReady = changeRows(project({ changes: would }), { rate: 8, holds: null })[0]!
  assert.deepEqual([gettingReady.against, gettingReady.tone, gettingReady.why], ['once ready', 'ok', 'It merges by itself once api is ready.'])
  const held = changeRows(project({ ...READY, changes: would }), { rate: 8, holds: 'work mode is paused' })[0]!
  assert.deepEqual([held.against, held.tone, held.why], ['held', 'ok', 'It would merge by itself, but nothing merges while work mode is paused.'])

  // When the rate is all that holds it, the press sets the rate it would pass at.
  const underRate = verdictOf({ changes: [change('Fix logout', 7.6, 'its general rate is 7.6, under 8', 'lo')] })
  assert.deepEqual(underRate.action, { label: 'Set rate to 7', press: { do: 'rate', rate: 7 }, title: 'Lower your rate to 7, so "Fix logout" merges by itself' })
  const belowLowest = verdictOf({ changes: [change('Fix logout', 5.2, 'its general rate is 5.2, under 8', 'lo')] })
  assert.equal(belowLowest.action?.press.do, 'review', 'a rate under the lowest the user can pick is not offered')
})

test('a change that merges on the next pass says so, and the deploy that still needs setting up is the press', () => {
  const merging = verdictOf({ parts: [DEPLOY_ASKS], changes: [change('Fix login', 9.2, null, 'fl')] })
  assert.deepEqual(merging.merges, { state: 'Merging', tone: 'live', text: '"Fix login" merges by itself on the next pass: a bug fix rated 9.2.' })
  assert.deepEqual(merging.action, { label: 'Answer item', press: { do: 'action', id: 'f0f8' } })
  assert.deepEqual(verdictOf({ parts: [DEPLOY_DONE], changes: [change('Fix login', 9.2, null, 'fl')] }).action, { label: 'Open review', press: { do: 'review', slug: 'api', item: 'fl' } })
})

test('nothing merges while YOLO mode is off, work mode waits, the project is paused, or it is in PR mode, and each says so', () => {
  const off = verdictOf({}, { on: false })
  assert.deepEqual([off.merges.state, off.merges.text, off.action], ['Off', 'YOLO mode is off, so every change here asks you.', null])
  assert.deepEqual(verdictOf({ ...project(), ready: false }, { on: false }).action, { label: 'Run readiness', press: { do: 'readiness' } }, 'readiness still runs with it off')

  const waits = verdictOf({}, { waits: 'work mode is paused' })
  assert.deepEqual([waits.merges.state, waits.merges.text, waits.action], ['Stuck', 'Nothing merges by itself while work mode is paused.', { label: 'Open Work', press: { do: 'work', key: null } }])
  assert.equal(verdictOf({}, { paused: true }).merges.text, 'Nothing merges by itself while api is paused on Work.')
  assert.equal(verdictOf({ changes: [] }, { prMode: 'published' }).merges.text, 'PR mode is on here, so each change goes up as a PR for your merge, and YOLO mode merges no PR.')
})

test('a project getting ready says what holds it, and the press is the part that holds it', () => {
  const pull = 'https://github.com/acme/api/pull/9'
  const held = verdictOf({ ready: false, needs: ['Tests: its PR waits for your merge.'], parts: [part('tests', 'pr', { needed: true, blocks: true, pr: pull }), DEPLOY_DONE] })
  assert.deepEqual(held.merges, { state: 'Getting ready', tone: 'warn', text: 'Nothing merges by itself until it is ready. Tests: its PR waits for your merge.' })
  assert.deepEqual(held.action, { label: 'Open PR', press: { do: 'pr', url: pull } })

  const asks = verdictOf({ ready: false, needs: ['Rollback: waits on you: Keep two releases.'], parts: [part('rollback', 'user', { needed: true, blocks: true, action: 'a9' })] })
  assert.deepEqual(asks.action, { label: 'Answer item', press: { do: 'action', id: 'a9' } })
  const running = verdictOf({ ready: false, work: 'running' })
  assert.deepEqual([running.merges.state, running.action], ['Getting ready', null], 'nothing to press while its run sets it up')
})

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
  // With no host the sample has no review of its own to open, so the change's card on Work opens, as before.
  assert.deepEqual(changeOpens('api', 'b4', false), { to: 'work', target: '[data-change="api:b4"]' })
  assert.deepEqual(changeOpens('bad:slug', 'b4', true), { to: 'work', target: '[data-change="bad:slug:b4"]' })
})

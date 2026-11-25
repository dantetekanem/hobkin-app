import assert from 'node:assert/strict'
import test from 'node:test'
import { homeModel } from '../src/features/home/model.ts'
import type { HomeContribution, HomeContributed, HomeInput } from '../src/features/home/types.ts'
import type { ActionItem, WaitingRow } from '../src/features/actions/items.ts'
import { hostRows } from '../src/features/actions/host.ts'
import type { FinishedChange, WorkProject, WorkState, YoloState } from '../../shared/protocol/work.ts'
import { contributed } from '../src/integration/home.ts'
import type { Report } from '../src/features/reports/report.ts'
import type { RoutineFacts } from '../src/features/routines/rules.ts'
import type { RunningAgent } from '../src/app/running-agents.ts'

const now = new Date(2026, 10, 12, 18).getTime()
const iso = (ago = 0) => new Date(now - ago).toISOString()
/**
 * A made-up integration's contribution: a row and a card for each pull request number waiting on the user, a card for
 * each one that went wrong, and a tile that says who it is signed in as. GitHub's own are tested in its folder.
 */
const forge = ({ waiting = [], failing = [], more = false, tile = false }: { waiting?: number[]; failing?: number[]; more?: boolean; tile?: boolean } = {}): HomeContributed => {
  const url = (number: number) => `https://forge.invalid/pull/${number}`
  const contribution: HomeContribution = {
    known: true,
    needs: waiting.map((number) => {
      const target = { to: 'pull', url: url(number) } as const
      return {
        row: { id: `forge:${number}`, title: `PR ${number}`, detail: `app #${number}`, tone: 'info', aside: null, action: { label: 'Review', target } },
        card: {
          id: `forge:${number}`, label: 'Review request · app', reason: 'Waiting for your review', tone: 'info', title: `PR ${number}`, detail: null,
          primary: { label: 'Review', target }, secondary: { label: 'Open', target: { to: 'url', url: url(number) } },
        },
      }
    }),
    cards: failing.map((number) => ({
      id: `forge:${number}`, label: 'Checks failing · app', reason: 'Checks failing', tone: 'bad', title: `PR ${number}`, detail: null,
      primary: { label: 'Open', target: { to: 'url', url: url(number) } },
    })),
    lift: failing.length,
    more,
    ...(tile ? { tile: { key: 'fk', name: 'Forge', status: 'Connected', tone: 'ok', note: '@octo', target: { to: 'screen', screen: 'forge' } } } : {}),
  }
  return contributed(contribution, { symbol: 'Fk', hue: 10 })
}
const input = (rest: Partial<HomeInput> = {}): HomeInput => ({
  now,
  reports: [],
  read: new Set(),
  attention: null,
  waiting: [],
  question: null,
  work: null,
  live: true,
  contributions: [],
  routines: [],
  agents: [],
  wins: null,
  integrations: null,
  dismissed: new Set(),
  layout: null,
  custom: null,
  thoughts: null,
  ...rest,
})
const occurrence = (rest: Record<string, unknown> = {}) => ({
  id: 'call-office:2026-11-12', routineId: 'call-office', on: '2026-11-12',
  dueAt: '2026-11-12T14:00:00.000Z', timezone: 'America/Toronto',
  deliveredAt: '2026-11-12T14:11:00.000Z', title: 'Call the office', next: 'Call and ask about availability.',
  status: 'pending-confirmation', resolvedAt: null, ...rest,
})
const reminderInput = (rest: Record<string, unknown> = {}) => ({
  home: '/fixture/home', entries: [occurrence()], ...rest,
})

test('an explicitly bound delivered reminder leads work, with real action and separate completion controls', () => {
  const model = homeModel(input({
    reminders: reminderInput(), waiting: [action('work')],
    reports: [report('call-office:2026-11-12', 1, { body: 'Useful: Call today\nNext: Call the office' })],
    read: new Set(['call-office:2026-11-12']),
  }))
  assert.equal(model.stack[0]?.label, 'Reminder')
  assert.equal(model.stack[0]?.title, 'Call the office')
  assert.equal(model.stack[0]?.next, 'Call and ask about availability.')
  assert.deepEqual(model.stack[0]?.reminder, { home: '/fixture/home', id: 'call-office:2026-11-12' })
  assert.equal(model.needs.rows[0]?.id, 'reminder:call-office:2026-11-12')
  assert.equal(model.needs.rows.filter(row => row.id.includes('call-office')).length, 1)
})

test('explicit reminder completion, dismissal, retention and exact dedup never promote arbitrary reports', () => {
  const make = (entries: unknown[], rest: Partial<HomeInput> = {}) => homeModel(input({ reminders: reminderInput({ entries }), ...rest }))
  for (const status of ['done', 'dismissed']) {
    const model = make([occurrence({ status, resolvedAt: iso() })], { now: now + 400 * 86_400_000 })
    assert.equal(model.needs.rows.length, 0)
  }
  assert.equal(make([occurrence()], { reports: [] }).stack[0]?.kind, 'reminder', 'report retention does not erase an unresolved reminder')
  assert.equal(make([occurrence()], { dismissed: new Set(['reminder:call-office:2026-11-12']) }).needs.rows.length, 0)
  assert.equal(make([occurrence()], { dismissed: new Set(['problem:call-office:2026-11-12']) }).needs.rows.length, 0)
  const native = action('native', iso(), { item: personalItem('native', 'reminder', { answerTo: { kind: 'reminder', id: occurrence().id } }) })
  assert.equal(make([occurrence()], { waiting: [native] }).needs.rows.length, 1)
  assert.equal(homeModel(input({ reports: [report('ordinary', 1, { body: 'Useful: Call someone\nNext: Call today' })] })).needs.rows.length, 0)
  assert.equal(make([occurrence(), occurrence()]).needs.rows.length, 0, 'ambiguous metadata is rejected')
  const critical = make([occurrence()], { reports: [report('critical')] })
  assert.equal(critical.stack[0]?.kind, 'problem')
  assert.equal(critical.stack[1]?.kind, 'reminder')
  const laterNative = action('later', iso(), { item: personalItem('later') })
  assert.equal(make([occurrence()], { waiting: [laterNative] }).needs.rows[0]?.id, 'reminder:call-office:2026-11-12', 'oldest first within the shared personal band')
})

test('due instants keep the original timezone through Toronto DST and do not reschedule', () => {
  for (const [on, dueAt, deliveredAt] of [
    ['2026-03-08', '2026-03-08T13:00:00.000Z', '2026-03-08T13:01:00.000Z'],
    ['2026-11-01', '2026-11-01T14:00:00.000Z', '2026-11-01T14:01:00.000Z'],
  ]) {
    const reminders = reminderInput({ entries: [occurrence({ id: `call-office:${on}`, on, dueAt, deliveredAt })] })
    assert.equal(homeModel(input({ reminders, now: Date.parse(dueAt) - 1 })).needs.rows.length, 0)
    const model = homeModel(input({ reminders, now: Date.parse(deliveredAt) }))
    assert.match(model.stack[0]!.reason, /9:00.*America\/Toronto/)
    assert.equal(homeModel(input({ reminders, now: Date.parse(dueAt) + 500 * 86_400_000 })).stack[0]?.kind, 'reminder')
  }
})

const action = (id: string, at: string | null = iso(), rest: Partial<WaitingRow> = {}): WaitingRow => ({
  id, at, kind: 'question', from: 'hobkin', summary: id, question: { id, from: 'hobkin', question: id, choices: [] },
  putOff: false, branch: false, pick: null, changed: null, links: [], item: null, ...rest,
})
const change = (item: string, head = 'head'): FinishedChange => ({
  key: `app:${item}`, slug: 'app', project: 'App', item, head, title: item, grade: null, branch: null, pr: null,
  about: null, proof: null, review: '', yes: '', reason: '', safety: null, size: null, behind: 0, conflict: null, landing: 'merge', choices: [],
})
const project = (slug: string, state: WorkProject['state'] = 'chosen'): WorkProject => ({
  slug, name: slug, state, priority: 'P2', prMode: 'off', level: 'casual', paused: false, open: 0, prs: 0, branches: 0,
  left: 0, unmerged: 0, nextLookAt: null, lookError: null,
})
const work = (changes: FinishedChange[] = [], projects: WorkProject[] = []): WorkState => ({
  enabled: true,
  folder: null,
  autoPick: false,
  held: null,
  forecast: null,
  agents: 2,
  agentsAllowed: 4,
  maxAgents: 8,
  queue: [],
  queued: 3,
  projects,
  finished: [{ name: 'needs', heading: 'Needs you', why: null, action: null, changes }],
})
const report = (id: string, ago = 1000, rest: Partial<Report> = {}): Report => ({ id, title: id, at: iso(ago), scheduleId: 'work.app.look', body: 'Critical: Broken\nNext: Fix it', outcome: 'completed', ...rest })
const agent = (id: string, asks?: string): RunningAgent => ({ id, title: id, doing: 'Reading', project: 'app', tier: 'mid', hue: 0, mood: 'working', kind: 'work', ...(asks ? { asks } : {}) })
const routine = (id: string, offset: number, state: RoutineFacts['state'] = 'on'): RoutineFacts => ({
  routine: {
    id,
    title: id,
    timezone: 'UTC',
    enabled: state !== 'off',
    harness: 'pi',
    model: null,
    effort: '',
    cwd: '',
    context: [],
    cadence: 'daily',
    path: '',
    prompt: '',
  },
  state,
  hold: state === 'held' ? { until: iso(-offset), reason: 'Waiting on a dependency' } : null,
  next: { at: now + offset },
  running: undefined,
  lastRun: undefined,
})
const question = { id: 'q', from: 'hobkin', question: 'Choose?', choices: [], other: true, askedAt: now - 1000, expiresAt: null }

const personalItem = (id: string, kind = 'reminder', rest: Partial<ActionItem> = {}): ActionItem => ({
  id,
  key: id,
  from: 'Personal',
  question: 'Call the office today to confirm a time.',
  tldr: 'Call the office',
  choices: [{ value: 'done', label: 'Done' }, { value: 'tomorrow', label: 'Remind me tomorrow' }],
  answerTo: { kind, id },
  recommended: null,
  why: null,
  changed: null,
  at: iso(),
  ...rest,
})

test('due host reminders lead older work decisions, real actions and activity without losing their completion path', () => {
  const waiting = [
    action('work', iso(86400000)),
    ...hostRows({ decisions: [personalItem('call'), personalItem('prepare', 'action', { at: iso(10000) })] }),
  ]
  const model = homeModel(input({ waiting, agents: [agent('busy')], wins: { today: { merged: 20, decided: 10 }, streak: 3 } }))
  assert.deepEqual(model.needs.rows.map(row => row.id), ['decision:call', 'decision:prepare', 'decision:work'])
  assert.equal(model.stack[0]?.id, 'decision:call')
  assert.equal(model.stack[0]?.label, 'Reminder')
  assert.equal(model.stack[0]?.detail, 'Call the office today to confirm a time.')
  assert.deepEqual(model.stack[0]?.primary, { label: 'Open reminder', target: { to: 'action', id: 'call' } })
  assert.deepEqual(model.stack[0]?.choices, ['Done', 'Remind me tomorrow'])
  assert.equal(model.running.rows[0]?.id, 'agent:busy')
  assert.equal(model.week.wins?.merged, 20)
  assert.ok(model.widgets.findIndex(widget => widget.kind === 'needs') < model.widgets.findIndex(widget => widget.kind === 'week'))
})

test('critical findings stay ahead of personal reminders, but blocked routine noise does not', () => {
  const waiting = hostRows({ decisions: [personalItem('call')] })
  const model = homeModel(input({ waiting, reports: [report('blocked', 1000, { body: 'Blocked: Routine unavailable' }), report('critical', 2000)] }))
  assert.equal(model.stack[0]?.id, 'problem:critical')
  assert.equal(model.stack[1]?.id, 'decision:call')

  const withoutCritical = homeModel(input({ waiting, reports: [report('blocked', 1000, { body: 'Blocked: Routine unavailable' })] }))
  assert.equal(withoutCritical.stack[0]?.id, 'decision:call')

  const corrected = homeModel(input({ waiting, reports: [report('critical', 2000, { body: 'Useful: The historical warning was handled; current health is unverified.' })] }))
  assert.equal(corrected.stack[0]?.id, 'decision:call')
  assert.deepEqual(corrected.problems.rows, [])
})

test('reading a delivery report never completes a reminder; done and dismissed reminders stay quiet', () => {
  const delivery = report('delivery', 1000, { scheduleId: 'call-office', body: 'Useful: Call the office today.\nNext: Confirm a time.' })
  const call = personalItem('call')
  const base = input({ reports: [delivery], read: new Set(['delivery']), waiting: hostRows({ decisions: [call] }) })
  assert.equal(homeModel(base).stack[0]?.id, 'decision:call')
  for (const answer of ['done', 'tomorrow']) {
    const settled = homeModel({ ...base, waiting: hostRows({ decisions: [{ ...call, answer, answeredAt: iso() }] }) })
    assert.deepEqual(settled.needs.rows, [])
    assert.deepEqual(settled.stack, [])
    assert.equal(settled.header.title, 'Nothing needs you')
  }
  const dismissed = homeModel({ ...base, dismissed: new Set(['decision:call']) })
  assert.deepEqual(dismissed.needs.rows, [])
  assert.deepEqual(dismissed.stack, [])
  assert.deepEqual(homeModel({ ...base, waiting: [] }).stack, [], 'a report alone is not an unresolved action record')
})

test('host-owned reminder status survives Toronto midnight and DST; the client does not reschedule it', () => {
  const waiting = hostRows({ decisions: [personalItem('call', 'reminder', { at: '2026-11-01T00:30:00-04:00' })] })
  for (const now of ['2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00', '2026-11-01T23:59:59-05:00', '2026-11-02T00:00:00-05:00']) {
    assert.equal(homeModel(input({ now: Date.parse(now), waiting })).stack[0]?.id, 'decision:call')
  }
  const workItem = action('work', iso(10000))
  const personal = action('yours', iso(), { kind: 'yours' })
  const model = homeModel(input({ waiting: [workItem, personal] }))
  assert.equal(model.stack[0]?.id, 'decision:yours')
  assert.equal(model.stack[0]?.primary.label, 'View action')
  assert.equal(homeModel(input()).header.title, 'Nothing needs you')
})

test('Needs keeps the question first, sorts unknown dates last, and resolves exact targets', () => {
  const model = homeModel(input({
    question,
    waiting: [
      action('unknown', 'bad'),
      action('recent'),
      action('q'),
      action('old', iso(10000), { opens: { screen: 'reports', report: 'r' } }),
      action('work', null, { opens: { screen: 'work' } }),
    ],
  }))

  assert.deepEqual(model.needs.rows.map(row => row.id), ['question:q', 'decision:old', 'decision:recent', 'decision:unknown', 'decision:work'])
  assert.deepEqual(model.needs.rows.map(row => row.action.target), [{ to: 'question' }, { to: 'report', id: 'r' }, { to: 'action', id: 'recent' }, { to: 'action', id: 'unknown' }, { to: 'screen', screen: 'work' }])
})

test('Needs deduplicates only the exact finished branch and counts known hidden entries', () => {
  const branch = action('branch', iso(), { branch: true })
  branch.item = {
    id: 'branch',
    key: null,
    from: 'hobkin',
    question: '',
    tldr: '',
    choices: [],
    answerTo: { kind: 'merge', slug: 'app', item: 'one', head: 'head' },
    recommended: null,
    why: null,
    changed: null,
    at: iso(),
  }
  const contributions = [forge({ waiting: [1], more: true })]
  const model = homeModel(input({
    question,
    waiting: [branch],
    work: work(
      [change('one'), change('one', 'different'), change('two')],
      [project('proposal', 'proposed')],
    ),
    contributions,
  }))

  assert.equal(model.needs.rows.length, 5)
  assert.equal(model.needs.more, 1)
  assert.equal(model.needs.rows.filter(row => row.kind === 'review').length, 2)
  assert.match(model.header.title, /At least 6/)
  assert.equal(homeModel(input({ work: work([], [project('proposal', 'proposed')]) })).needs.rows[0]?.kind, 'proposal')
  assert.match(homeModel(input({ question, contributions: [forge({ waiting: [1] })] })).header.title, /^2 things/)
  for (const answerTo of [
    { kind: 'merge', slug: 'other', item: 'one', head: 'head' },
    { kind: 'merge', slug: 'app', item: 'other', head: 'head' },
    { kind: 'work', slug: 'app', item: 'one', head: 'head' },
  ]) {
    const mismatch: WaitingRow = { ...branch, item: { ...branch.item, answerTo } }
    assert.equal(
      homeModel(input({ waiting: [mismatch], work: work([change('one')]) })).needs.rows.filter(row => row.kind === 'review').length,
      1,
    )
  }
})

test('Problems folds exact source and normalized issue/outcome using newest Next', () => {
  const reports = [report('older', 3000), report('newer', 1000, { body: 'Critical:  BROKEN\nNext: New fix' }), report('other-source', 2000, { scheduleId: 'work.app.tests' }), report('other-outcome', 4000, { outcome: 'failed', title: 'Broken' }), ...['x', 'y', 'z'].map((id, i) => report(id, 5000 + i, { body: `Blocked: ${id}` }))]
  const model = homeModel(input({ reports, routines: [routine('held', 9999999, 'held')] }))
  const folded = model.problems.rows.find(row => row.id === 'problem:newer')
  assert.ok(folded)
  assert.match(folded.detail ?? '', /New fix/)
  assert.match(folded.aside ?? '', /×2/)
  assert.equal(model.problems.rows.some(row => row.id === 'problem:older'), false)
  assert.equal(model.problems.rows.length, 4)
  assert.equal(model.problems.more, 3)
  assert.equal(homeModel(input({ routines: [routine('held', 9999999, 'held')] })).problems.rows[0]?.action.target.to, 'routine')
})

test('Projects uses only chosen state and exact work provenance without declaring health', () => {
  const chosen = { ...project('app'), prs: 2, paused: true, lookError: 'Failed to inspect' }
  const model = homeModel(input({
    work: work(
      [change('one')],
      [chosen, project('proposed', 'proposed'), project('dropped', 'dropped'), project('clean')],
    ),
    reports: [
      report('one'),
      report('two', 2000, { scheduleId: 'work.app.tests' }),
      report('prefix', 1000, { scheduleId: 'work.apple.look' }),
      report('routine', 1000, { scheduleId: 'app' }),
    ],
  }))

  assert.deepEqual(model.projects.rows.map(row => row.id), ['project:app', 'project:clean'])
  assert.deepEqual(model.projects.rows.map(row => row.action.target), [{ to: 'project', slug: 'app' }, { to: 'project', slug: 'clean' }], 'a project opens its own page')
  assert.match(model.projects.rows[0]?.detail ?? '', /2 problems/)
  assert.match(model.projects.rows[0]?.detail ?? '', /1 change/)
  assert.match(model.projects.rows[0]?.detail ?? '', /2 PRs/)
  assert.match(model.projects.rows[0]?.detail ?? '', /Paused/)
  assert.match(model.projects.rows[0]?.detail ?? '', /Failed to inspect/)
  assert.equal(model.projects.rows[0]?.tone, 'bad')
  assert.equal(model.projects.rows[1]?.tone, 'quiet')
})

test('day strip uses local midnight across DST and only actual scheduled observations', () => {
  const previous = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    const localNow = new Date(2026, 2, 8, 12).getTime()
    const finishedAt = new Date(2026, 2, 8, 9).toISOString()
    const facts = {
      ...routine('daily', 0),
      next: { at: localNow + 1000 },
      lastRun: { finishedAt, trigger: 'scheduled', status: 'failed', seconds: 10, usd: null, summary: '' },
    }
    const model = homeModel(input({
      now: localNow,
      routines: [facts],
      reports: [
        report('daily', 0, { scheduleId: 'daily', at: finishedAt, outcome: 'failed' }),
        report('work', 0, { at: finishedAt }),
      ],
    }))

    assert.equal(model.upcoming.day.end - model.upcoming.day.start, 23 * 3600000)
    assert.deepEqual(model.upcoming.day.marks.map(({ at, state }) => ({ at, state })), [{ at: Date.parse(finishedAt), state: 'failed' }, { at: localNow + 1000, state: 'next' }])
    assert.match(model.upcoming.summary, /1 run.*1 failed/)
    assert.equal(
      homeModel(input({ now: new Date(2026, 10, 1, 12).getTime() })).upcoming.day.end - new Date(2026, 10, 1).getTime(),
      25 * 3600000,
    )
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('forecasts exclude invalid, past and off times; last runs add only missing observations', () => {
  const facts = routine('log', 2000)
  facts.lastRun = { finishedAt: iso(1000), trigger: 'scheduled', status: 'completed', seconds: 1, usd: null, summary: '' }
  const routines = [routine('off', 0, 'off'), routine('bad', NaN), routine('past', -1), routine('third', 3000), facts, routine('first', 1000), routine('fourth', 4000)]
  const model = homeModel(input({ routines }))
  assert.deepEqual(model.upcoming.rows.map(row => row.id), ['routine:first', 'routine:log', 'routine:third'])
  assert.equal(model.upcoming.day.marks.filter(mark => mark.state === 'done').length, 1)
  assert.equal(model.upcoming.day.marks.filter(mark => mark.state === 'next').length, 4)
  assert.match(model.header.chips.map(chip => chip.label).join(' '), /first/)
})

test('week counts supplied completed and stopped records and validates wins as a whole', () => {
  const reports = [report('done'), report('failed', 1000, { outcome: 'failed' }), report('stopped', 1000, { outcome: 'interrupted' }), report('old', 8 * 86400000)]
  const wins = { today: { merged: 0, decided: 2 }, streak: 3 }
  const model = homeModel(input({ reports, wins }))
  assert.equal(model.week.days.length, 7)
  assert.equal(model.week.completed, 1)
  assert.equal(model.week.unfinished, 2)
  assert.deepEqual(model.week.wins, { merged: 0, decided: 2, streak: 3 })
  for (const bad of [
    [],
    null,
    { today: [], streak: 1 },
    { today: { merged: -1, decided: 0 }, streak: 1 },
    { today: { merged: 1.5, decided: 0 }, streak: 1 },
    { today: { merged: 1, decided: 0 }, streak: Infinity },
    { today: { merged: '1', decided: 0 }, streak: 1 },
    { today: { merged: NaN, decided: 0 }, streak: 1 },
    { today: { merged: 1, decided: 0 } },
  ]) {
    assert.equal(homeModel(input({ wins: bad })).week.wins, null)
  }
  assert.equal(homeModel(input({ wins: { today: { merged: 0, decided: 0 }, streak: 0 } })).stack.some(card => card.kind === 'today'), false)
})

test('running and header use real occupancy, holds and since-last-look without writing inputs', () => {
  const source = input({
    work: { ...work(), held: 'Waiting for budget' },
    agents: [
      agent('one'),
      agent('two'),
      { ...agent('routine'), kind: 'routine' },
      { ...agent('session'), kind: 'session' },
    ],
    reports: [report('a'), report('b'), report('c')],
    attention: [{ lastReadAt: iso(7200000) }],
  })
  const before = structuredClone(source)
  const model = homeModel(source)

  assert.equal(model.running.rows.length, 4)
  assert.equal(model.running.held, 'Waiting for budget')
  assert.equal(model.running.slots, '2 of 2 slots · 3 queued')
  assert.equal(
    homeModel({ ...source, work: { ...source.work!, agents: 0 } }).running.slots,
    '2 of 0 slots · 3 queued',
  )
  assert.match(model.header.line ?? '', /3 reports/)
  assert.ok(model.header.chips.some(chip => /held/i.test(chip.label)))
  assert.deepEqual(source, before)
})

test('unavailable input is neutral, while a published empty home can be calm', () => {
  const model = homeModel(input({
    live: false,
    question,
    reports: [report('stale')],
    work: work([change('stale')]),
    agents: [agent('stale')],
    contributions: [forge({ waiting: [1] })],
  }))

  assert.equal(model.header.mood, 'idle')
  assert.notEqual(model.header.title, 'Nothing needs you')
  assert.deepEqual([model.stack, model.needs.rows, model.running.rows, model.problems.rows, model.projects.rows, model.upcoming.rows, model.week.days], [[], [], [], [], [], [], []])
  assert.equal(model.connections.known, false)
  assert.equal(homeModel(input()).header.title, 'Nothing needs you')
})

test('stack ranks dated decisions oldest first, keeps untimed source order, and one per kind', () => {
  const model = homeModel(input({
    question,
    waiting: [action('new', iso()), action('old', iso(10000))],
    work: work([change('one'), change('two')]),
    agents: [agent('working'), agent('ask', 'Choose a version')],
    contributions: [forge({ waiting: [2, 1] })],
  }))

  assert.deepEqual(model.stack.map(card => card.kind), ['decision', 'question', 'review', 'agent', 'integration'])
  assert.equal(model.stack[0]?.primary.target.to, 'action')
  assert.equal(model.stack[0]?.id, 'decision:old')
  assert.equal(model.stack.find(card => card.kind === 'agent')?.id, 'agent:ask')
  assert.equal(model.stack.find(card => card.kind === 'integration')?.id, 'forge:2')
  assert.doesNotMatch(model.stack.find(card => card.kind === 'review')?.reason ?? '', /ago|minute|hour/)
})

test('the stack keeps a card of each integration, so a second code host is not hidden behind the first', () => {
  const model = homeModel(input({ contributions: [forge({ waiting: [2, 1] }), forge({ waiting: [7], failing: [8] }), forge({ failing: [9] })] }))
  assert.deepEqual(model.stack.filter(card => card.kind === 'integration').map(card => card.id), ['forge:2', 'forge:7', 'forge:9'])
})

test('stack keeps newest recent unread problems and request ahead of own failing checks', () => {
  const contributions = [forge({ waiting: [1], failing: [2] })]
  const model = homeModel(input({ reports: [report('old', 5000), report('new', 1000), report('read', 0), report('expired', 8 * 86400000), report('future', -1000)], read: new Set(['read']), contributions }))
  assert.deepEqual(model.stack.map(card => card.kind), ['problem', 'integration'])
  assert.equal(model.stack[0]?.id, 'problem:new')
  assert.equal(model.stack[0]?.next, 'Fix it')
  assert.equal(homeModel(input({ contributions: [forge({ failing: [2] })] })).stack[0]?.primary.target.to, 'url')
})

test('stack obeys away, routine, wins boundaries and caps seven kinds with stable IDs', () => {
  const reports = [report('a'), report('b'), report('c')]
  const base = input({ reports, attention: [{ lastReadAt: iso(7200000) }], routines: [routine('far', 900001), routine('edge', 900000)], wins: { today: { merged: 1, decided: 0 }, streak: 2 } })
  assert.deepEqual(homeModel(base).stack.map(card => card.kind), ['problem', 'away', 'upnext', 'today'])
  assert.equal(homeModel({ ...base, attention: [{ lastReadAt: iso(7199999) }] }).stack.some(card => card.kind === 'away'), false)
  assert.equal(homeModel({ ...base, attention: null }).stack.some(card => card.kind === 'away'), false)
  assert.equal(homeModel({ ...base, reports: reports.slice(0, 2) }).stack.some(card => card.kind === 'away'), false)
  assert.equal(homeModel({ ...base, attention: [null, { lastReadAt: 'bad' }] }).stack.some(card => card.kind === 'away'), false)
  assert.equal(homeModel({ ...base, routines: [routine('now', 0)] }).stack.find(card => card.kind === 'upnext')?.id, 'upnext:now')
  assert.equal(homeModel({ ...base, routines: [routine('past', -1), routine('far', 900001)] }).stack.some(card => card.kind === 'upnext'), false)
  assert.equal(homeModel({ ...base, now: new Date(2026, 10, 12, 16, 59).getTime() }).stack.some(card => card.kind === 'today'), false)
  assert.equal(homeModel({ ...base, now: new Date(2026, 10, 12, 17).getTime() }).stack.some(card => card.kind === 'today'), true)
  const full = { ...base, question, waiting: [action('decision')], work: work([change('one')]), agents: [agent('working')], contributions: [forge({ waiting: [1] })] }
  const stack = homeModel(full).stack
  assert.equal(stack.length, 7)
  assert.equal(new Set(stack.map(card => card.kind)).size, 7)
  assert.deepEqual(stack.map(card => card.id), homeModel(full).stack.map(card => card.id))
})

test('a finished change shows once: the item that asks about it opens its review, whatever head it named', () => {
  const branch = action('branch', iso(9000), { branch: true, pick: 'Merge it' })
  branch.item = {
    id: 'branch', key: null, from: 'hobkin', question: '', tldr: '', choices: [],
    answerTo: { kind: 'merge', slug: 'app', item: 'one', head: 'older-head' },
    recommended: null, why: 'Tests pass', changed: null, at: iso(9000),
  }
  const leftForYou = action('waiting:yours:app:two', iso(5000), { summary: 'two', from: 'App', opens: { screen: 'work' } })
  const one = { ...change('one'), about: 'Bumps the lockfile', size: { lines: 120, files: 4 }, behind: 3, conflict: true, grade: 'P1' as const }
  const model = homeModel(input({ waiting: [branch, leftForYou], work: work([one, change('two'), change('three')]) }))

  assert.deepEqual(model.needs.rows.map(row => row.id), ['decision:branch', 'decision:waiting:yours:app:two', 'review:app:three:head'])
  assert.deepEqual(model.needs.rows.map(row => row.action), [
    { label: 'Review', target: { to: 'review', change: one } },
    { label: 'Review', target: { to: 'review', change: change('two') } },
    { label: 'Review', target: { to: 'review', change: change('three') } },
  ])
  assert.match(model.header.title, /^3 things/)

  const card = model.stack[0]!
  assert.equal(card.id, 'decision:branch')
  assert.deepEqual(card.primary, { label: 'Review change', target: { to: 'review', change: one } })
  assert.equal(card.detail, 'Bumps the lockfile')
  assert.equal(card.pick, 'Merge it')
  assert.equal(card.why, 'Tests pass')
  assert.deepEqual(card.facts, [
    { label: 'Size', value: '120 lines · 4 files', tone: 'quiet' },
    { label: 'Grade', value: 'P1', tone: 'quiet' },
    { label: 'Behind', value: '3 commits', tone: 'warn' },
    { label: 'Conflicts', value: 'Yes', tone: 'bad' },
  ])
})

test('every card names what its button does and shows the choices it will ask', () => {
  const asked = { ...question, choices: [{ value: 'a', label: 'Keep it' }, { value: 'b', label: 'Drop it' }], recommended: 'b', why: 'It is unused' }
  const decision = action('decision', iso(), { pick: 'Yes', question: { id: 'decision', from: 'hobkin', question: 'Ship it?', choices: [{ value: 'y', label: 'Yes' }, { value: 'n', label: 'No' }] } })
  const contributions = [forge({ waiting: [1], failing: [2] })]
  const cards = homeModel(input({ question: asked, waiting: [decision], contributions, reports: [report('broken')], agents: [agent('busy'), agent('asks', 'Which version?')] })).stack
  const byKind = Object.fromEntries(cards.map(card => [card.kind, card]))

  assert.equal(byKind.question?.primary.label, 'Reply')
  assert.deepEqual(byKind.question?.choices, ['Keep it', 'Drop it'])
  assert.equal(byKind.question?.pick, 'Drop it')
  assert.equal(byKind.question?.why, 'It is unused')
  assert.equal(byKind.decision?.primary.label, 'Decide')
  assert.deepEqual(byKind.decision?.choices, ['Yes', 'No'])
  assert.equal(byKind.decision?.pick, 'Yes')
  assert.deepEqual(byKind.integration?.primary, { label: 'Review', target: { to: 'pull', url: 'https://forge.invalid/pull/1' } })
  assert.deepEqual(byKind.integration?.secondary, { label: 'Open', target: { to: 'url', url: 'https://forge.invalid/pull/1' } })
  assert.equal(byKind.problem?.primary.label, 'Read report')
  assert.equal(byKind.agent?.primary.label, 'Reply to agent')
})

test('an idle Running now previews the queue, and header chips go where they point', () => {
  const queue = ['first', 'skipped', 'second', 'third', 'fourth'].map((title, index) => ({
    key: `item:app:${index}`, kind: 'item', slug: 'app', project: 'App', item: String(index), title,
    grade: 'P2' as const, why: null, waiting: null, skipped: title === 'skipped', picked: false, tokens: null,
  }))
  const model = homeModel(input({ work: { ...work(), queue, held: 'Paused by you' }, agents: [agent('busy')], routines: [routine('soon', 60000)] }))

  assert.deepEqual(model.running.queue.map(row => row.title), ['first', 'second', 'third'])
  assert.deepEqual(model.running.queue[0]?.action.target, { to: 'screen', screen: 'work' })
  assert.equal(model.running.queue[0]?.aside, 'P2')
  assert.deepEqual(model.header.chips.map(chip => chip.target), [
    { to: 'screen', screen: 'work' },
    { to: 'routine', id: 'soon' },
    { to: 'screen', screen: 'work' },
  ])
})

test('a dismissed id leaves the stack, the needs row and the header count together', () => {
  const base = input({ question, waiting: [action('decide')] })
  const before = homeModel(base)
  assert.match(before.header.title, /^2 things/)
  assert.deepEqual(before.needs.rows.map(row => row.id), ['question:q', 'decision:decide'])
  assert.ok(before.stack.some(card => card.id === 'question:q'))

  const after = homeModel({ ...base, dismissed: new Set(['question:q']) })
  assert.match(after.header.title, /^1 thing needs/)
  assert.deepEqual(after.needs.rows.map(row => row.id), ['decision:decide'])
  assert.equal(after.stack.some(card => card.id === 'question:q'), false, 'the dismissed card is gone from the hero too')
  // A dismissed problem leaves the Problems widget and its stack card alike.
  const problems = input({ reports: [report('boom')] })
  assert.ok(homeModel(problems).problems.rows.some(row => row.id === 'problem:boom'))
  const quieted = homeModel({ ...problems, dismissed: new Set(['problem:boom']) })
  assert.equal(quieted.problems.rows.some(row => row.id === 'problem:boom'), false)
  assert.equal(quieted.stack.some(card => card.id === 'problem:boom'), false)
})

test('widgets are ordered most relevant first and the hero is empty when nothing needs you', () => {
  // Urgent: a waiting decision and a fresh problem lead the widget order.
  const busy = homeModel(input({ waiting: [action('decide')], reports: [report('boom')] }))
  assert.equal(busy.widgets[0]?.kind, 'needs')
  assert.ok(busy.widgets.findIndex(w => w.kind === 'needs') < busy.widgets.findIndex(w => w.kind === 'week'))
  assert.ok(busy.stack.length > 0)

  // Nothing needs the user: the stack is empty, so the screen shows no hero, and widgets still render.
  const calm = homeModel(input())
  assert.equal(calm.header.title, 'Nothing needs you')
  assert.deepEqual(calm.stack, [])
  assert.ok(calm.widgets.length > 0)

  // An external layout reorganizes the widgets and can hide a kind.
  const laid = homeModel(input({ waiting: [action('decide')], layout: { order: ['week'], hidden: ['needs'] } }))
  assert.equal(laid.widgets[0]?.kind, 'week')
  assert.equal(laid.widgets.some(w => w.kind === 'needs'), false)
})

test('the top strip carries the base tips plus hobkin thoughts, and dismissing one drops it for good', () => {
  const plain = homeModel(input())
  assert.ok(plain.strip.length >= 5, 'the five base tips are always there to rotate through')
  assert.ok(plain.strip.every(item => item.kind === 'tip'), 'no thoughts until hobkin sends any')
  assert.equal(plain.widgets.some(w => w.kind === ('tips' as never)), false, 'tips are not a grid widget any more')

  // A hobkin thought arrives in the snapshot and leads the strip, keyed so it reads as hobkin, not a canned tip.
  const withThought = homeModel(input({ thoughts: [{ id: 't1', text: 'Your deps PR has been green for a day — merge it?' }] }))
  assert.equal(withThought.strip[0]?.kind, 'thought')
  assert.equal(withThought.strip[0]?.id, 'thought:t1')
  assert.equal(withThought.strip.filter(item => item.kind === 'tip').length, 5)

  // Dismissing by the item's key removes exactly that item, tip or thought.
  const dismissed = homeModel(input({ thoughts: [{ id: 't1', text: 'x' }], dismissed: new Set(['thought:t1', 'tip:reload']) }))
  assert.equal(dismissed.strip.some(item => item.id === 'thought:t1'), false)
  assert.equal(dismissed.strip.some(item => item.id === 'tip:reload'), false)
  assert.equal(dismissed.strip.length, 4)

  // A malformed thought is dropped at the boundary.
  assert.equal(homeModel(input({ thoughts: [{ id: 'bad' }, 'nope'] })).strip.some(item => item.kind === 'thought'), false)
})

test('a custom widget hobkin authored rides the manifest and can be dismissed like the rest', () => {
  const london = { id: 'london', title: 'London', body: { kind: 'keyvalue', rows: [{ k: 'Time', v: '20:14' }] } }
  const withCustom = input({ custom: [london] })
  const model = homeModel(withCustom)
  const widget = model.widgets.find(w => w.id === 'custom:london')
  assert.ok(widget, 'the custom widget is in the manifest')
  assert.equal(widget.kind, 'custom')
  assert.equal(widget.custom?.title, 'London')

  // Its "×" dismisses it by its namespaced id, and it leaves the manifest.
  const dismissed = homeModel({ ...withCustom, dismissed: new Set(['custom:london']) })
  assert.equal(dismissed.widgets.some(w => w.id === 'custom:london'), false)
  // A malformed spec is dropped at the boundary rather than rendered.
  assert.equal(homeModel(input({ custom: [{ id: 'x', title: 'X' }] })).widgets.some(w => w.kind === 'custom'), false)
})

test('connections show gh and each Pi server, and a server waiting for sign-in needs the user', () => {
  const urls: Record<string, string> = {
    stripe: 'https://mcp.stripe.com', linear: 'https://mcp.linear.app/mcp', sentry: 'https://mcp.sentry.dev/mcp', notion: 'https://mcp.notion.com/mcp',
  }
  const server = (name: string, state: 'connected' | 'sign-in' | 'failed' | 'off' | 'connecting', error: string | null = null) => ({
    name, entry: { url: urls[name] ?? 'https://mine.invalid/mcp' }, state, tools: state === 'connected' ? [{ name: 't', does: '', effect: 'reads' as const }] : [], error,
  })
  const integrations = {
    path: '~/.pi/agent/mcp.json', problems: [], checking: false, checkedAt: iso(), error: null,
    servers: [server('stripe', 'sign-in'), server('linear', 'connected'), server('sentry', 'failed', 'Timed out'), server('notion', 'off'), server('mine', 'connecting')],
  }
  const model = homeModel(input({ integrations, contributions: [forge({ tile: true })] }))

  assert.deepEqual(model.connections.tiles.map(tile => [tile.key, tile.tone]), [
    ['fk', 'ok'], ['stripe', 'warn'], ['linear', 'ok'], ['sentry', 'bad'], ['notion', 'quiet'], ['mine', 'info'],
  ])
  assert.deepEqual(model.connections.tiles[0]?.target, { to: 'screen', screen: 'forge' })
  assert.deepEqual(model.connections.tiles[1]?.target, { to: 'screen', screen: 'integrations' })
  assert.equal(model.connections.tiles[3]?.note, 'Timed out')
  assert.equal(model.connections.summary, '2 connected · 1 needs sign-in · 1 failing')
  const need = model.needs.rows.find(row => row.kind === 'connection')
  assert.equal(need?.title, 'Sign in to stripe')
  assert.deepEqual(need?.action.target, { to: 'screen', screen: 'integrations' })
  assert.ok(model.problems.rows.some(row => row.title === 'sentry could not connect' && row.detail === 'Timed out'))
  assert.deepEqual(homeModel(input()).connections, { known: false, lift: 0, tiles: [], summary: null })
})

const yolo = (rest: Partial<YoloState> = {}): YoloState => ({
  on: true, rate: 8, lowest: 6, highest: 10, ready: 1,
  projects: [
    { slug: 'app', name: 'App', ready: true, needs: [] },
    { slug: 'api', name: 'API', ready: false, needs: ['Alerts: No alert reaches you.', 'Tests: None run.'] },
    { slug: 'docs', name: 'Docs', ready: false, needs: [] },
  ],
  ...rest,
})

test('YOLO mode shows as hobkin reports it: a chip to its page, and each project ready or with the first thing it needs', () => {
  const workScreen = { to: 'screen', screen: 'yolo' }
  const model = homeModel(input({ work: { ...work(), yolo: yolo() } }))
  assert.deepEqual(model.header.chips[0], { tone: 'accent', label: 'YOLO on · 1 of 3 ready', target: workScreen })
  assert.equal(model.yolo?.on, true)
  assert.equal(model.yolo?.rate, 8)
  assert.equal(model.yolo?.summary, '1 of 3 projects ready')
  assert.deepEqual(model.yolo?.projects, [
    { slug: 'app', name: 'App', ready: true, note: 'Ready' },
    { slug: 'api', name: 'API', ready: false, note: 'Alerts: No alert reaches you.' },
    { slug: 'docs', name: 'Docs', ready: false, note: 'Getting ready' },
  ])

  const off = homeModel(input({ work: { ...work(), yolo: yolo({ on: false }) } }))
  assert.deepEqual(off.header.chips[0], { tone: 'quiet', label: 'YOLO off', target: workScreen })
  assert.match(off.yolo?.says ?? '', /merges nothing/)
  assert.equal(homeModel(input({ work: { ...work(), yolo: yolo({ projects: [], ready: 0 }) } })).header.chips[0]?.label, 'YOLO on')

  // An older host sends no YOLO state, and an unavailable home knows nothing: no chip, and Home says it does not know yet.
  for (const unknown of [homeModel(input({ work: work() })), homeModel(input({ live: false, work: { ...work(), yolo: yolo() } }))]) {
    assert.equal(unknown.yolo, null)
    assert.equal(unknown.header.chips.some(chip => /YOLO/.test(chip.label)), false)
  }
})

test('held routines show as one chip that opens Routines', () => {
  const model = homeModel(input({ routines: [routine('a', 60000, 'held'), routine('b', 60000, 'held'), routine('c', 60000)] }))
  assert.deepEqual(model.header.chips.at(-1), { tone: 'warn', label: '2 routines held', target: { to: 'screen', screen: 'routines' } })
  assert.equal(homeModel(input({ routines: [routine('a', 60000, 'held')] })).header.chips.at(-1)?.label, '1 routine held')
  assert.equal(homeModel(input({ routines: [routine('c', 60000)] })).header.chips.some(chip => /held/.test(chip.label)), false)
})

test('each run on the day strip names its routine and opens its report, or the routine when no report says it', () => {
  const daily = routine('daily', 3_600_000)
  daily.routine.title = 'Daily sweep'
  daily.lastRun = { finishedAt: iso(7_200_000), trigger: 'scheduled', status: 'completed', seconds: 1, usd: null, summary: '' }
  const model = homeModel(input({
    routines: [daily],
    reports: [
      report('swept', 3_600_000, { scheduleId: 'daily', outcome: 'failed' }),
      report('Gone routine', 1_800_000, { scheduleId: 'gone' }),
    ],
  }))
  assert.deepEqual(model.upcoming.day.marks, [
    { at: now - 7_200_000, state: 'done', title: 'Daily sweep', target: { to: 'routine', id: 'daily' } },
    { at: now - 3_600_000, state: 'failed', title: 'Daily sweep', target: { to: 'report', id: 'swept' } },
    { at: now - 1_800_000, state: 'done', title: 'Gone routine', target: { to: 'report', id: 'Gone routine' } },
    { at: now + 3_600_000, state: 'next', title: 'Daily sweep', target: { to: 'routine', id: 'daily' } },
  ])
})

test('a project counts one problem, one change and one pull request in the singular', () => {
  const model = homeModel(input({
    work: work([change('one')], [{ ...project('app'), prs: 1 }]),
    reports: [report('only', 1000, { scheduleId: 'work.app.tests' })],
  }))
  assert.equal(model.projects.rows[0]?.detail, '1 problem · 1 change to review · 1 PR')
})

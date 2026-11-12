import assert from 'node:assert/strict'
import test from 'node:test'
import { homeModel } from '../src/features/home/model.ts'
import type { HomeInput } from '../src/features/home/types.ts'
import type { WaitingRow } from '../src/features/actions/items.ts'
import type { FinishedChange, WorkProject, WorkState } from '../../shared/protocol/work.ts'
import type { GitHubPull } from '../../shared/protocol/github.ts'
import type { Report } from '../src/features/reports/report.ts'
import type { RoutineFacts } from '../src/features/routines/rules.ts'
import type { RunningAgent } from '../src/app/running-agents.ts'

const now = new Date(2026, 10, 12, 18).getTime()
const iso = (ago = 0) => new Date(now - ago).toISOString()
const input = (rest: Partial<HomeInput> = {}): HomeInput => ({
  now,
  reports: [],
  read: new Set(),
  attention: null,
  waiting: [],
  question: null,
  work: null,
  live: true,
  github: {
    connection: 'unknown',
    login: null,
    reviews: [],
    pulls: [],
    issues: [],
    more: { reviews: false, pulls: false, issues: false },
    refreshedAt: null,
    refreshing: false,
    error: null,
    sample: false,
  },
  routines: [],
  agents: [],
  wins: null,
  ...rest,
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
const pull = (number: number, rest: Partial<GitHubPull> = {}): GitHubPull => ({
  repo: 'org/app', number, title: `PR ${number}`, labels: [], updatedAt: iso(), url: `https://github.com/org/app/pull/${number}`,
  draft: false, author: 'user', review: 'waiting', checks: 'passing', ...rest,
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
  const github = {
    ...input().github,
    connection: 'connected' as const,
    reviews: [pull(1), pull(2, { review: 'approved' })],
    more: { reviews: true, pulls: false, issues: false },
  }
  const model = homeModel(input({
    question,
    waiting: [branch],
    work: work(
      [change('one'), change('one', 'different'), change('two')],
      [project('proposal', 'proposed')],
    ),
    github,
  }))

  assert.equal(model.needs.rows.length, 5)
  assert.equal(model.needs.more, 1)
  assert.equal(model.needs.rows.filter(row => row.kind === 'review').length, 2)
  assert.match(model.header.title, /At least 6/)
  assert.equal(homeModel(input({ work: work([], [project('proposal', 'proposed')]) })).needs.rows[0]?.kind, 'proposal')
  assert.match(homeModel(input({ question, github: { ...github, more: { ...github.more, reviews: false } } })).header.title, /^2 things/)
  for (const answerTo of [
    { kind: 'merge', slug: 'other', item: 'one', head: 'head' },
    { kind: 'merge', slug: 'app', item: 'other', head: 'head' },
    { kind: 'merge', slug: 'app', item: 'one', head: 'other' },
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
  assert.match(model.projects.rows[0]?.detail ?? '', /2 problems/)
  assert.match(model.projects.rows[0]?.detail ?? '', /1 change/)
  assert.match(model.projects.rows[0]?.detail ?? '', /2 PRs/)
  assert.match(model.projects.rows[0]?.detail ?? '', /Paused/)
  assert.match(model.projects.rows[0]?.detail ?? '', /Failed to inspect/)
  assert.equal(model.projects.rows[0]?.tone, 'bad')
  assert.equal(model.projects.rows[1]?.tone, 'quiet')
})

test('GitHub counts waiting reviews and own failing PRs only when connected', () => {
  const github = { ...input().github, connection: 'connected' as const, reviews: [pull(1), pull(2, { review: 'approved' })], pulls: [pull(3, { checks: 'failing' }), pull(4)] }
  const model = homeModel(input({ github })).github
  assert.equal(model.known, true)
  assert.equal(model.reviews, 1)
  assert.equal(model.failing, 1)
  assert.deepEqual(model.rows.map(row => row.action.target), [{ to: 'url', url: pull(1).url }, { to: 'url', url: pull(3).url }])
  assert.deepEqual(homeModel(input({ github: { ...github, connection: 'signed-out' } })).github, { known: false, reviews: 0, failing: 0, rows: [] })
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
    assert.deepEqual(model.upcoming.day.marks, [{ at: Date.parse(finishedAt), state: 'failed' }, { at: localNow + 1000, state: 'next' }])
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
    github: { ...input().github, connection: 'connected', reviews: [pull(1)] },
  }))

  assert.equal(model.header.mood, 'idle')
  assert.notEqual(model.header.title, 'Nothing needs you')
  assert.deepEqual([model.stack, model.needs.rows, model.running.rows, model.problems.rows, model.projects.rows, model.upcoming.rows, model.week.days], [[], [], [], [], [], [], []])
  assert.equal(model.github.known, false)
  assert.equal(homeModel(input()).header.title, 'Nothing needs you')
})

test('stack ranks dated decisions oldest first, keeps untimed source order, and one per kind', () => {
  const model = homeModel(input({
    question,
    waiting: [action('new', iso()), action('old', iso(10000))],
    work: work([change('one'), change('two')]),
    agents: [agent('working'), agent('ask', 'Choose a version')],
    github: {
      ...input().github,
      connection: 'connected',
      reviews: [pull(2, { updatedAt: iso(99999999) }), pull(1)],
    },
  }))

  assert.deepEqual(model.stack.map(card => card.kind), ['decision', 'question', 'review', 'agent', 'github'])
  assert.equal(model.stack[0]?.primary.target.to, 'action')
  assert.equal(model.stack[0]?.id, 'decision:old')
  assert.equal(model.stack.find(card => card.kind === 'agent')?.id, 'agent:ask')
  assert.equal(model.stack.find(card => card.kind === 'github')?.id, 'github:org/app#2')
  assert.doesNotMatch(model.stack.find(card => card.kind === 'review')?.reason ?? '', /ago|minute|hour/)
})

test('stack keeps newest recent unread problems and request ahead of own failing checks', () => {
  const github = { ...input().github, connection: 'connected' as const, reviews: [pull(1)], pulls: [pull(2, { checks: 'failing' })] }
  const model = homeModel(input({ reports: [report('old', 5000), report('new', 1000), report('read', 0), report('expired', 8 * 86400000), report('future', -1000)], read: new Set(['read']), github }))
  assert.deepEqual(model.stack.map(card => card.kind), ['github', 'problem'])
  assert.equal(model.stack[1]?.id, 'problem:new')
  assert.equal(model.stack[1]?.next, 'Fix it')
  assert.equal(homeModel(input({ github: { ...github, reviews: [] } })).stack[0]?.primary.target.to, 'url')
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
  const full = { ...base, question, waiting: [action('decision')], work: work([change('one')]), agents: [agent('working')], github: { ...base.github, connection: 'connected' as const, reviews: [pull(1)] } }
  const stack = homeModel(full).stack
  assert.equal(stack.length, 7)
  assert.equal(new Set(stack.map(card => card.kind)).size, 7)
  assert.deepEqual(stack.map(card => card.id), homeModel(full).stack.map(card => card.id))
})

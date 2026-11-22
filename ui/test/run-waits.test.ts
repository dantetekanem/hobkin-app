import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import type { RunSummary, WireSnapshot } from '../../shared/protocol/snapshot.ts'
import { listedAgents, wordsOf } from '../src/features/hobkins/list.ts'
import { homeModel } from '../src/features/home/model.ts'
import type { HomeInput } from '../src/features/home/types.ts'
import { agentsFrom, waitingWords } from '../src/lib/host/frame.ts'

// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } } })
const { agentCounts } = await import('../src/app/running-agents.ts')

const run = (id: string, rest: Partial<RunSummary> = {}): RunSummary => ({ id, title: `Run ${id}`, state: 'running', kind: 'background', cwd: '/fake/app', ...rest })
const UNTIL = '2026-11-22T00:10:00.000Z'
const waiting = run('w1', { state: 'waiting', waitUntil: UNTIL, waitNote: 'Read the monitoring again.\nThen report.', waits: 1 })

test('a waiting run stays in the agents list as an agent that waits, at rest, its note for its words', () => {
  const snapshot: WireSnapshot = {
    runs: [run('r1'), waiting, run('done', { state: 'completed' })],
    jobActivity: { r1: [{ id: 'message:1:0', kind: 'assistant', text: 'Reading.' }], w1: [{ id: 'message:1:0', kind: 'assistant', text: 'Deployed.' }] },
  }

  const agents = listedAgents(snapshot)
  const agent = agents.find(({ id }) => id === 'w1')

  assert.deepEqual(agents.map(({ id }) => id), ['r1', 'w1'], 'in its own place, and an ended run still leaves')
  assert.equal(agent?.mood, 'idle')
  assert.equal(agent?.doing, waitingWords(UNTIL, Date.now()))
  assert.equal(agent?.update, 'Read the monitoring again.')
  assert.deepEqual(agent?.waits, { until: UNTIL, note: 'Read the monitoring again.' })
  assert.equal(wordsOf(snapshot, 'w1'), 'Read the monitoring again.', "the row's line is its note, not its last words")
})

test("a waiting run's row says until when in the dock's time, today, tomorrow, or once its time has come", () => {
  const toronto = { timeZone: 'America/Toronto', locale: 'en-US' }
  const afternoon = Date.parse('2026-11-21T20:00:00.000Z')
  assert.equal(waitingWords(UNTIL, afternoon, toronto), 'waiting until 7:10 PM')
  assert.equal(waitingWords(UNTIL, afternoon, { timeZone: 'Europe/Lisbon', locale: 'en-US' }), 'waiting until 12:10 AM tomorrow')
  assert.equal(waitingWords(UNTIL, afternoon, { timeZone: 'Europe/Lisbon', locale: 'en-GB' }), 'waiting until 00:10 tomorrow')
  assert.equal(waitingWords(UNTIL, Date.parse(UNTIL) + 1, toronto), 'about to carry on', 'its time came and it has not started again yet')
  assert.equal(waitingWords('not a time', afternoon, toronto), 'waiting')
})

test('the agents that wait for their time are counted apart from the ones at work', () => {
  const snapshot: WireSnapshot = { runs: [run('r1'), waiting, run('r2')] }
  const agents = [...agentsFrom(snapshot), { ...agentsFrom({ runs: [run('r3')] })[0]!, asks: 'Take the update now?' }]

  assert.deepEqual(agentCounts(agents), { working: 3, waiting: 1, needYou: 1 })
})

test("Home's chip counts the agents at work, and a card says that a waiting one waits", () => {
  const home = (agents: HomeInput['agents']): HomeInput => ({
    now: Date.now(), live: true, reports: [], read: new Set(), attention: null, waiting: [], question: null, work: null, routines: [], wins: null, integrations: null, dismissed: new Set(), layout: null, custom: null, thoughts: null,
    github: { connection: 'unknown', login: null, reviews: [], pulls: [], issues: [], more: { reviews: false, pulls: false, issues: false }, refreshedAt: null, refreshing: false, error: null, sample: false },
    agents,
  })

  const model = homeModel(home(agentsFrom({ runs: [run('r1'), waiting] })))

  assert.deepEqual(model.header.chips.map(({ label }) => label), ['1 working'])
  assert.deepEqual(model.stack.filter(({ kind }) => kind === 'agent').map(({ reason }) => reason), ['Working now'])
  const alone = homeModel(home(agentsFrom({ runs: [waiting] })))
  assert.deepEqual(alone.header.chips, [], 'no chip while nothing works')
  assert.deepEqual(alone.stack.filter(({ kind }) => kind === 'agent').map(({ reason, detail }) => [reason, detail]), [['Waiting', waitingWords(UNTIL, Date.now())]])
})

test('a host from before sends no waiting run, and the list says what it always did', () => {
  const snapshot: WireSnapshot = { runs: [run('r1'), run('old', { state: 'completed' })] }

  const agents = agentsFrom(snapshot)
  const ended = agentsFrom(snapshot, { includeEnded: true })

  assert.deepEqual(agents.map(({ id, doing, mood }) => ({ id, doing, mood })), [{ id: 'r1', doing: 'starting', mood: 'thinking' }])
  assert.ok(agents.every((agent) => !('waits' in agent)))
  assert.deepEqual(ended.map(({ doing }) => doing), ['starting', 'completed'])
})

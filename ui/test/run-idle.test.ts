import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import type { RunSummary, WireSnapshot } from '../../shared/protocol/snapshot.ts'
import { listedAgents } from '../src/features/hobkins/list.ts'
import { homeModel } from '../src/features/home/model.ts'
import type { HomeInput } from '../src/features/home/types.ts'
import { agentsFrom, idleWords } from '../src/lib/host/frame.ts'

// A job that lives until its agent says done sits idle between its turns (072-jobs-live-until-done): hobkin keeps its run
// `running` and marks it `idle`, with when its turn ended.

// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } } })
const { agentCounts, atRest, othersCount, waitingRowWords } = await import('../src/app/running-agents.ts')

const run = (id: string, rest: Partial<RunSummary> = {}): RunSummary => ({ id, title: `Run ${id}`, state: 'running', kind: 'background', cwd: '/fake/app', ...rest })
const SINCE = '2026-11-25T03:51:00.000Z'
const idle = run('j1', { idle: true, idleSince: SINCE })

test('an idle living job stays an agent of the list, at rest, saying since when it is idle, with its last words', () => {
  const snapshot: WireSnapshot = {
    runs: [run('r1'), idle],
    jobActivity: { r1: [{ id: 'message:1:0', kind: 'assistant', text: 'Reading.' }], j1: [{ id: 'message:1:0', kind: 'assistant', text: 'Merged the branch into main.' }] },
  }

  const [working, job] = listedAgents(snapshot)

  assert.deepEqual([working?.id, job?.id], ['r1', 'j1'])
  assert.deepEqual(job?.idle, { since: SINCE })
  assert.equal(job?.mood, 'idle')
  assert.equal(job?.doing, idleWords(SINCE, Date.now()))
  assert.equal(job?.update, 'Merged the branch into main.')
  assert.deepEqual([working, job].map((agent) => atRest(agent!)), [false, true], 'its face holds still')
  assert.equal(waitingRowWords(job!, job!.update), `${idleWords(SINCE, Date.now())} · Merged the branch into main.`)
  assert.equal(working?.idle, undefined)
})

test('a run is idle only while hobkin says so of a running run, and a turn starting takes it back to work', () => {
  const [working] = agentsFrom({ runs: [run('j1')] })
  const [ended] = agentsFrom({ runs: [run('j1', { state: 'completed', idle: true, idleSince: SINCE })] }, { includeEnded: true })

  assert.equal(working?.idle, undefined)
  assert.equal(working?.doing, 'starting')
  assert.equal(ended?.idle, undefined)
  assert.equal(ended?.doing, 'completed')
})

test("an idle job's row says since when in the dock's time: today, yesterday, or the weekday further back", () => {
  const toronto = { timeZone: 'America/Toronto', locale: 'en-US' }
  const sameNight = Date.parse('2026-11-25T04:30:00.000Z')
  assert.equal(idleWords(SINCE, sameNight, toronto), 'idle since 10:51 PM')
  assert.equal(idleWords(SINCE, sameNight, { timeZone: 'Europe/Lisbon', locale: 'en-GB' }), 'idle since 03:51')
  assert.equal(idleWords(SINCE, Date.parse('2026-11-25T15:00:00.000Z'), toronto), 'idle since 10:51 PM yesterday')
  assert.equal(idleWords(SINCE, Date.parse('2026-11-28T15:00:00.000Z'), toronto), 'idle since Tue 10:51 PM')
  assert.equal(idleWords('not a time', sameNight, toronto), 'idle')
})

test('the agents that sit idle are counted apart from the ones at work', () => {
  const counts = agentCounts(agentsFrom({ runs: [run('r1'), idle, run('w1', { state: 'waiting', waitUntil: SINCE })] }))

  assert.deepEqual(counts, { working: 1, waiting: 1, idle: 1, needYou: 0 })
  assert.equal(othersCount(counts), '1 working · 1 idle · 1 waiting')
  assert.equal(othersCount({ working: 2, waiting: 0, idle: 0 }), '2 working')
  assert.equal(othersCount({ working: 0, waiting: 0, idle: 2 }), '0 working · 2 idle')
})

test("Home's chip counts only the agents at work, and an idle job's card says it is idle", () => {
  const home = (agents: HomeInput['agents']): HomeInput => ({
    now: Date.now(), live: true, reports: [], read: new Set(), attention: null, waiting: [], question: null, work: null, routines: [], wins: null, integrations: null, dismissed: new Set(), layout: null, custom: null, thoughts: null,
    contributions: [],
    agents,
  })

  const model = homeModel(home(agentsFrom({ runs: [run('r1'), idle] })))
  const alone = homeModel(home(agentsFrom({ runs: [idle] })))

  assert.deepEqual(model.header.chips.map(({ label }) => label), ['1 working'])
  assert.deepEqual(alone.header.chips, [], 'no chip while nothing works')
  assert.deepEqual(alone.stack.filter(({ kind }) => kind === 'agent').map(({ label, reason, detail }) => [label, reason, detail]), [['Agent idle · app', 'Idle', idleWords(SINCE, Date.now())]])
})

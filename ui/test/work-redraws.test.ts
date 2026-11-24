import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { createElement, memo, useSyncExternalStore } from 'react'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { ReviewList } from '../../shared/review/status.ts'
import type { WorkState } from '../../shared/protocol/work.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'
import { sampleWork } from '../src/features/work/sample.ts'
import { counted, mountView, passing, readViews, stillMotion } from './view-draws.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
} })
// The page's frames never come here; what waits for one waits.
Object.assign(globalThis, { requestAnimationFrame: () => 0 })

// The review list as the host last answered it. The screen's hook gives a new view of it each time it draws.
let reviewList: ReviewList | null = null
const reviewReaders = new Set<() => void>()
const answerReviews = (list: ReviewList) => {
  reviewList = list
  for (const reader of reviewReaders) reader()
}
const refresh = () => {}
function readReviews(reader: () => void) {
  reviewReaders.add(reader)
  return () => {
    reviewReaders.delete(reader)
  }
}
function useReviewList() {
  const list = useSyncExternalStore(readReviews, () => reviewList)
  return { list, error: null, refresh }
}

// Work's sections, each counting its draws, under the Work screen's own layout. Motion, the entrances and buttons draw
// only their children. The tiles are a memo of their own, as the real ones are.
const draws: Record<string, number> = {}
const part = (name: string) => counted(draws, name)
const nothing = () => undefined
readViews({
  'motion/react': { motion: stillMotion, AnimatePresence: passing },
  'app/Reveal.tsx': { Hero: passing, Rise: passing },
  'app/stops.ts': { useStops: nothing, bindStops: nothing },
  'components/ui/button.tsx': { Button: passing },
  'features/work/page-arrival.tsx': { WhenWorkComes: passing, WorkPage: passing },
  'features/work/use-review-list.ts': { useReviewList },
  'features/work/WorkTiles.tsx': { WorkTiles: memo(part('WorkTiles')) },
  'features/work/DelegationMap.tsx': { DelegationMap: part('DelegationMap') },
  'features/work/Queue.tsx': { QueueSection: part('Queue'), ProjectsSection: part('Projects') },
  'features/work/Finished.tsx': { FinishedSection: part('Finished') },
  'features/work/PageTabs.tsx': { PageTabs: part('PageTabs'), TabCount: part('TabCount') },
  'features/work/AgentsStepper.tsx': { AgentsStepper: part('AgentsStepper') },
  'features/work/StatusLine.tsx': { StatusLine: part('StatusLine') },
  'features/work/WorkloadSheet.tsx': { WorkloadSheet: part('WorkloadSheet') },
  'features/work/NewProjectSheet.tsx': { NewProjectSheet: part('NewProjectSheet') },
  'features/work/parts.tsx': { SaidLine: part('SaidLine') },
  'features/work/AiReviews.tsx': { AiReviews: part('AiReviews') },
  'features/work/NumbersTab.tsx': { NumbersTab: part('NumbersTab') },
  'features/work/DecidedPanel.tsx': { DecidedPanel: part('DecidedPanel') },
  'features/work/Discovery.tsx': { Discovery: part('Discovery') },
})
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => { throw new Error('Connection must stay stopped') })
mock.method(HostConnection.prototype, 'command', async () => { throw new Error('Nothing here sends commands') })
const { hostStore } = await import('../src/lib/host/client.ts')
const { SAMPLE_REVIEW_LIST } = await import('../src/features/work/sample-reviews.ts')
const { WorkScreen } = await import('../src/features/work/WorkScreen.tsx')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const work: WorkState = { ...sampleWork(Date.parse('2026-11-23T15:00:00Z')), tokensToday: 1_000, dailyTokens: 100_000_000 }
// Work mode arrives whole, as parsed JSON: no object in it is one the window holds.
const sendWork = (changes: Partial<WorkState> = {}) => send({ type: 'state', rev: rev++, work: structuredClone({ ...work, ...changes }) })
const runs = ['worker', 'other'].map((id) => ({ id, kind: 'background' as const, state: 'running', title: `Agent ${id}`, cwd: '/fake/app' }))

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({
  type: 'state', rev: rev++, reset: true, set: { runs, reports: [] },
  activity: runs.map(({ id }) => ({ op: 'reset', job: id, entries: [{ id: 'message:1:0', kind: 'assistant', text: 'Starting' }] })),
})
sendWork()
answerReviews(structuredClone(SAMPLE_REVIEW_LIST))

const reset = () => {
  for (const name of Object.keys(draws)) delete draws[name]
}

test('each section of the Work screen draws only for its own part of what the host sends', async (t) => {
  const mounted = await mountView(() => createElement(WorkScreen))
  t.after(() => mounted.unmount())
  assert.ok(draws.DelegationMap && draws.Queue && draws.Finished && draws.Projects && draws.WorkTiles, 'every section drew as Work mounted')
  // While the screen arrives its rows take their turns, so every section draws. Then it has arrived.
  await mounted.change(() => mock.timers.tick(1_000))

  await t.test("today's token count draws the header that shows it and the workload sheet, and none of the other sections", async () => {
    reset()
    await mounted.change(() => sendWork({ tokensToday: 26_000 }))
    assert.deepEqual({ ...draws }, { WorkTiles: 1, StatusLine: 1, WorkloadSheet: 1 })
  })

  await t.test('an agent that starts a tool draws the map of agents and nothing else', async () => {
    reset()
    const tool = { id: 'tool:1', kind: 'tool' as const, name: 'bash', state: 'running' as const, input: '{"command":"ls"}' }
    await mounted.change(() => send({ type: 'state', rev: rev++, activity: [{ op: 'update', job: 'worker', entry: tool }] }))
    assert.deepEqual({ ...draws }, { DelegationMap: 1 })
  })

  await t.test('the review list read again with nothing new in it draws nothing', async () => {
    reset()
    await mounted.change(() => answerReviews(structuredClone(SAMPLE_REVIEW_LIST)))
    assert.deepEqual({ ...draws }, {})
  })
})

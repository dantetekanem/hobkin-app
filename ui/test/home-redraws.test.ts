import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { WorkState } from '../../shared/protocol/work.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'
import { sampleWork } from '../src/features/work/sample.ts'
import { mountCounting } from './render-count.ts'
import { readViews } from './view-draws.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
} })
readViews()
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => { throw new Error('Connection must stay stopped') })
mock.method(HostConnection.prototype, 'command', async () => { throw new Error('Nothing here sends commands') })
const { hostStore } = await import('../src/lib/host/client.ts')
const { useReports } = await import('../src/features/reports/store.ts')
const { useActionItems } = await import('../src/features/actions/store.ts')
const { useRoutines } = await import('../src/features/routines/store.ts')
const { gatherHomeInput } = await import('../src/features/home/input.ts')
const { homeModel } = await import('../src/features/home/model.ts')
const { HOME_WORK, useHomeModel } = await import('../src/features/home/use-home.ts')
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

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({ type: 'state', rev: rev++, reset: true, set: { runs: [{ id: 'worker', kind: 'background', state: 'running', title: 'Agent worker', cwd: '/fake/app' }], reports: [] } })
sendWork()
// Reports have been published, so Home reads the host as live.
useReports.setState({ ready: true, sample: false })

test("today's token counts in work mode build none of Home's model, and a part Home shows builds it once", async () => {
  let builds = 0
  let model: ReturnType<typeof useHomeModel> | undefined
  const Home = () => {
    const next = useHomeModel()
    if (next !== model) builds += 1
    model = next
    return null
  }
  const mounted = await mountCounting(() => createElement(Home))
  builds = 0

  for (let second = 1; second <= 5; second++) await mounted.change(() => sendWork({ tokensToday: 1_000 + second * 25_000 }))
  assert.equal(builds, 0, 'five token counts, no build')

  await mounted.change(() => sendWork({ tokensToday: 200_000, held: 'Paused until 9:00' }))
  assert.equal(builds, 1, 'work held is on Home, so it builds once')
  assert.ok(model!.header.chips.some(({ label }) => label === 'Work held'))
  await mounted.unmount()
})

test('Home builds the same model from the parts of work mode it keeps as from the whole of it', () => {
  const gather = (state: ReturnType<typeof hostStore.getState>) =>
    homeModel(gatherHomeInput(Date.parse('2026-11-23T15:00:00Z'), state, useReports.getState(), useActionItems.getState(), useRoutines.getState()))
  const state = hostStore.getState()
  const parts = Object.fromEntries(HOME_WORK.map((key) => [key, state.work![key]])) as unknown as WorkState
  assert.deepEqual(gather({ ...state, work: parts }), gather(state))
})

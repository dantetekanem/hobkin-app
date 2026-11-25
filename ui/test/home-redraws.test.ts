import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { WorkState } from '../../shared/protocol/work.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'
import { sampleWork } from '../src/features/work/sample.ts'
import { mountCounting } from './render-count.ts'
import { counted, mountView, passing, readViews, stillMotion } from './view-draws.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
} })
// Home's sections, each counting its draws, under Home's own layout. Motion and the entrance draw only their children.
const sections: Record<string, number> = {}
const section = (name: string) => counted(sections, name)
readViews({
  'motion/react': { motion: stillMotion, AnimatePresence: passing },
  'app/Reveal.tsx': { Rise: passing, Hero: passing },
  'features/home/Stage.tsx': { Stage: section('Stage'), StatusChips: section('StatusChips') },
  'features/home/Sections.tsx': Object.fromEntries(['Today', 'Needs', 'Yolo', 'Problems', 'Week', 'Projects', 'Custom'].map((name) => [name, section(name)])),
})
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
const { HomeView } = await import('../src/features/home/HomeView.tsx')
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

test('an agent that starts a tool draws the stage that shows it, and none of the sections that do not', async () => {
  const Home = () => createElement(HomeView, { model: useHomeModel() })
  const mounted = await mountView(() => createElement(Home))
  assert.ok(sections.Stage && sections.Needs && sections.Projects, 'every section drew as Home mounted')
  for (const name of Object.keys(sections)) delete sections[name]

  const tool = { id: 'tool:1', kind: 'tool' as const, name: 'bash', state: 'running' as const, input: '{"command":"ls"}' }
  await mounted.change(() => send({ type: 'state', rev: rev++, activity: [{ op: 'update', job: 'worker', entry: tool }] }))
  assert.deepEqual(sections, { Stage: 1 }, 'the agents at work are on the stage only')
  await mounted.unmount()
})

test('Home builds the same model from the parts of work mode it keeps as from the whole of it', () => {
  const gather = (state: ReturnType<typeof hostStore.getState>) =>
    homeModel(gatherHomeInput(Date.parse('2026-11-23T15:00:00Z'), state, useReports.getState(), useActionItems.getState(), useRoutines.getState()))
  const state = hostStore.getState()
  const parts = Object.fromEntries(HOME_WORK.map((key) => [key, state.work![key]])) as unknown as WorkState
  assert.deepEqual(gather({ ...state, work: parts }), gather(state))
})

test("a part's own change, such as a pull request the user ignored on this machine, draws Home again at once", async () => {
  const { setWindowParts } = await import('../src/integration/registry.ts')
  let ignored = false
  const heard = new Set<() => void>()
  const target = { to: 'url', url: 'https://code.example.invalid/acme/app/pull/1' } as const
  setWindowParts([{
    manifest: { id: 'forge', name: 'Forge', line: '', commands: {}, screens: [] },
    unknown: null,
    sample: () => null,
    home: () => ({ cards: ignored ? [] : [{ id: 'forge:1', label: 'Checks failing · app', reason: 'Checks failing', tone: 'bad', title: 'PR 1', detail: null, primary: { label: 'Open', target } }] }),
    subscribe(onChange) {
      heard.add(onChange)
      return () => heard.delete(onChange)
    },
  }])
  let model: ReturnType<typeof useHomeModel> | undefined
  const Home = () => {
    model = useHomeModel()
    return null
  }
  const mounted = await mountCounting(() => createElement(Home))
  assert.ok(model!.stack.some(({ id }) => id === 'forge:1'))
  await mounted.change(() => {
    ignored = true
    for (const onChange of heard) onChange()
  })
  assert.ok(!model!.stack.some(({ id }) => id === 'forge:1'), 'Home reads the part again without waiting for the next visit')
  await mounted.unmount()
  assert.equal(heard.size, 0, 'Home stops hearing the part once it is gone')
  setWindowParts([])
})


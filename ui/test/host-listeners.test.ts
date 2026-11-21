import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { ActivityEntry } from '../../shared/protocol/activity.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'

// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } } })
const { hostStore } = await import('../src/lib/host/client.ts')
const { useStartup } = await import('../src/features/work/store.ts')
const { useAgentThreads } = await import('../src/features/work/agent-threads.ts')

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const words = (job: string, text: string): HostMessage => ({ type: 'state', rev: rev++, activity: [{ op: 'update', job, entry: { id: 'message:1:0', kind: 'assistant', text } satisfies ActivityEntry }] })
send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })

test('a host message with no startup in it leaves the startup state alone', () => {
  send({ type: 'state', rev: rev++, reset: true, set: { runs: [{ id: 'r1', title: 'One', state: 'running' }] }, activity: [{ op: 'reset', job: 'r1', entries: [] }] })
  let told = 0
  const stop = useStartup.subscribe(() => void (told += 1))
  for (let index = 0; index < 5; index++) send(words('r1', `Step ${index}`))
  stop()
  assert.equal(told, 0)
})

test('agent threads read receipts only when the runs or the receipts change', async () => {
  // Receipts that count each read of a run's own.
  let reads = 0
  const receipts = () =>
    Object.defineProperty({}, 'r1', {
      enumerable: true,
      get: () => {
        reads += 1
        return []
      },
    })
  send({ type: 'state', rev: rev++, set: { steeringReceipts: receipts() } })
  useAgentThreads.setState({ notes: {} })
  await useAgentThreads.getState().send('r1', 'Wait for me', async () => ({ sent: true }))
  reads = 0
  for (let index = 0; index < 5; index++) send(words('r1', `More ${index}`))
  assert.equal(reads, 0, 'five messages of words read no receipts')
  send({ type: 'state', rev: rev++, set: { steeringReceipts: receipts() } })
  assert.equal(reads, 1, 'new receipts are read')
})

test('a start-over that does not say which runs there are keeps the notes, and a run that leaves the list takes its own', () => {
  const run = (id: string) => ({ id, title: `Run ${id}`, state: 'running' })
  send({ type: 'state', rev: rev++, reset: true, set: { runs: [run('r1'), run('r2')] }, activity: [{ op: 'reset', job: 'r1', entries: [] }] })
  useAgentThreads.setState({ notes: {} })
  useAgentThreads.getState().say('r1', 'Use the staging database')
  useAgentThreads.getState().say('r2', 'Take your time')
  useAgentThreads.getState().say('hobkin:0a1b2c3d', 'A durable hobkin is never a run of the list')

  // hobkin starts over: its state comes before its snapshot is read, with no runs and no activity in it.
  send({ type: 'state', rev: rev++, reset: true, set: {} })
  assert.deepEqual(Object.keys(useAgentThreads.getState().notes), ['r1', 'r2', 'hobkin:0a1b2c3d'], 'nothing is forgotten')

  send({ type: 'state', rev: rev++, reset: true, set: { runs: [run('r1'), run('r2')] }, activity: [{ op: 'reset', job: 'r1', entries: [] }] })
  send({ type: 'state', rev: rev++, set: { runs: [run('r1')] } })
  assert.deepEqual(Object.keys(useAgentThreads.getState().notes), ['r1', 'hobkin:0a1b2c3d'], 'r2 left the list')
})

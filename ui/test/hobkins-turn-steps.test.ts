import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import type { ActivityEntry } from '../../shared/protocol/activity.ts'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'
import { mountCounting } from './render-count.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
} })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })

const bash = (id: string, at: number): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name: 'bash', state: 'completed', input: JSON.stringify({ command: `npm test -- ${id}` }), output: 'ok', at })
const turn = (n: number) => `hobkin:0a1b2c3d:${n}`
/** What the hobkin's conversation holds of each turn, as `activity.before` reads it, and what the page asked for. */
const saved: Record<string, ActivityEntry[]> = {
  [turn(1)]: [bash('a', 1), bash('b', 2)],
  [turn(3)]: Array.from({ length: 5 }, (_, index) => bash(`old-${index}`, 10 + index)),
}
const asked: { job: string; before?: string }[] = []

const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => {
  throw new Error('Connection must stay stopped')
})
mock.method(HostConnection.prototype, 'command', async (name: string, args: { job: string; before?: string }) => {
  assert.equal(name, 'activity.before')
  asked.push(args)
  return { steps: saved[args.job] ?? [], more: false, found: args.before !== undefined }
})
const { hostStore } = await import('../src/lib/host/client.ts')
const { useTurnSteps } = await import('../src/features/hobkins/turn-steps.ts')
after(() => {
  mock.restoreAll()
  Reflect.deleteProperty(globalThis, 'window')
})

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })

test('a finished turn the host holds nothing of is read from the conversation once, one it holds whole is not read, and a full one reads what came before', async () => {
  // The host holds turn 2 whole, a full feed of turn 3, and nothing of turn 1 or of the turn in flight.
  const full = Array.from({ length: 200 }, (_, index) => bash(`new-${index}`, 100 + index))
  send({
    type: 'state', rev: rev++, reset: true,
    set: { runs: [], reports: [] },
    activity: [{ op: 'reset', job: turn(2), entries: [bash('c', 3)] }, { op: 'reset', job: turn(3), entries: full }],
  })
  let shown: ReturnType<typeof useTurnSteps> = {}
  const runs = [turn(1), turn(2), turn(3), turn(4)]
  const Page = () => {
    shown = useTurnSteps(runs, { live: turn(4) })
    return null
  }
  const mounted = await mountCounting(() => createElement(Page))
  await mounted.change(() => {})

  assert.deepEqual(asked, [{ job: turn(1) }, { job: turn(3), before: 'tool:new-0', at: 100 }], 'the turn in flight and one held whole are not read')
  const ids = (run: string) => shown[run]?.entries.map(({ id }) => id)
  assert.deepEqual(ids(turn(1)), ['tool:a', 'tool:b'])
  assert.deepEqual(ids(turn(2)), ['tool:c'])
  assert.deepEqual(ids(turn(3)), [...saved[turn(3)]!, ...full].map(({ id }) => id), 'what the conversation has, then what the host holds')
  assert.equal(shown[turn(4)], undefined)

  // Nothing changes on the host, so nothing is read again.
  await mounted.change(() => send({ type: 'state', rev: rev++, set: { reports: [] } }))
  assert.equal(asked.length, 2)
  // Once the host lets go of turn 2, its steps are read from the conversation.
  await mounted.change(() => send({ type: 'state', rev: rev++, activity: [{ op: 'reset', job: turn(2), entries: [] }] }))
  assert.deepEqual(asked.at(-1), { job: turn(2) })
  await mounted.unmount()
})

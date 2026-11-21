import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { MAIN_ACTIVITY, type ActivityEntry } from '#shared/protocol/activity.ts'
import type { HelloMessage, HostMessage, StateMessage } from '#shared/protocol/messages.ts'
import { applyHostMessage, initialHostState } from '../src/lib/host/state.ts'

const hello: HelloMessage = {
  type: 'hello',
  protocol: 1,
  home: '/tmp/home',
  model: 'scripted',
  owner: { state: 'live', limits: { images: 4, imageBytes: 1024 } },
  signIn: { status: 'signed-in' },
  models: null,
  viewState: null,
}

const startOver = (rev: number, rest: Partial<StateMessage> = {}): StateMessage => ({ type: 'state', rev, reset: true, set: {}, messages: [{ op: 'reset', messages: [] }], ...rest })
const said = (id: string, text: string): ActivityEntry => ({ id: `message:${id}`, kind: 'assistant', text })
const ran = (id: string, state: ActivityEntry['state']): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name: 'bash', state, input: '{"command":"pnpm test"}' })

test('a host from before activity steps sends the whole key, and it is applied as it always was', () => {
  let state = applyHostMessage(initialHostState, hello)
  state = applyHostMessage(state, startOver(0, { set: { busy: true, jobActivity: { r1: [said('1:0', 'Looking')] } } }))
  assert.deepEqual(state.snapshot.jobActivity, { r1: [said('1:0', 'Looking')] })

  state = applyHostMessage(state, { type: 'state', rev: 1, set: { jobActivity: { r1: [said('1:0', 'Looking at it'), ran('a', 'running')] } } })
  assert.deepEqual(state.snapshot.jobActivity, { r1: [said('1:0', 'Looking at it'), ran('a', 'running')] })
  state = applyHostMessage(state, { type: 'state', rev: 2, unset: ['jobActivity'] })
  assert.equal(state.snapshot.jobActivity, undefined)
})

test('a host that sends activity as steps builds the same activity, a job at a time', () => {
  let state = applyHostMessage(initialHostState, hello)
  state = applyHostMessage(state, startOver(0, { set: { busy: true }, activity: [{ op: 'reset', job: 'r1', entries: [said('1:0', 'Looking')] }, { op: 'reset', job: 'old', entries: [said('0:0', 'Done.')] }] }))
  assert.deepEqual(state.snapshot.jobActivity, { r1: [said('1:0', 'Looking')], old: [said('0:0', 'Done.')] })
  const old = (state.snapshot.jobActivity as Record<string, unknown>).old

  state = applyHostMessage(state, { type: 'state', rev: 1, activity: [{ op: 'update', job: 'r1', entry: said('1:0', 'Looking at it') }, { op: 'append', job: 'r1', entries: [ran('a', 'running')] }] })
  assert.deepEqual((state.snapshot.jobActivity as Record<string, unknown>).r1, [said('1:0', 'Looking at it'), ran('a', 'running')])
  assert.equal((state.snapshot.jobActivity as Record<string, unknown>).old, old, 'a job no step touched stays as it was')
  assert.equal(state.snapshot.busy, true, 'the other keys stay')

  state = applyHostMessage(state, { type: 'state', rev: 2, set: { busy: false } })
  assert.deepEqual(Object.keys(state.snapshot.jobActivity as object), ['r1', 'old'], 'a message without steps leaves the activity alone')
  state = applyHostMessage(state, { type: 'state', rev: 3, activity: [{ op: 'remove', job: 'old' }] })
  assert.deepEqual(Object.keys(state.snapshot.jobActivity as object), ['r1'])

  // A reconnect replaces everything held, activity too.
  state = applyHostMessage(state, startOver(0, { activity: [{ op: 'reset', job: 'r2', entries: [] }] }))
  assert.deepEqual(state.snapshot.jobActivity, { r2: [] })
  state = applyHostMessage(state, startOver(0))
  assert.equal(state.snapshot.jobActivity, undefined, 'a reset with no activity holds none')
})

test('steps for the main chat leave the jobs activity as it was', () => {
  let state = applyHostMessage(initialHostState, hello)
  state = applyHostMessage(state, startOver(0, { activity: [{ op: 'reset', job: 'r1', entries: [said('1:0', 'Looking')] }] }))
  const jobs = state.snapshot.jobActivity
  state = applyHostMessage(state, { type: 'state', rev: 1, activity: [{ op: 'append', job: MAIN_ACTIVITY, entries: [ran('m', 'running')] }] })
  assert.deepEqual(state.snapshot.mainActivity, [ran('m', 'running')])
  assert.equal(state.snapshot.jobActivity, jobs)
})

/** The window's step times, with the host store and its listener, loaded the way the window loads them. */
async function stepTimes() {
  registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } } })
  const { hostStore } = await import('../src/lib/host/client.ts')
  const { entryTimeOf } = await import('../src/features/agent-activity/use-agent-activity.ts')
  const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
  send(hello)
  return { send, entryTimeOf }
}

test('a run that left takes its step times with it', async () => {
  const { send, entryTimeOf } = await stepTimes()
  send(startOver(0, { activity: [{ op: 'reset', job: 'r1', entries: [said('1:0', 'Looking'), ran('a', 'running')] }, { op: 'reset', job: 'r2', entries: [said('1:0', 'Here')] }] }))
  assert.ok(entryTimeOf('r1', 'tool:a')?.started !== undefined)
  send({ type: 'state', rev: 1, activity: [{ op: 'remove', job: 'r1' }] })
  assert.equal(entryTimeOf('r1', 'message:1:0'), undefined)
  assert.equal(entryTimeOf('r1', 'tool:a'), undefined)
  assert.ok(entryTimeOf('r2', 'message:1:0'), 'a run that stays keeps its times')
  send(startOver(0))
  assert.equal(entryTimeOf('r2', 'message:1:0'), undefined, 'a reset without a run lets go of its times too')
})

test('a job seen as its tail and then whole keeps hobkin\'s times for its steps, and a call whose end the window missed gets none made up', async () => {
  const { send, entryTimeOf } = await stepTimes()
  const words = { ...said('1:0', 'Reading'), at: 1000 }
  const call = { ...ran('a', 'running'), at: 2000 }
  const brief = ({ input: _input, ...rest }: ActivityEntry) => rest
  // Its tail: the newest words, then the call. Then newer words come before the window ever saw the call end.
  send(startOver(0, { activity: [{ op: 'reset', job: 'r4', entries: [words, brief(call)] }] }))
  send({ type: 'state', rev: 1, activity: [{ op: 'reset', job: 'r4', entries: [{ ...said('2:0', 'Done'), at: 5000 }] }] })
  // Its page opens: the whole feed.
  send({ type: 'state', rev: 2, activity: [{ op: 'reset', job: 'r4', entries: [words, { ...call, state: 'completed' }, { ...said('2:0', 'Done'), at: 5000 }] }] })

  assert.deepEqual(entryTimeOf('r4', 'tool:a'), { seen: 2000, started: 2000 }, 'no end the window did not see')
  assert.equal(entryTimeOf('r4', 'message:1:0')?.seen, 1000)
})

test('a call that ends before the one after it still gets its end time', async () => {
  const { send, entryTimeOf } = await stepTimes()
  send(startOver(0, { activity: [{ op: 'reset', job: 'r3', entries: [ran('a', 'running'), ran('b', 'running')] }] }))
  send({ type: 'state', rev: 1, activity: [{ op: 'update', job: 'r3', entry: ran('a', 'completed') }] })
  assert.ok(entryTimeOf('r3', 'tool:a')?.ended !== undefined)
  assert.equal(entryTimeOf('r3', 'tool:b')?.ended, undefined)
})

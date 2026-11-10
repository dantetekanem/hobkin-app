import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { HelloMessage, StateMessage } from '#shared/protocol/messages.ts'
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

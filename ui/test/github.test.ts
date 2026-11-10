import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sampleGitHub } from '#shared/protocol/github.ts'
import type { HelloMessage, StateMessage } from '#shared/protocol/messages.ts'
import { applyHostMessage, initialHostState } from '../src/lib/host/state.ts'

const hello: HelloMessage = {
  type: 'hello',
  protocol: 1,
  home: '/tmp/home',
  model: 'scripted',
  owner: { state: 'opening' },
  signIn: { status: 'signed-in' },
  models: null,
  viewState: null,
}

const startOver = (rev: number, rest: Partial<StateMessage> = {}): StateMessage => ({ type: 'state', rev, reset: true, set: {}, messages: [{ op: 'reset', messages: [] }], ...rest })

test('the GitHub slice comes with state messages, and a reset without it means the host does not read GitHub', () => {
  const github = sampleGitHub(Date.parse('2026-11-10T09:00:00Z'))
  let state = applyHostMessage(initialHostState, hello)
  assert.equal(state.github, null, 'nothing before the host says')

  state = applyHostMessage(state, startOver(0, { github }))
  assert.deepEqual(state.github, github)
  state = applyHostMessage(state, { type: 'state', rev: 1, set: { busy: true } })
  assert.deepEqual(state.github, github, 'a message without the slice leaves it as it was')
  state = applyHostMessage(state, { type: 'state', rev: 2, github: { ...github, refreshing: true } })
  assert.equal(state.github?.refreshing, true)

  state = applyHostMessage(state, startOver(0))
  assert.equal(state.github, null)
})

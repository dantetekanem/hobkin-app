import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRefreshCode, refreshCodeButton, SAMPLE_REFRESH_CODE } from '../src/features/review/refresh-code.ts'
import type { StackStarted } from '../src/features/review/stack-start.ts'

const input = { merged: false, busy: false, code: { behind: 3, conflict: false, base: 'main' } }

test('the button shows only for an unmerged change known to be behind or in conflict', () => {
  assert.equal(refreshCodeButton(input).shown, true)
  assert.equal(refreshCodeButton({ ...input, code: { behind: 0, conflict: false, base: 'main' } }).shown, false, 'up to date')
  assert.equal(refreshCodeButton({ ...input, code: { behind: null, conflict: null, base: null } }).shown, false, 'nothing known')
  assert.equal(refreshCodeButton({ ...input, code: undefined }).shown, false, 'no code field')
  assert.equal(refreshCodeButton({ ...input, code: { behind: null, conflict: true, base: 'main' } }).shown, true)
  assert.equal(refreshCodeButton({ ...input, merged: true }).shown, false)
  assert.equal(refreshCodeButton({ ...input, busy: true }).busy, true)
  assert.equal(refreshCodeButton({ ...input, merged: true, busy: true }).busy, false)
})

test('the tooltip says what is behind, what conflicts, and what the agent does', () => {
  assert.equal(refreshCodeButton(input).tooltip, '3 commits behind main. An agent merges main into it, settles any conflict and runs the tests.')
  assert.match(refreshCodeButton({ ...input, code: { behind: 1, conflict: false, base: 'main' } }).tooltip, /^1 commit behind main\./)
  assert.equal(refreshCodeButton({ ...input, code: { behind: 0, conflict: true, base: 'main' } }).tooltip, 'It conflicts with main. An agent settles the conflict and runs the tests.')
  assert.equal(
    refreshCodeButton({ ...input, code: { behind: 3, conflict: true, base: 'main' } }).tooltip,
    '3 commits behind main, and it conflicts with it. An agent merges main into it, settles the conflict and runs the tests.',
  )
  assert.match(refreshCodeButton({ ...input, code: { behind: 2, conflict: false, base: null } }).tooltip, /^2 commits behind the branch it merges into\./)
})

function start({ live = true, answer = { hobkin: 'h1', run: 'r1', already: false } as StackStarted | Error } = {}) {
  const calls: string[] = []
  const opened: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const command = async (id: string) => {
    calls.push(id)
    await gate
    if (answer instanceof Error) throw answer
    return answer
  }
  return { flow: createRefreshCode({ id: 'pr:acme/shop/9', live, command, opened: (h) => opened.push(h) }), calls, opened, release }
}

test('a press asks once, a second press during the call does nothing, and the answer opens the agent', async () => {
  const { flow, calls, opened, release } = start()
  const first = flow.press()
  assert.equal(flow.getState().busy, true)
  await flow.press()
  assert.deepEqual(calls, ['pr:acme/shop/9'])
  release()
  await first
  assert.deepEqual(opened, ['h1'])
  assert.deepEqual(flow.getState(), { busy: false, error: null })
})

test('a refusal stays as one line until the next press', async () => {
  const refused = start({ answer: new Error('Its code is up to date.') })
  refused.release()
  await refused.flow.press()
  assert.deepEqual(refused.opened, [])
  assert.deepEqual(refused.flow.getState(), { busy: false, error: 'Its code is up to date.' })
})

test('with no host a press says a sample review starts nothing', async () => {
  const { flow, calls } = start({ live: false })
  await flow.press()
  assert.deepEqual(calls, [])
  assert.equal(flow.getState().error, SAMPLE_REFRESH_CODE)
  assert.match(SAMPLE_REFRESH_CODE, /sample review/i)
})

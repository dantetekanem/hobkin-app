import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sendChange } from '../src/features/chat/send-change.ts'

const refused = (message: string) => Object.assign(new Error(message), { code: 'unavailable' })

test('an agent is changed by its run, and a hobkin by its id, with only what the line named', async () => {
  const calls: unknown[][] = []
  const run = async (name: string, args: unknown) => (calls.push([name, args]), { message: 'It works on a/b at high from its next step.' })
  assert.deepEqual(await sendChange({ agent: 'work:a' }, { effort: 'high' }, { live: true, run: run as never }), { ok: true, message: 'It works on a/b at high from its next step.' })
  await sendChange({ hobkin: 'a1b2c3d4' }, { model: 'opus' }, { live: true, run: run as never })
  assert.deepEqual(calls, [['agent.change', { run: 'work:a', effort: 'high' }], ['hobkin.change', { id: 'a1b2c3d4', model: 'opus' }]])
})

test('a refusal says why, and a window with no host refuses a sample agent without asking', async () => {
  const run = async () => { throw refused('That agent is not working.') }
  assert.deepEqual(await sendChange({ agent: 'x' }, { effort: 'low' }, { live: true, run: run as never }), { ok: false, why: 'That agent is not working.' })
  const never = async () => { throw Error('asked') }
  assert.deepEqual(await sendChange({ agent: 'sample' }, { effort: 'low' }, { live: false, run: never as never }), { ok: false, why: 'A sample agent has no model to change.' })
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runCommand } from '../src/commands.ts'
import { workHandlers, type WorkApp } from '../src/work.ts'

/** Stands in for hobkin's application: it writes down every work action it is asked for, and answers with `answer`. */
function fakeHobkin(answer: unknown) {
  const calls: unknown[][] = []
  const app: WorkApp = {
    workAction: async (...args: unknown[]) => {
      calls.push(args)
      return answer
    },
    refresh: async () => {},
  }
  return { calls, handlers: workHandlers({ app: () => app, root: () => '/nowhere' }) }
}

const key = 'item:storefront:a1a1a1'

test("Start now is hobkin's own now work action, and what hobkin says of it comes back", async () => {
  const said = 'Queued "Fix the cart" on storefront to start at once. It starts now as one extra worker.'
  const { calls, handlers } = fakeHobkin({ ok: true, message: said, key })

  assert.deepEqual(await runCommand(handlers, 'work.queue', { row: key, action: 'now' }), { ok: true, value: { ok: true, message: said } })
  assert.deepEqual(calls, [['now', key]])
})

test('the other queue actions answer as they did, because hobkin says nothing of them', async () => {
  // hobkin's `run`, `later` and `back` answer with work mode's saved settings, which hold no message.
  const { calls, handlers } = fakeHobkin({ enabled: true, queueNext: [key], queueNow: [] })

  for (const action of ['run', 'skip', 'back'] as const) {
    assert.deepEqual(await runCommand(handlers, 'work.queue', { row: key, action }), { ok: true, value: { ok: true } }, action)
  }
  assert.deepEqual(calls, [['run', key], ['later', key], ['back', key]])
})

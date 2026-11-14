import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { HobkinApplication } from 'hobkin/src/cli/application.mjs'
import { resolveDataRoot } from 'hobkin/src/cli/migration/admission.mjs'
import { Client, hostFor } from './support.ts'

/** The events hobkin keeps in a home, oldest first. */
function events(root: string): Record<string, unknown>[] {
  const folder = join(resolveDataRoot(root), 'runtime', 'events')
  if (!existsSync(folder)) return []
  return readdirSync(folder).sort().flatMap((name) => readFileSync(join(folder, name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)))
}

test('the host says it takes timings, keeps a good shown message as a turn_shown event, and drops a bad one without closing', async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  t.after(() => client.close())
  await client.live()
  assert.equal(client.view.hello?.timings, true, 'its hello says it takes timings')

  let closed = false
  void client.closed().then(() => (closed = true))
  const good = { type: 'shown', id: 'run-1', arrivedMs: 812, shownMs: 950 }
  for (const bad of [
    { ...good, id: 7 },
    { ...good, id: 'r'.repeat(201) },
    { ...good, arrivedMs: -1 },
    { ...good, shownMs: 600001 },
    { ...good, arrivedMs: 951 },
    { type: 'shown' },
  ]) client.sendRaw(JSON.stringify(bad))
  client.sendRaw(JSON.stringify({ ...good, text: 'never kept' }))
  // A command after them answers once all of them have been handled.
  await client.run('host.code')

  assert.equal(closed, false, 'the connection stays open')
  const shown = events(host.root).filter(({ type }) => type === 'turn_shown')
  assert.deepEqual(shown.map(({ at: _at, ...facts }) => facts), [{ type: 'turn_shown', id: 'run-1', arrivedMs: 812, shownMs: 950 }])
})

test('a send passes the time the user sent it on to hobkin unchanged, and leaves it out when the window sent none', async (t) => {
  const calls: unknown[][] = []
  t.mock.method(HobkinApplication.prototype, 'send', async (...args: unknown[]) => {
    calls.push(args)
    return { id: `run-${calls.length}`, queued: false }
  })
  const host = await hostFor(t)
  const client = await Client.connect(host)
  t.after(() => client.close())
  await client.live()

  assert.deepEqual(await client.run('conversation.send', { text: 'Plan the week', sentAt: 1763114400000 }), { id: 'run-1', queued: false })
  await client.run('conversation.send', { text: 'And skip Friday' })

  assert.deepEqual(calls, [
    ['Plan the week', undefined, [], { sentAt: 1763114400000 }],
    ['And skip Friday', undefined, []],
  ])
})

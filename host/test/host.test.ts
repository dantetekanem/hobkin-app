import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

test('opens an empty home and sends the first state', async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  assert.equal(existsSync(root), false)

  const startedAt = performance.now()
  const host = await hostFor(t, { root })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  const view = await client.live()
  const took = performance.now() - startedAt

  assert.ok(took < 2000, `first state took ${Math.round(took)}ms`)
  assert.equal(view.hello?.protocol, 1)
  assert.equal(view.hello?.home, root)
  assert.equal(view.hello?.model, 'scripted')
  assert.ok(existsSync(join(root, 'config.json')), 'the home was created')

  // hobkin's first-run state: connected, nothing said, nothing scheduled, the scripted model in place.
  assert.deepEqual(view.messages, [])
  assert.equal(view.snapshot.busy, false)
  assert.deepEqual(view.snapshot.schedules, [])
  assert.deepEqual(view.snapshot.main, { harness: 'pi', model: 'hobkin-client/scripted', effort: 'medium' })
  assert.equal(view.signIn?.status, 'signed-in')
  for (const key of ['config', 'history', 'presentation']) assert.equal(key in view.snapshot, false, `${key} stays in the host`)

  // Where the shell finds a running host. Only the user may read it.
  const file = join(root, 'client', 'host.json')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pid: process.pid, port: host.port, token: host.token })
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.match(host.token, /^[\w-]{40,}$/)

  await host.close()
  assert.equal(existsSync(file), false, 'the file goes when the host stops')
})

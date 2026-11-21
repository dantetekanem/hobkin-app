import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { test } from 'node:test'
import { HobkinApplication } from 'hobkin/src/cli/application.mjs'
import { initialize } from 'hobkin/src/cli/config.mjs'
import { createScriptedModel } from '../src/scripted.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

test('a home another process holds is a fault until it lets go, then the host opens it', async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  initialize(root, { cwd: root })

  // Another owner of the home: it holds hobkin's lock and has said something.
  const model = await createScriptedModel(root, { reply: () => ({ text: 'Said elsewhere' }) })
  const other = await HobkinApplication.open(root, {
    createMain: model.createMain,
    runHarness: model.runHarness,
    fetch: async () => {
      throw Error('offline')
    },
  })
  let released = false
  afterTest(t, () => (released ? undefined : other.close()))
  await other.send('Hello from elsewhere')
  await other.runtime.idle()

  const host = await hostFor(t, { root, lockRetryMs: 200 })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const held = await client.until((view) => view.owner?.state === 'failed', 'the fault')
  assert.match(held.owner?.state === 'failed' ? held.owner.message : '', /Another process holds this home/)

  // Nothing goes into a home someone else runs, its model included, and the reason says so.
  const refused = await client.command('conversation.send', { text: 'Can you hear me?' })
  assert.equal(!refused.ok && refused.error.code, 'unavailable')
  assert.match(!refused.ok ? refused.error.message : '', /Another process holds this home/)
  const choosing = await client.command('models.select', { model: 'openai/gpt-test' })
  assert.match(!choosing.ok ? choosing.error.message : '', /Another process holds this home/)

  // The host keeps looking and leaves the lock to its holder.
  await pause(700)
  assert.equal(client.view.owner?.state, 'failed')
  assert.equal(existsSync(join(root, 'runtime.lock')), true)

  const releasedAt = performance.now()
  await other.close()
  released = true
  const live = await client.live()
  assert.ok(performance.now() - releasedAt < 5000, 'live within five seconds of the release')
  assert.deepEqual(live.messages.map(({ content }) => content), ['Hello from elsewhere', 'Said elsewhere'], 'the same home, now live')

  const sent = await client.command('conversation.send', { text: 'And now from the client' })
  assert.equal(sent.ok, true)
})

test('a home whose holder was killed outright opens in the host within seconds, not five minutes later', async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  initialize(root, { cwd: root })
  const runtime = join(root, 'runtime')
  mkdirSync(runtime, { recursive: true })

  // Another process holds hobkin's lock, as a host does until it is killed for taking too long to close.
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    const { lockHome } = await import(${JSON.stringify(import.meta.resolve('hobkin/src/cli/home-lock.mjs'))});
    await lockHome(${JSON.stringify(runtime)}, { onCompromised: () => {} });
    console.log('locked');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'] })
  afterTest(t, () => void holder.kill('SIGKILL'))
  await once(holder.stdout, 'data')

  const host = await hostFor(t, { root, lockRetryMs: 200 })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.until((view) => view.owner?.state === 'failed', 'the fault')

  const killedAt = performance.now()
  holder.kill('SIGKILL')
  await once(holder, 'exit')
  await client.live()
  assert.ok(performance.now() - killedAt < 5000, 'live within five seconds of the kill')
})

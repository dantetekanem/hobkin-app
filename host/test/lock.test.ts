import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { HobkinApplication } from 'hobkin/src/cli/application.mjs'
import { initialize } from 'hobkin/src/cli/config.mjs'
import { createScriptedModel } from '../src/scripted.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

test('serves the saved view while locked and goes live when released', async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  initialize(root, { cwd: root })

  // Another owner of the home, as the terminal app is: it holds hobkin's lock and has said something.
  const model = await createScriptedModel(root, { reply: () => ({ text: 'Said in the terminal' }) })
  const terminal = await HobkinApplication.open(root, {
    createMain: model.createMain,
    runHarness: model.runHarness,
    fetch: async () => {
      throw Error('offline')
    },
  })
  let released = false
  afterTest(t, () => (released ? undefined : terminal.close()))
  await terminal.send('Hello from the terminal')
  await terminal.runtime.idle()
  await terminal.refresh()

  const host = await hostFor(t, { root, lockRetryMs: 200 })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const saved = await client.until((view) => view.owner?.state === 'read-only', 'the saved view')
  assert.deepEqual(saved.owner, { state: 'read-only', holder: 'terminal', savedAt: saved.owner?.state === 'read-only' ? saved.owner.savedAt : null })
  assert.match(String(saved.owner?.state === 'read-only' && saved.owner.savedAt), /^\d{4}-\d{2}-\d{2}T/)
  assert.deepEqual(saved.messages.map(({ content }) => content), ['Hello from the terminal', 'Said in the terminal'])
  assert.equal(saved.snapshot.connection, 'offline')

  // Nothing can be sent into a home someone else owns, and the reason names who holds it.
  const refused = await client.command('conversation.send', { text: 'Can you hear me?' })
  assert.equal(!refused.ok && refused.error.code, 'unavailable')
  assert.match(!refused.ok ? refused.error.message : '', /open in the terminal/)
  // Nor can its model be chosen from here: the terminal owns its configuration while it runs.
  const choosing = await client.command('models.select', { model: 'openai/gpt-test' })
  assert.match(!choosing.ok ? choosing.error.message : '', /open in the terminal/)

  // What the other owner says next shows here too, still read-only.
  await terminal.send('One more')
  await terminal.runtime.idle()
  await terminal.refresh()
  await client.until((view) => view.messages.some(({ content }) => content === 'One more'), 'the newer saved view')
  assert.equal(client.view.owner?.state, 'read-only')

  const releasedAt = performance.now()
  await terminal.close()
  released = true
  const live = await client.live()
  assert.ok(performance.now() - releasedAt < 5000, 'live within five seconds of the release')
  assert.equal(live.messages.filter(({ role }) => role === 'user').length, 2, 'the same conversation, now live')

  const sent = await client.command('conversation.send', { text: 'And now from the client' })
  assert.equal(sent.ok, true)
})

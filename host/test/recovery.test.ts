import assert from 'node:assert/strict'
import { existsSync, mkdirSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { test } from 'node:test'
import { APP_ORIGIN } from '../src/access.ts'
import { afterTest, Client, runHostProcess, temporaryDirectory, type View } from './support.ts'

const mainRuns = (view: View) => (view.snapshot.runs ?? []).filter((run) => run.kind === 'main').map(({ title, state }) => `${title}: ${state}`)

test('marks an unfinished run interrupted and does not replay it', { timeout: 30000 }, async (t) => {
  const base = temporaryDirectory(t)
  const root = join(base, 'home')
  const userHome = join(base, 'user')
  mkdirSync(userHome)
  const start = () => runHostProcess(t, ['--home', root], { HOME: userHome })

  const first = await start()
  const before = await Client.connect(first.address(root), { origin: APP_ORIGIN })
  await before.live()
  // "hold" is the scripted model's cue to keep its turn open, so the run is still going when the host dies.
  await before.run('conversation.send', { text: 'hold' })
  const running = await before.until((view) => mainRuns(view).includes('Conversation: running') && view.turns.some(({ event }) => event.kind === 'text-end'), 'a run under way')
  assert.equal(running.snapshot.busy, true)

  // The host dies with no chance to finish anything: no receipt for the run, and its lock left behind.
  await first.kill('SIGKILL')
  // hobkin takes a lock over once its owner has not refreshed it for five minutes. This is those minutes passing.
  const longAgo = new Date(Date.now() - 6 * 60000)
  utimesSync(join(root, 'runtime.lock'), longAgo, longAgo)

  const second = await start()
  const after = await Client.connect(second.address(root), { origin: APP_ORIGIN })
  afterTest(t, () => after.close())
  const view = await after.live()
  assert.deepEqual(mainRuns(view), ['Conversation: interrupted'])
  assert.equal(view.snapshot.busy, false)
  assert.deepEqual(view.messages.map(({ role, content }) => `${role}: ${content}`), ['user: hold'], 'what was asked is still there, unanswered')

  // Several of hobkin's ticks later nothing has started by itself: no turn, no second run, no model call.
  await pause(2500)
  assert.deepEqual(mainRuns(after.view), ['Conversation: interrupted'])
  assert.deepEqual(after.view.turns, [])
  assert.equal(after.view.messages.length, 1)
  assert.equal(after.view.snapshot.busy, false)
})

test('a host that is asked to stop ends its turn, releases the home and leaves no address behind', { timeout: 30000 }, async (t) => {
  const base = temporaryDirectory(t)
  const root = join(base, 'home')
  const userHome = join(base, 'user')
  mkdirSync(userHome)
  const start = () => runHostProcess(t, ['--home', root], { HOME: userHome })

  const first = await start()
  const before = await Client.connect(first.address(root), { origin: APP_ORIGIN })
  await before.live()
  await before.run('conversation.send', { text: 'hold' })
  await before.until((view) => mainRuns(view).includes('Conversation: running') && view.turns.some(({ event }) => event.kind === 'text-end'), 'a run under way')

  // The shell stops the host with a signal. It gets the time to close hobkin properly.
  assert.equal(await first.kill('SIGTERM'), 0)
  assert.equal(existsSync(join(root, 'client', 'host.json')), false, 'no address of a host that is gone')
  assert.equal(existsSync(join(root, 'runtime.lock')), false, 'the home is free for the next owner at once')

  // Nothing had to go stale: the next host opens the home straight away and finds the turn ended, not replayed.
  // hobkin itself ended it this time, so it has a receipt, and hobkin's word for a turn the model did not finish is "incomplete".
  const second = await start()
  const after = await Client.connect(second.address(root), { origin: APP_ORIGIN })
  afterTest(t, () => after.close())
  const view = await after.live()
  assert.deepEqual(mainRuns(view), ['Conversation: incomplete'])
  assert.equal(view.snapshot.busy, false)
  assert.deepEqual(after.view.turns, [])
})

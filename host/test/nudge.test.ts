import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { StateMessage } from '#shared/protocol/messages.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { Nudges } from '../src/nudge.ts'
import { afterTest, Client, hostFor } from './support.ts'

test('the nudges holder records each instruction with a new id and tells the window once', () => {
  let changes = 0
  const nudge = new Nudges({ onChange: () => (changes += 1) })
  assert.equal(nudge.state, null)

  assert.deepEqual(nudge.open('reports'), { id: 1, action: { kind: 'open', screen: 'reports' } })
  assert.deepEqual(nudge.spotlight(), { id: 2, action: { kind: 'spotlight' } })
  assert.deepEqual(nudge.back(), { id: 3, action: { kind: 'back' } })
  assert.deepEqual(nudge.draft('land the storefront fix'), { id: 4, action: { kind: 'draft', text: 'land the storefront fix' } })
  assert.equal(changes, 4, 'the window is told once for each instruction')

  // A screen the window does not know is refused rather than sent on.
  assert.throws(() => nudge.open('nowhere' as never), /no screen named/)
})

test('the client tool exposes navigation and drafting and keeps merges and ship behind the user', async () => {
  // No handlers are needed to see what the gate lets hobkin run: list reads the registry.
  const tool = createClientTool({ run: (name, args) => runCommand({} as never, name, args) })
  const listed = new Set((JSON.parse((await tool.execute('1', { action: 'list' })).content[0]!.text) as { name: string }[]).map(({ name }) => name))

  // Phase 1 flag-flips and Phase 2 commands are now reachable.
  for (const name of [
    'routine.enable', 'routine.times', 'routine.delete', 'report.read', 'report.delete',
    'learning.answer', 'question.answer', 'question.defer',
    'work.mode', 'work.queue', 'work.project', 'work.proposal', 'work.agents', 'work.tokens',
    'view.open', 'view.spotlight', 'view.back', 'conversation.draft',
  ]) {
    assert.ok(listed.has(name), `${name} should be reachable by hobkin`)
  }

  // Merges and ship stay the user's, and a decision answer can trigger a merge, so none of these are reachable.
  for (const name of ['work.change', 'work.group', 'decision.answer', 'review.verdict']) {
    assert.ok(!listed.has(name), `${name} must stay behind the user`)
    await assert.rejects(tool.execute('2', { action: 'run', name, args: {} }), Error, name)
  }
})

test('the host tells the window to navigate, and never replays the move on a reconnect', async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  const nudges = () => client.received.filter((message): message is StateMessage => message.type === 'state' && message.nudge !== undefined).map((message) => message.nudge)

  // Nothing has been sent as a nudge until hobkin asks for one.
  assert.equal(nudges().length, 0)
  await client.run('view.open', { screen: 'work' })
  await client.until(() => nudges().at(-1)?.action.kind === 'open', 'the window to be sent to a screen')
  assert.deepEqual(nudges().at(-1), { id: 1, action: { kind: 'open', screen: 'work' } })

  await client.run('conversation.draft', { text: 'jot this down' })
  await client.until(() => nudges().at(-1)?.action.kind === 'draft', 'the composer to be given words')
  assert.deepEqual(nudges().at(-1), { id: 2, action: { kind: 'draft', text: 'jot this down' } })

  // A fresh connection gets the full state, which never carries a one-shot instruction, so it does not re-navigate.
  const reopened = await Client.connect(host)
  afterTest(t, () => reopened.close())
  await reopened.live()
  assert.equal(reopened.received.filter((message) => message.type === 'state' && message.nudge !== undefined).length, 0)
})

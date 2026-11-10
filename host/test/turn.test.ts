import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TurnEvent } from '#shared/protocol/turn.ts'
import { afterTest, Client, hostFor } from './support.ts'

test('forwards main-session events in order', async (t) => {
  const host = await hostFor(t, { scripted: { reply: () => ({ thinking: 'Hm.', text: 'One two three' }) } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()

  await client.run('conversation.send', { text: 'Count' })
  const view = await client.until((now) => now.turns.some(({ event }) => event.kind === 'settled'), 'the end of the turn')
  const events = view.turns.map(({ event }) => event)
  const kinds = events.map(({ kind }) => kind)

  // Pi's own order: the run starts, what the model is given goes in (hobkin's note, then the user's message),
  // and the reply is written block by block.
  const reply = kinds.slice(kinds.lastIndexOf('message-start'))
  assert.deepEqual(reply, ['message-start', 'thinking-start', 'thinking-end', 'text-start', 'text-delta', 'text-delta', 'text-delta', 'text-end', 'message-end', 'end', 'settled'])
  assert.deepEqual(kinds.slice(0, kinds.lastIndexOf('message-start')), ['start', 'message-start', 'message-end', 'message-start', 'message-end'])
  assert.deepEqual(
    events.filter((event) => event.kind === 'message-start').map((event) => (event as Extract<TurnEvent, { kind: 'message-start' }>).role),
    ['system', 'user', 'assistant'],
  )

  const deltas = events.filter((event): event is Extract<TurnEvent, { kind: 'text-delta' }> => event.kind === 'text-delta')
  assert.equal(deltas.map(({ delta }) => delta).join(''), 'One two three')
  assert.deepEqual(events.find((event) => event.kind === 'text-end'), { kind: 'text-end', index: 1, text: 'One two three' })
  assert.deepEqual(events.at(-1), { kind: 'settled', aborted: false })
  assert.deepEqual(events.findLast((event) => event.kind === 'message-end'), { kind: 'message-end', role: 'assistant', stop: 'stop' })

  // Numbered as they were emitted, with no gap, so the UI can rely on the order.
  assert.deepEqual(view.turns.map(({ seq }) => seq), view.turns.map((_, index) => index + 1))

  // Only what changed travels: no event carries the message so far.
  for (const turn of view.turns) assert.ok(JSON.stringify(turn).length < 200, JSON.stringify(turn))
})

test('a UI that connects during a reply gets what was written so far', async (t) => {
  const host = await hostFor(t, { scripted: { reply: () => ({ text: 'Still here', hold: true }) } })
  const first = await Client.connect(host)
  afterTest(t, () => first.close())
  await first.live()
  await first.run('conversation.send', { text: 'Stay' })
  await first.until((now) => now.turns.some(({ event }) => event.kind === 'text-end'), 'the held reply')

  const late = await Client.connect(host)
  afterTest(t, () => late.close())
  const view = await late.until((now) => now.turns.length >= 3, 'the catch-up')
  assert.deepEqual(view.turns.map(({ event }) => event), [
    { kind: 'message-start', role: 'assistant' },
    { kind: 'text-start', index: 0 },
    { kind: 'text-delta', index: 0, delta: 'Still here' },
  ])

  await first.run('conversation.stop')
})

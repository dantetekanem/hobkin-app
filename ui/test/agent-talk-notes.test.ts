import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HobkinSummary } from '../../shared/protocol/hobkins.ts'
import { waitsForTurn as hobkinWaits } from '../src/features/hobkins/conversation.ts'
import { useAgentThreads, waitsForTurn } from '../src/features/work/agent-threads.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { initialHostState } from '../src/lib/host/state.ts'

test("a note sent into an agent's turn waits above the box until the turn reads it, and one taken back leaves the page", async () => {
  hostStore.setState(initialHostState, true)
  useAgentThreads.setState({ notes: {} })
  let id = ''

  await useAgentThreads.getState().send('run', 'Then sum it up', (noteId) => ((id = noteId), Promise.resolve({ sent: true })), undefined, 'follow-up')
  const [note] = useAgentThreads.getState().notes.run!
  assert.deepEqual([note!.queue, note!.delivery, waitsForTurn(note!)], ['follow-up', 'waiting', true])

  hostStore.setState({ snapshot: { steeringReceipts: { run: [{ noteId: id, at: 5 }] } } })
  assert.equal(waitsForTurn(useAgentThreads.getState().notes.run![0]!), false, 'read, it joins the steps')

  useAgentThreads.getState().drop('run', [id])
  assert.deepEqual(useAgentThreads.getState().notes.run, [])
})

test("a note sent into a durable hobkin's turn waits while that turn works and has not read it", () => {
  const working = { state: 'working', run: 'hobkin:a1b2c3d4:2' } as HobkinSummary
  const note = { text: 'Only weekdays', at: 1, run: 'hobkin:a1b2c3d4:2', started: false, queue: 'steer' as const }

  assert.equal(hobkinWaits(note, working), true)
  assert.equal(hobkinWaits({ ...note, receivedAt: 2 }, working), false, 'the turn read it')
  assert.equal(hobkinWaits(note, { ...working, run: 'hobkin:a1b2c3d4:3' }), false, 'its turn is over')
  assert.equal(hobkinWaits({ text: 'Sending', at: 3, queue: 'steer' }, working), true, 'on its way into the turn')
  assert.equal(hobkinWaits({ text: 'Started a turn', at: 4 }, working), false)
})

import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { KeptNote } from '#shared/protocol/hobkins.ts'
import { useAgentThreads, waitsForTurn } from '../src/features/work/agent-threads.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { initialHostState } from '../src/lib/host/state.ts'

beforeEach(() => hostStore.setState(initialHostState, true))

for (const beforeAck of [true, false]) {
  test(`exact steering receipt survives ${beforeAck ? 'later' : 'earlier'} ACK and view switches`, { timeout: 1000 }, async () => {
    hostStore.setState(initialHostState, true)
    useAgentThreads.setState({ notes: {} })
    let acknowledge!: (result: { sent: true }) => void
    const ack = new Promise<{ sent: true }>((resolve) => { acknowledge = resolve })
    let id = ''
    const pending = useAgentThreads.getState().send('run', 'Same words', (noteId) => { id = noteId; return ack })
    const publish = (run: string, noteId: string) => hostStore.setState({ snapshot: { steeringReceipts: { [run]: [{ noteId, at: 123 }] } } })
    publish('other', id)
    publish('run', 'wrong-id')
    assert.equal(useAgentThreads.getState().notes.run![0]!.delivery, 'sending')
    if (beforeAck) publish('run', id)
    acknowledge({ sent: true })
    await pending
    if (!beforeAck) publish('run', id)
    useAgentThreads.getState().say('other', 'A different view')
    hostStore.setState({ snapshot: { runs: [{ id: 'run', title: 'Done', state: 'completed' }] } })
    assert.equal(useAgentThreads.getState().notes.run![0]!.delivery, 'received')
    assert.equal(useAgentThreads.getState().notes.run![0]!.receivedAt, 123)
  })
}

test('a late transport error cannot revoke an exact receipt', { timeout: 1000 }, async () => {
  useAgentThreads.setState({ notes: {} })
  const result = await useAgentThreads.getState().send('run', 'Wait', async (noteId) => {
    hostStore.setState({ snapshot: { steeringReceipts: { run: [{ noteId, at: 123 }] } } })
    throw Error('Connection closed')
  })
  assert.deepEqual(result, { sent: true })
  assert.equal(useAgentThreads.getState().notes.run![0]!.delivery, 'received')
})

test('terminal runs leave unreceived notes unconfirmed, even before ACK', { timeout: 1000 }, async () => {
  hostStore.setState(initialHostState, true)
  useAgentThreads.setState({ notes: {} })
  let acknowledge!: (result: { sent: true }) => void
  const ack = new Promise<{ sent: true }>((resolve) => { acknowledge = resolve })
  const pending = useAgentThreads.getState().send('run', 'Please wait', () => ack)
  hostStore.setState({ snapshot: { runs: [{ id: 'run', title: 'Done', state: 'completed' }] } })
  hostStore.setState({ snapshot: {} })
  acknowledge({ sent: true })
  await pending
  assert.equal(useAgentThreads.getState().notes.run![0]!.delivery, 'unconfirmed')
  assert.equal(useAgentThreads.getState().notes.run![0]!.text, 'Please wait')
})

test('steering stays in its run while sending and after a late queue acknowledgement', { timeout: 1000 }, async () => {
  useAgentThreads.setState({ notes: {} })
  let finish!: (value: { sent: true }) => void
  const pending = useAgentThreads.getState().send('run-a', 'Wait for me', () => new Promise((resolve) => { finish = resolve }))
  const first = useAgentThreads.getState().notes['run-a']![0]!
  assert.equal(first.text, 'Wait for me')
  assert.equal(first.delivery, 'sending')
  useAgentThreads.getState().say('run-b', 'Different agent')
  assert.equal(useAgentThreads.getState().notes['run-a']![0]!.id, first.id)
  finish({ sent: true })
  await pending
  const note = useAgentThreads.getState().notes['run-a']![0]!
  assert.equal(note.delivery, 'waiting')
  assert.equal(note.id, first.id)
  assert.equal(note.at, first.at)
  assert.equal(useAgentThreads.getState().notes['run-b']!.length, 1)
})

test('a refused send retains its words and reason on that run', { timeout: 1000 }, async () => {
  useAgentThreads.setState({ notes: {} })
  await useAgentThreads.getState().send('ended', 'Please wait', async () => ({ sent: false, why: 'It has finished.' }))
  assert.equal(useAgentThreads.getState().notes.ended![0]!.delivery, 'refused')
  assert.equal(useAgentThreads.getState().notes.ended![0]!.text, 'Please wait')
  assert.equal(useAgentThreads.getState().notes.ended![0]!.why, 'It has finished.')
})

test('concurrent notes settle by message identity, not by the last note or open run', { timeout: 1000 }, async () => {
  useAgentThreads.setState({ notes: {} })
  let finish!: (value: { sent: true }) => void
  const first = useAgentThreads.getState().send('run', 'First', () => new Promise((resolve) => { finish = resolve }))
  await useAgentThreads.getState().send('run', 'Second', async () => ({ sent: false, why: 'Not running.' }))
  finish({ sent: true })
  await first
  assert.deepEqual(useAgentThreads.getState().notes.run!.map(({ text, delivery }) => [text, delivery]), [['First', 'waiting'], ['Second', 'refused']])
})

test('a transport failure preserves the message without claiming it was refused', { timeout: 1000 }, async () => {
  useAgentThreads.setState({ notes: {} })
  await useAgentThreads.getState().send('run', 'Wait', async () => { throw Error('Connection closed') })
  assert.equal(useAgentThreads.getState().notes.run![0]!.delivery, 'unconfirmed')
  assert.equal(useAgentThreads.getState().notes.run![0]!.why, 'Connection closed')
})

test('preview messages are explicitly local, not queued for a real agent', { timeout: 1000 }, async () => {
  useAgentThreads.setState({ notes: {} })
  await useAgentThreads.getState().send('sample', 'Preview', async () => ({ sent: true, local: true }))
  assert.equal(useAgentThreads.getState().notes.sample![0]!.delivery, 'local')
})

test('notes a page lost come back from what hobkin kept, each once, in the order they were sent, with their marks', { timeout: 1000 }, async () => {
  hostStore.setState(initialHostState, true)
  useAgentThreads.setState({ notes: {} })
  const [weekdays, holidays, month] = ['1', '2', '3'].map((n) => `00000000-0000-4000-8000-00000000000${n}`)
  // The page still has one of them, with its own key.
  let own = ''
  await useAgentThreads.getState().send('run', 'Then sum it up', async (noteId) => ((own = noteId), { sent: true }), undefined, 'follow-up')
  const at = useAgentThreads.getState().notes.run![0]!.at
  hostStore.setState({ snapshot: { runs: [{ id: 'run', title: 'Recap', state: 'running' }], steeringReceipts: { run: [{ noteId: holidays, at: at + 5 }] } } })
  const kept: KeptNote[] = [
    { noteId: weekdays, text: 'Only weekdays', at: at - 20, queue: 'steer', receivedAt: at - 10 },
    { noteId: own, text: 'Then sum it up', at: at + 1, queue: 'follow-up' },
    { noteId: holidays, text: 'And the holidays', at: at + 2, queue: 'steer' },
    { noteId: month, text: 'Plan the month instead', at: at + 3, queue: 'interrupt' },
  ]

  useAgentThreads.getState().recall('run', kept)
  const notes = useAgentThreads.getState().notes.run!
  assert.deepEqual(notes.map((note) => [note.text, note.delivery, note.queue]), [
    ['Only weekdays', 'received', 'steer'],
    ['Then sum it up', 'waiting', 'follow-up'],
    ['And the holidays', 'received', 'steer'],
    ['Plan the month instead', 'waiting', undefined],
  ])
  assert.equal(notes[1]!.at, at, 'the page keeps its own copy')
  assert.deepEqual(notes.map(waitsForTurn), [false, true, false, false], 'only the follow-up not read yet waits above the box')
  useAgentThreads.getState().recall('run', kept)
  assert.equal(useAgentThreads.getState().notes.run, notes, 'nothing new, the same notes')

  // The run ended: what its turn never read says so.
  hostStore.setState({ snapshot: { runs: [{ id: 'run', title: 'Recap', state: 'completed' }] } })
  assert.deepEqual(useAgentThreads.getState().notes.run!.map((note) => note.delivery), ['received', 'unconfirmed', 'received', 'unconfirmed'])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunSummary, WireSnapshot } from '#shared/protocol/snapshot.ts'
import { heldBy } from '../src/features/chat/doing.ts'

const SENT_AT = Date.parse('2026-11-13T03:34:40Z')
const turn = (startedAt: string): RunSummary => ({ id: 'turn', kind: 'main', title: 'Conversation', state: 'running', startedAt })
const workAgent: RunSummary = { id: 'work:rpsleague:do', kind: 'background', title: 'rpsleague', state: 'running', startedAt: '2026-11-13T03:29:13Z' }

test('a message sent while hobkin compacts the conversation, with no turn running, waits behind the compaction', () => {
  const snapshot: WireSnapshot = { busy: true, context: { compacting: true }, runs: [workAgent] }

  assert.equal(heldBy(snapshot, SENT_AT), 'compacting')
})

test('a message sent during a turn that began before it waits behind that turn', () => {
  const snapshot: WireSnapshot = { busy: true, runs: [turn('2026-11-13T03:34:10Z')] }

  assert.equal(heldBy(snapshot, SENT_AT), 'turn')
})

test('nothing holds a message that started its own turn, or one sent while only a work agent runs', () => {
  const ownTurn: WireSnapshot = { busy: true, runs: [turn('2026-11-13T03:34:41Z')] }
  const onlyWork: WireSnapshot = { busy: false, runs: [workAgent] }

  assert.equal(heldBy(ownTurn, SENT_AT), null, 'its own turn')
  assert.equal(heldBy(onlyWork, SENT_AT), null, 'a work agent')
})

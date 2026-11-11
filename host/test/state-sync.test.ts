import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyMessageOps, diffMessages } from '#shared/protocol/message-ops.ts'
import type { StateMessage } from '#shared/protocol/messages.ts'
import type { ChatMessage, RunTelemetry } from '#shared/protocol/snapshot.ts'
import { StateSync } from '../src/state-sync.ts'

import { DARK_PALETTE } from '../../ui/src/features/settings/rules.ts'
import { applyHostMessage, initialHostState } from '../../ui/src/lib/host/state.ts'

const message = (id: string, content = id): ChatMessage => ({ id, role: 'assistant', content })
const list = (ids: string) => ids.split('').map((id) => message(id))

test('the steps between two conversations rebuild the second from the first', () => {
  const cases: [string, string][] = [
    ['', 'abc'],
    ['abc', 'abcd'],
    ['abc', 'bcd'],
    ['ad', 'abcd'],
    ['abcd', 'ad'],
    ['abc', 'xabcyz'],
    ['abc', 'xyz'],
    ['abc', ''],
    ['abc', 'cba'],
    ['abcdef', 'bxdyfz'],
  ]
  for (const [before, after] of cases) {
    assert.deepEqual(applyMessageOps(list(before), diffMessages(list(before), list(after))), list(after), `${before} to ${after}`)
  }

  // Any two lists, including ones that share nothing or reorder what they share.
  let seed = 7
  const random = (below: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % below
  const anyList = () => [...'abcdefgh'].filter(() => random(2)).sort(() => random(3) - 1).map((id) => message(id, `${id}${random(2)}`))
  for (let round = 0; round < 500; round += 1) {
    const before = anyList()
    const after = anyList()
    assert.deepEqual(applyMessageOps(before, diffMessages(before, after)), after)
  }
})

test('appearance travels on changes and resets, and older hosts clear the wire slice', () => {
  const facts = { owner: { state: 'opening' } as const, signIn: { status: 'unknown' } as const, models: null, snapshot: null }
  const sync = new StateSync(facts)
  const appearance = { id: 10, name: 'Night', palette: DARK_PALETTE }
  const update = sync.update({ ...facts, appearance })!
  assert.deepEqual(update.appearance, appearance)
  assert.equal(sync.update({ ...facts, appearance: structuredClone(appearance) }), null)
  assert.deepEqual(sync.full().appearance, appearance, 'a reconnect receives the latest request')
  const held = applyHostMessage(initialHostState, sync.full())
  assert.deepEqual(held.appearance, appearance)
  assert.deepEqual(applyHostMessage(held, { type: 'state', rev: 12 }).appearance, appearance)
  assert.equal(applyHostMessage(held, { type: 'state', rev: 13, reset: true }).appearance, null)
  assert.equal(sync.update({ ...facts, appearance: null })!.appearance, null)
  assert.equal(sync.full().appearance, null)
})

test('parent telemetry travels whole on full, changes, unset and owner reset', () => {
  const facts = { owner: { state: 'opening' } as const, signIn: { status: 'unknown' } as const, models: null }
  const telemetry: RunTelemetry = {
    schemaVersion: 1, connection: 'connected', stale: false, asOf: null,
    scope: 'own-parent', helpers: 'unavailable', runs: [],
    retention: { maxRuns: 100, eventMonthFiles: 2, eventTailBytesPerFile: 262144,
      eventReadState: 'available', eventTailTruncated: false, history: 'bounded' },
  }
  const sync = new StateSync(facts)
  const snapshot = { busy: false, telemetry }
  assert.deepEqual(sync.update({ ...facts, snapshot })!.set, snapshot)
  assert.deepEqual(sync.full().set?.telemetry, telemetry)
  assert.equal(sync.update({ ...facts, snapshot: structuredClone(snapshot) }), null)
  const offline: RunTelemetry = { ...telemetry, connection: 'offline', stale: true, asOf: '2026-11-11T12:00:00.000Z' }
  assert.deepEqual(sync.update({ ...facts, snapshot: { busy: false, telemetry: offline } })!.set, { telemetry: offline })
  const held = applyHostMessage(initialHostState, sync.full())
  assert.deepEqual(held.snapshot.telemetry, offline)
  const removed = sync.update({ ...facts, snapshot: { busy: false } })!
  assert.deepEqual(removed.unset, ['telemetry'])
  assert.equal(applyHostMessage(held, removed).snapshot.telemetry, undefined)
  assert.equal(sync.full().set?.telemetry, undefined)
  sync.update({ ...facts, snapshot })
  const reset = sync.update({ ...facts, owner: { state: 'failed', message: 'fake owner changed' }, snapshot: { busy: false } })!
  assert.equal(reset.reset, true)
  assert.equal(applyHostMessage(held, reset).snapshot.telemetry, undefined)
})

test('a reply appended to a long conversation travels alone', () => {
  const history = Array.from({ length: 100 }, (_, index) => message(`m${index}`))
  const next = [...history.slice(1), message('reply')]

  assert.deepEqual(diffMessages(history, next), [
    { op: 'remove', ids: ['m0'] },
    { op: 'append', messages: [message('reply')] },
  ])
  assert.deepEqual(diffMessages(history, history), [])
  assert.deepEqual(diffMessages(list('abc'), [message('a'), message('b', 'changed'), message('c')]), [{ op: 'update', id: 'b', message: message('b', 'changed') }])
})

test('only the keys that changed are sent, and a new owner starts over', () => {
  const live = { state: 'live', limits: { images: 4, imageBytes: 67108864 } } as const
  const signIn = { status: 'signed-in' } as const
  const sync = new StateSync({ owner: { state: 'opening' }, signIn, models: null })
  const base = { busy: false, doing: null, runs: [], config: { launcher: 'secret' }, savedAt: '1', presentation: { hiddenMessageIds: ['hidden'] } }

  const first = sync.update({ owner: live, signIn, models: null, snapshot: { ...base, messages: [message('a'), message('hidden'), message('blank', ' ')] } }) as StateMessage
  assert.equal(first.reset, true)
  assert.deepEqual(first.set, { busy: false, doing: null, runs: [] })
  assert.deepEqual(first.messages, [{ op: 'reset', messages: [message('a')] }], 'cleared and blank messages stay out')
  assert.deepEqual(first.owner, live)

  // A refresh that changed nothing the UI reads sends nothing.
  assert.equal(sync.update({ owner: live, signIn, models: null, snapshot: { ...base, savedAt: '2', messages: [message('a'), message('hidden')] } }), null)

  const second = sync.update({ owner: live, signIn, models: null, snapshot: { ...base, busy: true, doing: 'writing', messages: [message('a'), message('b')] } }) as StateMessage
  assert.deepEqual(second, { type: 'state', rev: 2, set: { busy: true, doing: 'writing' }, messages: [{ op: 'append', messages: [message('b')] }] })

  const { runs: _runs, ...withoutRuns } = base
  assert.deepEqual((sync.update({ owner: live, signIn, models: null, snapshot: { ...withoutRuns, busy: true, doing: 'writing', messages: [message('a'), message('b')] } }) as StateMessage).unset, ['runs'])

  // A UI that connects now gets all of it in one message.
  const full = sync.full()
  assert.equal(full.reset, true)
  assert.deepEqual(full.set, { busy: true, doing: 'writing' })
  assert.deepEqual(full.messages, [{ op: 'reset', messages: [message('a'), message('b')] }])
  assert.equal('models' in full, false, 'no models slice before Pi has said')

  // The models slice travels whole, only when some of it changed.
  const models = { providers: [{ id: 'openai', name: 'OpenAI', connected: true }], models: [] }
  const snapshot = { ...withoutRuns, busy: true, doing: 'writing', messages: [message('a'), message('b')] }
  assert.deepEqual((sync.update({ owner: live, signIn, models, snapshot }) as StateMessage).models, models)
  assert.equal(sync.update({ owner: live, signIn, models: structuredClone(models), snapshot }), null)
  assert.deepEqual(sync.full().models, models)
})

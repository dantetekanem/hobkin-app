import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scheduleDefinition } from 'hobkin/src/cli/checks.mjs'
import type { CanvasState } from '#shared/protocol/canvas.ts'
import { applyMessageOps, diffMessages } from '#shared/protocol/message-ops.ts'
import type { StateMessage } from '#shared/protocol/messages.ts'
import type { ChatMessage, RunTelemetry } from '#shared/protocol/snapshot.ts'
import { StateSync, type HostFacts } from '../src/state-sync.ts'

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

test('the other hobkins canvases travel whole, on a change and with every reset', () => {
  const facts = { owner: { state: 'opening' } as const, signIn: { status: 'unknown' } as const, models: null, snapshot: null }
  const sync = new StateSync(facts)
  assert.equal(sync.full().canvases, undefined)
  const canvases = { a1b2c3d4: { open: true, url: 'http://127.0.0.1:1/canvas/k?r=1', title: 'Sketch', kind: 'drawing' as const, revision: 1 } }
  assert.deepEqual(sync.update({ ...facts, canvases })!.canvases, canvases)
  assert.equal(sync.update({ ...facts, canvases: structuredClone(canvases) }), null)
  assert.deepEqual(sync.full().canvases, canvases)
  const closed = { a1b2c3d4: { open: false, url: null, title: null } }
  assert.deepEqual(sync.update({ ...facts, canvases: closed })!.canvases, closed)
  assert.deepEqual(sync.update({ ...facts, owner: { state: 'failed', message: 'fake owner changed' } })!.canvases, closed)
})

/** A value that counts each time it is serialized. It serializes as `value`. */
const watched = <T extends object>(value: T, count: { reads: number }): T => ({ ...value, toJSON: () => { count.reads += 1; return value } })
const canvasOf = (revision: number): CanvasState => ({ open: true, url: 'http://127.0.0.1:1/canvas/k?r=1', title: 'Sketch', kind: 'drawing', revision })

test('kept messages that are the same objects are not serialized again, and a changed one is updated', () => {
  const count = { reads: 0 }
  const kept = ['a', 'b', 'c'].map((id) => watched(message(id), count))
  assert.deepEqual(diffMessages(kept, [...kept, message('d')]), [{ op: 'append', messages: [message('d')] }])
  assert.equal(count.reads, 0)
  assert.deepEqual(diffMessages(kept, [kept[0]!, message('b', 'changed'), kept[2]!]), [{ op: 'update', id: 'b', message: message('b', 'changed') }])
  assert.equal(count.reads, 1, 'only the old copy of the changed message')
})

test('a host fact that is the same object is not serialized again, and only a changed one is sent', () => {
  const facts = { owner: { state: 'failed', message: 'fake owner' } as const, signIn: { status: 'unknown' } as const, models: null, snapshot: null }
  const github = { connection: 'connected', login: 'someone', refreshedAt: null, refreshing: false, error: null, sample: true, reviews: [], pulls: [], issues: [], more: { reviews: false, pulls: false, issues: false } }
  const integrations = { path: null, servers: [], problems: [], checking: false, checkedAt: null, error: null }
  const appearance = { id: 10, name: 'Night', palette: DARK_PALETTE }
  // Each fact with a value and a changed one. The owner keeps its state, because a new state starts over.
  const cases: [Exclude<keyof HostFacts, 'snapshot'>, object, object][] = [
    ['owner', { state: 'failed', message: 'first' }, { state: 'failed', message: 'second' }],
    ['signIn', { status: 'signed-in' }, { status: 'signed-out' }],
    ['models', { providers: [{ id: 'openai', name: 'OpenAI', connected: true }], models: [] }, { providers: [], models: [] }],
    ['github', github, { ...github, refreshing: true }],
    ['integrations', integrations, { ...integrations, checking: true }],
    ['work', { enabled: true, queue: [] }, { enabled: false, queue: [] }],
    ['canvas', canvasOf(1), canvasOf(2)],
    ['canvases', { a1b2c3d4: canvasOf(1) }, { a1b2c3d4: canvasOf(2) }],
    ['nudge', { id: 1, action: { kind: 'back' } }, { id: 2, action: { kind: 'back' } }],
    ['appearance', appearance, { ...appearance, id: 11 }],
  ]
  for (const [fact, value, changed] of cases) {
    const sync = new StateSync(facts)
    const count = { reads: 0 }
    const same = watched(value, count)
    assert.ok(sync.update({ ...facts, [fact]: same } as HostFacts)?.[fact], `${fact}: a new value is sent`)
    count.reads = 0
    assert.equal(sync.update({ ...facts, [fact]: same } as HostFacts), null, `${fact}: the same object sends nothing`)
    assert.equal(count.reads, 0, `${fact}: the same object is not serialized again`)
    assert.equal(sync.update({ ...facts, [fact]: watched(structuredClone(value), count) } as HostFacts), null, `${fact}: an equal new object sends nothing`)
    assert.equal(count.reads, 1, `${fact}: only the new object is serialized`)
    assert.deepEqual(sync.update({ ...facts, [fact]: changed } as HostFacts)?.[fact], changed, `${fact}: a changed value is sent`)
  }

  // The first comparison is with what the host opened with.
  const opened = new StateSync({ ...facts, canvas: canvasOf(1) })
  assert.equal(opened.update({ ...facts, canvas: canvasOf(1) }), null)
})

test('a snapshot key that is the same object is not serialized again, and a changed key is sent', () => {
  const facts = { owner: { state: 'opening' } as const, signIn: { status: 'unknown' } as const, models: null }
  const sync = new StateSync(facts, { now: () => 0 })
  const count = { reads: 0 }
  const usage = watched({ usd: 1, pending: 0 }, count)
  const snapshot = { busy: false, usage, runs: [] }
  assert.deepEqual(sync.update({ ...facts, snapshot })?.set, snapshot)
  count.reads = 0
  // An activity-only refresh: a new snapshot that keeps every other value as the same object.
  assert.deepEqual(sync.update({ ...facts, snapshot: { ...snapshot, busy: true } }), { type: 'state', rev: 2, set: { busy: true } })
  assert.equal(count.reads, 0, 'the kept value is not serialized again')
  assert.equal(sync.update({ ...facts, snapshot: { ...snapshot, busy: true, usage: watched({ usd: 1, pending: 0 }, count) } }), null, 'an equal new value sends nothing')
  const changed = { usd: 2, pending: 0 }
  assert.deepEqual(sync.update({ ...facts, snapshot: { ...snapshot, busy: true, usage: changed } })?.set, { usage: changed })
})

test('a value edited in place is sent with the first update a second after the last full check', () => {
  let now = 0
  const facts = { owner: { state: 'opening' } as const, signIn: { status: 'unknown' } as const, models: null }
  const sync = new StateSync(facts, { now: () => now })
  const usage = { usd: 1 }
  // A routine's row is worked out from it, so the full check works the row out again.
  const routine = { id: 'daily.test', path: '/fake/routines/daily/test.md', prompt: 'Check' }
  const snapshot = { usage, schedules: [routine] }
  const row = () => ({ ...routine, expectedDefinition: scheduleDefinition(routine) })
  assert.deepEqual(sync.update({ ...facts, snapshot })?.set, { usage: { usd: 1 }, schedules: [row()] })
  usage.usd = 2
  routine.prompt = 'Check again'
  now = 999
  assert.equal(sync.update({ ...facts, snapshot }), null, 'not before the full check')
  now = 1000
  assert.deepEqual(sync.update({ ...facts, snapshot })?.set, { usage: { usd: 2 }, schedules: [row()] })
  usage.usd = 3
  now = 1999
  assert.equal(sync.update({ ...facts, snapshot }), null, 'the next full check is a second after this one')
  now = 2000
  assert.deepEqual(sync.update({ ...facts, snapshot })?.set, { usage: { usd: 3 } })
})

test('a reconnect and a new owner state still get every key and fact', () => {
  const facts = { owner: { state: 'opening' } as const, signIn: { status: 'unknown' } as const, models: null }
  const sync = new StateSync(facts, { now: () => 0 })
  const canvas = canvasOf(1)
  const appearance = { id: 10, name: 'Night', palette: DARK_PALETTE }
  const snapshot = { busy: false, usage: { usd: 1 }, runs: [] }
  sync.update({ ...facts, canvas, appearance, snapshot })
  sync.update({ ...facts, canvas, appearance, snapshot: { ...snapshot, busy: true } })

  const full = sync.full()
  assert.deepEqual(full.set, { ...snapshot, busy: true })
  assert.deepEqual([full.canvas, full.appearance], [canvas, appearance])

  const live = { state: 'live', limits: { images: 4, imageBytes: 67108864 } } as const
  const reset = sync.update({ ...facts, owner: live, canvas, appearance, snapshot: { ...snapshot, busy: true } })!
  assert.equal(reset.reset, true)
  assert.deepEqual(reset.set, { ...snapshot, busy: true }, 'the keys that did not change travel too')
  assert.deepEqual([reset.owner, reset.canvas, reset.appearance], [live, canvas, appearance])
})

test('the same schedule list keeps its rows between full checks, and a new list gets new rows', () => {
  const facts = { owner: { state: 'opening' } as const, signIn: { status: 'unknown' } as const, models: null }
  const sync = new StateSync(facts, { now: () => 0 })
  const definition = { id: 'daily.test', path: '/fake/routines/daily/test.md', prompt: 'Check' }
  const schedules = [{ ...definition, nextRun: { state: 'scheduled', at: null } }]
  sync.update({ ...facts, snapshot: { busy: false, schedules } })
  const rows = sync.full().set?.schedules as unknown[]
  assert.deepEqual(rows, [{ ...schedules[0], expectedDefinition: scheduleDefinition(definition) }])

  assert.deepEqual(sync.update({ ...facts, snapshot: { busy: true, schedules } })?.set, { busy: true })
  assert.equal(sync.full().set?.schedules, rows, 'the same list gives the same rows')
  assert.equal(sync.update({ ...facts, snapshot: { busy: true, schedules: structuredClone(schedules) } }), null, 'equal rows send nothing')
  const again = sync.full().set?.schedules as unknown[]
  assert.notEqual(again, rows, 'a new list gives new rows')
  assert.notEqual(again[0], rows[0])
  assert.deepEqual(again, rows)
})

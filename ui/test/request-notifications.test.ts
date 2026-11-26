import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequestNotifications, type RequestFacts } from '../src/features/notifications/request.ts'
import type { Destination, Need } from '../src/features/notifications/rules.ts'

const OPENS: Partial<Record<Need['kind'], Destination>> = { question: { to: 'question' }, notice: { to: 'chat' }, digest: { to: 'chat' } }
const need = (id: string, kind: Need['kind'] = 'question', reach: Need['reach'] = 'chime'): Need =>
  ({ id, kind, title: `${kind} title`, body: `About ${id}`, opens: OPENS[kind] ?? { to: 'item', id }, reach })

const TOLD = 'hobkin:told:home'

/** A window that has seen this home before (`known`), with one question up and the window away (`front` false). */
function fixture({ known = true } = {}) {
  let state: RequestFacts = { home: 'home', generation: 1, ready: true, needs: [need('ask')] }
  const saved = new Map<string, string>(), sent: string[] = [], words: { title: string; body: string }[] = [], reaches: Need['reach'][] = [], visits: Destination[] = []
  if (known) saved.set(TOLD, '[]')
  let click: (id: string) => Promise<void> = async () => {}, removed = 0, inFront = false
  const adapter = {
    available: () => true,
    permission: async () => true,
    listen: async (handler: typeof click) => { click = handler; return () => { removed++ } },
    send: async (notice: { id: string; title: string; body: string; reach: Need['reach'] }) => {
      sent.push(notice.id); words.push({ title: notice.title, body: notice.body }); reaches.push(notice.reach); return true
    },
  }
  const options = { facts: () => state, adapter, storage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) } },
    front: async () => inFront, reveal: (opens: Destination) => { visits.push(opens) } }
  return {
    options, sent, words, reaches, visits, saved, click: (id: string) => click(id), removed: () => removed, state: () => state,
    told: () => JSON.parse(saved.get(TOLD) ?? 'null') as string[] | null,
    change: (patch: Partial<RequestFacts>) => { state = { ...state, ...patch } },
    front: (value: boolean) => { inFront = value },
  }
}

test('each thing that needs the user is told once, across a reload and a reconnect, and in each home', async () => {
  const f = fixture(), c = createRequestNotifications(f.options)
  f.change({ needs: [need('ask'), need('item-1', 'item')] })
  await Promise.all([c.refresh(), c.refresh()]); assert.equal(f.sent.length, 2)
  c.dispose(); const reloaded = createRequestNotifications(f.options)
  await reloaded.refresh(); assert.equal(f.sent.length, 2)
  f.change({ generation: 2 }); await reloaded.refresh(); assert.equal(f.sent.length, 2)
  f.saved.set('hobkin:told:another', '[]')
  f.change({ home: 'another' }); await reloaded.refresh(); assert.equal(f.sent.length, 4)
  reloaded.dispose()
})

test('a notification says what needs the user in its own words', async () => {
  const f = fixture(), c = createRequestNotifications(f.options)
  await c.refresh()
  assert.deepEqual(f.words, [{ title: 'question title', body: 'About ask' }])
  c.dispose()
})

test('a home this window never saw is taken as it is: what already waits is not told, what comes after is', async () => {
  const f = fixture({ known: false }), c = createRequestNotifications(f.options)
  await c.refresh()
  assert.deepEqual(f.sent, []); assert.deepEqual(f.told(), ['ask'])
  f.change({ needs: [need('ask'), need('item-1', 'item')] }); await c.refresh()
  assert.deepEqual(f.sent, ['["home","item-1","item"]'])
  c.dispose()
})

test('nothing is told while the window is in front, and what was seen there is not told later', async () => {
  const f = fixture(), c = createRequestNotifications(f.options)
  f.front(true); await c.refresh()
  assert.deepEqual(f.sent, []); assert.deepEqual(f.told(), ['ask'])
  f.front(false); await c.refresh(); assert.deepEqual(f.sent, [])
  c.dispose(); const reloaded = createRequestNotifications(f.options)
  await reloaded.refresh(); assert.deepEqual(f.sent, [])
  f.change({ needs: [need('ask'), need('item-1', 'item')] }); await reloaded.refresh()
  assert.equal(f.sent.length, 1)
  reloaded.dispose()
})

test('a refusal is respected, while an unavailable shell or a dispatch that failed is tried again', async () => {
  const f = fixture(), c = createRequestNotifications(f.options)
  f.options.adapter.available = () => false; await c.refresh()
  f.options.adapter.available = () => true; f.options.adapter.send = async () => false; await c.refresh()
  assert.deepEqual(f.told(), []); assert.equal(f.sent.length, 0)
  f.options.adapter.permission = async () => false; await c.refresh()
  assert.deepEqual(f.told(), ['ask'])
  f.options.adapter.permission = async () => true; f.options.adapter.send = async (notice) => { f.sent.push(notice.id); return true }
  await c.refresh(); assert.equal(f.sent.length, 0)
  c.dispose()
})

test('a refusal stops the notifications, never a cue beside them', async () => {
  const f = fixture(), c = createRequestNotifications(f.options)
  let asked = 0
  f.options.adapter.permission = async () => {
    asked++
    return false
  }
  f.change({ needs: [need('line', 'notice', 'cue'), need('digest', 'digest', 'soft')] })

  await c.refresh()

  assert.equal(asked, 1)
  assert.deepEqual(f.reaches, ['cue'])
  assert.deepEqual(f.told()?.toSorted(), ['digest', 'line'])
  c.dispose()
})

test('a cue asks the Mac nothing, a digest is one soft notification that opens the chat, and in front nothing sounds', async () => {
  const f = fixture(), c = createRequestNotifications(f.options)
  f.options.adapter.permission = async () => {
    throw new Error('a cue asks nothing')
  }
  f.change({ needs: [need('line', 'notice', 'cue')] })
  await c.refresh()
  assert.deepEqual(f.reaches, ['cue'])

  f.options.adapter.permission = async () => true
  f.change({ needs: [need('digest', 'digest', 'soft')] })
  await c.refresh()
  assert.deepEqual(f.reaches, ['cue', 'soft'])
  await f.click(f.sent.at(-1)!)
  assert.deepEqual(f.visits, [{ to: 'chat' }])

  // Seen with the window in front, a cue is not played later either.
  f.front(true)
  f.change({ needs: [need('line-2', 'notice', 'cue')] })
  await c.refresh()
  f.front(false)
  await c.refresh()
  assert.deepEqual(f.reaches, ['cue', 'soft'])
  c.dispose()
})

test('home, generation, reset and closed requests invalidate pending permission checks', async () => {
  for (const patch of [{ home: 'away' }, { generation: 2 }, { ready: false }, { needs: [] }]) {
    const f = fixture(); let release!: (allowed: boolean) => void
    f.options.adapter.permission = () => new Promise<boolean>((resolve) => { release = resolve })
    const c = createRequestNotifications(f.options), pending = c.refresh()
    await new Promise((resolve) => setImmediate(resolve))
    f.change(patch); release(true); await pending
    assert.equal(f.sent.length, 0); assert.deepEqual(f.told(), []); c.dispose()
  }
})

test('the listener comes before the first notification; a click opens only what still waits, and dispose removes it', async () => {
  const f = fixture(), c = createRequestNotifications(f.options)
  f.change({ needs: [need('ask'), need('item-1', 'item')] })
  const send = f.options.adapter.send
  f.options.adapter.send = async (notice) => { await f.click(notice.id); return send(notice) }
  await c.refresh()
  assert.deepEqual(f.visits, [{ to: 'question' }, { to: 'item', id: 'item-1' }])
  f.visits.length = 0
  // The question left the sheet: it waits under Action Items now. The item was answered and is gone.
  f.change({ needs: [] })
  for (const key of f.sent) await f.click(key)
  assert.deepEqual(f.visits, [{ to: 'actions' }])
  // Another home's notification, and a key that is not one of ours, open nothing.
  f.visits.length = 0
  await f.click('["elsewhere","ask","question"]'); await f.click('not json'); await f.click('["home",7,"question"]')
  assert.deepEqual(f.visits, [])
  c.dispose(); await Promise.resolve(); assert.equal(f.removed(), 1)
})

test('async listener, window and send steps recheck freshness; failures remain retryable', async () => {
  for (const step of ['listen', 'front', 'send'] as const) {
    const f = fixture(), c = createRequestNotifications(f.options)
    if (step === 'listen') f.options.adapter.listen = async () => { f.change({ generation: 2 }); return () => {} }
    if (step === 'front') f.options.front = async () => { f.change({ needs: [] }); return false }
    if (step === 'send') f.options.adapter.send = async () => { f.change({ needs: [] }); return true }
    await c.refresh(); if (f.sent[0]) await f.click(f.sent[0])
    assert.deepEqual(f.visits, []); if (step !== 'front') assert.deepEqual(f.told(), [])
    c.dispose()
  }
  const f = fixture(), c = createRequestNotifications(f.options), permission = f.options.adapter.permission
  f.options.adapter.permission = async () => { throw new Error('unavailable') }; await c.refresh()
  f.options.adapter.permission = permission; await c.refresh(); assert.equal(f.sent.length, 1); c.dispose()
})

test('dispose during listener registration removes it and prevents dispatch', async () => {
  const f = fixture(); let register!: () => void, removed = 0
  const started = new Promise<void>((resolve) => {
    f.options.adapter.listen = () => { resolve(); return new Promise((done) => { register = () => done(() => { removed++ }) }) }
  })
  const c = createRequestNotifications(f.options), pending = c.refresh()
  await started; c.dispose(); register(); await pending
  assert.equal(removed, 1); assert.equal(f.sent.length, 0)
})

test('when storage cannot be read, what already waits counts as told and what comes after is told once', async () => {
  const f = fixture()
  f.options.storage.getItem = () => { throw new Error('storage unavailable') }
  const c = createRequestNotifications(f.options)

  await c.refresh()
  assert.deepEqual(f.sent, [])

  f.change({ needs: [need('ask'), need('item-1', 'item')] })
  await c.refresh(); await c.refresh()
  assert.deepEqual(f.sent, ['["home","item-1","item"]'])

  await f.click(f.sent[0]!)
  assert.deepEqual(f.visits, [{ to: 'item', id: 'item-1' }])
  c.dispose()
})

for (const mode of ['reload', 'reconnect'] as const) {
  test(`an existing notification opens its still-pending request after ${mode}`, async () => {
    const f = fixture()
    let c = createRequestNotifications(f.options)
    await c.refresh()
    if (mode === 'reload') {
      c.dispose()
      c = createRequestNotifications(f.options)
    } else f.change({ generation: 2 })

    await c.refresh()
    assert.equal(f.sent.length, 1)
    await f.click(f.sent[0]!)
    assert.deepEqual(f.visits, [{ to: 'question' }])
    c.dispose()
  })
}

test('storage write failures preserve click routing and in-memory dedupe', async () => {
  const f = fixture()
  const c = createRequestNotifications(f.options)
  f.options.storage.setItem = () => { throw new Error('storage unavailable') }

  await c.refresh()
  await c.refresh()

  assert.deepEqual(f.sent, ['["home","ask","question"]'])

  await f.click(f.sent[0]!)
  assert.deepEqual(f.visits, [{ to: 'question' }])
  c.dispose()
})

test('the told list of a home keeps its newest entries and stays bounded', async () => {
  const f = fixture(), c = createRequestNotifications(f.options)
  for (let round = 0; round < 6; round++) {
    f.change({ needs: Array.from({ length: 100 }, (_, index) => need(`item-${round}-${index}`, 'item')) })
    await c.refresh()
  }
  const told = f.told()!
  assert.equal(told.length, 500)
  assert.equal(told.at(-1), 'item-5-99')
  assert.ok(!told.includes('item-0-0'))
  c.dispose()
})

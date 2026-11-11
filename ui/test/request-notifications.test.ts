import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequestNotifications, type RequestFacts } from '../src/features/notifications/request.ts'

function fixture() {
  let state: RequestFacts = { home: 'home', generation: 1, ready: true, question: { id: 'ask' } as RequestFacts['question'], decisions: [] }
  const saved = new Map<string, string>(), sent: string[] = [], visits: string[] = []
  let click: (id: string) => Promise<void> = async () => {}, removed = 0
  const adapter = {
    available: () => true,
    permission: async () => true,
    listen: async (handler: typeof click) => { click = handler; return () => { removed++ } },
    send: async (notice: { id: string; title: string; body: string }) => {
      assert.equal(notice.title, 'hobkin'); assert.equal(notice.body, 'Your input is needed.')
      sent.push(notice.id); return true
    },
  }
  const options = { facts: () => state, adapter, storage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) } },
    show: async () => { visits.push('show') }, focus: async () => { visits.push('focus') }, reveal: (id: string) => { visits.push(id) } }
  return { options, sent, visits, saved, click: (id: string) => click(id), removed: () => removed, state: () => state, change: (patch: Partial<RequestFacts>) => { state = { ...state, ...patch } } }
}

test('foreground live asks and answerable decisions share persistent per-home dedupe', async () => {
  const f = fixture(), c = createRequestNotifications(f.options)
  f.change({ decisions: [{ id: 'ask', answers: { by: 'decision', id: 'ask' } }, { id: 'other', answers: { by: 'decision', id: 'other' } }, { id: 'summary' }, { id: 'learning', answers: { by: 'learning', id: 'learning' } }] as RequestFacts['decisions'] })
  await Promise.all([c.refresh(), c.refresh()]); assert.equal(f.sent.length, 2)
  c.dispose(); const reloaded = createRequestNotifications(f.options)
  await reloaded.refresh(); assert.equal(f.sent.length, 2)
  f.change({ home: 'another' }); await reloaded.refresh(); assert.equal(f.sent.length, 4)
  reloaded.dispose()
})

test('denied, unavailable and refused dispatches are not recorded', async () => {
  const f = fixture(), c = createRequestNotifications(f.options)
  f.options.adapter.available = () => false; await c.refresh()
  f.options.adapter.available = () => true; f.options.adapter.permission = async () => false; await c.refresh()
  f.options.adapter.permission = async () => true; f.options.adapter.send = async () => false; await c.refresh()
  assert.equal(f.saved.size, 0); assert.equal(f.sent.length, 0); c.dispose()
})

test('home, generation, reset and closed requests invalidate pending permission checks', async () => {
  for (const patch of [{ home: 'away' }, { generation: 2 }, { ready: false }, { question: null }]) {
    const f = fixture(); let release!: (allowed: boolean) => void
    f.options.adapter.permission = () => new Promise<boolean>((resolve) => { release = resolve })
    const c = createRequestNotifications(f.options), pending = c.refresh()
    f.change(patch); release(true); await pending
    assert.equal(f.sent.length, 0); assert.equal(f.saved.size, 0); c.dispose()
  }
})

test('listener precedes dispatch; clicks only reveal still-current requests and dispose cleans up', async () => {
  const f = fixture(), c = createRequestNotifications(f.options)
  const send = f.options.adapter.send
  f.options.adapter.send = async (notice) => { await f.click(notice.id); return send(notice) }
  await c.refresh(); assert.deepEqual(f.visits, ['show', 'focus', 'ask'])
  f.visits.length = 0; f.change({ question: null }); await f.click(f.sent[0]!)
  assert.deepEqual(f.visits, []); c.dispose(); await Promise.resolve(); assert.equal(f.removed(), 1)
})

test('async listener, send and window steps recheck freshness; failures remain retryable', async () => {
  for (const step of ['listen', 'send', 'show', 'focus'] as const) {
    const f = fixture(), c = createRequestNotifications(f.options)
    if (step === 'listen') f.options.adapter.listen = async () => { f.change({ generation: 2 }); return () => {} }
    if (step === 'send') f.options.adapter.send = async () => { f.change({ question: null }); return true }
    if (step === 'show' || step === 'focus') f.options[step] = async () => { f.change({ question: null }) }
    await c.refresh(); if (f.sent[0]) await f.click(f.sent[0])
    assert.ok(!f.visits.includes('ask')); if (step === 'listen' || step === 'send') assert.equal(f.saved.size, 0)
    c.dispose()
  }
  const f = fixture(), c = createRequestNotifications(f.options), permission = f.options.adapter.permission
  f.options.adapter.permission = async () => { throw new Error('unavailable') }; await c.refresh()
  f.options.adapter.permission = permission; await c.refresh(); assert.equal(f.sent.length, 1); c.dispose()
})

test('dispose during listener registration removes it and prevents dispatch', async () => {
  const f = fixture(); let register!: () => void
  const started = new Promise<void>((resolve) => {
    f.options.adapter.listen = () => { resolve(); return new Promise((done) => { register = () => done(() => { f.visits.push('removed') }) }) }
  })
  const c = createRequestNotifications(f.options), pending = c.refresh()
  await started; c.dispose(); register(); await pending
  assert.deepEqual(f.visits, ['removed']); assert.equal(f.sent.length, 0)
})

test('storage read failures do not suppress authorized dispatch', async () => {
  const f = fixture()
  const c = createRequestNotifications(f.options)
  f.options.storage.getItem = () => { throw new Error('storage unavailable') }

  await c.refresh()

  assert.deepEqual(f.sent, ['["home","ask"]'])

  await f.click(f.sent[0]!)
  assert.deepEqual(f.visits, ['show', 'focus', 'ask'])
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
    assert.deepEqual(f.visits, ['show', 'focus', 'ask'])
    c.dispose()
  })
}

test('storage write failures preserve click routing and in-memory dedupe', async () => {
  const f = fixture()
  const c = createRequestNotifications(f.options)
  f.options.storage.setItem = () => { throw new Error('storage unavailable') }

  await c.refresh()
  await c.refresh()

  assert.deepEqual(f.sent, ['["home","ask"]'])

  await f.click(f.sent[0]!)
  assert.deepEqual(f.visits, ['show', 'focus', 'ask'])
  c.dispose()
})

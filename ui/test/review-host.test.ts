import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Review } from '../../shared/review/types.ts'
import { ReviewRefused } from '../../shared/review/validate.ts'
import { IDLE_STATUS, type OpenedReview } from '../../shared/review/status.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createReviewLoader, type ReviewCommands } from '../src/features/review/loader.ts'
import { ReviewLoad } from '../src/features/review/ReviewLoad.ts'

const review = { id: 'change:project:item', snapshot: 'a'.repeat(64), nodes: [], edges: [], story: [] } as unknown as Review
const ready = { ...IDLE_STATUS(review.id), state: 'ready' as const }
const opened = (): OpenedReview => ({ review, status: ready, notes: { entries: [], draft: { intent: 'comment', text: 'Stored draft' } } })
function fixture(get = async () => opened()) {
  const calls: { name: string; args: any }[] = []
  const command = (async (name: string, args: any) => {
    calls.push({ name, args })
    if (name === 'review.get') return get()
    if (name === 'review.notes') return { ok: true }
    if (name === 'review.file') return { fileId: args.fileId, base: 'before', head: 'after' }
    return ready
  }) as ReviewCommands
  const memory = createReviewMemory()
  const loader = createReviewLoader({ id: review.id, scope: 'host:/fixture', command, memory })
  return { loader, memory, calls }
}

test('host data reaches the rendered loading boundary and file source, with restored notes', async () => {
  const { loader, memory, calls } = fixture()
  await loader.load()
  const state = loader.getState()
  assert.equal(state.status, 'ready')
  assert.equal(memory.getState().of(state.review!).draft?.text, 'Stored draft')
  const html = renderToStaticMarkup(createElement(ReviewLoad, { loader, renderReview: (value) => createElement('p', null, value.snapshot) }))
  assert.ok(html.includes(review.snapshot))
  assert.deepEqual(await loader.source.getFile(review.id, 'f1'), { fileId: 'f1', base: 'before', head: 'after' })
  assert.deepEqual(calls.map((call) => call.name), ['review.status', 'review.get', 'review.file'])
  loader.dispose()
})

test('refresh asks the host to replace its cache and preserves newer local draft edits', async () => {
  let release!: (value: OpenedReview) => void
  let delayed = false
  const { loader, memory, calls } = fixture(() => delayed ? new Promise((resolve) => { release = resolve }) : Promise.resolve(opened()))
  await loader.load()
  const first = loader.getState().review!
  delayed = true
  const refreshing = loader.refresh()
  await Promise.resolve(); await Promise.resolve()
  memory.getState().setDraft(first, { intent: 'question', text: 'New local words' })
  release({ ...opened(), review: { ...review, snapshot: 'b'.repeat(64) } })
  await refreshing
  await loader.flushNotes()
  assert.equal(memory.getState().of(loader.getState().review!).draft?.text, 'New local words')
  assert.ok(calls.some(({ name, args }) => name === 'review.prepare' && args.refresh === true))
  assert.equal(calls.filter(({ name }) => name === 'review.notes').at(-1)?.args.draft.text, 'New local words')
  loader.dispose()
})

test('snapshot history and layout-only caches never overwrite target-level host notes', async () => {
  let host = opened()
  const writes: unknown[] = []
  const memory = createReviewMemory()
  const command = (async (name: string, args: any) => {
    if (name === 'review.get') return host
    if (name === 'review.notes') { host = { ...host, notes: { entries: args.entries, draft: args.draft } }; writes.push(args); return { ok: true } }
    return ready
  }) as ReviewCommands
  const open = () => createReviewLoader({ id: review.id, scope: 'fixture', memory, command })
  let loader = open()
  await loader.load()
  memory.getState().setDraft(loader.getState().review!, { intent: 'comment', text: 'Snapshot A words' })
  await loader.saveNotes()
  host = { ...host, review: { ...review, snapshot: 'b'.repeat(64) } }
  await loader.refresh()
  memory.getState().setDraft(loader.getState().review!, { intent: 'question', text: 'Snapshot B words' })
  memory.getState().addNote(loader.getState().review!, { step: 's', target: { kind: 'step' }, intent: 'comment', text: 'New note' })
  await loader.saveNotes()
  loader.dispose()
  host = { ...host, review }
  const saved = host.notes
  const count = writes.length
  loader = open()
  await loader.load()
  assert.deepEqual(memory.getState().of(loader.getState().review!).notes, saved.entries)
  assert.equal(memory.getState().of(loader.getState().review!).draft?.text, 'Snapshot B words')
  assert.equal(writes.length, count)
  loader.dispose()
  const layoutMemory = createReviewMemory()
  layoutMemory.getState().markOpened({ ...review, memoryScope: 'fixture' } as Review)
  loader = createReviewLoader({ id: review.id, scope: 'fixture', memory: layoutMemory, command })
  await loader.load()
  assert.deepEqual(layoutMemory.getState().of(loader.getState().review!).notes, saved.entries)
  assert.equal(layoutMemory.getState().of(loader.getState().review!).draft?.text, 'Snapshot B words')
  assert.equal(writes.length, count)
  loader.dispose()
})

test('persisted unsynced words survive reopening on another snapshot and clear only after saving', async () => {
  const storage = memoryStorage()
  let memory = createReviewMemory(storage)
  let fail = true
  let host = opened()
  const command = (async (name: string, args: any) => {
    if (name === 'review.get') return host
    if (name === 'review.notes') {
      if (fail) throw new Error('Offline')
      host = { ...host, notes: { entries: args.entries, draft: args.draft } }
      return { ok: true }
    }
    return ready
  }) as ReviewCommands
  let loader = createReviewLoader({ id: review.id, scope: 'fixture', memory, command })
  await loader.load()
  memory.getState().setDraft(loader.getState().review!, { intent: 'comment', text: 'Offline words' })
  await assert.rejects(loader.saveNotes(), /Offline/)
  loader.dispose()
  memory = createReviewMemory(storage)
  host = { ...host, review: { ...review, snapshot: 'b'.repeat(64) } }
  loader = createReviewLoader({ id: review.id, scope: 'fixture', memory, command })
  await loader.load()
  assert.equal(memory.getState().of(loader.getState().review!).draft?.text, 'Offline words')
  fail = false
  await loader.saveNotes()
  host = { ...host, notes: { entries: [], draft: { intent: 'comment', text: 'Later host words' } } }
  await loader.load()
  assert.equal(memory.getState().of(loader.getState().review!).draft?.text, 'Later host words')
  loader.dispose()
})

test('preparation polling coalesces status replies slower than its interval and eventually becomes ready', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let calls = 0
  const command = (async (name: string) => {
    if (name === 'review.get') return opened()
    if (++calls === 1) return { ...ready, state: 'preparing', phase: 'reading' }
    return new Promise<typeof ready>((resolve) => setTimeout(() => resolve(ready), 2000))
  }) as ReviewCommands
  const loader = createReviewLoader({ id: review.id, scope: 'fixture', memory: createReviewMemory(), command })
  await loader.load()
  assert.equal(loader.getState().preparation?.phase, 'reading')
  const timer = setInterval(() => { if (loader.getState().preparation?.phase) void loader.load() }, 1500)
  const polling = loader.load()
  t.mock.timers.tick(1500)
  t.mock.timers.tick(500)
  await polling
  assert.equal(loader.getState().status, 'ready')
  assert.equal(loader.getState().preparation?.phase, null)
  assert.equal(calls, 2)
  clearInterval(timer)
  loader.dispose()
})

test('explicit refresh invalidates a coalesced status poll instead of reusing it', async () => {
  let finish!: (value: typeof ready) => void
  const command = (async (name: string) => {
    if (name === 'review.status') return new Promise<typeof ready>((resolve) => { finish = resolve })
    if (name === 'review.get') return opened()
    return ready
  }) as ReviewCommands
  const loader = createReviewLoader({ id: review.id, scope: 'fixture', memory: createReviewMemory(), command })
  const stale = loader.load()
  assert.equal(loader.load(), stale)
  await loader.refresh()
  finish({ ...ready, state: 'preparing', phase: 'reading' } as any)
  await stale
  assert.equal(loader.getState().status, 'ready')
  assert.equal(loader.getState().preparation?.phase, null)
  loader.dispose()
})

test('preparation, refusal and transport failure remain recoverable without sample data', async () => {
  let status = { ...IDLE_STATUS(review.id), state: 'preparing' as const, phase: 'reading' as const }
  const command = (async (name: string) => {
    if (name === 'review.status') return status
    if (name === 'review.get') throw new Error('Connection lost')
    return status
  }) as ReviewCommands
  const loader = createReviewLoader({ id: review.id, scope: 'host:/fixture', command, memory: createReviewMemory() })
  await loader.load()
  assert.equal(loader.getState().status, 'preparing')
  status = { ...ready, phase: null } as any
  await loader.load()
  assert.equal(loader.getState().status, 'error')
  assert.match(loader.getState().error!, /Connection lost/)
  assert.equal(loader.getState().review, null)
  loader.dispose()
})

test('failed note saves keep local words, report the failure, and retry the newest draft', async () => {
  let fail = true
  const writes: string[] = []
  const memory = createReviewMemory()
  const command = (async (name: string, args: any) => {
    if (name === 'review.get') return opened()
    if (name === 'review.notes') {
      writes.push(args.draft.text)
      if (fail) throw new Error('Host unavailable')
      return { ok: true }
    }
    return ready
  }) as ReviewCommands
  const loader = createReviewLoader({ id: review.id, scope: 'fixture', command, memory })
  await loader.load()
  memory.getState().setDraft(loader.getState().review!, { intent: 'comment', text: 'Keep these words' })
  await assert.rejects(loader.saveNotes(), /Host unavailable/)
  assert.equal(memory.getState().of(loader.getState().review!).draft?.text, 'Keep these words')
  assert.ok(renderToStaticMarkup(createElement(ReviewLoad, { loader, renderReview: () => null })).includes('Retry saving notes'))
  fail = false
  await loader.saveNotes()
  assert.equal(loader.getState().notesError, null)
  assert.equal(writes.at(-1), 'Keep these words')
  loader.dispose()
})

test('note writes are serialized and a delayed acknowledgement never replaces newer words', async () => {
  let acknowledge!: () => void
  const writes: string[] = []
  const memory = createReviewMemory()
  const command = (async (name: string, args: any) => {
    if (name === 'review.get') return opened()
    if (name === 'review.notes') {
      writes.push(args.draft.text)
      if (writes.length === 1) await new Promise<void>((resolve) => { acknowledge = resolve })
      return { ok: true }
    }
    return ready
  }) as ReviewCommands
  const loader = createReviewLoader({ id: review.id, scope: 'fixture', memory, command })
  await loader.load()
  const loaded = loader.getState().review!
  memory.getState().setDraft(loaded, { intent: 'comment', text: 'First words' })
  memory.getState().setDraft(loaded, { intent: 'question', text: 'Newer words' })
  assert.deepEqual(writes, ['First words'])
  acknowledge()
  await loader.saveNotes()
  assert.deepEqual(writes, ['First words', 'Newer words'])
  assert.equal(memory.getState().of(loaded).draft?.text, 'Newer words')
  loader.dispose()
})

test('a disposed load cannot publish late data and effect reconnect restores the source', async () => {
  let finish!: (value: OpenedReview) => void
  const { loader } = fixture(() => new Promise((resolve) => { finish = resolve }))
  const loading = loader.load()
  await Promise.resolve(); await Promise.resolve()
  loader.dispose()
  finish(opened())
  await loading
  assert.equal(loader.getState().review, null)
  const reconnected = loader.load()
  await Promise.resolve(); await Promise.resolve()
  finish(opened())
  await reconnected
  assert.equal(loader.getState().status, 'ready')
  loader.dispose()
})

test('refused sample anchors show refusal instead of silently switching sources', async () => {
  const loader = createReviewLoader({ id: 'sample', scope: 'sample', memory: createReviewMemory(), sample: {
    getReview: async () => { throw new ReviewRefused('Anchor changed', ['Anchor changed']) },
    getFile: async () => { throw new Error('Not reached') },
  } })
  await loader.load()
  assert.equal(loader.getState().status, 'refused')
  assert.match(loader.getState().error!, /Anchor changed/)
  loader.dispose()
})

test('sample source is explicit and does not issue host commands; host identities isolate drafts', async () => {
  const memory = createReviewMemory()
  const source = { getReview: async () => review, getFile: async () => ({ fileId: 'f', path: 'f.ts', binary: false, base: '', head: '' }) }
  const sample = createReviewLoader({ id: 'sample', scope: 'sample', sample: source, memory })
  await sample.load()
  memory.getState().setDraft(sample.getState().review!, { intent: 'comment', text: 'Sample only' })
  const host = createReviewLoader({ id: review.id, scope: 'other-host', command: (async (name: string) => name === 'review.get' ? opened() : ready) as ReviewCommands, memory })
  await host.load()
  assert.equal(memory.getState().of(host.getState().review!).draft?.text, 'Stored draft')
  assert.equal(memory.getState().of(sample.getState().review!).draft?.text, 'Sample only')
  sample.dispose(); host.dispose()
})

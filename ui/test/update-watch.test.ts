import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readyVersion, watchUpdate } from '../src/features/update/watch.ts'

test('a version is read from an event payload or a plain answer', () => {
  assert.equal(readyVersion({ version: '0.2.0' }), '0.2.0')
  assert.equal(readyVersion('0.2.0'), '0.2.0')
  assert.equal(readyVersion(null), null)
  assert.equal(readyVersion({ version: '' }), null)
  assert.equal(readyVersion({}), null)
})

function fakes(answer: Promise<unknown>) {
  const shown: string[] = []
  let emit: (payload: unknown) => void = () => {}
  let unlistened = 0
  const deps = {
    status: () => answer,
    onReady: async (listener: (payload: unknown) => void) => ((emit = listener), () => void unlistened++),
    show: (version: string) => void shown.push(version),
  }
  return { deps, shown, emit: (payload: unknown) => emit(payload), unlistened: () => unlistened }
}
const settle = () => new Promise((done) => setTimeout(done, 0))

test('a version the shell already holds is shown once, even when the event repeats it', async () => {
  const t = fakes(Promise.resolve('0.2.0'))
  watchUpdate(t.deps)
  await settle()
  t.emit({ version: '0.2.0' })
  assert.deepEqual(t.shown, ['0.2.0'])
})

test('a later version is shown when the event arrives', async () => {
  const t = fakes(Promise.resolve(null))
  watchUpdate(t.deps)
  await settle()
  t.emit({ version: '0.3.0' })
  assert.deepEqual(t.shown, ['0.3.0'])
})

test('without the commands nothing is shown and nothing throws', async () => {
  const shown: string[] = []
  watchUpdate({ status: () => Promise.reject(new Error('no command')), onReady: () => Promise.reject(new Error('no event')), show: (v) => void shown.push(v) })
  await settle()
  assert.deepEqual(shown, [])
})

test('stopping lets go of the listener and ignores later events', async () => {
  const t = fakes(Promise.resolve(null))
  const stop = watchUpdate(t.deps)
  await settle()
  stop()
  t.emit({ version: '0.4.0' })
  assert.equal(t.unlistened(), 1)
  assert.deepEqual(t.shown, [])
})

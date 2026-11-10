import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { ActivityKeeper } from '../src/activity.ts'
import { StateSync } from '../src/state-sync.ts'

const owner = { state: 'live', limits: { images: 4, imageBytes: 1024 } } as const
const signIn = { status: 'signed-in' } as const
const said = (id: string, text: string): ActivityEntry => ({ id: `message:${id}`, kind: 'assistant', text })
const read = (id: string, output: string): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name: 'read', state: 'completed', input: JSON.stringify({ path: `src/${id}.ts` }, null, 2), output })

test('job activity travels as steps: the growing entry alone, never the whole key', () => {
  const sync = new StateSync({ owner, signIn, models: null })
  const facts = (jobActivity: Record<string, ActivityEntry[]>) => ({ owner, signIn, models: null, snapshot: { busy: true, jobActivity } })
  const reads = Array.from({ length: 200 }, (_, index) => read(`${index}`, 'export const value = 1\n'.repeat(200)))

  const first = sync.update(facts({ r1: [...reads, said('9:0', 'I will')] }))
  assert.equal(first?.set?.jobActivity, undefined, 'not in the keys that change')
  assert.deepEqual(first?.activity, [{ op: 'reset', job: 'r1', entries: [...reads, said('9:0', 'I will')] }])

  // hobkin rebuilds every entry on each refresh, many times a second while the agent writes.
  const growing = sync.update(facts({ r1: [...reads.map((entry) => ({ ...entry })), said('9:0', 'I will look')] }))
  assert.deepEqual(growing, { type: 'state', rev: 2, activity: [{ op: 'update', job: 'r1', entry: said('9:0', 'I will look') }] })
  assert.ok(JSON.stringify(growing).length < 300, 'a few words cost a few words')

  assert.equal(sync.update(facts({ r1: [...reads, said('9:0', 'I will look')] })), null, 'nothing changed, nothing sent')
  assert.deepEqual(sync.full().activity, [{ op: 'reset', job: 'r1', entries: [...reads, said('9:0', 'I will look')] }], 'a UI that connects later gets every job whole')
  assert.equal(sync.full().set?.jobActivity, undefined)
})

test('a job the host keeps after it ended sends nothing more, and a job gone is removed', () => {
  const keeper = new ActivityKeeper()
  const sync = new StateSync({ owner, signIn, models: null })
  const facts = (jobActivity: Record<string, ActivityEntry[]>) => ({ owner, signIn, models: null, snapshot: keeper.keep({ jobActivity }) })

  sync.update(facts({ done: [said('1:0', 'Finished.')], r1: [said('2:0', 'Reading')] }))
  // hobkin drops the ended job. The host keeps its last activity, as it was.
  assert.deepEqual(sync.update(facts({ r1: [said('2:0', 'Reading'), read('a', 'text')] }))?.activity, [{ op: 'append', job: 'r1', entries: [read('a', 'text')] }])
  assert.deepEqual(sync.update(facts({ r1: [said('2:0', 'Reading'), read('a', 'text')] })), null)

  const quiet = new StateSync({ owner, signIn, models: null })
  quiet.update({ owner, signIn, models: null, snapshot: { jobActivity: { r1: [said('1:0', 'Hi')] } } })
  assert.deepEqual(quiet.update({ owner, signIn, models: null, snapshot: { jobActivity: {} } })?.activity, [{ op: 'remove', job: 'r1' }])
})

test('a new owner starts over with every job whole', () => {
  const sync = new StateSync({ owner: { state: 'opening' }, signIn, models: null })
  const message = sync.update({ owner, signIn, models: null, snapshot: { jobActivity: { r1: [said('1:0', 'Hi')] } } })
  assert.equal(message?.reset, true)
  assert.deepEqual(message?.activity, [{ op: 'reset', job: 'r1', entries: [said('1:0', 'Hi')] }])
})

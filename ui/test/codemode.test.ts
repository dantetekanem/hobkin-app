import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { codemodeOf, savedCodemode } from '../src/features/agent-activity/codemode.ts'
import { stepsOf } from '../src/features/agent-activity/steps.ts'

const call = (name: string, status = 'running', id = 'outer/?') => ({ id, name, args: 'preview…', status })
const outer = (calls?: unknown, state: ActivityEntry['state'] = 'running'): ActivityEntry => ({ id: 'tool:outer', kind: 'tool', name: 'codemode', state, input: '{"code":"await tools.read({path: x})"}', output: '==> text 1/2 <==\naggregate only', ...(calls === undefined ? {} : { codemode: { calls } as ActivityEntry['codemode'] }) })

test('snapshots keep ordinal identity with duplicate pending IDs and out-of-order completions', () => {
  const pending = outer([call('read'), call('bash')])
  const before = structuredClone(pending)
  const started = codemodeOf(pending)
  const updated = codemodeOf(outer([call('read'), call('bash', 'ok', 'real-2')]))
  const final = codemodeOf(outer([call('read', 'error', 'real-1'), call('bash', 'ok', 'real-2')], 'completed'))
  assert.deepEqual(started.operations?.map(c => c.key), ['tool:outer:0', 'tool:outer:1'])
  assert.deepEqual(updated.operations?.map(c => c.key), started.operations?.map(c => c.key))
  assert.deepEqual(final.operations?.map(c => [c.name, c.status]), [['read', 'error'], ['bash', 'ok']])
  assert.equal(final.state, 'done')
  assert.equal(final.output, pending.output)
  assert.deepEqual(pending, before)
  assert.equal(stepsOf([pending])[0]?.kind, 'codemode')
})

test('script failure/partial output and unknown or cancelled children remain independent', () => {
  const entry = outer([call('read'), call('bash', 'cancelled')], 'failed')
  const model = codemodeOf(entry, true)
  assert.equal(model.state, 'failed')
  assert.deepEqual(model.operations?.map(c => c.status), ['unknown', 'cancelled'])
  assert.equal(model.output, entry.output)
  assert.match(model.source, /await tools.read/)
  assert.equal(codemodeOf(outer()).operations, undefined)
  assert.equal(codemodeOf(outer([call('read', 'invented')])).operations, undefined)
  assert.equal(codemodeOf(outer({ private: 'secret' })).operations, undefined)
  assert.deepEqual(codemodeOf(outer([])).operations, [])
})

test('malformed status metadata is unavailable for live and uniquely linked saved calls', () => {
  const statuses: unknown[] = [{ toString: null }, ['running'], null, 3, 'unknown']
  for (const [index, status] of statuses.entries()) {
    const entry = outer([{ ...call('read'), status }])
    let live: ReturnType<typeof codemodeOf> | undefined
    assert.doesNotThrow(() => { live = codemodeOf(entry) })
    assert.equal(live?.metadata, undefined)
    assert.equal(live?.operations, undefined)
    assert.equal(live?.output, entry.output)
    assert.match(live?.source ?? '', /await tools.read/)

    const id = `status-${index}`
    const part = tool(id)
    const raw = [record({ role: 'assistant', content: [part] }), record({ ...result(id), details: { calls: [{ ...call('read'), status }] } })]
    const before = structuredClone(raw)
    const linked = savedCodemode(raw)
    const saved = linked.get(part)?.entry
    assert.equal(linked.get(part)?.correlation, 'matched')
    assert.equal(saved?.output, 'partial')
    assert.equal(codemodeOf(saved!).operations, undefined)
    assert.deepEqual(raw, before)
  }
})

test('bounded allowlisted previews retain reported errors, duration and cost without inner bodies', () => {
  const entry = outer([{ ...call('bash', 'ok'), args: 'a'.repeat(240), durationMs: 12, cost: 0.02, result: 'private body' }, { ...call('read', 'error'), error: 'e'.repeat(600), durationMs: -1, cost: Infinity }], 'completed')
  const model = codemodeOf(entry)
  assert.equal(model.state, 'done')
  assert.equal(model.operations?.[0]?.args.length, 200)
  assert.equal(model.operations?.[0]?.durationMs, 12)
  assert.equal(model.operations?.[0]?.cost, 0.02)
  assert.equal(model.operations?.[1]?.error?.length, 500)
  assert.equal(model.operations?.[1]?.durationMs, undefined)
  assert.equal(model.operations?.[1]?.cost, undefined)
  assert.equal('result' in model.operations![0]!, false)
  assert.equal(codemodeOf(outer(Array.from({ length: 105 }, () => call('read')))).operations?.length, 100)
})

const tool = (id: string) => ({ type: 'toolCall', id, name: 'codemode', arguments: { code: 'return 1' } })
const result = (id: string, isError = false) => ({ role: 'toolResult', toolCallId: id, toolName: 'codemode', isError, content: [{ type: 'text', text: 'partial' }], details: { calls: [call('read', 'error')], private: 'secret' } })
const record = (message: object) => ({ type: 'message', message })

test('saved branches correlate exact unambiguous IDs, preserving interleaved source records', () => {
  const a = tool('a'), b = tool('b'), missing = tool('missing')
  const rb = result('b'), ra = result('a', true), orphan = result('orphan')
  const entries = [record({ role: 'assistant', content: [a, { type: 'text', text: 'between' }, b, missing] }), record(rb), record({ role: 'assistant', content: 'later' }), record(ra), record(orphan)]
  const before = structuredClone(entries)
  const linked = savedCodemode(entries)
  assert.equal(linked.get(a)?.correlation, 'matched')
  assert.equal(linked.get(a)?.entry.state, 'failed')
  assert.equal(linked.get(b)?.entry.output, 'partial')
  assert.equal(linked.get(missing)?.correlation, 'missing')
  assert.equal(linked.get(orphan)?.correlation, 'orphan')
  assert.deepEqual(entries, before)
  assert.equal('private' in (linked.get(a)?.entry.codemode ?? {}), false)
})

test('stored codemode records without IDs stay explicitly uncorrelated', () => {
  const part = { type: 'toolCall', name: 'codemode', arguments: { code: 'return 1' } }
  const message = { ...result('x'), toolCallId: undefined }
  const linked = savedCodemode([record({ role: 'assistant', content: [part] }), record(message)])
  assert.equal(linked.get(part)?.correlation, 'missing')
  assert.equal(linked.get(message)?.correlation, 'orphan')
})

test('duplicate call or result IDs never lend another record their output', () => {
  const a = tool('a'), duplicate = tool('a'), b = tool('b')
  const ra = result('a'), rb = result('b'), rb2 = result('b')
  const linked = savedCodemode([record({ role: 'assistant', content: [a, duplicate, b] }), record(ra), record(rb), record(rb2)])
  for (const part of [a, duplicate, b]) {
    assert.equal(linked.get(part)?.correlation, 'ambiguous')
    assert.equal(linked.get(part)?.entry.output, '')
  }
  assert.equal(linked.get(ra)?.correlation, 'ambiguous')
  assert.equal(linked.get(rb)?.correlation, 'ambiguous')
})

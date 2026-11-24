import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { callTime, codemodeOf, codemodeText, codemodeWords } from '../src/features/agent-activity/codemode.ts'

const call = (name: string, status: string) => ({ id: `${name}-call`, name, args: 'preview', status })

/** A codemode step as the feed sends it, with the tool calls its script made, when the host reported them. */
function script(calls: ReturnType<typeof call>[] | undefined, state: ActivityEntry['state'] = 'completed'): ActivityEntry {
  return {
    id: 'tool:script',
    kind: 'tool',
    name: 'codemode',
    state,
    input: '{"code":"await tools.bash()"}',
    output: 'aggregate',
    ...(calls === undefined ? {} : { codemode: { calls } as ActivityEntry['codemode'] }),
  }
}

const wordsOf = (entry: ActivityEntry, ended = false) => codemodeWords(codemodeOf(entry, ended))

test('a script whose tool calls all passed says how many, that they passed, and what they were', () => {
  const words = wordsOf(script([call('bash', 'ok'), call('read', 'ok'), call('read', 'ok'), call('ls', 'ok')]))

  assert.deepEqual(words, { calls: { count: '4 tool calls', passed: 'all passed', tally: 'bash, 2 read, ls' } })
  assert.equal(codemodeText(words), '4 tool calls, all passed · bash, 2 read, ls')
})

test('one tool call is one, and it passed', () => {
  const words = wordsOf(script([call('bash', 'ok')]))

  assert.equal(codemodeText(words), '1 tool call, passed · bash')
})

test('failed tool calls are counted apart, with their names', () => {
  const words = wordsOf(script([call('bash', 'error'), call('read', 'ok'), call('read', 'ok'), call('ls', 'ok')]))

  assert.deepEqual(words, { calls: { count: '4 tool calls', failed: '1 failed', names: 'bash', tally: 'bash, 2 read, ls' } })
  assert.equal(codemodeText(words), '4 tool calls, 1 failed: bash · bash, 2 read, ls')
})

test('each failed name is said once, in the order they failed', () => {
  const words = wordsOf(script([call('read', 'error'), call('bash', 'error'), call('read', 'error'), call('ls', 'ok')]))

  assert.equal(codemodeText(words), '4 tool calls, 3 failed: read, bash · 2 read, bash, ls')
})

test('while the script runs, its tool calls are counted so far', () => {
  const words = wordsOf(script([call('read', 'ok'), call('bash', 'running')], 'running'))

  assert.deepEqual(words, { calls: { count: '2 tool calls so far', tally: 'read, bash' } })
  assert.equal(codemodeText(wordsOf(script([], 'running'))), 'no tool calls yet')
})

test('a script whose tool calls are not known says nothing about them', () => {
  assert.deepEqual(wordsOf(script(undefined)), {})
  assert.equal(codemodeText(wordsOf(script(undefined))), '')
  assert.equal(codemodeText(wordsOf(script(undefined, 'failed'))), 'script failed')
})

test('a script that made no tool calls says so', () => {
  assert.equal(codemodeText(wordsOf(script([]))), 'no tool calls')
})

test('a script that failed or was stopped says so first, then its tool calls', () => {
  assert.equal(codemodeText(wordsOf(script([call('read', 'ok')], 'failed'))), 'script failed · 1 tool call, passed · read')
  // Stopped while a call ran: that call never finished.
  assert.equal(codemodeText(wordsOf(script([call('read', 'ok'), call('bash', 'running')], 'running'), true)), 'stopped · 2 tool calls, 1 did not finish · read, bash')
  assert.equal(codemodeText(wordsOf(script([call('read', 'cancelled'), call('bash', 'error')], 'failed'))), 'script failed · 2 tool calls, 1 did not finish, 1 failed: bash · read, bash')
})

test('the tally counts each kind in the order it was first seen', () => {
  const words = wordsOf(script([call('read', 'ok'), call('bash', 'ok'), call('read', 'ok'), call('ls', 'ok'), call('bash', 'ok')]))

  assert.equal(words.calls?.tally, '2 read, 2 bash, ls')
})

test('a tool call takes its time as the app says one', () => {
  assert.equal(callTime(361.11054200000217), '361 ms')
  assert.equal(callTime(5), '5 ms')
  assert.equal(callTime(0.4), '0 ms')
  assert.equal(callTime(1234), '1.2 s')
  assert.equal(callTime(999.7), '1.0 s')
  assert.equal(callTime(65_000), '1m 05s')
})

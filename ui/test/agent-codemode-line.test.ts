import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { callTime, codemodeOf, codemodeText, codemodeWarning, codemodeWords } from '../src/features/agent-activity/codemode.ts'

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
  assert.equal(codemodeText(wordsOf(script([], 'running'))), '', 'with none reported yet, the row claims nothing')
})

test('a script whose tool calls are not known says nothing about them', () => {
  assert.deepEqual(wordsOf(script(undefined)), {})
  assert.equal(codemodeText(wordsOf(script(undefined))), '')
  assert.equal(codemodeText(wordsOf(script(undefined, 'failed'))), 'script failed')
})

test('a script with no tool run reported never says "no tool calls": it says what it printed, or nothing', () => {
  // The count is of tools the script ran through codemode. A script that works with codemode's own functions has none.
  assert.equal(codemodeText(wordsOf(script([]))), '')

  const listing = 'Script completed\nWall time 0.0 seconds\nOutput:\n\n[{"name":"mcp__mail__get","description":"Get a message."},{"name":"mcp__mail__draft","description":"Write a draft."}]'
  assert.equal(codemodeText(wordsOf({ ...script([]), output: listing })), 'listed 2 tools')
  assert.equal(codemodeText(wordsOf({ ...script([]), output: listing.slice(0, 120) })), 'listed tools', 'a listing cut short is not counted')
  assert.equal(codemodeText(wordsOf({ ...script([call('read', 'ok')]), output: listing })), '1 tool call, passed · read', 'reported runs are what the row says')
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

const warningOf = (entry: ActivityEntry, ended = false) => codemodeWarning(codemodeOf(entry, ended))

test('a script that finished keeps its tick only when every tool call it made passed', () => {
  assert.equal(warningOf(script([call('bash', 'ok'), call('read', 'ok')])), null)
  assert.equal(warningOf(script([])), null)
  assert.equal(warningOf(script(undefined)), null)
})

test('a script that finished with a call that failed or did not finish warns, and says how many', () => {
  assert.equal(warningOf(script([call('bash', 'error'), call('read', 'ok'), call('read', 'ok'), call('ls', 'ok')])), 'The script finished. Of its 4 tool calls, 1 failed.')
  assert.equal(warningOf(script([call('bash', 'error'), call('read', 'cancelled'), call('ls', 'ok')])), 'The script finished. Of its 3 tool calls, 1 failed and 1 did not finish.')
  assert.equal(warningOf(script([call('bash', 'running')])), 'The script finished. Its one tool call did not finish.')
  assert.equal(warningOf(script([call('bash', 'error')])), 'The script finished. Its one tool call failed.')
})

test('a script that failed, was stopped or still runs keeps the mark it has', () => {
  assert.equal(warningOf(script([call('bash', 'error')], 'failed')), null)
  assert.equal(warningOf(script([call('bash', 'error'), call('read', 'running')], 'running'), true), null)
  assert.equal(warningOf(script([call('bash', 'error'), call('read', 'running')], 'running')), null)
})

test('a tool call takes its time as the app says one', () => {
  assert.equal(callTime(361.11054200000217), '361 ms')
  assert.equal(callTime(5), '5 ms')
  assert.equal(callTime(0.4), '0 ms')
  assert.equal(callTime(1234), '1.2 s')
  assert.equal(callTime(999.7), '1.0 s')
  assert.equal(callTime(65_000), '1m 05s')
})

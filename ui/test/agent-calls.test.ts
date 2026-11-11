import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { callsOf, type Call, type CallRow } from '../src/features/agent-activity/calls.ts'

const said = (id: string, text: string): ActivityEntry => ({ id: `message:${id}`, kind: 'assistant', text })
const tool = (id: string, name: string, args: object, state: ActivityEntry['state'] = 'completed', output = ''): ActivityEntry => ({
  id: `tool:${id}`,
  kind: 'tool',
  name,
  state,
  input: JSON.stringify(args, null, 2),
  output,
})
const calls = (rows: readonly CallRow[]) => rows.filter((row): row is Call => row.kind === 'call')

test('each tool call is one row in the order it came, with the agent\'s words between them, the same after a reconnect', () => {
  const entries = [said('1:0', 'Looking.'), tool('a', 'read', { path: '/repo/src/a.ts' }), said('2:0', ''), tool('b', 'bash', { command: 'pnpm test' }), said('3:0', 'Done.')]
  const rows = callsOf(entries, { cwd: '/repo' })
  assert.deepEqual(rows.map((row) => [row.kind, row.key]), [['says', 'message:1:0'], ['call', 'tool:a'], ['call', 'tool:b'], ['says', 'message:3:0']])
  // A reset resends every entry as a new object: the rows, and their keys, stay the same.
  assert.deepEqual(callsOf(entries.map((entry) => ({ ...entry })), { cwd: '/repo' }), rows)
})

test('a call\'s task is its tool and what the canvas says it does', () => {
  const [read, run, other] = calls(callsOf([tool('a', 'read', { path: '/repo/src/a.ts' }), tool('b', 'bash', { command: 'pnpm test\n# more' }, 'running'), tool('c', 'sparsity_scan', { path: 'src', depth: 2 })], { cwd: '/repo' }))
  assert.deepEqual([read!.name, read!.task], ['read', { lead: 'Read', subject: 'src/a.ts', code: true }])
  assert.deepEqual([run!.name, run!.task, run!.state], ['bash', { lead: 'Running', subject: 'pnpm test', code: true }, 'running'])
  assert.deepEqual([other!.name, other!.task], ['sparsity_scan', { lead: 'Used', subject: 'src' }], 'a tool with no words of its own is told by its first argument')
})

test('parameters are indented JSON, and text on many lines is drawn apart in its own language', () => {
  const [edit, script, raw] = calls(
    callsOf([
      tool('a', 'edit', { path: 'src/a.ts', edits: [{ oldText: 'const a = 1\nconst b = 2', newText: 'const a = 3' }] }),
      tool('b', 'bash', { command: 'cd src\npnpm test' }),
      { id: 'tool:c', kind: 'tool', name: 'x', state: 'completed', input: 'not json' },
    ]),
  )
  assert.equal(edit!.parameters, JSON.stringify({ path: 'src/a.ts', edits: [{ oldText: '↓ 2 lines', newText: 'const a = 3' }] }, null, 2))
  assert.equal(edit!.parametersLanguage, 'json')
  assert.deepEqual(edit!.long, [{ field: 'edits[0].oldText', text: 'const a = 1\nconst b = 2', language: 'typescript' }])
  assert.deepEqual(script!.long, [{ field: 'command', text: 'cd src\npnpm test', language: 'shellscript' }])
  assert.deepEqual([raw!.parameters, raw!.parametersLanguage, raw!.long], ['not json', null, []], 'arguments that are not JSON are shown as they came')
})

test('output is highlighted as the file it read or as JSON, and plain otherwise', () => {
  const [read, json, plain] = calls(
    callsOf([
      tool('a', 'read', { path: 'src/a.ts', offset: 40 }, 'completed', 'const a = 1\n\n[Showing lines 40-2039 of 5000. Use offset=2040 to continue.]'),
      tool('b', 'bash', { command: 'gh pr list --json number' }, 'completed', '[{"number":482}]'),
      tool('c', 'bash', { command: 'ls' }, 'completed', 'a.ts\nb.ts'),
    ]),
  )
  assert.deepEqual([read!.output, read!.outputLanguage, read!.from, read!.notice], ['const a = 1', 'typescript', 40, 'Showing lines 40-2039 of 5000. Use offset=2040 to continue.'])
  assert.deepEqual([json!.output, json!.outputLanguage], [JSON.stringify([{ number: 482 }], null, 2), 'json'])
  assert.deepEqual([plain!.output, plain!.outputLanguage, plain!.from], ['a.ts\nb.ts', null, undefined])
})

test('a failed call says why, and one still running when its job ended stopped', () => {
  const [shell, read] = calls(
    callsOf([tool('a', 'bash', { command: 'pnpm test' }, 'failed', 'FAIL x\n\nCommand exited with code 1'), tool('b', 'read', { path: 'missing.ts' }, 'failed', 'ENOENT: no such file')]),
  )
  assert.deepEqual([shell!.state, shell!.output, shell!.error, shell!.exitCode], ['failed', 'FAIL x', 'Command exited with code 1', 1])
  assert.deepEqual([read!.state, read!.output, read!.error], ['failed', '', 'ENOENT: no such file'])
  const [stopped] = calls(callsOf([tool('c', 'bash', { command: 'pnpm dev' }, 'running', 'ready')], { ended: true }))
  assert.equal(stopped!.state, 'stopped')
})

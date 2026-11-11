import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { History } from '../src/history.ts'
import { toWire } from '../src/state-sync.ts'

const shell = { id: 's', role: 'bashExecution', command: 'printf "<tag>**raw**"', output: '', exitCode: 0, cancelled: false, truncated: false, timestamp: 1000, fullOutputPath: '/private/log' }

test('wire retains command-only native shells, bounds previews and honors clear', () => {
  const messages = toWire({ messages: [shell] }).messages
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.command, shell.command)
  assert.equal(messages[0]?.output, '')
  assert.equal(messages[0]?.content, '')
  assert.equal(messages[0]?.at, 1000)
  assert.equal('fullOutputPath' in messages[0]!, false)
  assert.deepEqual(toWire({ messages: [shell] }, new Set(['s'])).messages, [])
  assert.deepEqual(toWire({ messages: [shell], presentation: { hiddenMessageIds: ['s'] } }).messages, [])
  const long = toWire({ messages: [{ ...shell, command: 'c'.repeat(8193), output: 'o'.repeat(8193), truncated: false }] }).messages[0]!
  assert.equal(long.command?.length, 8192)
  assert.equal(long.output?.length, 8192)
  assert.equal(long.commandPreviewCut, true)
  assert.equal(long.outputPreviewCut, true)
  assert.equal(long.truncated, false)
  assert.deepEqual(toWire({ messages: [] }).messages, [], 'reset carries no old rows')
})

test('History keeps native shell text only on the saved active branch within retention', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'shell-history-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await mkdir(join(home, 'sessions'))
  const row = (id: string, parentId: string | null, message: unknown) => ({ type: 'message', id, parentId, message })
  const output = '  <script>raw</script>\n**not markdown**\n'
  const entries = [
    { type: 'session', id: 'session', timestamp: 1 },
    row('u', null, { role: 'user', content: 'Before', timestamp: 10 }),
    row('abandoned', 'u', { ...shell, output: 'old branch' }),
    row('s', 'u', { ...shell, output, exitCode: 7, truncated: true, excludeFromContext: true }),
    row('last', 's', { role: 'assistant', content: 'After', timestamp: 2000 }),
  ]
  await writeFile(join(home, 'sessions/main.jsonl'), entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  const history = new History(home, () => null)
  const opened = await history.open('main.jsonl')
  assert.deepEqual(opened.messages.map(({ id }) => id), ['u', 's', 'last'])
  const saved = opened.messages[1]!
  assert.equal(saved.role, 'bashExecution')
  assert.equal(saved.text, output)
  assert.equal(saved.command, shell.command)
  assert.equal(saved.exitCode, 7)
  assert.equal(saved.truncated, true)
  assert.equal(saved.excludeFromContext, true)
  assert.equal(saved.at, 1000)
  assert.equal('fullOutputPath' in saved, false)
  const limited = await new History(home, () => null, { files: 100, bytes: 32768, messages: 2 }).open('main.jsonl')
  assert.equal(limited.earlier, 1)
  assert.deepEqual(limited.messages.map(({ id }) => id), ['s', 'last'])
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { readJobSession, type JobSessionSeat } from '../src/job-session.ts'
import { runCommand } from '../src/commands.ts'

const harnessId = '11111111-1111-4111-8111-111111111111'
const entry = (id: string, parentId: string | null, message: unknown) => ({ type: 'message', id, parentId, message })
const header = { type: 'session', version: 3, id: 'pi-session-id' }
const encode = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n'
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-saved-job-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'jobs'))
  const file = join(root, 'jobs', `${harnessId}.jsonl`)
  const seat: JobSessionSeat = {
    data: () => root,
    snapshot: () => ({ reports: [{ id: 'report' }], completedJobReports: { run: { id: 'report' } } }),
    state: async () => ({ runs: { run: { kind: 'background', harness: 'pi', harnessId, result: { sessionId: header.id } } } }),
  }
  return { root, file, seat }
}

test('reads the exact mapped run, preserving branch order, parameters, results and stored thinking', async t => {
  const f = fixture(t)
  const rows = [header,
    entry('u', null, { role: 'user', content: 'Task' }),
    entry('abandoned', 'u', { role: 'assistant', content: 'Not this branch' }),
    entry('a', 'u', { role: 'assistant', content: [{ type: 'thinking', thinking: 'Actual stored thought' }, { type: 'text', text: 'Reading' }, { type: 'toolCall', id: 'call1', name: 'read', arguments: { path: '/synthetic', extra: ['all', 'parameters'] } }] }),
    entry('t', 'a', { role: 'toolResult', toolCallId: 'call1', toolName: 'read', content: [{ type: 'text', text: 'Full output\nsecond line' }], details: { preserved: true } }),
    { type: 'compaction', id: 'c', parentId: 't', summary: 'Summary', firstKeptEntryId: 'a' },
    { type: 'custom_message', id: 'x', parentId: 'c', content: 'Extension context', display: false },
  ]
  writeFileSync(f.file, encode(rows))
  const before = readFileSync(f.file, 'utf8')
  const saved = await readJobSession(f.seat, 'report')
  assert.equal(saved.run, 'run'); assert.equal(saved.report, 'report'); assert.equal(saved.cut, false)
  assert.deepEqual(saved.entries, rows.slice(1).filter(row => row.id !== 'abandoned'))
  assert.equal(readFileSync(f.file, 'utf8'), before)
  assert.deepEqual(await runCommand({ 'agent.session': ({ report }) => readJobSession(f.seat, report) }, 'agent.session', { report: 'report' }), { ok: true, value: saved })
  const pathInput = await runCommand({}, 'agent.session', { report: 'report', path: f.file })
  assert.equal(!pathInput.ok && pathInput.error.code, 'invalid-arguments')
})

test('preserves long Unicode messages, tool output and thinking through the exact byte bound', async t => {
  const f = fixture(t)
  const text = 'stored λ\n'.repeat(6000)
  const rows = [entry('u', null, { role: 'user', content: text }), entry('a', 'u', { role: 'assistant', content: [{ type: 'thinking', thinking: text }, { type: 'toolCall', id: 'c', name: 'bash', arguments: { command: text } }] }), entry('t', 'a', { role: 'toolResult', toolCallId: 'c', content: [{ type: 'text', text }] })]
  const data = encode([header, ...rows])
  writeFileSync(f.file, data)
  assert.deepEqual((await readJobSession(f.seat, 'report', Buffer.byteLength(data))).entries, rows)
  await assert.rejects(readJobSession(f.seat, 'report', Buffer.byteLength(data) - 1), /read limit/i)
})

test('known same-ID reports work without completion mapping; unknown, ambiguous and imported reports fail', async t => {
  const f = fixture(t)
  writeFileSync(f.file, encode([header, entry('u', null, { role: 'user', content: 'Exact' })]))
  const state = await f.seat.state()
  const direct = { ...f.seat, snapshot: () => ({ reports: [{ id: 'run' }] }) }
  assert.equal((await readJobSession(direct, 'run')).run, 'run')
  for (const id of ['missing', '../sessions/main.jsonl', '/etc/passwd']) await assert.rejects(readJobSession(f.seat, id), /report|run/i)
  await assert.rejects(readJobSession({ ...f.seat, snapshot: () => ({ completedJobReports: { run: { id: 'report' }, other: { id: 'report' } } }) }, 'report'), /ambiguous/i)
  await assert.rejects(readJobSession({ ...f.seat, state: async () => ({ runs: {} }) }, 'report'), /supported/i)
  await assert.rejects(readJobSession({ ...f.seat, state: async () => ({ runs: { run: { ...state.runs.run, result: { sessionId: 'another-session' } } } }) }, 'report'), /identity/i)
  for (const patch of [{ kind: 'main' }, { harness: 'other' }, { harnessId: '../main' }, { legacy: true }]) {
    await assert.rejects(readJobSession({ ...f.seat, state: async () => ({ runs: { run: { ...state.runs.run, ...patch } } }) }, 'report'), /supported|Pi|job/i)
  }
})

test('refuses missing, linked, directory, FIFO and escaped jobs sources without blocking', { timeout: 4000 }, async t => {
  const f = fixture(t)
  await assert.rejects(readJobSession(f.seat, 'report'), /unavailable|missing/i)
  writeFileSync(join(f.root, 'outside'), encode([header]))
  symlinkSync(join(f.root, 'outside'), f.file)
  await assert.rejects(readJobSession(f.seat, 'report'), /unavailable|regular|link/i)
  rmSync(f.file); mkdirSync(f.file)
  await assert.rejects(readJobSession(f.seat, 'report'), /unavailable|regular/i)
  rmSync(f.file, { recursive: true }); execFileSync('mkfifo', [f.file])
  await assert.rejects(readJobSession(f.seat, 'report'), /unavailable|regular/i)
  rmSync(join(f.root, 'jobs'), { recursive: true }); mkdirSync(join(f.root, 'elsewhere'))
  symlinkSync(join(f.root, 'elsewhere'), join(f.root, 'jobs'))
  await assert.rejects(readJobSession(f.seat, 'report'), /unavailable|link|folder/i)
})

test('refuses oversized files instead of claiming a prefix is the active branch; discloses a crash fragment', async t => {
  const f = fixture(t)
  const prefix = encode([header, entry('u', null, { role: 'user', content: 'Preserved prefix' })])
  writeFileSync(f.file, prefix + encode([entry('a', 'u', { role: 'assistant', content: 'x'.repeat(5000) })]))
  await assert.rejects(readJobSession(f.seat, 'report', Buffer.byteLength(prefix) + 30), /read limit.*no partial branch/i)
  writeFileSync(f.file, prefix + '{"type":"message"')
  const saved = await readJobSession(f.seat, 'report')
  assert.equal(saved.cut, false); assert.equal(saved.skipped, 1)
  assert.deepEqual(saved.entries.map(row => row.id), ['u'])
  writeFileSync(f.file, prefix + 'malformed complete record\n')
  await assert.rejects(readJobSession(f.seat, 'report'), /malformed/i)
  for (const rows of [[{ ...header, version: 1 }], [header, entry('u', 'missing', { role: 'user', content: 'Broken' })], [header, entry('u', 'u', {})]]) {
    writeFileSync(f.file, encode(rows))
    await assert.rejects(readJobSession(f.seat, 'report'), /unsupported|branch/i)
  }
})

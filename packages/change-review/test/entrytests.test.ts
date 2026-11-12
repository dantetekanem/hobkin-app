import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { readEntryTests, searchEntryTests } from '../src/entrytests.ts'

const ANSWER = {
  entry: { kind: 'controller', exact: true },
  tests: [
    { path: 'test/controllers/orders_controller_test.rb', line: 5, text: 'post orders_url, params: { id: 1 }', found: 'route', detail: 'post orders_url → orders#create (POST /orders)' },
    { path: 'test/jobs/receipt_job_test.rb', found: 'perform' },
    { line: 3, found: 'route' },
  ],
  notes: ['one test file was not readable'],
}

test('the tests of an answer are read at the top or under details, and one with no path or label is left out', () => {
  const expected = [
    { path: 'test/controllers/orders_controller_test.rb', line: 5, text: 'post orders_url, params: { id: 1 }', found: 'route', detail: 'post orders_url → orders#create (POST /orders)' },
    { path: 'test/jobs/receipt_job_test.rb', found: 'perform' },
  ]
  assert.deepEqual(readEntryTests(ANSWER), { tests: expected, notes: ['one test file was not readable'] })
  assert.deepEqual(readEntryTests({ text: '', details: ANSWER }).tests, expected)
  // As agentic-search writes it today: beside the files of the search, under `entryTests`.
  assert.deepEqual(readEntryTests({ text: 'No code matches found', details: { query: 'OrdersController#create', intent: 'tests', files: [], entryTests: ANSWER } }), { tests: expected, notes: ['one test file was not readable'] })
  assert.deepEqual(readEntryTests({ text: 'x', details: { files: [] } }), { tests: [], notes: [] })
  assert.deepEqual(readEntryTests('nonsense'), { tests: [], notes: [] })
})

function fakeProgram(t: TestContext, body: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'change-review-entry-test-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const program = join(dir, 'agentic-search')
  writeFileSync(program, `#!${process.execPath}\n${body}\n`)
  chmodSync(program, 0o755)
  return { dir, program }
}

test('the search runs agentic-search for the symbol and says why when it cannot', async (t) => {
  const ok = fakeProgram(t, `process.stdout.write(JSON.stringify({ tests: [{ path: 'a_test.rb', found: 'class', args: process.argv.slice(2) }] }))`)
  const answer = await searchEntryTests({ cwd: ok.dir, symbol: 'Orders#create', program: ok.program })
  assert.deepEqual(answer, { ok: true, tests: [{ path: 'a_test.rb', found: 'class' }], notes: [] })

  const failing = fakeProgram(t, `process.stderr.write('agentic-search: bad query\\n'); process.exit(2)`)
  assert.deepEqual(await searchEntryTests({ cwd: failing.dir, symbol: 'x', program: failing.program }), { ok: false, reason: 'bad query' })
  const garbled = fakeProgram(t, `process.stdout.write('not json')`)
  assert.deepEqual(await searchEntryTests({ cwd: garbled.dir, symbol: 'x', program: garbled.program }), { ok: false, reason: 'the search gave no readable answer.' })
  const slow = fakeProgram(t, `setTimeout(() => {}, 30000)`)
  assert.deepEqual(await searchEntryTests({ cwd: slow.dir, symbol: 'x', program: slow.program, timeoutMs: 300 }), { ok: false, reason: 'the search took longer than 0.3 seconds.' })
  assert.deepEqual(await searchEntryTests({ cwd: slow.dir, symbol: 'x', program: join(slow.dir, 'missing') }), { ok: false, reason: `agentic-search could not start: spawn ${join(slow.dir, 'missing')} ENOENT` })
})

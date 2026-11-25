import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bunCases, detectRunbooks, runProof } from '../src/proof.ts'

test('Bun receipts reject other headers, duplicate names and non-native output', () => {
  const output = 'bun test v1.3.14 (hash)\n\ntest/a.test.ts:\n(pass) active [0.10ms]\n(skip) later\n(fail) broken [0.20ms]\n(pass) duplicate\n(pass) duplicate\nother.test.ts:\n(pass) borrowed\n'
  assert.deepEqual(bunCases(output, ['test/a.test.ts'], '/repo'), [
    { path: 'test/a.test.ts', name: 'active', status: 'passed' },
    { path: 'test/a.test.ts', name: 'later', status: 'skipped' },
    { path: 'test/a.test.ts', name: 'broken', status: 'failed' },
  ])
  assert.deepEqual(bunCases(output, ['test/a.test.ts', 'other.test.ts'], '/repo'), [])
  assert.deepEqual(bunCases(output.replace('bun test', 'fake test'), ['test/a.test.ts'], '/repo'), [])
})

test('Bun GUI discovery ignores relative PATH and preserves explicit flags', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'proof-bun-gui-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'bun test --timeout 4000 --bail' } }))
  const prior = process.env.PATH
  t.after(() => { process.env.PATH = prior })
  process.env.PATH = '.:node_modules/.bin'
  const book = detectRunbooks(dir)[0]
  assert.ok(book?.command[0]?.startsWith('/'))
  assert.deepEqual(book?.command.slice(1), ['test', '--timeout', '4000', '--bail'])
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'bun test --test-name-pattern "only this"' } }))
  assert.equal(detectRunbooks(dir).length, 0, 'complex scripts need an override, not silently dropped filters')
  for (const args of ['other.test.ts', '--watch', '--update-snapshots', '--reporter-outfile report.xml']) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: `bun test ${args}` } }))
    assert.equal(detectRunbooks(dir).length, 0)
  }
})

test('installed Bun runs a Rails repository’s script tests and skipped files prove nothing', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'proof-bun-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'bin'))
  mkdirSync(join(dir, 'test'))
  writeFileSync(join(dir, 'bin/rails'), '')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }))
  writeFileSync(join(dir, 'test/active.test.ts'), "import {test, expect} from 'bun:test'; test('active', () => expect(2 + 2).toBe(4))\n")
  writeFileSync(join(dir, 'test/skipped.test.ts'), "import {test} from 'bun:test'; test.skip('missing rejected-move AP case', () => {})\n")
  writeFileSync(join(dir, 'test/failure.test.ts'), "import {test, expect} from 'bun:test'; test('broken', () => expect(1).toBe(2))\n")
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' }).trim()
  git('init', '--quiet'); git('add', '.'); git('commit', '--quiet', '-m', 'fixture')
  const books = detectRunbooks(dir)
  assert.equal(books.length, 2)
  assert.equal(books[1]?.command[1], 'test')
  assert.deepEqual(books[1]?.report, { runner: 'bun' }, 'Bun prints no passing case when its output is not a terminal, so it writes a report')
  const result = await runProof({ cwd: dir, head: git('rev-parse', 'HEAD'), nodes: [], candidates: {}, runbook: books, diffs: [], doublePatterns: [], changedTests: ['test/active.test.ts', 'test/skipped.test.ts', 'test/failure.test.ts'] })
  assert.equal(result.refused, undefined)
  assert.deepEqual(result.runs.find((run) => run.tests.length === 1 && run.tests[0] === 'test/active.test.ts')?.cases, [{ path: 'test/active.test.ts', name: 'active', status: 'passed', line: 1 }])
  assert.deepEqual(result.runs.find((run) => run.tests.length === 1 && run.tests[0] === 'test/skipped.test.ts')?.cases, [{ path: 'test/skipped.test.ts', name: 'missing rejected-move AP case', status: 'skipped', line: 1 }])
  assert.deepEqual(result.runs.find((run) => run.tests.length === 1 && run.tests[0] === 'test/failure.test.ts')?.cases, [{ path: 'test/failure.test.ts', name: 'broken', status: 'failed', line: 1 }])
  const skipped = result.runs.find((run) => run.tests.length === 1 && run.tests[0] === 'test/skipped.test.ts')
  assert.match(skipped?.not_run ?? '', /no test/)
  assert.ok(result.runs.some((run) => run.tests.length === 1 && run.tests[0] === 'test/active.test.ts' && run.exit_code === 0 && !run.not_run))
  assert.equal(git('status', '--porcelain'), '')
})

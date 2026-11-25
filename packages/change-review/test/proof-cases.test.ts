import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { detectRunbook, runProof } from '../src/proof.ts'

/** A committed checkout of the files; the `executable` ones can be run. */
function repo(t: TestContext, files: Record<string, string>, executable: string[] = []) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'proof-cases-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  for (const path of executable) chmodSync(join(dir, path), 0o755)
  const git = (...args: string[]) => {
    const author = ['-c', 'user.name=t', '-c', 'user.email=t@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null']
    return execFileSync('git', ['-C', dir, ...author, ...args], { encoding: 'utf8' }).trim()
  }
  git('init', '--quiet')
  git('add', '.')
  git('commit', '--quiet', '-m', 'fixture')
  return { dir, git, head: git('rev-parse', 'HEAD') }
}

test('node and Vitest runbooks say how their runner reports each case; others say nothing', (t) => {
  const vitest = (version: string | null) =>
    repo(t, {
      'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
      'node_modules/.bin/vitest': '',
      ...(version ? { 'node_modules/vitest/package.json': JSON.stringify({ version }) } : {}),
    }).dir
  assert.deepEqual(detectRunbook(repo(t, { 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) }).dir)?.report, { runner: 'node' })
  assert.deepEqual(detectRunbook(vitest('4.1.12'))?.report, { runner: 'vitest', lines: true })
  // Vitest 3 is the oldest seen taking --includeTaskLocation; an older one could refuse it.
  assert.deepEqual(detectRunbook(vitest('2.1.9'))?.report, { runner: 'vitest', lines: false })
  assert.deepEqual(detectRunbook(vitest(null))?.report, { runner: 'vitest', lines: false })
  const jest = repo(t, { 'package.json': JSON.stringify({ devDependencies: { jest: '^30.0.0' } }), 'node_modules/.bin/jest': '' }).dir
  assert.equal(detectRunbook(jest)?.report, undefined)
  assert.equal(detectRunbook(jest, { command: [process.execPath, '--test'] })?.report, undefined, 'a configured command is run as it is')
})

test("node's own report gives each case of a test file run alone its result, and leaves nothing behind", async (t) => {
  const { dir, git, head } = repo(t, {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }),
    'test/cart.test.js': [
      "import assert from 'node:assert/strict'",
      "import { describe, it, test } from 'node:test'",
      "test('active', () => assert.equal(2 + 2, 4))",
      "describe('cart', () => {",
      "  it('broken', () => assert.equal(1, 2))",
      "  it.skip('later', () => {})",
      '})',
      '',
    ].join('\n'),
  })
  // A temporary folder of this test's own, so another file's runs leave nothing in it.
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'proof-cases-tmp-')))
  const prior = process.env.TMPDIR
  const restore = () => {
    if (prior === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = prior
  }
  t.after(() => {
    restore()
    rmSync(temporary, { recursive: true, force: true })
  })
  process.env.TMPDIR = temporary
  const result = await runProof({ cwd: dir, head, nodes: [], candidates: {}, runbook: detectRunbook(dir), diffs: [], doublePatterns: [], changedTests: ['test/cart.test.js'] })
  restore()
  const [run] = result.runs
  assert.deepEqual(run?.cases, [
    { path: 'test/cart.test.js', name: 'active', status: 'passed' },
    { path: 'test/cart.test.js', name: 'cart > broken', status: 'failed' },
    { path: 'test/cart.test.js', name: 'cart > later', status: 'skipped' },
  ])
  assert.equal(run?.command, `${process.execPath} --test test/cart.test.js`, 'the command is the one to type, without the review’s report')
  assert.deepEqual(run?.failed_at, [{ path: 'test/cart.test.js', line: 5 }], 'the printed output is what it was')
  assert.equal(git('status', '--porcelain'), '')
  assert.deepEqual(readdirSync(temporary), [], 'the report is removed once it is read')
})

test('a Vitest run alone writes its report where the review asks, and each case of the file is read from it', async (t) => {
  // A stand-in for Vitest that writes the report a real one does to the file it is given.
  const fake = [
    '#!/usr/bin/env node',
    "const { writeFileSync } = require('node:fs')",
    "const { resolve } = require('node:path')",
    'const args = process.argv.slice(2)',
    "const out = args.find((arg) => arg.startsWith('--outputFile.json='))?.slice('--outputFile.json='.length)",
    "const line = args.includes('--includeTaskLocation') ? { location: { line: 1, column: 1 } } : {}",
    "const results = [{ ancestorTitles: ['cart'], title: 'rounds', status: 'passed', ...line }, { ancestorTitles: [], title: 'later', status: 'todo', ...line }]",
    'if (out) writeFileSync(out, JSON.stringify({ testResults: [{ name: resolve(args.at(-1)), assertionResults: results }] }))',
    "console.log(' Test Files  1 passed (1)')",
    '',
  ].join('\n')
  const { dir, head } = repo(t, {
    'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
    'node_modules/.bin/vitest': fake,
    'node_modules/vitest/package.json': JSON.stringify({ version: '4.1.12' }),
    'test/cart.test.ts': "test('rounds', () => {})\n",
  }, ['node_modules/.bin/vitest'])
  const result = await runProof({ cwd: dir, head, nodes: [], candidates: {}, runbook: detectRunbook(dir), diffs: [], doublePatterns: [], changedTests: ['test/cart.test.ts'] })
  assert.deepEqual(result.runs[0]?.cases, [
    { path: 'test/cart.test.ts', name: 'cart > rounds', status: 'passed', line: 1 },
    { path: 'test/cart.test.ts', name: 'later', status: 'skipped', line: 1 },
  ])
})

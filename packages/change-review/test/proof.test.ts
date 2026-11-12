import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { gitRepo } from '../src/git.ts'
import { candidateTests, detectRunbook, doublesIn, probeNode, proofOf, revertNode, runProof, type ProofNode, type TestCandidate } from '../src/proof.ts'
import type { FileDiff, Scan, TestRun } from '../src/types.ts'

function tempDir(t: TestContext, name: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `change-review-${name}-`)))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function writeIn(dir: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
}

const DOUBLES = ['stub(:sym', 'receive(:sym)', 'expects(:sym)', 'mock.method(', 'spyOn(', 'vi.mock(', 'sinon.stub(']

// ───────────────────────── Runbook ─────────────────────────

test('the runbook is how this repository runs given test files, and none when nothing fits', (t) => {
  const layout = (files: Record<string, string>) => {
    const dir = tempDir(t, 'runbook')
    writeIn(dir, files)
    return dir
  }
  const commandOf = (dir: string) => detectRunbook(dir)?.command ?? null

  assert.deepEqual(commandOf(layout({ 'package.json': JSON.stringify({ scripts: { test: 'node --test "test/**/*.test.ts"' } }) })), [process.execPath, '--test'])
  // A fixture under test/ is not a test: run as one, a server in it would never end.
  const nodeBook = detectRunbook(layout({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) }))!
  const runs = (path: string) => nodeBook.accepts.some((ending) => path.endsWith(ending))
  assert.equal(runs('host/test/fixtures/mcp-server.mjs'), false)
  assert.equal(runs('ui/test/home-model.test.ts'), true)
  assert.equal(runs('test/cart.spec.js'), true)
  const vitest = layout({ 'package.json': JSON.stringify({ scripts: { test: 'vitest' } }), 'node_modules/.bin/vitest': '' })
  assert.deepEqual(commandOf(vitest), [join(vitest, 'node_modules/.bin/vitest'), 'run'])
  assert.equal(commandOf(layout({ 'package.json': JSON.stringify({ scripts: { test: 'vitest' } }) })), null, 'never installs a runner it does not find')
  const jest = layout({ 'package.json': JSON.stringify({ devDependencies: { jest: '^30.0.0' } }), 'node_modules/.bin/jest': '' })
  assert.deepEqual(commandOf(jest), [join(jest, 'node_modules/.bin/jest'), '--runTestsByPath'])
  const rails = layout({ 'bin/rails': '', 'test/test_helper.rb': '', 'package.json': JSON.stringify({ scripts: { test: 'jest' } }) })
  assert.deepEqual(commandOf(rails), [join(rails, 'bin/rails'), 'test'])
  assert.deepEqual(detectRunbook(rails)?.accepts, ['_test.rb'])
  assert.deepEqual(commandOf(layout({ Gemfile: "gem 'rspec-rails'\n", 'spec/spec_helper.rb': '' })), ['bundle', 'exec', 'rspec'])
  assert.equal(commandOf(layout({ 'spec/runner.js': '', 'README.md': '' })), null)

  const override = detectRunbook(layout({ 'package.json': '{}' }), { command: ['make', 'test', 'FILES='], env: { RAILS_ENV: 'test' }, timeoutMs: 5_000 })
  assert.deepEqual(override && { command: override.command, env: override.env, timeoutMs: override.timeoutMs, accepts: override.accepts }, { command: ['make', 'test', 'FILES='], env: { RAILS_ENV: 'test' }, timeoutMs: 5_000, accepts: [] })
  assert.throws(() => detectRunbook(tmpdir(), { command: [] }), /command/)
})

// ───────────────────────── Candidates ─────────────────────────

test('candidate tests: what the scan links, changed tests that name the symbol, and files named after the source', async () => {
  const files: Record<string, string> = {
    'test/flow/checkout.test.ts': "checkout(['a'])",
    'test/rounding.test.ts': 'assert.equal(Shop.total([0.1, 0.2]), 0.3)',
    'test/other.test.ts': 'assert.equal(subtotal(1), 1)',
    'test/shop.test.ts': '',
    'src/shop.ts': '',
    'test/models/cart_test.rb': '',
  }
  const scan = { anchors: [{ id: 'n1', tests: [{ id: 'n7', symbol: 'checkout', path: 'test/flow/checkout.test.ts', line: 1 }, { id: 'n8', symbol: 'gone', path: 'test/gone.test.ts', line: 1 }] }] } as unknown as Scan
  const args = {
    scan,
    changedTestPaths: ['test/rounding.test.ts', 'test/other.test.ts', 'test/deleted.test.ts'],
    isLifecycleTest: (path: string) => path.includes('/flow/'),
    exists: (path: string) => path in files,
    read: (path: string) => files[path] ?? null,
  }

  assert.deepEqual(await candidateTests({ ...args, node: { id: 'n1', symbol: 'Shop.total', path: 'src/shop.ts' } }), [
    { path: 'test/flow/checkout.test.ts', why: 'the scan links it to Shop.total', lifecycle: true, changed: false },
    { path: 'test/rounding.test.ts', why: 'this diff changed it and it names total', lifecycle: false, changed: true },
    { path: 'test/shop.test.ts', why: 'named after src/shop.ts', lifecycle: false, changed: false },
  ])
  assert.deepEqual(await candidateTests({ ...args, node: { id: 'n2', symbol: 'Cart#total', path: 'app/models/cart.rb' } }), [
    { path: 'test/rounding.test.ts', why: 'this diff changed it and it names total', lifecycle: false, changed: true },
    { path: 'test/models/cart_test.rb', why: 'named after app/models/cart.rb', lifecycle: false, changed: false },
  ])
})

test('a test the scan links only by name must import the definition’s file, unless it goes through the life cycle', async () => {
  const files: Record<string, string> = {
    'test/canvas.test.ts': "import { open } from '../src/canvas.ts'\nopen()",
    'test/home.test.ts': "import { open } from '../src/home/model.ts'\nopen()",
    'test/flow/app.test.ts': 'await app.open()',
    'test/main.test.ts': "import { open } from '../src/main-model.ts'\nopen()",
    'src/home/model.ts': '',
  }
  const linked = ['test/canvas.test.ts', 'test/home.test.ts', 'test/flow/app.test.ts', 'test/main.test.ts'].map((path, index) => ({ id: `t${index}`, symbol: 'open', path, line: 1 }))
  const scan = { anchors: [{ id: 'n1', tests: linked }] } as unknown as Scan
  const found = await candidateTests({
    node: { id: 'n1', symbol: 'open', path: 'src/home/model.ts' },
    scan,
    changedTestPaths: [],
    isLifecycleTest: (path) => path.includes('/flow/'),
    exists: (path) => path in files,
    read: (path) => files[path] ?? null,
  })
  assert.deepEqual(found.map((candidate) => candidate.path).sort(), ['test/flow/app.test.ts', 'test/home.test.ts'])
})

// ───────────────────────── Mutations ─────────────────────────

const SHOP_BASE = [
  'export function total(items: number[]): number {',
  '  return items.reduce((sum, item) => sum + item, 0)',
  '}',
  '',
  'export function checkout(items: number[]): number {',
  '  return total(items)',
  '}',
  '',
  'export function spin(): number {',
  '  while (true) {}',
  '}',
  '',
].join('\n')

const SHOP_HEAD = [
  'export function total(items: number[]): number {',
  '  const sum = items.reduce((sum, item) => sum + item, 0)',
  '  return Math.round(sum * 100) / 100',
  '}',
  '',
  'export function discount(value: number): number {',
  '  return value > 100 ? value - 10 : value',
  '}',
  '',
  'export function checkout(items: number[]): number {',
  '  return discount(total(items))',
  '}',
  '',
  'export function spin(): number {',
  '  return 1',
  '}',
  '',
].join('\n')

test('a revert puts back only the changes inside the definition, even when git aligned one across two', () => {
  // One hunk, as git writes it: every change sits within three lines of the next, and the closing brace of total
  // at base is matched with the one that closes the new discount, so one block runs from total into discount.
  const diff: FileDiff = {
    path: 'src/shop.ts',
    hunks: [
      {
        oldStart: 1,
        oldLines: 11,
        newStart: 1,
        newLines: 16,
        lines: [
          ' export function total(items: number[]): number {',
          '-  return items.reduce((sum, item) => sum + item, 0)',
          '+  const sum = items.reduce((sum, item) => sum + item, 0)',
          '+  return Math.round(sum * 100) / 100',
          '+}',
          '+',
          '+export function discount(value: number): number {',
          '+  return value > 100 ? value - 10 : value',
          ' }',
          ' ',
          ' export function checkout(items: number[]): number {',
          '-  return total(items)',
          '+  return discount(total(items))',
          ' }',
          ' ',
          ' export function spin(): number {',
          '-  while (true) {}',
          '+  return 1',
          ' }',
        ],
      },
    ],
  }
  const checkout = revertNode(SHOP_HEAD, [10, 12], diff)
  assert.deepEqual(checkout, { text: SHOP_HEAD.replace('  return discount(total(items))', '  return total(items)') })
  const total = revertNode(SHOP_HEAD, [1, 4], diff)
  assert.deepEqual(total, { text: SHOP_HEAD.replace('  const sum = items.reduce((sum, item) => sum + item, 0)\n  return Math.round(sum * 100) / 100', '  return items.reduce((sum, item) => sum + item, 0)') })

  // A changed first line with an insertion right above it: what was removed belongs to the definition.
  const header: FileDiff = { path: 'src/b.ts', hunks: [{ oldStart: 1, oldLines: 4, newStart: 1, newLines: 5, lines: [' x', '-function b(p) {', '+function a() {}', '+function b(p, q) {', '   return p', ' }'] }] }
  assert.deepEqual(revertNode('x\nfunction a() {}\nfunction b(p, q) {\n  return p\n}\n', [3, 5], header), { text: 'x\nfunction a() {}\nfunction b(p) {\n  return p\n}\n' })

  assert.deepEqual(revertNode(SHOP_HEAD, [5, 5], diff), { why: 'none of the changes in the diff sit inside lines 5 to 5.' })
  assert.deepEqual(revertNode(SHOP_HEAD.replace('return 1', 'return 2'), [14, 16], diff), { why: 'the file does not hold what the diff says it holds at line 15.' })
  assert.deepEqual(revertNode(SHOP_HEAD, [1, 4], undefined), { why: 'the diff has no changes for this file.' })
})

test('a probe replaces the body of an added definition with a failing statement, or says why it cannot', () => {
  const probe = (text: string, path = 'src/a.ts') => probeNode(text, { id: 'n9', path, lines: [1, text.trimEnd().split('\n').length] })
  const THROW = "throw new Error('change-review probe n9')"

  assert.deepEqual(probe('export function f(a: { x: number }): { y: number } {\n  return { y: a.x }\n}\n'), { text: `export function f(a: { x: number }): { y: number } { ${THROW} }\n` })
  assert.deepEqual(probe("export const g = (x: number) => x * 2 // '}'\n"), { text: `export const g = (x: number) => { ${THROW} } // '}'\n` })
  assert.deepEqual(probe('const h = async () => {\n  const s = `${"}"}`\n  return s\n};\n'), { text: `const h = async () => { ${THROW} };\n` })
  assert.deepEqual(probe('const wrapped = memo((x) => x)\n'), { why: 'no function body to replace was found in lines 1 to 1.' })
  assert.deepEqual(probe('def total(items, rate = 1)\n  items.sum * rate\nend\n', 'app/cart.rb'), { text: "def total(items, rate = 1)\n  raise 'change-review probe n9'\nend\n" })
  assert.deepEqual(probe('def total = 1\n', 'app/cart.rb'), { why: 'no def with a body and an end was found in lines 1 to 1.' })
  assert.deepEqual(probe('export const C = () => <div />\n', 'ui/c.tsx'), { why: 'no probe is placed in .tsx files: nothing here can check that the result still parses.' })
})

// ───────────────────────── The value ─────────────────────────

test('the proof value follows what failed: changed life-cycle tests first, doubles last', () => {
  const candidate = (path: string, lifecycle: boolean, changed: boolean): TestCandidate => ({ path, why: 'test', lifecycle, changed })
  const flowNew = candidate('test/flow/new.test.ts', true, true)
  const flowOld = candidate('test/flow/old.test.ts', true, false)
  const unit = candidate('test/unit.test.ts', false, false)
  const value = (observations: Parameters<typeof proofOf>[0]['observations']) => proofOf({ symbol: 'total', mutation: 'revert', observations }).value

  assert.equal(value([{ candidate: flowNew, outcome: 'failed', doubles: [] }, { candidate: unit, outcome: 'failed', doubles: [] }]), 'lifecycle-observed')
  assert.equal(value([{ candidate: flowOld, outcome: 'failed', doubles: [] }, { candidate: flowNew, outcome: 'passed', doubles: [] }]), 'lifecycle')
  assert.equal(value([{ candidate: unit, outcome: 'failed', doubles: [] }, { candidate: flowOld, outcome: 'passed', doubles: [] }]), 'isolated')
  assert.equal(value([{ candidate: flowNew, outcome: 'failed', doubles: ['test/flow/new.test.ts:3: mock.method(shop, "total")'] }]), 'mocked')
  assert.equal(value([{ candidate: flowNew, outcome: 'failed', doubles: ['x'] }, { candidate: unit, outcome: 'failed', doubles: [] }]), 'isolated', 'a test without the double still proves it')
  assert.equal(value([{ candidate: unit, outcome: 'passed', doubles: [] }]), 'none')
  assert.equal(value([{ candidate: unit, outcome: 'timed-out', doubles: [] }]), 'unknown', 'a run cut short proves nothing')

  const answer = proofOf({ symbol: 'total', mutation: 'probe', observations: [{ candidate: flowOld, outcome: 'failed', doubles: [] }, { candidate: unit, outcome: 'passed', doubles: [] }] })
  assert.deepEqual(answer, { value: 'lifecycle', evidence: 'test/flow/old.test.ts fails when total is made to throw: a life-cycle test this diff did not change.', observedBy: ['test/flow/old.test.ts'], doubles: [] })
})

test('a double counts when it names the definition or its module', () => {
  const text = ["allow(cart).to receive(:total).and_return(3)", 'Cart.stub(:total_price, 1)', "mock.method(shop, 'total')", "vi.mock('../src/shop.ts')", 'spyOn(other, "subtotal")'].join('\n')
  assert.deepEqual(doublesIn(text, 'spec/cart_spec.rb', 'Cart#total', 'src/shop.ts', DOUBLES), [
    'spec/cart_spec.rb:1: allow(cart).to receive(:total).and_return(3)',
    "spec/cart_spec.rb:3: mock.method(shop, 'total')",
    "spec/cart_spec.rb:4: vi.mock('../src/shop.ts')",
  ])
})

// ───────────────────────── Running the proof ─────────────────────────

const TEST_HEADER = "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\n"

/** A node --test project with base and head commits: the change in `src/shop.ts`, its tests, and one test that fails at head. */
function shopRepo(t: TestContext) {
  const dir = tempDir(t, 'proof')
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', timeout: 30_000 }).trim()
  git('init', '--quiet', '--initial-branch=main')
  writeIn(dir, {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }),
    'src/shop.ts': SHOP_BASE,
    // A life-cycle test from before the change: it calls checkout and never checks the amount.
    'test/flow/checkout.test.ts': `${TEST_HEADER}import { checkout } from '../../src/shop.ts'\n\ntest('checkout gives a number', () => {\n  assert.equal(typeof checkout([1, 2]), 'number')\n})\n`,
    'test/broken.test.ts': `${TEST_HEADER}\ntest('was already broken', () => {\n  assert.equal(1, 2)\n})\n`,
  })
  git('add', '-A')
  git('commit', '--quiet', '-m', 'Start')
  const base = git('rev-parse', 'HEAD')
  writeIn(dir, {
    'src/shop.ts': SHOP_HEAD,
    // Changed with the diff: it checks the new rounding, so it fails once total is put back.
    'test/flow/rounding.test.ts': `${TEST_HEADER}import { total } from '../../src/shop.ts'\n\ntest('totals are rounded to cents', () => {\n  assert.equal(total([0.1, 0.2]), 0.3)\n})\n`,
    'test/shop.test.ts': `${TEST_HEADER}import { discount, spin } from '../src/shop.ts'\n\ntest('discount takes ten off above a hundred', () => {\n  assert.equal(discount(150), 140)\n})\n\ntest('spin returns', () => {\n  assert.equal(spin(), 1)\n})\n`,
  })
  git('add', '-A')
  git('commit', '--quiet', '-m', 'Round totals and discount large carts')
  const head = git('rev-parse', 'HEAD')
  return { dir, git, base, head }
}

const NODES: ProofNode[] = [
  { id: 'n1', symbol: 'total', kind: 'function', path: 'src/shop.ts', lines: [1, 4], change: 'modified' },
  { id: 'n2', symbol: 'discount', kind: 'function', path: 'src/shop.ts', lines: [6, 8], change: 'added' },
  { id: 'n3', symbol: 'checkout', kind: 'function', path: 'src/shop.ts', lines: [10, 12], change: 'modified' },
  { id: 'n4', symbol: 'spin', kind: 'function', path: 'src/shop.ts', lines: [14, 16], change: 'modified' },
  { id: 'n5', symbol: 'legacy', kind: 'function', path: 'src/shop.ts', lines: [1, 1], change: 'removed' },
]

const candidate = (path: string, lifecycle: boolean, changed: boolean): TestCandidate => ({ path, why: 'chosen by the test', lifecycle, changed })
const ROUNDING = candidate('test/flow/rounding.test.ts', true, true)
const CHECKOUT = candidate('test/flow/checkout.test.ts', true, false)
const SHOP = candidate('test/shop.test.ts', false, true)
const BROKEN = candidate('test/broken.test.ts', false, false)
const CANDIDATES = { n1: [ROUNDING, SHOP], n2: [CHECKOUT, SHOP], n3: [CHECKOUT, BROKEN], n4: [SHOP] }

/** Programs still running with this folder in their command line. */
function runningIn(dir: string): string[] {
  return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', timeout: 10_000 })
    .split('\n')
    .filter((line) => line.includes(dir))
}

test('a test that fails on revert proves the definition, one that still passes does not', async (t) => {
  const { dir, git, base, head } = shopRepo(t)
  const runbook = detectRunbook(dir)
  assert.ok(runbook)
  const heard: TestRun[] = []
  const result = await runProof({
    cwd: dir,
    head,
    nodes: NODES,
    candidates: CANDIDATES,
    runbook,
    diffs: await gitRepo(dir).diffs(base, head),
    doublePatterns: DOUBLES,
    timeoutMs: 3_000,
    onRun: (run) => heard.push(run),
  })

  const answer = (id: string) => result.nodes[id]
  assert.deepEqual(answer('n1'), {
    value: 'lifecycle-observed',
    evidence: 'test/flow/rounding.test.ts fails when total is put back to base: a life-cycle test this diff added or changed.',
    observedBy: ['test/flow/rounding.test.ts'],
    doubles: [],
  })
  assert.deepEqual(answer('n3'), {
    value: 'none',
    evidence: 'test/flow/checkout.test.ts still passes when checkout is put back to base: nothing in it checks the change.',
    observedBy: [],
    doubles: [],
  })
  assert.equal(answer('n2')?.value, 'lifecycle', 'an unchanged life-cycle test reaches the added discount through checkout')
  assert.deepEqual(answer('n2')?.observedBy, ['test/flow/checkout.test.ts', 'test/shop.test.ts'])
  assert.equal(answer('n4')?.value, 'unknown')
  assert.match(answer('n4')?.evidence ?? '', /test\/shop\.test\.ts did not finish within 3 seconds when spin is put back to base/)
  assert.deepEqual(answer('n5'), { value: 'not-applicable', evidence: 'removed: there is nothing left to run.', observedBy: [], doubles: [] })

  assert.deepEqual(result.findings, [{ rule: 'failing-test', text: 'test/broken.test.ts fails at head, before anything is changed.', by: 'proof' }])
  assert.deepEqual(
    result.runs.map((run) => [run.kind, run.node ?? '', run.tests.join(' '), run.failed.join(' ')]),
    [
      ['baseline', '', 'test/flow/rounding.test.ts test/shop.test.ts test/flow/checkout.test.ts test/broken.test.ts', 'test/broken.test.ts'],
      ['baseline', '', 'test/flow/rounding.test.ts', ''],
      ['baseline', '', 'test/shop.test.ts', ''],
      ['baseline', '', 'test/flow/checkout.test.ts', ''],
      ['baseline', '', 'test/broken.test.ts', 'test/broken.test.ts'],
      ['revert', 'n1', 'test/flow/rounding.test.ts test/shop.test.ts', 'test/flow/rounding.test.ts'],
      ['revert', 'n1', 'test/flow/rounding.test.ts', 'test/flow/rounding.test.ts'],
      ['revert', 'n1', 'test/shop.test.ts', ''],
      ['probe', 'n2', 'test/flow/checkout.test.ts test/shop.test.ts', 'test/flow/checkout.test.ts test/shop.test.ts'],
      ['probe', 'n2', 'test/flow/checkout.test.ts', 'test/flow/checkout.test.ts'],
      ['probe', 'n2', 'test/shop.test.ts', 'test/shop.test.ts'],
      ['revert', 'n3', 'test/flow/checkout.test.ts', ''],
      ['revert', 'n4', 'test/shop.test.ts', 'test/shop.test.ts'],
    ],
  )
  const first = result.runs[0]!
  assert.equal(first.command, `${process.execPath} --test test/flow/rounding.test.ts test/shop.test.ts test/flow/checkout.test.ts test/broken.test.ts`)
  assert.ok(first.exit_code !== 0 && first.seconds > 0 && first.output_tail?.includes('was already broken'))
  assert.ok(result.runs.every((run) => run.condition_state === 'default'))
  assert.match(result.runs.at(-1)!.output_tail ?? '', /\(stopped after 3 seconds, the time limit\)$/, 'the run that hung was stopped and says so')
  assert.deepEqual(heard, result.runs, 'every run is reported as it is recorded')

  assert.equal(readFileSync(join(dir, 'src/shop.ts'), 'utf8'), SHOP_HEAD, 'the source is back byte for byte')
  assert.equal(git('status', '--porcelain'), '', 'the checkout is clean')
  assert.equal(result.clean, true)
  assert.deepEqual(runningIn(dir), [], 'nothing the tests started is still running')
})

test('the proof refuses a checkout that is not exactly the change, and runs nothing', async (t) => {
  const { dir, base, head } = shopRepo(t)
  const runbook = detectRunbook(dir)!
  const diffs = await gitRepo(dir).diffs(base, head)
  const prove = (at: string) => runProof({ cwd: dir, head: at, nodes: NODES.slice(0, 2), candidates: CANDIDATES, runbook, diffs, doublePatterns: DOUBLES })

  const elsewhere = await prove(base)
  assert.match(elsewhere.refused ?? '', /not at the head of the change/)
  assert.deepEqual(elsewhere.runs, [])

  writeFileSync(join(dir, 'src/shop.ts'), `${SHOP_HEAD}// edited\n`)
  const dirty = await prove(head)
  assert.equal(dirty.refused, 'the checkout has uncommitted changes, so its tests would not run the change as committed.')
  assert.deepEqual(dirty.nodes.n1, { value: 'unknown', evidence: `tests were not run: ${dirty.refused}`, observedBy: [], doubles: [] })
  assert.deepEqual(dirty.runs, [])
  assert.equal(readFileSync(join(dir, 'src/shop.ts'), 'utf8'), `${SHOP_HEAD}// edited\n`, 'nothing was touched')
})

test('a file that is not plain UTF-8 text is never rewritten', async (t) => {
  const dir = tempDir(t, 'proof-latin')
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', timeout: 30_000 }).trim()
  const latin = (body: string) => Buffer.concat([Buffer.from('// caf'), Buffer.from([0xe9]), Buffer.from(`\nexport function f() { return ${body} }\n`)])
  git('init', '--quiet', '--initial-branch=main')
  writeIn(dir, { 'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }), 'test/f.test.js': `${TEST_HEADER}import { f } from '../src/latin.js'\n\ntest('f gives a number', () => {\n  assert.equal(typeof f(), 'number')\n})\n` })
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src/latin.js'), latin('1'))
  git('add', '-A')
  git('commit', '--quiet', '-m', 'Start')
  const base = git('rev-parse', 'HEAD')
  writeFileSync(join(dir, 'src/latin.js'), latin('2'))
  git('commit', '--quiet', '-am', 'Change')
  const head = git('rev-parse', 'HEAD')

  const result = await runProof({
    cwd: dir,
    head,
    nodes: [{ id: 'n1', symbol: 'f', kind: 'function', path: 'src/latin.js', lines: [2, 2], change: 'modified' }],
    candidates: { n1: [candidate('test/f.test.js', false, false)] },
    runbook: detectRunbook(dir),
    diffs: await gitRepo(dir).diffs(base, head),
    doublePatterns: DOUBLES,
  })
  assert.deepEqual(result.nodes.n1, { value: 'unknown', evidence: 'could not put it back to base: src/latin.js is not plain UTF-8 text, so it is not rewritten.', observedBy: [], doubles: [] })
  assert.deepEqual(result.runs.map((run) => run.kind), ['baseline'])
  assert.ok(readFileSync(join(dir, 'src/latin.js')).equals(latin('2')))
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { EntriesSearch } from '../src/entries.ts'
import type { ProofRequest, ProofResult } from '../src/proof.ts'
import { reviewChange } from '../src/pipeline.ts'
import type { ScanOutcome } from '../src/scan.ts'
import type { Level, ModelRunner, Progress, Scan, ScanAnchor, Units } from '../src/types.ts'

/** A git repository whose base commit holds `before` and whose head commit holds `after` on top of it. */
function repoOf(t: TestContext, before: Record<string, string>, after: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'change-review-pipeline-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'shop')
  mkdirSync(repo)
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args],
      { encoding: 'utf8' },
    ).trim()
  const commit = (files: Record<string, string>, message: string) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(repo, path, '..'), { recursive: true })
      writeFileSync(join(repo, path), text)
    }
    git('add', '.')
    git('commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '--quiet', '--initial-branch=main')
  const base = commit(before, 'Start')
  return { repo, base, head: commit(after, 'Change'), out: join(root, 'out'), git }
}

const PACKAGE = JSON.stringify({ name: 'shop', type: 'module', scripts: { test: 'node --test' } })
const TEST_HEADER = "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\n"

/** A small Node project: `total` gains rounding with a test that sees it, and a constant changes that nothing reads. */
function project(t: TestContext) {
  return repoOf(
    t,
    {
      'package.json': PACKAGE,
      'src/total.js': 'export function total(a, b) {\n  return a + b\n}\n',
      'src/config.js': 'export const PRECISION = 2\n',
      'src/money.ts': 'export type Money = number\n',
    },
    {
      'src/total.js': 'export function total(a, b) {\n  return Math.round(a + b)\n}\n',
      'src/config.js': 'export const PRECISION = 3\n',
      'src/money.ts': 'export type Money = { cents: number }\n',
      'test/total.test.js': `${TEST_HEADER}import { total } from '../src/total.js'\n\ntest('rounds the total', () => {\n  assert.equal(total(1.2, 1.4), 3)\n})\n`,
    },
  )
}

/** A scan of the given anchors and nothing else. */
const scanWith = (anchors: ScanAnchor[], dangling: Scan['dangling'] = []): Scan => ({
  anchors,
  nodes: Object.fromEntries(anchors.map(({ id, symbol, kind, path, startLine, endLine }) => [id, { id, symbol, kind, path, startLine, endLine }])),
  edges: [],
  dangling,
  tests: [],
  files: [],
  coverage: { truncated: false, truncatedBy: 'none', skippedAnchors: 0, unresolved: 0, notes: [] },
})
const scanning = (scan: Scan) => async (): Promise<ScanOutcome> => ({ ok: true, scan })

/** What agentic-search would report for that change. */
const scanOf = (): Scan => ({
  anchors: [
    {
      id: 'n1',
      symbol: 'total',
      kind: 'function',
      path: 'src/total.js',
      startLine: 1,
      endLine: 3,
      changedLines: [2],
      language: 'javascript',
      status: 'modified',
      tests: [{ id: 'n3', symbol: 'rounds the total', path: 'test/total.test.js', line: 5 }],
    },
    {
      id: 'n2',
      symbol: 'PRECISION',
      kind: 'constant',
      path: 'src/config.js',
      startLine: 1,
      endLine: 1,
      changedLines: [1],
      language: 'javascript',
      status: 'modified',
      loadTime: true,
      tests: [],
    },
    {
      id: 'n3',
      symbol: 'rounds the total',
      kind: 'test',
      path: 'test/total.test.js',
      startLine: 5,
      endLine: 7,
      changedLines: [1, 2, 3, 4, 5, 6, 7],
      language: 'javascript',
      status: 'added',
      tests: [],
    },
    // A type, erased before the code runs, and a helper inside a test file: neither is a unit to review on its own.
    { id: 'n4', symbol: 'Money', kind: 'type', path: 'src/money.ts', startLine: 1, endLine: 1, changedLines: [1], language: 'javascript', status: 'modified', tests: [] },
    { id: 'n5', symbol: 'cents', kind: 'function', path: 'test/total.test.js', startLine: 1, endLine: 1, changedLines: [1], language: 'javascript', status: 'added', tests: [] },
  ],
  nodes: {
    n1: { id: 'n1', symbol: 'total', kind: 'function', path: 'src/total.js', startLine: 1, endLine: 3 },
    n2: { id: 'n2', symbol: 'PRECISION', kind: 'constant', path: 'src/config.js', startLine: 1, endLine: 1 },
    n3: { id: 'n3', symbol: 'rounds the total', kind: 'test', path: 'test/total.test.js', startLine: 5, endLine: 7 },
    n4: { id: 'n4', symbol: 'Money', kind: 'type', path: 'src/money.ts', startLine: 1, endLine: 1 },
    n5: { id: 'n5', symbol: 'cents', kind: 'function', path: 'test/total.test.js', startLine: 1, endLine: 1 },
  },
  edges: [],
  dangling: [],
  tests: [{ path: 'test/total.test.js', entries: [{ symbol: 'rounds the total', startLine: 5, endLine: 7 }] }],
  files: [],
  coverage: { truncated: false, truncatedBy: 'none', skippedAnchors: 0, unresolved: 0, notes: [] },
})

/** A clock that moves one second at every reading, so measured times are known. */
function steadyClock() {
  let at = Date.parse('2026-11-12T12:00:00Z')
  return () => new Date((at += 1000))
}

/** A careful pass that tries to make safe the node only direct tests prove, and a checker that would lower one unit and raise another. */
function fakeModel() {
  const calls = { review: 0, checker: 0 }
  const model: ModelRunner = async ({ pass }) => {
    calls[pass] += 1
    if (pass === 'review') {
      return JSON.stringify({
        events: [{ node: 'n1', level: 'safe', direction: 'down', aspect: 'behaviour', evidence: 'The existing tests run total and pass with the change in place.', evidence_kind: 'equivalent' }],
        words: { title: 'Round the total', units: { u2: { title: '`total` now rounds every sum to a whole number' } } },
        claims: [],
      })
    }
    return JSON.stringify({
      units: [
        { id: 'u2', agree: 'no', level_i_would_give: 'safe', because: 'it looks small', understood: 'yes', context: 'about right' },
        { id: 'u1', agree: 'no', level_i_would_give: 'high', because: 'nothing shows who reads PRECISION', understood: 'yes', context: 'about right' },
      ],
      needs: [],
    })
  }
  return { model, calls }
}

const levelsOf = (units: Units) => Object.fromEntries(units.units.map((unit) => [unit.nodes.join(','), unit.level])) as Record<string, Level>

test('the blind check runs once and never lowers', async (t) => {
  const { repo, base, head, out, git } = project(t)
  const { model, calls } = fakeModel()
  const result = await reviewChange({ cwd: repo, base, head, out, model, clock: steadyClock(), scan: async (): Promise<ScanOutcome> => ({ ok: true, scan: scanOf() }) })

  assert.deepEqual(calls, { review: 1, checker: 1 }, 'one careful pass and one blind check')
  // total was changed in place and its direct test fails without the rounding: mid by rule 4b. No test goes through a
  // request to it, so no argument makes it safe.
  assert.ok(result.rejected.some((entry) => entry.event.node === 'n1' && /rule 4/.test(entry.reason)))
  assert.deepEqual(levelsOf(result.units), { n1: 'mid', n2: 'high', n4: 'safe' }, 'the checker lowered nothing and raised the constant one step')
  assert.equal(result.graph.nodes.find((node) => node.id === 'n5')?.kind, 'test', 'a helper in a test file is a test, never a unit')
  assert.deepEqual(['n3', 'n5'].map((id) => [result.graph.nodes.find((node) => node.id === id)?.level?.current, result.graph.nodes.find((node) => node.id === id)?.level?.rule]), [['safe', 2], ['safe', 2]], 'a test carries no risk of its own')
  assert.match(result.units.units.find((unit) => unit.nodes.includes('n4'))?.title ?? '', /changes a type, erased before the code runs/)
  assert.equal(result.blind.ran, true)
  // Raising PRECISION moved it ahead of total: each action names the unit that holds its nodes after the check.
  const unitOf = (node: string) => result.units.units.find((unit) => unit.nodes.includes(node))!
  assert.deepEqual(result.blind.actions.map((action) => [action.unit, action.answer]).sort(), [[unitOf('n1').id, 'told-badly'], [unitOf('n2').id, 'thin-evidence']].sort())
  assert.match(result.story, new RegExp(`- Unit ${result.units.units.indexOf(unitOf('n2')) + 1}: raised to high: could not be shown simply`))
  assert.equal(result.storyBy, 'model')
  assert.match(result.story, /^# Round the total/)
  assert.match(result.story, /`total` now rounds every sum to a whole number/)

  // Proof came from running the project's own test: it passed at head, failed with the rounding undone, and passed
  // again alone at head.
  const total = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.equal(total.facts.proof.value, 'isolated')
  assert.deepEqual([total.level?.floor, total.level?.rule, total.extras.changedInPlace], ['mid', 4, true])
  assert.deepEqual(total.runs.map((run) => run.kind), ['baseline', 'revert', 'baseline'])
  assert.equal(git('status', '--porcelain'), '', 'the checkout is the change again')

  for (const name of ['triage.json', 'graph.json', 'risk-events.jsonl', 'units.json', 'story.md', 'story-words.json', 'blind-check.json', 'progress.json', 'progress.jsonl']) {
    assert.ok(existsSync(join(out, name)), `${name} is written`)
  }
  const saved = JSON.parse(readFileSync(join(out, 'blind-check.json'), 'utf8'))
  assert.equal(typeof saved.answer, 'string', 'the checker’s answer is kept unedited')
  // The words the story was written with, under the units as they stand after the check, so a host can tell each unit in them.
  const words = JSON.parse(readFileSync(join(out, 'story-words.json'), 'utf8'))
  assert.equal(words.title, 'Round the total')
  assert.equal(words.units[unitOf('n1').id].title, '`total` now rounds every sum to a whole number')
})

test('progress names the step and measures every one', async (t) => {
  const { repo, base, head, out } = project(t)
  const seen: Progress[] = []
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: async () => ({ ok: true, scan: scanOf() }), onProgress: (progress) => seen.push(progress) })

  assert.deepEqual(result.progress.steps.map((step) => step.id), ['triage', 'map-search', 'map-proof', 'risk-floor', 'risk-model', 'shape', 'story', 'blind-check'])
  for (const step of result.progress.steps) {
    assert.ok(['done', 'skipped'].includes(step.status), `${step.id} finished`)
    if (step.status === 'done') assert.equal(typeof step.seconds, 'number', `${step.id} is measured`)
    else assert.match(step.note ?? '', /no model/, `${step.id} says why it was skipped`)
  }
  assert.equal(result.progress.percent, 100)
  assert.equal(result.storyBy, 'host', 'with no model the story is written from the facts')
  assert.ok(seen.some((progress) => /^map-proof: (baseline|revert) run for/.test(progress.now)), 'it says which test run is going on')
  const lines = readFileSync(join(out, 'progress.jsonl'), 'utf8').trim().split('\n')
  assert.equal(lines.length, seen.length, 'every change of progress is appended as one line')
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'progress.json'), 'utf8')), result.progress)
})

test('rule 11 needs an unchanged life-cycle test that ran and still passed with the change undone, not one that never ran', async (t) => {
  const flags = 'const on = new Set()\n\nexport function setFlag(name, value) {\n  if (value) on.add(name)\n  else on.delete(name)\n}\n\nexport function isEnabled(name) {\n  return on.has(name)\n}\n'
  const total = (branch: string) => `import { isEnabled } from './flags.js'\n\nexport function total(a, b) {\n${branch}  return a + b\n}\n`
  const onTest = `${TEST_HEADER}import { setFlag } from '../../src/flags.js'\nimport { total } from '../../src/total.js'\n\ntest('with new-total on, the total is rounded', () => {\n  setFlag('new-total', true)\n  assert.equal(total(1.2, 1.4), 3)\n})\n`
  const offTest = `${TEST_HEADER}import { total } from '../../src/total.js'\n\ntest('with new-total off, the total is the plain sum', () => {\n  assert.equal(total(1, 2), 3)\n})\n`
  const said: string[] = []
  // node --test runs `.test.js` files, never `.check.js` ones: the first off-path test is never run.
  for (const offPath of ['test/e2e/total-off.check.js', 'test/e2e/total-off.test.js']) {
    const { repo, base, head, out } = repoOf(
      t,
      { 'package.json': PACKAGE, 'src/flags.js': flags, 'src/total.js': total(''), [offPath]: offTest },
      { 'src/total.js': total("  if (isEnabled('new-total')) {\n    return Math.round(a + b)\n  }\n"), 'test/e2e/total-on.test.js': onTest },
    )
    const anchors: ScanAnchor[] = [
      {
        id: 'n1', symbol: 'total', kind: 'function', path: 'src/total.js', startLine: 3, endLine: 8, changedLines: [4, 5, 6], status: 'modified',
        tests: [{ id: 'n2', symbol: 'with new-total on, the total is rounded', path: 'test/e2e/total-on.test.js', line: 6 }, { id: 'n3', symbol: 'with new-total off, the total is the plain sum', path: offPath, line: 5 }],
      },
      { id: 'n2', symbol: 'with new-total on, the total is rounded', kind: 'test', path: 'test/e2e/total-on.test.js', startLine: 6, endLine: 9, changedLines: [1, 2, 3, 4, 5, 6, 7, 8, 9], status: 'added', tests: [] },
    ]
    const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scanWith(anchors)) })
    const node = result.graph.nodes.find((item) => item.id === 'n1')!
    assert.deepEqual([node.facts.exposure.value, node.facts.undo.value, node.facts.proof.value, node.extras.conditionOnProven], ['nobody-yet', 'flag', 'lifecycle-observed', true], offPath)
    said.push(`${node.level?.current} by rule ${node.level?.rule}, off path proven: ${node.extras.offPathProven}`)
  }
  assert.deepEqual(said, ['mid by rule 12, off path proven: false', 'safe by rule 11, off path proven: true'])
})

test('a model that fails leaves every level at its floor, and the review finishes and says so', async (t) => {
  const { repo, base, head, out } = project(t)
  const model: ModelRunner = async ({ pass }) => {
    throw new Error(`the ${pass} model is down`)
  }
  const result = await reviewChange({ cwd: repo, base, head, out, model, clock: steadyClock(), scan: scanning(scanOf()) })
  const step = (id: string) => result.progress.steps.find((item) => item.id === id)!

  assert.deepEqual(levelsOf(result.units), { n1: 'mid', n2: 'mid', n4: 'safe' })
  assert.ok(result.problems.some((problem) => /careful pass failed: the review model is down/.test(problem)), result.problems.join('\n'))
  assert.deepEqual([step('risk-model').status, step('blind-check').status], ['skipped', 'skipped'])
  assert.match(step('risk-model').note ?? '', /the review model is down/)
  assert.match(step('blind-check').note ?? '', /the checker model is down/)
  assert.equal(result.blind.ran, false)
  assert.equal(result.storyBy, 'host')
  assert.equal(result.progress.percent, 100)
})

test('a review stopped by its signal ends with an error that says so, never with a result that looks finished', async (t) => {
  const { repo, base, head, out } = project(t)
  const before = new AbortController()
  before.abort()
  await assert.rejects(reviewChange({ cwd: repo, base, head, out: join(out, 'before'), signal: before.signal, clock: steadyClock(), scan: scanning(scanOf()) }), /stopped/)

  // Stopped while the tests run: the proof comes back with nothing proven, as a stopped proof does.
  const during = new AbortController()
  const proof = async (): Promise<ProofResult> => {
    during.abort()
    return { nodes: {}, runs: [], findings: [], clean: true }
  }
  await assert.rejects(reviewChange({ cwd: repo, base, head, out: join(out, 'during'), signal: during.signal, clock: steadyClock(), scan: scanning(scanOf()), proof }), /stopped/)
  const progress = JSON.parse(readFileSync(join(out, 'during', 'progress.json'), 'utf8')) as Progress
  assert.deepEqual(progress.steps.filter((step) => step.status === 'failed').map((step) => [step.id, step.note]), [['map-proof', 'the review was stopped']])
  assert.equal(existsSync(join(out, 'during', 'story.md')), false, 'no story is written for a review cut short')
})

test('a removed definition is decided by what still refers to it: nothing is safe, something is broken', async (t) => {
  const keep = 'export function keep() {\n  return 1\n}\n'
  const { repo, base, head, out } = repoOf(
    t,
    { 'src/shop.js': `${keep}\nexport function unused() {\n  return 2\n}\n\nexport function called() {\n  return 3\n}\n`, 'src/user.js': "import { called } from './shop.js'\n\nexport const three = called()\n" },
    { 'src/shop.js': keep },
  )
  const removed = (id: string, symbol: string, startLine: number, value: number): ScanAnchor => ({
    id, symbol, kind: 'function', path: 'src/shop.js', startLine, endLine: startLine + 2, changedLines: [], removed: [{ oldStart: startLine - 1, lines: ['', `export function ${symbol}() {`, `  return ${value}`, '}'] }], tests: [],
  })
  const dangling = [{ symbol: 'called', path: 'src/shop.js', references: [{ path: 'src/user.js', line: 1, text: "import { called } from './shop.js'" }] }]
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scanWith([removed('n1', 'unused', 5, 2), removed('n2', 'called', 9, 3)], dangling)) })
  const of = (id: string) => result.graph.nodes.find((node) => node.id === id)!

  assert.deepEqual(['n1', 'n2'].map((id) => [of(id).change, of(id).facts.proof.value]), [['removed', 'not-applicable'], ['removed', 'not-applicable']])
  assert.deepEqual([of('n1').level?.current, of('n1').level?.rule, of('n1').extras.unreferencedRemoval], ['safe', 2, true])
  assert.deepEqual([of('n2').level?.current, of('n2').extras.unreferencedRemoval], ['high', undefined], 'src/user.js still refers to it')
  assert.deepEqual([of('x1').level?.current, of('x1').level?.rule, of('x1').critical], ['high', 1, true])
})

test('a test failing at head is a finding only on the nodes it is a candidate of, matched by its exact path', async (t) => {
  const { repo, base, head, out } = project(t)
  const failing = (path: string) => ({ rule: 'failing-test', text: `${path} fails at head, before anything is changed.`, by: 'proof' })
  const proof = async (): Promise<ProofResult> => ({
    nodes: { n1: { value: 'lifecycle', evidence: 'test/total.test.js fails when total is put back to base.', observedBy: ['test/total.test.js'], doubles: [], stillPass: [], reachedBy: [] } },
    runs: [],
    findings: [failing('test/total.test.js'), failing('vendor/test/total.test.js')],
    clean: true,
  })
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scanOf()), proof })
  const total = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.deepEqual(total.findings.filter((finding) => finding.rule === 'failing-test').map((finding) => finding.text), [failing('test/total.test.js').text])
})

test('lines deleted inside a definition that is still there make it modified, proven by its tests', async (t) => {
  const { repo, base, head, out } = repoOf(
    t,
    { 'package.json': PACKAGE, 'src/total.js': 'export function total(items) {\n  items = items.filter((item) => item > 0)\n  return items.reduce((sum, item) => sum + item, 0)\n}\n' },
    {
      'src/total.js': 'export function total(items) {\n  return items.reduce((sum, item) => sum + item, 0)\n}\n',
      'test/total.test.js': `${TEST_HEADER}import { total } from '../src/total.js'\n\ntest('negative items count', () => {\n  assert.equal(total([1, -1, 2]), 2)\n})\n`,
    },
  )
  // The search tool gives no status: every changed line at head is gone, but the definition is not.
  const anchor: ScanAnchor = {
    id: 'n1', symbol: 'total', kind: 'function', path: 'src/total.js', startLine: 1, endLine: 3, changedLines: [], removed: [{ oldStart: 2, lines: ['  items = items.filter((item) => item > 0)'] }],
    tests: [{ id: 'n2', symbol: 'negative items count', path: 'test/total.test.js', line: 5 }],
  }
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scanWith([anchor])) })
  const total = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.deepEqual([total.change, total.facts.effect.value, total.facts.proof.value], ['modified', 'behaviour', 'isolated'])
  assert.deepEqual(total.runs.map((run) => run.kind), ['baseline', 'revert', 'baseline'])
})

/** `total` changes behind no check of its own; what its callers do decides who runs it. */
function callersScan(callers: { complete: boolean; guards: { line: number; text: string; branch: 'then' | 'else' | 'after-return' }[][] }): Scan {
  const total: ScanAnchor = {
    id: 'n1', symbol: 'total', kind: 'function', path: 'src/total.js', startLine: 1, endLine: 3, changedLines: [2], language: 'javascript', status: 'modified', tests: [],
    callers: { total: callers.guards.length, shown: callers.guards.length, complete: callers.complete },
  }
  const scan = scanWith([total])
  callers.guards.forEach((guards, index) => {
    const id = `c${index + 1}`
    scan.nodes[id] = { id, symbol: `checkout${index + 1}`, kind: 'function', path: `src/checkout${index + 1}.js`, startLine: 1, endLine: 9 }
    scan.edges.push({ from: id, to: 'n1', name: 'total', relationship: 'called_by', resolution: 'exact', line: 4, guards })
  })
  return scan
}
const ON = [{ line: 3, text: "if (isFeatureEnabled('fast_total'))", branch: 'then' as const }]

test('a complete caller list where every call is on the on branch of a flag gives nobody-yet', async (t) => {
  const { repo, base, head, out } = project(t)
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(callersScan({ complete: true, guards: [ON, [{ line: 2, text: "unless isFeatureEnabled('fast_total')", branch: 'after-return' }]] })) })
  const total = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.equal(total.facts.exposure.value, 'nobody-yet')
  assert.match(total.facts.exposure.evidence, /dominance proven: all 2 callers/)
})

test('an incomplete caller list, an unguarded caller or a call on the off branch stays everyone', async (t) => {
  const { repo, base, head, out } = project(t)
  const cases = [
    { complete: false, guards: [ON] },
    { complete: true, guards: [ON, []] },
    { complete: true, guards: [ON, [{ line: 3, text: "if (isFeatureEnabled('fast_total'))", branch: 'else' as const }]] },
    { complete: true, guards: [ON, [{ line: 3, text: 'if (cart.paid)', branch: 'then' as const }]] },
  ]
  for (const [index, one] of cases.entries()) {
    const result = await reviewChange({ cwd: repo, base, head, out: `${out}-${index}`, clock: steadyClock(), scan: scanning(callersScan(one)) })
    assert.equal(result.graph.nodes.find((node) => node.id === 'n1')!.facts.exposure.value, 'everyone', JSON.stringify(one))
  }
})

/** A project with a job test the scan does not link to the code. */
function entryProject(t: TestContext) {
  return repoOf(
    t,
    { 'package.json': PACKAGE, 'src/total.js': 'export function total(a, b) {\n  return a + b\n}\n' },
    {
      'src/total.js': 'export function total(a, b) {\n  return Math.round(a + b)\n}\n',
      'test/orders.test.js': `${TEST_HEADER}\ntest('creates an order', () => {\n  assert.ok(true)\n})\n`,
      'test/receipt_job.test.js': `${TEST_HEADER}\ntest('performs', () => {\n  assert.ok(true)\n})\n`,
    },
  )
}

test('the life-cycle tests found for each entry point above a node become its candidates, once per entry', async (t) => {
  const { repo, base, head, out } = entryProject(t)
  const scan = callersScan({ complete: true, guards: [[]] })
  scan.anchors[0]!.entry = { kind: 'job', exact: true }
  scan.anchors[0]!.callSites = [{ id: 'c1', symbol: 'OrdersController#create', path: 'src/checkout1.js', line: 4, guards: [], entry: { kind: 'controller', exact: true } }]
  const asked: string[] = []
  const entryTests = async ({ symbol }: { symbol: string }) => {
    asked.push(symbol)
    return symbol === 'total'
      ? { ok: true as const, tests: [{ path: 'test/receipt_job.test.js', found: 'perform', detail: 'ReceiptJob.new.perform' }], notes: [] }
      : { ok: true as const, tests: [{ path: 'test/orders.test.js', found: 'route', detail: 'post orders_url → orders#create' }, { path: 'test/missing.test.js', found: 'class' }], notes: [] }
  }
  let candidates: ProofRequest['candidates'] = {}
  const proof = async (request: ProofRequest): Promise<ProofResult> => {
    candidates = request.candidates
    return { nodes: {}, runs: [], findings: [], clean: true }
  }
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scan), entryTests, proof })
  assert.deepEqual(asked.sort(), ['OrdersController#create', 'total'])
  const found = candidates.n1!.filter((candidate) => candidate.path.startsWith('test/') && candidate.path !== 'test/total.test.js')
  assert.deepEqual(found.map((candidate) => [candidate.path, candidate.why, candidate.lifecycle, candidate.changed]), [
    ['test/receipt_job.test.js', 'life-cycle test of total: perform: ReceiptJob.new.perform', true, true],
    ['test/orders.test.js', 'life-cycle test of OrdersController#create: route: post orders_url → orders#create', true, true],
  ])
  assert.deepEqual(result.problems, [])
})

test('a search that fails or hangs is a note in the problems and the review goes on', async (t) => {
  const { repo, base, head, out } = entryProject(t)
  const scan = callersScan({ complete: true, guards: [[]] })
  scan.anchors[0]!.entry = { kind: 'job', exact: true }
  const entryTests = async () => {
    throw new Error('boom')
  }
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scan), entryTests })
  assert.ok(result.problems.some((problem) => /life-cycle tests of total.*boom/.test(problem)), result.problems.join('\n'))
  const refused = await reviewChange({ cwd: repo, base, head, out: `${out}-2`, clock: steadyClock(), scan: scanning(scan), entryTests: async () => ({ ok: false, reason: 'the search took longer than 30 seconds.' }) })
  assert.ok(refused.problems.some((problem) => /life-cycle tests of total.*longer than 30 seconds/.test(problem)))
  assert.ok(refused.graph.nodes.some((node) => node.id === 'n1'))
})

// ───────────────────────── A helper, a script and a README: the change these rules were calibrated on ─────────────────────────

const POSTS_BASE = "import { findUser, findUsers } from '../users.js'\n\nexport function linkUserTags(text) {\n  return text.replace(/@(\\d+)/g, (_all, id) => findUser(Number(id))?.name ?? 'someone')\n}\n"
const POSTS_HEAD = "import { findUser, findUsers } from '../users.js'\n\nexport function linkUserTags(text) {\n  const ids = [...text.matchAll(/@(\\d+)/g)].map((match) => Number(match[1]))\n  const users = findUsers(ids)\n  return text.replace(/@(\\d+)/g, (_all, id) => users.get(Number(id))?.name ?? 'someone')\n}\n"
const USERS = "const USERS = new Map([[1, { name: 'Ana' }], [2, { name: 'Bo' }]])\nexport const lookups = { count: 0 }\n\nexport function findUser(id) {\n  lookups.count += 1\n  return USERS.get(id)\n}\n\nexport function findUsers(ids) {\n  lookups.count += 1\n  return new Map(ids.filter((id) => USERS.has(id)).map((id) => [id, USERS.get(id)]))\n}\n"

/**
 * A helper that looks users up once instead of once for each mention, with direct tests added for it and an older
 * request test above it that never counts lookups; a new script with no file ending and its test; and a README.
 */
function mentionsProject(t: TestContext) {
  return repoOf(
    t,
    {
      'package.json': PACKAGE,
      'README.md': '# Shop\n',
      'src/users.js': USERS,
      'src/helpers/posts.js': POSTS_BASE,
      'src/render.js': "import { linkUserTags } from './helpers/posts.js'\n\nexport function renderPost(post) {\n  return `<p>${linkUserTags(post.message)}</p>`\n}\n",
      'src/handlers/topics.js': "import { renderPost } from '../render.js'\n\nexport function showTopic(topic) {\n  return topic.posts.map(renderPost).join('')\n}\n",
      'test/e2e/topics.test.js': `${TEST_HEADER}import { showTopic } from '../../src/handlers/topics.js'\n\ntest('a topic shows its posts with mentions as names', () => {\n  assert.equal(showTopic({ posts: [{ message: 'hi @1' }] }), '<p>hi Ana</p>')\n})\n`,
    },
    {
      'README.md': '# Shop\n\n## Production errors\n\nRun `bin/production-errors`.\n',
      'src/helpers/posts.js': POSTS_HEAD,
      'bin/production-errors': "#!/usr/bin/env node\nconst token = process.env.SENTRY_AUTH_TOKEN\nif (!token) process.exit(1)\nconsole.log(JSON.stringify({ complete: true }))\n",
      'test/bin/production-errors.test.js': `${TEST_HEADER}\ntest('the report says it is complete', () => {\n  assert.ok(true)\n})\n`,
      'test/helpers/posts.test.js': `${TEST_HEADER}import { linkUserTags } from '../../src/helpers/posts.js'\nimport { lookups } from '../../src/users.js'\n\ntest('repeated mentions are one lookup', () => {\n  lookups.count = 0\n  assert.equal(linkUserTags('@1 @1 @2'), 'Ana Ana Bo')\n  assert.equal(lookups.count, 1)\n})\n\ntest('a missing user keeps a fallback', () => {\n  assert.equal(linkUserTags('@9'), 'someone')\n})\n`,
    },
  )
}

/** What the scan reports for it: the helper with its one caller, a helper and not an entry point, and nothing for the script. */
const mentionsScan = (): Scan =>
  scanWith([
    {
      id: 'n1', symbol: 'linkUserTags', kind: 'function', path: 'src/helpers/posts.js', startLine: 3, endLine: 7, changedLines: [4, 5, 6], language: 'javascript', status: 'modified',
      callers: { total: 1, shown: 1, complete: true },
      callSites: [{ id: 'c1', symbol: 'renderPost', path: 'src/render.js', line: 4, guards: [] }],
      tests: [{ id: 'n2', symbol: 'repeated mentions are one lookup', path: 'test/helpers/posts.test.js', line: 6 }],
    },
    { id: 'n2', symbol: 'repeated mentions are one lookup', kind: 'test', path: 'test/helpers/posts.test.js', startLine: 6, endLine: 10, changedLines: [6, 7, 8, 9, 10], language: 'javascript', status: 'added', tests: [] },
    { id: 'n3', symbol: 'a missing user keeps a fallback', kind: 'test', path: 'test/helpers/posts.test.js', startLine: 12, endLine: 14, changedLines: [12, 13, 14], language: 'javascript', status: 'added', tests: [] },
  ])

/** The way up, as the search tool finds it: the caller is a helper, and the handler above it is where a request enters. */
const mentionsEntries: EntriesSearch = async ({ starts }) => ({ entries: Object.fromEntries(starts.map((start) => [start.id, [{ symbol: 'showTopic', path: 'src/handlers/topics.js', hops: 2 }]])), notes: [] })
const mentionsEntryTests = async ({ symbol }: { symbol: string }) => ({ ok: true as const, tests: symbol === 'showTopic' ? [{ path: 'test/e2e/topics.test.js', found: 'route', detail: 'showTopic' }] : [], notes: [] })

test('a helper its direct tests prove, with an older request test running through it, is mid; the new script nobody could read is said, at mid; the README is counted', async (t) => {
  const { repo, base, head, out, git } = mentionsProject(t)
  const asked: { id: string; callers: readonly { path: string; line: number }[] }[] = []
  const entriesAbove: EntriesSearch = async (request) => {
    asked.push(...request.starts)
    return mentionsEntries(request)
  }
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(mentionsScan()), entriesAbove, entryTests: mentionsEntryTests })

  // The walk starts from the helper's caller, and the entry point it finds brings its request test to the proof.
  assert.deepEqual(asked, [{ id: 'n1', callers: [{ path: 'src/render.js', line: 4 }] }])
  const helper = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.deepEqual(helper.entries, ['showTopic'])
  assert.equal(helper.facts.proof.value, 'lifecycle')
  assert.equal(
    helper.facts.proof.evidence,
    'test/helpers/posts.test.js fails when linkUserTags is put back to base; test/e2e/topics.test.js runs through linkUserTags and passes with the change (it fails when linkUserTags is made to throw): a life-cycle test this diff did not change.',
  )
  assert.deepEqual(helper.runs.map((run) => run.kind), ['baseline', 'revert', 'revert', 'revert', 'baseline', 'reach'])
  // Rule 7: a test goes through a request to it. A test changed with it shows the change, so nothing says none did.
  assert.deepEqual([helper.level?.current, helper.level?.rule, helper.extras.testChangedWithIt], ['mid', 7, true])
  assert.deepEqual(helper.findings, [])
  // Only the test that counts lookups failed with the change put back: the run says where.
  const reverted = helper.runs.find((run) => run.kind === 'revert' && run.tests.length === 1 && run.failed.length === 1)!
  assert.ok(reverted.failed_at!.some((at) => at.line >= 6 && at.line <= 10) && !reverted.failed_at!.some((at) => at.line >= 12), JSON.stringify(reverted.failed_at))

  assert.deepEqual(
    result.units.units.map((unit) => [unit.level, unit.title]),
    [
      ['mid', '`linkUserTags` changes behaviour, and a test goes through a request to it'],
      ['mid', '`bin/production-errors` is new and was not checked: the search tool found no definition in it'],
    ],
  )
  assert.equal(result.units.units[0]!.where, 'Reached from showTopic.')
  assert.equal(result.units.attention.files_skipped, 1, 'the README is counted, not read')
  assert.match(result.story, /\*\*Proof:\*\* .*A life cycle test executes unit 1\. No test shows unit 2\./)
  assert.ok(result.progress.steps.every((step) => step.status === 'done' || step.status === 'skipped'))
  assert.equal(git('status', '--porcelain'), '')
})

test('with no request test above it, the same helper is mid by rule 4b and says what no test does', async (t) => {
  const { repo, base, head, out } = mentionsProject(t)
  const none: EntriesSearch = async ({ starts }) => ({ entries: Object.fromEntries(starts.map((start) => [start.id, []])), notes: ['The search for entry points stopped: agentic-search is not installed.'] })
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(mentionsScan()), entriesAbove: none })
  const helper = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.deepEqual([helper.facts.proof.value, helper.level?.current, helper.level?.rule], ['isolated', 'mid', 4])
  assert.equal(helper.facts.proof.evidence, 'test/helpers/posts.test.js fails when linkUserTags is put back to base; no life-cycle test was found to try.')
  assert.deepEqual(helper.findings.map((finding) => finding.rule), ['direct-tests-only'])
  assert.ok(result.problems.includes('Entry points: The search for entry points stopped: agentic-search is not installed.'), result.problems.join('\n'))
  assert.equal(result.units.units.find((unit) => unit.nodes.includes('n1'))!.title, '`linkUserTags` changes behaviour, and tests that call it directly fail without the change')
})

test('a scan handed in brings no walk of its own, and a walk that throws is a note', async (t) => {
  const { repo, base, head, out } = mentionsProject(t)
  const plain = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(mentionsScan()) })
  assert.deepEqual(plain.graph.nodes.find((node) => node.id === 'n1')!.entries, [])
  const failing: EntriesSearch = async () => {
    throw new Error('boom')
  }
  const result = await reviewChange({ cwd: repo, base, head, out: `${out}-2`, clock: steadyClock(), scan: scanning(mentionsScan()), entriesAbove: failing })
  assert.ok(result.problems.some((problem) => /The search for entry points failed: boom/.test(problem)), result.problems.join('\n'))
  assert.equal(result.graph.nodes.find((node) => node.id === 'n1')!.facts.proof.value, 'isolated')
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { EntriesSearch } from '../src/entries.ts'
import type { ProofRequest, ProofResult, Runbook } from '../src/proof.ts'
import { reviewChange } from '../src/pipeline.ts'
import type { ScanOutcome } from '../src/scan.ts'
import type { Level, ModelCheck, ModelRunner, Progress, Scan, ScanAnchor, Units } from '../src/types.ts'

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

test('the blind check runs once and changes no level', async (t) => {
  const { repo, base, head, out, git } = project(t)
  const { model, calls } = fakeModel()
  const result = await reviewChange({ cwd: repo, base, head, out, model, clock: steadyClock(), scan: async (): Promise<ScanOutcome> => ({ ok: true, scan: scanOf() }) })

  assert.deepEqual(calls, { review: 1, checker: 1 }, 'one careful pass and one blind check')
  // total's direct test fails without the rounding: mid by rule 6. No test goes through a request to it, so no
  // argument makes it safe.
  assert.ok(result.rejected.some((entry) => entry.event.node === 'n1' && /rule 6/.test(entry.reason)))
  assert.deepEqual(levelsOf(result.units), { n1: 'mid', n2: 'mid', n4: 'safe' }, 'the checker would rate the constant higher, and that is a question, not a level')
  assert.equal(result.graph.nodes.find((node) => node.id === 'n5')?.kind, 'test', 'a helper in a test file is a test, never a unit')
  assert.deepEqual(['n3', 'n5'].map((id) => [result.graph.nodes.find((node) => node.id === id)?.level?.current, result.graph.nodes.find((node) => node.id === id)?.level?.rule]), [['safe', 2], ['safe', 2]], 'a test carries no risk of its own')
  assert.match(result.units.units.find((unit) => unit.nodes.includes('n4'))?.title ?? '', /changes a type, erased before the code runs/)
  assert.equal(result.blind.ran, true)
  const unitOf = (node: string) => result.units.units.find((unit) => unit.nodes.includes(node))!
  assert.deepEqual(result.blind.actions.map((action) => [action.unit, action.answer]).sort(), [[unitOf('n1').id, 'told-badly'], [unitOf('n2').id, 'thin-evidence']].sort())
  assert.match(result.story, new RegExp(`- Unit ${result.units.units.indexOf(unitOf('n2')) + 1}: asked the reviewer: the blind check would rate it high`))
  assert.match(unitOf('n2').questions.at(-1)?.text ?? '', /^The blind check would rate this high, not mid: /)
  assert.equal(result.storyBy, 'model')
  assert.match(result.story, /^# Round the total/)
  assert.match(result.story, /`total` now rounds every sum to a whole number/)

  // Proof came from running the project's own test: it passed at head, failed with the rounding undone, and passed
  // again alone at head.
  const total = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.equal(total.facts.proof.value, 'isolated')
  assert.deepEqual([total.level?.floor, total.level?.rule], ['mid', 6])
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

test('rule 10 needs an unchanged life-cycle test that ran and still passed with the change undone, not one that never ran', async (t) => {
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
  assert.deepEqual(said, ['mid by rule 11, off path proven: false', 'safe by rule 10, off path proven: true'])
})

test('a model that fails leaves every level at its floor, and the review finishes and says so', async (t) => {
  const { repo, base, head, out } = project(t)
  const model: ModelRunner = async ({ pass }) => {
    throw new Error(`the ${pass} model is down`)
  }
  const result = await reviewChange({ cwd: repo, base, head, out, model, clock: steadyClock(), scan: scanning(scanOf()) })
  const step = (id: string) => result.progress.steps.find((item) => item.id === id)!

  assert.deepEqual(levelsOf(result.units), { n1: 'mid', n2: 'mid', n4: 'safe' })
  assert.ok(result.problems.some((problem) => /The Reviewer could not be asked: the review model is down/.test(problem)), result.problems.join('\n'))
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

test('a comment edited inside a function or outside any, with no node for either, builds a review where nothing that runs changed', async (t) => {
  const total = '// Totals.\n\nexport function total(items) {\n  // Adds them up.\n  return items.length\n}\n'
  for (const [where, from, to] of [['inside a function', '  // Adds them up.', '  // Counts them.'], ['outside any function', '// Totals.', '// Totals of a cart.']] as const) {
    const { repo, base, head, out } = repoOf(t, { 'src/total.js': total }, { 'src/total.js': total.replace(from, to) })
    const scan: Scan = { ...scanWith([]), files: [{ path: 'src/total.js', kind: 'code', status: 'modified', language: 'javascript' }] }
    const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scan) })
    assert.deepEqual([result.units.units, result.answer], [[], { deploy: 'safe', why: 'Nothing that runs changed.' }], where)
  }
})

/** A careful pass that changes nothing and writes down every prompt it was shown. The checker gives nothing to read. */
function watchingModel() {
  const shown: string[] = []
  const model: ModelRunner = async ({ pass, prompt }) => {
    if (pass !== 'review') return 'nothing'
    shown.push(prompt)
    return JSON.stringify({ events: [], words: {}, claims: [] })
  }
  return { model, shown }
}

/** The part a review made of a file nothing mapped, and the unit that holds it. */
const readFromDiff = (result: Awaited<ReturnType<typeof reviewChange>>, path: string) => {
  const part = result.graph.nodes.find((node) => node.path === path && node.findings.some((finding) => finding.rule === 'not-mapped'))
  return { part, unit: part ? result.units.units.find((unit) => unit.nodes.includes(part.id)) : undefined }
}

test('a code file the search tool has no parser for is a part of its own, read from its diff, and the review finishes', async (t) => {
  const { repo, base, head, out } = repoOf(t, { 'tools/report.py': 'def total(items):\n    return len(items)\n' }, { 'tools/report.py': 'def total(items):\n    return len(items) * 1\n' })
  const scan: Scan = { ...scanWith([]), files: [{ path: 'tools/report.py', kind: 'code', status: 'modified' }] }
  const { model, shown } = watchingModel()
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scan), model })

  const { part, unit } = readFromDiff(result, 'tools/report.py')
  assert.deepEqual([part?.kind, part?.change, part?.changed_lines, part?.findings.map((finding) => finding.by)], ['general', 'modified', [2], ['search']])
  assert.equal(part!.findings[0]!.text, 'The search tool has no parser for it, so what calls it and what tests it were not looked for, and its change is judged from the diff alone.')
  assert.deepEqual([result.units.units.length, unit?.level, unit?.title], [1, 'mid', '`tools/report.py` changed and nothing mapped it: it is read from its diff'])
  assert.ok(shown.some((prompt) => prompt.includes('return len(items) * 1')), 'the careful pass was shown its changed line')
  assert.ok(result.problems.includes('Read from the diff alone, with no map: `tools/report.py`.'), result.problems.join('\n'))
})

test('a scan that could not run leaves every changed code file read from its diff, with the scan\'s reason', async (t) => {
  const { repo, base, head, out } = repoOf(t, { 'src/total.js': 'export function total(a, b) {\n  return a + b\n}\n' }, { 'src/total.js': 'export function total(a, b) {\n  return Math.round(a + b)\n}\n' })
  const { model, shown } = watchingModel()
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: async () => ({ ok: false, reason: 'agentic-search is not installed.' }), model })

  const { part, unit } = readFromDiff(result, 'src/total.js')
  assert.equal(part?.findings[0]?.text, 'The scan could not run (agentic-search is not installed), so what calls it and what tests it were not looked for, and its change is judged from the diff alone.')
  assert.equal(unit?.level, 'mid')
  assert.ok(shown.some((prompt) => prompt.includes('Math.round(a + b)')))
  assert.ok(result.problems.includes('The scan could not run: agentic-search is not installed.'), result.problems.join('\n'))
  assert.ok(result.problems.includes('Read from the diff alone, with no map: `src/total.js`.'), result.problems.join('\n'))
})

test('in a change the search tool partly reads, a file with a definition and a file it has no parser for are both rated parts', async (t) => {
  const { repo, base, head, out } = repoOf(
    t,
    { 'src/total.js': 'export function total(a, b) {\n  return a + b\n}\n', 'src/registry.rs': 'pub const LIMIT: u32 = 3;\n' },
    { 'src/total.js': 'export function total(a, b) {\n  return Math.round(a + b)\n}\n', 'src/registry.rs': 'pub const LIMIT: u32 = 4;\n' },
  )
  const scan: Scan = {
    ...scanWith([{ id: 'n1', symbol: 'total', kind: 'function', path: 'src/total.js', startLine: 1, endLine: 3, changedLines: [2], language: 'javascript', status: 'modified', tests: [] }]),
    files: [{ path: 'src/total.js', kind: 'code', status: 'modified', language: 'javascript' }, { path: 'src/registry.rs', kind: 'code', status: 'modified' }],
  }
  const { model, shown } = watchingModel()
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scan), model })

  const { part, unit } = readFromDiff(result, 'src/registry.rs')
  assert.ok(part?.level && unit, 'the Rust file is a rated part')
  assert.equal(unit!.title, '`src/registry.rs` changed and nothing mapped it: it is read from its diff')
  assert.ok(result.units.units.some((entry) => entry.nodes.includes('n1')), 'and the mapped definition is one too')
  assert.ok(shown.some((prompt) => prompt.includes('LIMIT: u32 = 4')), 'the careful pass was shown the Rust line')
})

test('a config file the search tool has no parser for is a part read from its diff, not only counted', async (t) => {
  const { repo, base, head, out } = repoOf(t, { 'config/settings.yml': 'retries: 2\n' }, { 'config/settings.yml': 'retries: 3\n' })
  const scan: Scan = { ...scanWith([]), files: [{ path: 'config/settings.yml', kind: 'config', status: 'modified' }] }
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scan) })
  const { part, unit } = readFromDiff(result, 'config/settings.yml')
  assert.deepEqual([part?.changed_lines, unit?.level], [[1], 'mid'])
})

test('a file the search tool has no parser for whose change is only a blank line makes no part', async (t) => {
  const { repo, base, head, out } = repoOf(t, { 'tools/report.py': 'def total(items):\n    return len(items)\n' }, { 'tools/report.py': 'def total(items):\n    return len(items)\n\n' })
  const scan: Scan = { ...scanWith([]), files: [{ path: 'tools/report.py', kind: 'code', status: 'modified' }] }
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scan) })
  assert.deepEqual([result.units.units, result.graph.nodes], [[], []])
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

test('a change of tests alone runs them at its commit, and the graph keeps every run and why a test of the change did not run', async (t) => {
  const passing = (name: string) => `${TEST_HEADER}\ntest('${name}', () => {\n  assert.equal(1, 1)\n})\n`
  const { repo, base, head, out } = repoOf(
    t,
    { 'package.json': PACKAGE, 'test/total.test.js': passing('adds') },
    { 'test/total.test.js': passing('adds two numbers'), 'test/limits.test.js': passing('the limit is ten'), 'test/models/cart_test.rb': 'class CartTest\nend\n' },
  )
  const anchors: ScanAnchor[] = [
    { id: 'n1', symbol: 'adds two numbers', kind: 'test', path: 'test/total.test.js', startLine: 3, endLine: 5, changedLines: [3], status: 'modified', tests: [] },
    { id: 'n2', symbol: 'the limit is ten', kind: 'test', path: 'test/limits.test.js', startLine: 3, endLine: 5, changedLines: [1, 2, 3, 4, 5], status: 'added', tests: [] },
  ]
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scanWith(anchors)) })
  const told = (graph: { runs?: { kind: string; node?: string; tests: string[]; failed: string[] }[] }) => (graph.runs ?? []).map((run) => [run.kind, run.node ?? '', [...run.tests].sort().join(' '), run.failed.join(' ')])
  assert.deepEqual(told(result.graph), [['baseline', '', 'test/limits.test.js test/total.test.js', '']])
  assert.deepEqual(result.graph.not_run, [{ path: 'test/models/cart_test.rb', why: 'this review runs tests with the test script in package.json runs node --test, which does not take it.' }])
  const saved = JSON.parse(readFileSync(join(out, 'graph.json'), 'utf8'))
  assert.deepEqual([told(saved), saved.not_run], [told(result.graph), result.graph.not_run], 'graph.json keeps them')
})

test('a Rails app’s review runs its JavaScript tests with its JavaScript command, beside Rails’s', async (t) => {
  const { repo, base, head, out } = repoOf(
    t,
    { 'bin/rails': '', 'test/test_helper.rb': '', 'package.json': PACKAGE },
    { 'test/javascript/cart.test.js': `${TEST_HEADER}\ntest('adds', () => {\n  assert.equal(1, 1)\n})\n` },
  )
  const asked: Runbook[] = []
  const proof = async (request: ProofRequest): Promise<ProofResult> => {
    asked.push(...[request.runbook ?? []].flat())
    return { nodes: {}, runs: [], findings: [], clean: true }
  }
  await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scanWith([])), proof })
  assert.deepEqual(asked.map((book) => book.source), ['bin/rails with a test folder', 'the test script in package.json runs node --test'])
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

test('every part says where it runs from, or why nothing was looked for, and names its zone', async (t) => {
  const { repo, base, head, out } = project(t)
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(scanOf()) })
  const of = (id: string) => result.graph.nodes.find((node) => node.id === id)!
  assert.deepEqual(of('n1').runs_from, { found: 'none', hops: 0, why: 'The scan listed nothing that calls it.' })
  assert.deepEqual(of('n2').runs_from, { found: 'not-looked', why: 'It takes effect when its file loads, so what calls it was not looked for.' })
  assert.deepEqual(of('n3').runs_from, { found: 'not-looked', why: 'A test: the test runner runs it.' })
  assert.deepEqual(of('n4').runs_from, { found: 'not-looked', why: 'A type: the compiler checks it and nothing runs it.' })
  assert.deepEqual(result.graph.nodes.map((node) => node.zone), ['-/src/total', '-/src/config', '-/test:root/total', '-/src/money', '-/test:root/total'])
  assert.deepEqual(result.graph.zones?.map((zone) => [zone.id, zone.label]), [
    ['-/src/total', 'Source · total'],
    ['-/src/config', 'Source · config'],
    ['-/test:root/total', 'Tests · total'],
    ['-/src/money', 'Source · money'],
  ])
})

test('a part only tests call says so, and a caller the scan names as an entry is where it runs from', async (t) => {
  const { repo, base, head, out } = project(t)
  const tested = scanOf()
  Object.assign(tested.anchors[0]!, { callers: { total: 0, shown: 0, complete: true }, callSites: [], testCallers: 2 })
  const only = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(tested) })
  assert.deepEqual(only.graph.nodes[0]!.runs_from, { found: 'only-tests', tests: 2 })

  const routed = scanOf()
  routed.nodes.c9 = { id: 'c9', symbol: 'OrdersController#create', kind: 'method', path: 'app/controllers/orders_controller.rb', startLine: 2, endLine: 8, entry: { kind: 'controller', exact: true, routes: [{ verbs: ['POST'], path: '/orders', file: 'config/routes.rb', line: 2 }] } }
  Object.assign(routed.anchors[0]!, { callers: { total: 1, shown: 1, complete: true }, callSites: [{ id: 'c9', symbol: 'OrdersController#create', path: 'app/controllers/orders_controller.rb', line: 5, guards: [{ line: 4, text: 'if order.valid?', branch: 'then' }] }] })
  const result = await reviewChange({ cwd: repo, base, head, out: `${out}-2`, clock: steadyClock(), scan: scanning(routed) })
  const total = result.graph.nodes[0]!
  assert.deepEqual(total.runs_from, {
    found: 'origins',
    origins: [
      {
        kind: 'controller', label: 'POST /orders', route: { verbs: ['POST'], path: '/orders' }, exact: true, by: 'scan', symbol: 'OrdersController#create', hops: 1,
        chain: [{ symbol: 'OrdersController#create', path: 'app/controllers/orders_controller.rb', line: 2, call_line: 5, guard: 'if order.valid?' }],
      },
    ],
  })
  assert.deepEqual(total.entries, ['OrdersController#create'])
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
const mentionsEntries: EntriesSearch = async ({ starts }) => ({
  entries: Object.fromEntries(
    starts.map((start) => [
      start.id,
      [
        {
          symbol: 'showTopic', path: 'src/handlers/topics.js', hops: 2, line: 3, kind: 'handler', label: 'showTopic', exact: false, by: 'path' as const,
          chain: [{ symbol: 'showTopic', path: 'src/handlers/topics.js', line: 3, call_line: 4 }, { symbol: 'renderPost', path: 'src/render.js', line: 3, call_line: 4 }],
        },
      ],
    ]),
  ),
  notes: [],
  stops: Object.fromEntries(starts.map((start) => [start.id, { hops: 2 }])),
})
const mentionsEntryTests = async ({ symbol }: { symbol: string }) => ({ ok: true as const, tests: symbol === 'showTopic' ? [{ path: 'test/e2e/topics.test.js', found: 'route', detail: 'showTopic' }] : [], notes: [] })

test('a helper its direct tests prove, with an older request test running through it, is safe; the new script nobody could read is said, at mid; the README is counted', async (t) => {
  const { repo, base, head, out, git } = mentionsProject(t)
  const asked: { id: string; callers: readonly { path: string; line: number }[] }[] = []
  let kindOf: ((path: string) => unknown) | undefined
  const entriesAbove: EntriesSearch = async (request) => {
    asked.push(...request.starts)
    kindOf = request.isEntry
    return mentionsEntries(request)
  }
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(mentionsScan()), entriesAbove, entryTests: mentionsEntryTests })

  // The walk starts from the helper's caller, and the entry point it finds brings its request test to the proof.
  assert.deepEqual(asked, [{ id: 'n1', callers: [{ path: 'src/render.js', line: 4 }] }])
  const helper = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.deepEqual(helper.entries, ['showTopic'])
  // Where it runs from keeps the way: the handler, the render between, and what kind of entry the path rule says it is.
  assert.equal(helper.runs_from?.found, 'origins')
  const [origin] = helper.runs_from?.found === 'origins' ? helper.runs_from.origins : []
  assert.deepEqual(origin!.chain.map((step) => step.symbol), ['showTopic', 'renderPost'])
  assert.deepEqual([origin!.kind, origin!.label, origin!.by, origin!.hops, origin!.symbol], ['handler', 'showTopic', 'path', 2, 'showTopic'])
  assert.equal(helper.facts.proof.value, 'lifecycle')
  assert.equal(
    helper.facts.proof.evidence,
    'test/helpers/posts.test.js fails when linkUserTags is put back to base; test/e2e/topics.test.js runs through linkUserTags and passes with the change (it fails when linkUserTags is made to throw): a life-cycle test this diff did not change.',
  )
  assert.deepEqual(helper.runs.map((run) => run.kind), ['baseline', 'revert', 'revert', 'revert', 'baseline', 'reach'])
  // Rule 9: tests fail without the change, and a test goes through a request to it. A test changed with it shows the
  // change, so nothing says none did.
  assert.deepEqual([helper.level?.current, helper.level?.rule, helper.extras.testChangedWithIt], ['safe', 9, true])
  assert.deepEqual(helper.findings, [])
  // Only the test that counts lookups failed with the change put back: the run says where.
  const reverted = helper.runs.find((run) => run.kind === 'revert' && run.tests.length === 1 && run.failed.length === 1)!
  assert.ok(reverted.failed_at!.some((at) => at.line >= 6 && at.line <= 10) && !reverted.failed_at!.some((at) => at.line >= 12), JSON.stringify(reverted.failed_at))

  assert.deepEqual(
    result.units.units.map((unit) => [unit.level, unit.title]),
    [
      ['mid', '`bin/production-errors` is new and nothing mapped it: it is read from its diff'],
      ['safe', '`linkUserTags`: a test goes through a request to it'],
    ],
  )
  assert.equal(result.units.units[1]!.where, 'Reached from showTopic.')
  assert.equal(result.units.attention.files_skipped, 1, 'the README is counted, not read')
  assert.match(result.story, /\*\*Proof:\*\* .*A life cycle test executes unit 2\. No test shows unit 1\./)
  assert.ok(result.progress.steps.every((step) => step.status === 'done' || step.status === 'skipped'))
  assert.equal(git('status', '--porcelain'), '')
  assert.equal(kindOf?.('src/handlers/topics.js'), 'handler', 'the walk is told which path rule names an entry')
})

test('with no request test above it, the same helper is mid by rule 6 and says what no test does', async (t) => {
  const { repo, base, head, out } = mentionsProject(t)
  const none: EntriesSearch = async ({ starts }) => ({ entries: Object.fromEntries(starts.map((start) => [start.id, []])), notes: ['The search for entry points stopped: agentic-search is not installed.'] })
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(mentionsScan()), entriesAbove: none })
  const helper = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.deepEqual([helper.facts.proof.value, helper.level?.current, helper.level?.rule], ['isolated', 'mid', 6])
  assert.equal(helper.facts.proof.evidence, 'test/helpers/posts.test.js fails when linkUserTags is put back to base; no life-cycle test was found to try.')
  assert.deepEqual(helper.findings.map((finding) => finding.rule), ['direct-tests-only'])
  assert.ok(result.problems.includes('Entry points: The search for entry points stopped: agentic-search is not installed.'), result.problems.join('\n'))
  assert.equal(result.units.units.find((unit) => unit.nodes.includes('n1'))!.title, '`linkUserTags`: tests that call it directly fail without the change')
  // A walk of an older shape says nothing of where it stopped: the pack looked one call out.
  assert.deepEqual(helper.runs_from, { found: 'none', hops: 1, why: 'Nothing within 1 call of it is where work enters.' })
})

test('a walk that stopped says so on the part, with how far it looked and where the way ended', async (t) => {
  const { repo, base, head, out } = mentionsProject(t)
  const failed: EntriesSearch = async ({ starts }) => ({ entries: { n1: [] }, notes: [], stops: Object.fromEntries(starts.map((start) => [start.id, { hops: 0, stopped: 'failed' as const, reason: 'agentic-search is not installed.' }])) })
  const helper = (await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(mentionsScan()), entriesAbove: failed })).graph.nodes.find((node) => node.id === 'n1')!
  assert.deepEqual(helper.runs_from, { found: 'none', hops: 1, stopped: 'failed', why: 'Nothing within 1 call of it is where work enters, and the search further out failed: agentic-search is not installed.' })
  const ended: EntriesSearch = async () => ({ entries: { n1: [] }, notes: [], stops: { n1: { hops: 2, top: 'showTopic' } } })
  const dead = (await reviewChange({ cwd: repo, base, head, out: `${out}-2`, clock: steadyClock(), scan: scanning(mentionsScan()), entriesAbove: ended })).graph.nodes.find((node) => node.id === 'n1')!
  assert.deepEqual(dead.runs_from, { found: 'none', hops: 2, top: 'showTopic', why: 'Nothing within 2 calls of it is where work enters: the way out stops at showTopic, and the scan found nothing that calls it.' })
})

test('a scan handed in brings no walk of its own, and a walk that throws is a note', async (t) => {
  const { repo, base, head, out } = mentionsProject(t)
  const plain = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(mentionsScan()) })
  assert.deepEqual(plain.graph.nodes.find((node) => node.id === 'n1')!.entries, [])
  assert.deepEqual(plain.graph.nodes.find((node) => node.id === 'n1')!.runs_from, {
    found: 'none',
    hops: 1,
    why: 'Nothing within 1 call of it is where work enters, and what calls its callers was not looked for.',
  })
  const failing: EntriesSearch = async () => {
    throw new Error('boom')
  }
  const result = await reviewChange({ cwd: repo, base, head, out: `${out}-2`, clock: steadyClock(), scan: scanning(mentionsScan()), entriesAbove: failing })
  assert.ok(result.problems.some((problem) => /The search for entry points failed: boom/.test(problem)), result.problems.join('\n'))
  assert.equal(result.graph.nodes.find((node) => node.id === 'n1')!.facts.proof.value, 'isolated')
})

/** A Reviewer that answers `answer` in its one call, and a checker that gives nothing to read. */
function answering(answer: Record<string, unknown>) {
  const calls = { review: 0, checker: 0 }
  const model: ModelRunner = async ({ pass }) => {
    calls[pass] += 1
    return pass === 'review' ? JSON.stringify(answer) : 'nothing'
  }
  return { model, calls }
}

test('the Reviewer reorganizes the map in its one answer: a part renamed, two units merged, a safe part taken out, a mid one kept', async (t) => {
  const { repo, base, head, out } = project(t)
  const { model, calls } = answering({
    events: [],
    claims: [],
    words: { title: 'Round the total', units: { u1: { title: 'The total and its precision change together' } } },
    map: [
      { op: 'describe', node: 'n1', title: 'Rounded total', what: '`total` rounds every sum.' },
      { op: 'merge', units: ['u1', 'u2'] },
      { op: 'remove', node: 'n4', why: 'only a type changed, and the compiler checks it' },
      { op: 'remove', node: 'n1', why: 'it is small' },
    ],
  })
  const result = await reviewChange({ cwd: repo, base, head, out, model, clock: steadyClock(), scan: scanning(scanOf()) })

  assert.deepEqual(calls, { review: 1, checker: 1 }, 'still one call to the Reviewer')
  assert.deepEqual(result.units.units.map((unit) => [unit.nodes, unit.grouping, unit.level]), [[['n2', 'n1'], 'regrouped', 'mid']])
  assert.deepEqual(levelsOf(result.units), { 'n2,n1': 'mid' }, 'the levels are the floors')
  const graph = JSON.parse(readFileSync(join(out, 'graph.json'), 'utf8')) as { nodes: { id: string; hidden?: string; told?: unknown }[] }
  assert.equal(graph.nodes.find((node) => node.id === 'n4')?.hidden, 'only a type changed, and the compiler checks it', 'the part taken out stays in the saved graph with the reason')
  assert.deepEqual(graph.nodes.find((node) => node.id === 'n1')?.told, { title: 'Rounded total', what: '`total` rounds every sum.' })
  assert.ok(result.problems.some((problem) => /From the Reviewer: map\[3\] removing n1 was refused: it is mid/.test(problem)), result.problems.join('\n'))
  assert.match(result.story, /The total and its precision change together/)
  assert.match(result.story, /- `total`: `total` rounds every sum\./)
  assert.doesNotMatch(result.story, /Money/, 'the part taken out is not in the story')
  const words = JSON.parse(readFileSync(join(out, 'story-words.json'), 'utf8'))
  assert.equal(words.units[result.units.units[0]!.id].title, 'The total and its precision change together')
})

test('an answer with an empty map gives the same review as one with none', async (t) => {
  const { repo, base, head, out } = project(t)
  const answer = { events: [], claims: [], words: { title: 'Round the total', units: { u2: { title: '`total` rounds every sum' } } } }
  const plain = await reviewChange({ cwd: repo, base, head, out, model: answering(answer).model, clock: steadyClock(), scan: scanning(scanOf()) })
  const empty = await reviewChange({ cwd: repo, base, head, out: `${out}-empty`, model: answering({ ...answer, map: [] }).model, clock: steadyClock(), scan: scanning(scanOf()) })
  assert.deepEqual(empty.units, plain.units)
  assert.equal(empty.story, plain.story)
  assert.deepEqual(empty.problems, plain.problems)
  assert.deepEqual(readFileSync(join(`${out}-empty`, 'story-words.json'), 'utf8'), readFileSync(join(out, 'story-words.json'), 'utf8'))
})

const SALE_SPEC = '_specs/tla/sale/Sale.tla'
const SALE_CFG = '_specs/tla/sale/Sale.cfg'

/** A sale that stops selling past the stock, with a TLA+ model of it and its config added beside it. */
function modeledSale(t: TestContext) {
  return repoOf(
    t,
    { 'src/sale.js': 'export function sell(stock, count) {\n  return stock - count\n}\n' },
    {
      'src/sale.js': 'export function sell(stock, count) {\n  return count > stock ? stock : stock - count\n}\n',
      [SALE_SPEC]: "---- MODULE Sale ----\n\\* models: src/sale.js\nVARIABLE stock\nInit == stock = 3\nSell == stock > 0 /\\ stock' = stock - 1\nStockInBounds == stock >= 0\n====\n",
      [SALE_CFG]: 'INIT Init\nNEXT Sell\nINVARIANT StockInBounds\n',
    },
  )
}

const saleScan = (): Scan => ({
  ...scanWith([{ id: 'n1', symbol: 'sell', kind: 'function', path: 'src/sale.js', startLine: 1, endLine: 3, changedLines: [2], language: 'javascript', status: 'modified', tests: [] }]),
  files: [{ path: 'src/sale.js', kind: 'code', status: 'modified', language: 'javascript' }, { path: SALE_SPEC, kind: 'code', status: 'added' }, { path: SALE_CFG, kind: 'code', status: 'added' }],
})

/** What hobkin's TLC run of the sale model at the head said. */
const saleCheck = (more: Partial<ModelCheck> = {}): ModelCheck => ({
  spec: SALE_SPEC,
  run: '20261121-060242-sale-3w0w',
  result: 'holds',
  states: 15,
  rules: [{ name: 'StockInBounds', kind: 'invariant', held: true, words: 'Stock never goes below zero.' }],
  unfired: [],
  models: ['src/sale.js'],
  ...more,
})

/** No test could run, as when a test command cannot start in the review tree. */
const noTestsRan = async (): Promise<ProofResult> => ({ nodes: {}, runs: [], findings: [], clean: true })

test('a TLA+ model TLC checked at the head is evidence the Reviewer is given: its lines are shown holding, and the code it models keeps its level', async (t) => {
  const { repo, base, head, out } = modeledSale(t)
  const { model, shown } = watchingModel()
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(saleScan()), proof: noTestsRan, model, modelChecks: [saleCheck()] })

  assert.ok(shown[0]?.includes('"model_checks":[{"spec":"_specs/tla/sale/Sale.tla","run":"20261121-060242-sale-3w0w","result":"holds","states":15'), 'the Reviewer is given the check')
  for (const path of [SALE_SPEC, SALE_CFG]) {
    const { part, unit } = readFromDiff(result, path)
    assert.deepEqual([part?.level?.current, part?.level?.rule, part?.level?.why[0]], ['safe', 2, 'TLC checked Sale.tla at this commit: it holds in 15 states, and StockInBounds holds.'], path)
    assert.equal(unit?.level, 'safe', path)
  }
  assert.match(readFromDiff(result, SALE_SPEC).unit?.title ?? '', /TLC checked it at this commit, and it holds/)
  // A model is not a test of the code: what it models stays where the rules put it, and its reason says what the model shows.
  const sell = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.deepEqual([sell.level?.current, sell.level?.rule], ['mid', 5])
  assert.equal(
    sell.level?.why[0],
    'No test that ran shows these lines work. Sale.tla models this file and holds in 15 states at this commit: that shows its rules keep in the model, not that these lines work, and it lowers no break found in them.',
  )
  assert.equal(result.answer.deploy, 'safe')
})

test('a TLA+ model whose rule TLC found broken at the head is a break the change carries, and the code it models is told so', async (t) => {
  const { repo, base, head, out } = modeledSale(t)
  const broke = saleCheck({ result: 'violated', broken: 'StockInBounds', steps: 4, rules: [{ name: 'StockInBounds', kind: 'invariant', held: false }] })
  const result = await reviewChange({ cwd: repo, base, head, out, clock: steadyClock(), scan: scanning(saleScan()), proof: noTestsRan, modelChecks: [broke] })

  const { part } = readFromDiff(result, SALE_SPEC)
  assert.deepEqual([part?.level?.current, part?.level?.rule, part?.critical, part?.level?.why[0]], ['high', 1, true, 'TLC checked Sale.tla at this commit: StockInBounds breaks in 4 steps.'])
  assert.equal(result.answer.deploy, 'risky')
  const sell = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.deepEqual(
    [sell.level?.current, sell.findings.find((finding) => finding.rule === 'model-violated')?.text],
    ['mid', 'Sale.tla models this file, and TLC found StockInBounds broken in 4 steps at this commit: the code or the model is wrong.'],
  )
})

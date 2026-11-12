import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { reviewChange } from '../src/pipeline.ts'
import type { ScanOutcome } from '../src/scan.ts'
import type { Level, ModelRunner, Progress, Scan, Units } from '../src/types.ts'

/** A small Node project: `total` gains rounding with a test that sees it, and a constant changes that nothing reads. */
function project(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'change-review-pipeline-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'shop')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  git('init', '--quiet', '--initial-branch=main')
  write('package.json', JSON.stringify({ name: 'shop', type: 'module', scripts: { test: 'node --test' } }))
  write('src/total.js', 'export function total(a, b) {\n  return a + b\n}\n')
  write('src/config.js', 'export const PRECISION = 2\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  const base = git('rev-parse', 'HEAD')
  write('src/total.js', 'export function total(a, b) {\n  return Math.round(a + b)\n}\n')
  write('src/config.js', 'export const PRECISION = 3\n')
  write('test/total.test.js', "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\nimport { total } from '../src/total.js'\n\ntest('rounds the total', () => {\n  assert.equal(total(1.2, 1.4), 3)\n})\n")
  git('add', '.')
  git('commit', '--quiet', '-m', 'Round the total')
  return { repo, base, head: git('rev-parse', 'HEAD'), out: join(root, 'out'), git }
}

/** What agentic-search would report for that change. */
const scanOf = (): Scan => ({
  anchors: [
    { id: 'n1', symbol: 'total', kind: 'function', path: 'src/total.js', startLine: 1, endLine: 3, changedLines: [2], language: 'javascript', status: 'modified', tests: [{ id: 'n3', symbol: 'rounds the total', path: 'test/total.test.js', line: 5 }] },
    { id: 'n2', symbol: 'PRECISION', kind: 'constant', path: 'src/config.js', startLine: 1, endLine: 1, changedLines: [1], language: 'javascript', status: 'modified', loadTime: true, tests: [] },
    { id: 'n3', symbol: 'rounds the total', kind: 'test', path: 'test/total.test.js', startLine: 5, endLine: 7, changedLines: [1, 2, 3, 4, 5, 6, 7], language: 'javascript', status: 'added', tests: [] },
  ],
  nodes: {
    n1: { id: 'n1', symbol: 'total', kind: 'function', path: 'src/total.js', startLine: 1, endLine: 3 },
    n2: { id: 'n2', symbol: 'PRECISION', kind: 'constant', path: 'src/config.js', startLine: 1, endLine: 1 },
    n3: { id: 'n3', symbol: 'rounds the total', kind: 'test', path: 'test/total.test.js', startLine: 5, endLine: 7 },
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

/** A careful pass that tries to lower the proven-only-in-isolation node, and a checker that would lower one unit and raise another. */
function fakeModel() {
  const calls = { review: 0, checker: 0 }
  const model: ModelRunner = async ({ pass }) => {
    calls[pass] += 1
    if (pass === 'review') {
      return JSON.stringify({
        events: [{ node: 'n1', level: 'mid', direction: 'down', aspect: 'behaviour', evidence: 'The existing tests run total and pass with the change in place.', evidence_kind: 'equivalent' }],
        words: { title: 'Round the total', units: { u1: { title: '`total` now rounds every sum to a whole number' } } },
        claims: [],
      })
    }
    return JSON.stringify({
      units: [
        { id: 'u1', agree: 'no', level_i_would_give: 'safe', because: 'it looks small', understood: 'yes', context: 'about right' },
        { id: 'u2', agree: 'no', level_i_would_give: 'high', because: 'nothing shows who reads PRECISION', understood: 'yes', context: 'about right' },
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
  // The test that sees the rounding is not a life-cycle test, so total stays high: no argument lowers missing proof.
  assert.ok(result.rejected.some((entry) => entry.event.node === 'n1' && /rule 4/.test(entry.reason)))
  assert.deepEqual(levelsOf(result.units), { n1: 'high', n2: 'high' }, 'the checker lowered nothing and raised the constant one step')
  assert.equal(result.blind.ran, true)
  assert.deepEqual(result.blind.actions.map((action) => action.answer).sort(), ['thin-evidence', 'told-badly'])
  assert.equal(result.storyBy, 'model')
  assert.match(result.story, /^# Round the total/)
  assert.match(result.story, /`total` now rounds every sum to a whole number/)

  // Proof came from running the project's own test: it passed at head and failed with the rounding undone.
  const total = result.graph.nodes.find((node) => node.id === 'n1')!
  assert.equal(total.facts.proof.value, 'isolated')
  assert.deepEqual(total.runs.map((run) => run.kind), ['baseline', 'revert'])
  assert.equal(git('status', '--porcelain'), '', 'the checkout is the change again')

  for (const name of ['triage.json', 'graph.json', 'risk-events.jsonl', 'units.json', 'story.md', 'blind-check.json', 'progress.json', 'progress.jsonl']) {
    assert.ok(existsSync(join(out, name)), `${name} is written`)
  }
  const saved = JSON.parse(readFileSync(join(out, 'blind-check.json'), 'utf8'))
  assert.equal(typeof saved.answer, 'string', 'the checker’s answer is kept unedited')
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

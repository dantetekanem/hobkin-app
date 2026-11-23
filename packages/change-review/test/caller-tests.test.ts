import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { EntriesSearch } from '../src/entries.ts'
import { reviewChange } from '../src/pipeline.ts'
import type { ScanOutcome } from '../src/scan.ts'
import type { Scan } from '../src/types.ts'

/** A git repository whose base commit holds `before` and whose head commit holds `after` on top of it. */
function repoOf(t: TestContext, before: Record<string, string>, after: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'change-review-callers-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'shop')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
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
  return { repo, base, head: commit(after, 'Change'), out: join(root, 'out') }
}

const HEADER = "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\n"

/**
 * A score helper that now caps at five, with a direct test the change adds, and a service test from before that
 * reaches the helper only through `findReview`, the service a route calls.
 */
function scoreProject(t: TestContext) {
  return repoOf(
    t,
    {
      'package.json': JSON.stringify({ name: 'shop', type: 'module', scripts: { test: 'node --test' } }),
      'src/helpers/score.js': 'export function formatScore(stars) {\n  return `${stars} of 5`\n}\n',
      'src/services/reviews.js': "import { formatScore } from '../helpers/score.js'\n\nexport function findReview(id) {\n  return { id, score: formatScore(3) }\n}\n",
      'src/handlers/reviews.js': "import { findReview } from '../services/reviews.js'\n\nexport function showReview(req, res) {\n  res.json(findReview(req.params.id))\n}\n",
      'test/services/reviews.test.js': `${HEADER}import { findReview } from '../../src/services/reviews.js'\n\ntest('a review shows its score', () => {\n  assert.match(findReview('abc').score, /^3/)\n})\n`,
    },
    {
      'src/helpers/score.js': 'export function formatScore(stars) {\n  return `${Math.min(stars, 5)} of 5`\n}\n',
      'test/helpers/score-cap.test.js': `${HEADER}import { formatScore } from '../../src/helpers/score.js'\n\ntest('caps a score at five', () => {\n  assert.equal(formatScore(9), '5 of 5')\n})\n`,
    },
  )
}

const scoreScan = (): Scan => {
  const anchor = {
    id: 'n2', symbol: 'formatScore', kind: 'function', path: 'src/helpers/score.js', startLine: 1, endLine: 3, changedLines: [2], language: 'javascript', status: 'modified' as const,
    callers: { total: 1, shown: 1, complete: true }, callSites: [{ id: 'c1', symbol: 'findReview', path: 'src/services/reviews.js', line: 4, guards: [] }],
    tests: [{ id: 't1', symbol: 'caps a score at five', path: 'test/helpers/score-cap.test.js', line: 4 }],
  }
  return {
    anchors: [anchor],
    nodes: { n2: { id: 'n2', symbol: 'formatScore', kind: 'function', path: 'src/helpers/score.js', startLine: 1, endLine: 3 } },
    edges: [],
    dangling: [],
    tests: [],
    files: [],
    coverage: { truncated: false, truncatedBy: 'none', skippedAnchors: 0, unresolved: 0, notes: [] },
  }
}

/** The walk as agentic-search answers it: a route above the service, and the service's own test, which the walk's scan links to it. */
const walk = (withTests: boolean): EntriesSearch => async () => ({
  entries: {
    n2: [
      {
        symbol: 'showReview', path: 'src/handlers/reviews.js', hops: 2, line: 3, kind: 'route', label: 'GET /reviews/:id', exact: true, by: 'scan' as const,
        chain: [{ symbol: 'showReview', path: 'src/handlers/reviews.js', line: 3, call_line: 4 }, { symbol: 'findReview', path: 'src/services/reviews.js', line: 3, call_line: 4 }],
      },
    ],
  },
  notes: [],
  stops: { n2: { hops: 2 } },
  ...(withTests ? { tests: { 'src/services/reviews.js:3': [{ symbol: 'a review shows its score', path: 'test/services/reviews.test.js', line: 4 }] } } : {}),
})

const noEntryTests = async () => ({ ok: true as const, tests: [], notes: [] })
const scanning = (scan: Scan) => async (): Promise<ScanOutcome> => ({ ok: true, scan })

test('a test that covered the part before, through a caller on the way in, is run and said, and the level stays', async (t) => {
  const { repo, base, head, out } = scoreProject(t)
  const result = await reviewChange({ cwd: repo, base, head, out, scan: scanning(scoreScan()), entriesAbove: walk(true), entryTests: noEntryTests })
  const score = result.graph.nodes.find((node) => node.id === 'n2')!
  const before = score.tests!.find((entry) => entry.path === 'test/services/reviews.test.js')
  assert.deepEqual(
    before && { relation: before.relation, found: before.found, lifecycle: before.lifecycle, at_head: before.at_head, shows: before.shows },
    { relation: 'before', found: 'entry', lifecycle: false, at_head: 'passed', shows: 'reaches' },
    JSON.stringify(score.tests),
  )
  assert.match(score.facts.proof.evidence, /test\/services\/reviews\.test\.js runs through it from findReview \(it fails when formatScore is made to throw\)\.$/)

  // It shows the part is reached, not that a request works: the level is what it is without it.
  const without = await reviewChange({ cwd: repo, base, head, out: `${out}-without`, scan: scanning(scoreScan()), entriesAbove: walk(false), entryTests: noEntryTests })
  const plain = without.graph.nodes.find((node) => node.id === 'n2')!
  assert.deepEqual([score.facts.proof.value, score.level?.current, score.level?.rule], [plain.facts.proof.value, plain.level?.current, plain.level?.rule])
  assert.ok(!plain.tests!.some((entry) => entry.path === 'test/services/reviews.test.js'))
})

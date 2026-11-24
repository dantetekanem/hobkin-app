/** A change whose whole diff is a TLA+ model and its config, for the tests of TLA+ models in a review. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import type { ProofResult } from '../src/proof.ts'
import type { ScanOutcome } from '../src/scan.ts'
import type { ModelCheck, Scan } from '../src/types.ts'

export const SPEC = '_specs/tla/review/Review.tla'
export const CFG = '_specs/tla/review/Review.cfg'

export const check = (more: Partial<ModelCheck> = {}): ModelCheck => ({
  spec: SPEC,
  run: '20261123-120000-review-ab12',
  result: 'holds',
  states: 9,
  rules: [{ name: 'SentOnlyWhenReady', kind: 'invariant', held: true }],
  unfired: [],
  models: ['src/review.js'],
  ...more,
})
export const violated = () => check({ result: 'violated', broken: 'SentOnlyWhenReady', steps: 3, rules: [{ name: 'SentOnlyWhenReady', kind: 'invariant', held: false }] })

/** A git repository whose base commit holds `before` and whose head commit holds `after` on top of it. */
export function repoOf(t: TestContext, before: Record<string, string>, after: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'change-review-models-'))
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

/** A change whose whole diff is a TLA+ model of the review and its config. */
export function modelsOnly(t: TestContext) {
  const model = (body: string) => `---- MODULE Review ----\n\\* models: src/review.js\n${body}\n====\n`
  return repoOf(
    t,
    {
      'src/review.js': 'export function prepare(review) {\n  return { ...review, ready: true }\n}\n',
      [SPEC]: model("VARIABLE ready\nInit == ready = FALSE\nNext == ready' = TRUE"),
      [CFG]: 'INIT Init\nNEXT Next\n',
    },
    {
      [SPEC]: model("VARIABLES ready, sent\nInit == ready = FALSE /\\ sent = FALSE\nNext == ready' = TRUE /\\ sent' = ready\nSentOnlyWhenReady == sent => ready"),
      [CFG]: 'INIT Init\nNEXT Next\nINVARIANT SentOnlyWhenReady\n',
    },
  )
}

/** The scan as agentic-search gives it for these files: listed, with no parser for either. */
export const scanning = async (): Promise<ScanOutcome> => ({
  ok: true,
  scan: {
    anchors: [],
    nodes: {},
    edges: [],
    dangling: [],
    tests: [],
    files: [{ path: SPEC, kind: 'code', status: 'modified' }, { path: CFG, kind: 'code', status: 'modified' }],
    coverage: { truncated: false, truncatedBy: 'none', skippedAnchors: 0, unresolved: 0, notes: [] },
  } satisfies Scan,
})
export const noTests = async (): Promise<ProofResult> => ({ nodes: {}, runs: [], findings: [], clean: true })

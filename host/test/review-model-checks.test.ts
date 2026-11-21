import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { modelChecksAt, reviewModelChecks } from '../src/review/model-checks.ts'
import { temporaryDirectory } from './support.ts'

const SPEC = '_specs/tla/sale/Sale.tla'
const SPEC_TEXT = "---- MODULE Sale ----\n\\* models: src/sale.js\nVARIABLE stock\nInit == stock = 3\nSell == stock > 0 /\\ stock' = stock - 1\n====\n"

/** A project whose change edits the sale and adds a model of it, and a hobkin home to keep runs in. */
function modeledChange(t: TestContext) {
  const root = temporaryDirectory(t)
  const repo = join(root, 'shop')
  const data = join(root, 'home')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  const commit = (files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(repo, path, '..'), { recursive: true })
      writeFileSync(join(repo, path), text)
    }
    git('add', '.')
    git('commit', '--quiet', '-m', 'Commit')
    return git('rev-parse', 'HEAD')
  }
  git('init', '--quiet', '--initial-branch=main')
  const base = commit({ 'src/sale.js': 'export const sell = (stock) => stock - 1\n' })
  const head = commit({ 'src/sale.js': 'export const sell = (stock) => Math.max(0, stock - 1)\n', [SPEC]: SPEC_TEXT })
  /** A run as `hobkin proof check` leaves it in the home. */
  const run = (id: string, more: Record<string, unknown> = {}) => {
    mkdirSync(join(data, 'proofs', id), { recursive: true })
    const result = {
      id,
      project: 'shop',
      item: '4f2c',
      spec: SPEC,
      head,
      specHash: createHash('sha256').update(SPEC_TEXT).digest('hex'),
      tool: 'TLC 1.7.4',
      started: '2026-11-21T06:02:42.559Z',
      finished: '2026-11-21T06:02:44.027Z',
      outcome: 'holds',
      stats: { generated: 91, distinct: 15, queue: 0, depth: 4 },
      rules: [
        { name: 'StockInBounds', kind: 'invariant', status: 'holds', words: 'Stock never goes below zero.' },
        { name: 'Deadlock', kind: 'deadlock', status: 'holds' },
      ],
      actions: [{ name: 'Sell', count: 3 }],
      ...more,
    }
    writeFileSync(join(data, 'proofs', id, 'result.json'), JSON.stringify(result))
  }
  return { repo, data, base, head, run }
}

test("a hobkin change's review is given hobkin's TLC run of each model it adds or touches, at the reviewed head", async (t) => {
  const { repo, data, base, head, run } = modeledChange(t)
  run('20261121-060242-sale-3w0w')
  // Checks that never speak for this head: another commit, another project, and an edit of the spec nobody committed.
  run('older', { head: base, finished: '2026-11-21T07:00:00.000Z' })
  run('elsewhere', { project: 'api', finished: '2026-11-21T07:00:00.000Z' })
  run('uncommitted', { specHash: 'f'.repeat(64), outcome: 'broken', finished: '2026-11-21T07:00:00.000Z' })

  assert.deepEqual(await modelChecksAt({ data, slug: 'shop', repo, base, head: head.slice(0, 12) }), [
    {
      spec: SPEC,
      run: '20261121-060242-sale-3w0w',
      result: 'holds',
      states: 15,
      rules: [
        { name: 'StockInBounds', kind: 'invariant', held: true, words: 'Stock never goes below zero.' },
        { name: 'Deadlock', kind: 'deadlock', held: true },
      ],
      unfired: [],
      models: ['src/sale.js'],
    },
  ])
})

test('a violation at the head outweighs a hold, and says which rule broke and in how many steps', async (t) => {
  const { repo, data, base, head, run } = modeledChange(t)
  run('held')
  run('broke', { outcome: 'broken', broken: 'StockInBounds', traceLength: 5, rules: [{ name: 'StockInBounds', kind: 'invariant', status: 'broken' }], actions: [{ name: 'Sell', count: 0 }] })

  const [check] = await modelChecksAt({ data, slug: 'shop', repo, base, head })
  assert.deepEqual(check, { spec: SPEC, run: 'broke', result: 'violated', states: 15, rules: [{ name: 'StockInBounds', kind: 'invariant', held: false }], unfired: ['Sell'], models: ['src/sale.js'], broken: 'StockInBounds', steps: 4 })
})

test('a model nothing checked at the head, or a home with no runs, gives the review nothing to go on', async (t) => {
  const { repo, data, base, head } = modeledChange(t)
  assert.deepEqual(await modelChecksAt({ data, slug: 'shop', repo, base, head }), [])
})

test("a pull request's review has no model checks, and one whose runs cannot be read goes on without them and says why", async (t) => {
  const { repo, data, base, head, run } = modeledChange(t)
  run('held')
  const said: string[] = []
  const log = (line: string) => said.push(line)
  const change = { kind: 'change', slug: 'shop', item: '4f2c' } as const
  assert.deepEqual((await reviewModelChecks({ target: change, cwd: repo, base, head }, { data: () => data, log })).map((check) => check.run), ['held'])
  assert.deepEqual(await reviewModelChecks({ target: { kind: 'pull', owner: 'acme', repo: 'shop', number: 12 }, cwd: repo, base, head }, { data: () => data, log }), [])
  const closed = () => {
    throw new Error('hobkin is not open in this host.')
  }
  assert.deepEqual(await reviewModelChecks({ target: change, cwd: repo, base, head }, { data: closed, log }), [])
  assert.deepEqual(said, [`Change review at ${head.slice(0, 7)}: its model checks could not be read, so the Reviewer goes without them: hobkin is not open in this host.`])
})

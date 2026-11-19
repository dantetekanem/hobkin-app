import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { Assessments, treeOf } from '../src/review/assessment.ts'
import { readyHostTree } from '../src/review/host-tree.ts'
import { temporaryDirectory } from './support.ts'

const GB = 1024 ** 3

/** A repository whose change touches a folder of code, one named like an option and one named like a pattern. */
function repository(t: TestContext) {
  const dir = temporaryDirectory(t)
  const repo = join(dir, 'shop')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  git('init', '--quiet', '--initial-branch=main')
  for (const path of ['app/cart.rb', 'docs/readme.md', '-dash/f.txt', 'glob*/f.txt']) write(path, 'one\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  const base = git('rev-parse', 'HEAD')
  for (const path of ['app/cart.rb', '-dash/f.txt', 'glob*/f.txt']) write(path, 'two\n')
  git('commit', '--quiet', '-am', 'Change')
  const head = git('rev-parse', 'HEAD')
  return { dir, repo, base, head, git }
}

const gitAt = (folder: string, ...args: string[]) => execFileSync('git', ['-C', folder, ...args], { encoding: 'utf8' }).trim()

test('a missing review tree is made by its command, in its folder, from the change’s base; one the disk has no room for is refused', async (t) => {
  const { dir, repo, base, head } = repository(t)
  const path = join(dir, 'tree')
  const tree = { path, make: ['git', '-C', repo, 'worktree', 'add', '--quiet', '--detach', path, '{base}'], makeIn: dir, leastFreeGb: 20 }
  await assert.rejects(readyHostTree({ tree, repo, base, head, freeBytes: () => 5 * GB }), /needs 20 GB free/)
  assert.equal(existsSync(path), false)
  assert.equal(await readyHostTree({ tree, repo, base, head, freeBytes: () => 100 * GB }), path)
  assert.equal(gitAt(path, 'rev-parse', 'HEAD'), head)
  // A base that is not a full commit is never put in a command.
  await assert.rejects(readyHostTree({ tree: { ...tree, path: join(dir, 'other') }, repo, base: base.slice(0, 7), head, freeBytes: () => 100 * GB }), /full commit/)
})

test('the tree is checked out at the change’s head, emptied of what an earlier review left, and fitted to the changed folders, leaving out names that read as options or patterns', async (t) => {
  const { dir, repo, base, head } = repository(t)
  const path = join(dir, 'tree')
  const tree = { path, make: ['git', '-C', repo, 'worktree', 'add', '--quiet', '--detach', path, '{base}'], makeIn: dir, leastFreeGb: 0 }
  await readyHostTree({ tree, repo, base, head })
  writeFileSync(join(path, 'left-behind.txt'), 'a run wrote this\n')
  writeFileSync(join(path, 'app/cart.rb'), 'changed by a run\n')
  await readyHostTree({ tree, repo, base, head })
  assert.equal(existsSync(join(path, 'left-behind.txt')), false)
  assert.equal(readFileSync(join(path, 'app/cart.rb'), 'utf8'), 'two\n')
  assert.equal(gitAt(path, 'status', '--porcelain'), '')
  assert.deepEqual(gitAt(path, 'sparse-checkout', 'list').split('\n'), ['app'])
  assert.equal(existsSync(join(path, 'docs/readme.md')), false, 'what the change did not touch is left out')
})

test("a host's own fit command fits the tree instead, with the base filled in", async (t) => {
  const { dir, repo, base, head } = repository(t)
  const path = join(dir, 'tree')
  const fit = join(dir, 'fit')
  writeFileSync(fit, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(join(dir, 'fitted.json'))}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), lfs: process.env.GIT_LFS_SKIP_SMUDGE }))\n`)
  chmodSync(fit, 0o755)
  const tree = { path, make: ['git', '-C', repo, 'worktree', 'add', '--quiet', '--detach', path, '{base}'], makeIn: dir, fit: [fit, '--from', '{base}'], leastFreeGb: 0, env: { GIT_LFS_SKIP_SMUDGE: '1' } }
  await readyHostTree({ tree, repo, base, head })
  const fitted = JSON.parse(readFileSync(join(dir, 'fitted.json'), 'utf8')) as { args: string[]; cwd: string; lfs: string }
  assert.deepEqual([fitted.args, fitted.lfs], [['--from', base], '1'])
  assert.equal(execFileSync('realpath', [fitted.cwd], { encoding: 'utf8' }).trim(), execFileSync('realpath', [path], { encoding: 'utf8' }).trim())
  assert.equal(gitAt(path, 'rev-parse', 'HEAD'), head)
})

test('a folder at the tree’s place that is not a worktree of the repository is left alone', async (t) => {
  const { dir, repo, base, head } = repository(t)
  const path = join(dir, 'tree')
  mkdirSync(path)
  writeFileSync(join(path, 'mine.txt'), 'the user’s\n')
  const tree = { path, make: ['true'], makeIn: dir, leastFreeGb: 0 }
  await assert.rejects(readyHostTree({ tree, repo, base, head }), /not a worktree of .* left alone/)
  assert.equal(readFileSync(join(path, 'mine.txt'), 'utf8'), 'the user’s\n')
  // Nor is a worktree of another repository.
  const other = repository(t)
  const elsewhere = join(dir, 'elsewhere')
  gitAt(other.repo, 'worktree', 'add', '--quiet', '--detach', elsewhere, other.base)
  await assert.rejects(readyHostTree({ tree: { ...tree, path: elsewhere }, repo, base, head }), /not a worktree of/)
})

test("a change review on a host with a tree of its own runs in that tree, never in a worktree of hobkin's, and pull request trees stay apart for each host", async (t) => {
  const { dir, repo, base, head } = repository(t)
  const path = join(dir, 'tree')
  const root = temporaryDirectory(t)
  const tree = { path, make: ['git', '-C', repo, 'worktree', 'add', '--quiet', '--detach', path, '{base}'], makeIn: dir, leastFreeGb: 0 }
  const named = { kind: 'pull' as const, host: 'corp', owner: 'acme', repo: 'shop', number: 7 }
  const assessments = new Assessments({ root, run: async () => Promise.reject(new Error('not run here')), repoOf: () => null, hostTree: (target) => (target.kind === 'pull' && target.host === 'corp' ? tree : null) })
  const used = await assessments.inTree(named, repo, head, async (at) => at, undefined, base)
  assert.equal(used, path)
  assert.equal(gitAt(path, 'rev-parse', 'HEAD'), head)
  assert.equal(existsSync(treeOf(root, named)), false, "hobkin's own worktree is never made for it")
  assert.notEqual(treeOf(root, named), treeOf(root, { ...named, host: undefined }), 'a named host’s pull request trees are apart from GitHub’s')
})

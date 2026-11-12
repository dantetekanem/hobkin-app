import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { gitRepo, runProgram } from '../src/git.ts'

/** A repository of this test's own under the system's temporary folder, removed when the test ends. */
function tempRepo(t: TestContext) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'change-review-git-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', timeout: 30_000 }).trim()
  const write = (path: string, text: string | Buffer) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const commit = (message: string) => {
    git('add', '-A')
    git('commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '--quiet', '--initial-branch=main')
  return { dir, git, write, commit }
}

const NAMES = ['ada', 'grace', 'alan', 'edsger', 'barbara', 'donald', 'ken', 'dennis', 'margaret', 'john']

/** A base and a head with one of each change: an add, a modify, a delete, a rename and a binary file. */
function changedRepo(t: TestContext) {
  const repo = tempRepo(t)
  repo.write('src/keep.ts', 'export function total(items: number[]) {\n  return items.length\n}\n')
  repo.write('src/gone.ts', 'export const gone = 1\n')
  repo.write('src/old-name.ts', NAMES.map((name) => `export const ${name} = '${name}'\n`).join(''))
  repo.write('assets/logo.bin', Buffer.from([0, 1, 2, 3]))
  const base = repo.commit('Start')
  repo.write('src/keep.ts', 'export function total(items: number[]) {\n  return items.reduce((sum, item) => sum + item, 0)\n}\n')
  rmSync(join(repo.dir, 'src/gone.ts'))
  rmSync(join(repo.dir, 'src/old-name.ts'))
  repo.write('src/new-name.ts', NAMES.map((name) => `export const ${name} = '${name === 'ken' ? 'kenneth' : name}'\n`).join(''))
  repo.write('src/added.ts', 'export const added = true\n')
  repo.write('assets/logo.bin', Buffer.from([0, 1, 2, 3, 4]))
  repo.commit('Sum the items')
  repo.write('src/added.ts', 'export const added = true\nexport const more = 2\n')
  const head = repo.commit('Add more\n\nA body that explains\nover two lines.')
  return { ...repo, base, head }
}

test('meta reads each kind of change with its counts, the rename and its similarity, binary files, and the commits', async (t) => {
  const { dir, base, head } = changedRepo(t)
  const meta = await gitRepo(dir).meta('HEAD~2', 'HEAD')

  assert.equal(meta.range, 'HEAD~2..HEAD')
  assert.equal(meta.base, base)
  assert.equal(meta.head, head)
  const byPath = new Map(meta.files.map((file) => [file.path, file]))
  assert.deepEqual(byPath.get('src/added.ts'), { path: 'src/added.ts', status: 'added', added: 2, deleted: 0, binary: false })
  assert.deepEqual(byPath.get('src/keep.ts'), { path: 'src/keep.ts', status: 'modified', added: 1, deleted: 1, binary: false })
  assert.deepEqual(byPath.get('src/gone.ts'), { path: 'src/gone.ts', status: 'deleted', added: 0, deleted: 1, binary: false })
  assert.deepEqual(byPath.get('assets/logo.bin'), { path: 'assets/logo.bin', status: 'modified', added: 0, deleted: 0, binary: true })
  const renamed = byPath.get('src/new-name.ts')
  assert.equal(renamed?.status, 'renamed')
  assert.equal(renamed?.oldPath, 'src/old-name.ts')
  assert.equal(renamed?.added, 1)
  assert.equal(renamed?.deleted, 1)
  assert.ok(renamed?.similarity !== undefined && renamed.similarity >= 50 && renamed.similarity < 100, `similarity ${renamed?.similarity}`)
  assert.equal(meta.files.length, 5)

  assert.deepEqual(
    meta.commits.map(({ subject, body, author }) => ({ subject, body, author })),
    [
      { subject: 'Sum the items', body: undefined, author: 't' },
      { subject: 'Add more', body: 'A body that explains\nover two lines.', author: 't' },
    ],
  )
  assert.equal(meta.commits[1]?.sha, head)
  assert.match(meta.commits[0]?.date ?? '', /^\d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(meta.description, { source: 'commits' })
})

test('meta between a commit and itself has no files, no commits and no description', async (t) => {
  const { dir, head } = changedRepo(t)
  const meta = await gitRepo(dir).meta(head, head, 'same')
  assert.deepEqual({ range: meta.range, files: meta.files, commits: meta.commits, description: meta.description }, { range: 'same', files: [], commits: [], description: { source: 'none' } })
})

test('diffs parse hunks line by line, keep the old path of a rename, and can be limited to paths', async (t) => {
  const { dir, base, head } = changedRepo(t)
  const repo = gitRepo(dir)
  const diffs = await repo.diffs(base, head)
  const byPath = new Map(diffs.map((diff) => [diff.path, diff]))

  assert.deepEqual(byPath.get('src/keep.ts'), {
    path: 'src/keep.ts',
    hunks: [
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [' export function total(items: number[]) {', '-  return items.length', '+  return items.reduce((sum, item) => sum + item, 0)', ' }'],
      },
    ],
  })
  assert.deepEqual(byPath.get('src/gone.ts')?.hunks, [{ oldStart: 1, oldLines: 1, newStart: 0, newLines: 0, lines: ['-export const gone = 1'] }])
  assert.deepEqual(byPath.get('src/added.ts')?.hunks.map((hunk) => hunk.lines), [['+export const added = true', '+export const more = 2']])
  assert.deepEqual(byPath.get('assets/logo.bin'), { path: 'assets/logo.bin', hunks: [] })
  const renamed = byPath.get('src/new-name.ts')
  assert.equal(renamed?.oldPath, 'src/old-name.ts')
  assert.ok(renamed?.hunks[0]?.lines.includes("+export const ken = 'kenneth'"))
  assert.equal(diffs.length, 5)

  const limited = await repo.diffs(base, head, ['src/new-name.ts', 'src/keep.ts'])
  assert.deepEqual(limited.map((diff) => [diff.path, diff.oldPath]).sort(), [['src/keep.ts', undefined], ['src/new-name.ts', 'src/old-name.ts']])
  assert.deepEqual((await repo.diffs(base, head, ['src/old-name.ts'])).map((diff) => [diff.path, diff.oldPath]), [['src/new-name.ts', 'src/old-name.ts']], 'either side of a rename finds it')
  assert.deepEqual(await repo.diffs(base, head, []), [])
})

test('diffs read paths with spaces, tabs and quotes, and lines that look like diff headers', async (t) => {
  const repo = tempRepo(t)
  repo.write('notes/a b.txt', 'one\n')
  repo.write('notes/t\tab "q".txt', 'one\n')
  repo.write('notes/dash.txt', '-- a\n++ b\n')
  const base = repo.commit('Start')
  repo.write('notes/a b.txt', 'two\n')
  repo.write('notes/t\tab "q".txt', 'two\n')
  repo.write('notes/dash.txt', '++ b\n-- c\n')
  const head = repo.commit('Change')

  const diffs = await gitRepo(repo.dir).diffs(base, head)
  assert.deepEqual(diffs.map((diff) => diff.path).sort(), ['notes/a b.txt', 'notes/dash.txt', 'notes/t\tab "q".txt'])
  assert.deepEqual(diffs.find((diff) => diff.path === 'notes/dash.txt')?.hunks[0]?.lines, ['--- a', ' ++ b', '+-- c'])
})

test('text, list and grep answer what the revision holds, never the working tree', async (t) => {
  const { dir, write, base, head } = changedRepo(t)
  const repo = gitRepo(dir)
  write('src/keep.ts', 'export const edited = "in the working tree only"\n')

  assert.equal(await repo.text(head, 'src/keep.ts'), 'export function total(items: number[]) {\n  return items.reduce((sum, item) => sum + item, 0)\n}\n')
  assert.equal(await repo.text(base, 'src/keep.ts'), 'export function total(items: number[]) {\n  return items.length\n}\n')
  assert.equal(await repo.text(head, 'src/gone.ts'), null, 'a file the revision does not have')
  assert.equal(await repo.text(head, 'assets/logo.bin'), null, 'a binary file')
  assert.equal(await repo.text(head, 'src'), null, 'a folder')
  await assert.rejects(repo.text('no-such-revision', 'src/keep.ts'), /no-such-revision/)

  assert.deepEqual(await repo.list(head, 'src'), ['src/added.ts', 'src/keep.ts', 'src/new-name.ts'])
  assert.deepEqual(await repo.list(base, 'src/'), ['src/gone.ts', 'src/keep.ts', 'src/old-name.ts'])
  assert.deepEqual((await repo.list(head, '')).length, 4)

  assert.deepEqual(await repo.grep(head, 'reduce|edited'), [{ path: 'src/keep.ts', line: 2, text: '  return items.reduce((sum, item) => sum + item, 0)' }])
  assert.deepEqual(await repo.grep(base, 'export const (gone|added)'), [{ path: 'src/gone.ts', line: 1, text: 'export const gone = 1' }])
  assert.deepEqual(await repo.grep(head, 'ken', ['src/new-name.ts']), [{ path: 'src/new-name.ts', line: 7, text: "export const ken = 'kenneth'" }])
  assert.deepEqual(await repo.grep(head, 'ken', ['src/keep.ts']), [])
  assert.deepEqual(await repo.grep(head, 'nothing matches this'), [])
})

test('head, resolve, merge base and clean', async (t) => {
  const { dir, git, write, commit, base, head } = changedRepo(t)
  const repo = gitRepo(dir)
  assert.equal(await repo.head(), head)
  assert.equal(await repo.resolve('HEAD~2'), base)
  assert.equal(await repo.resolve('no-such-branch'), null)
  await assert.rejects(repo.resolve('--all'), /option/)
  assert.equal(await repo.clean(), true)

  git('checkout', '--quiet', '-b', 'side', base)
  write('side.txt', 'side\n')
  commit('Side')
  assert.equal(await repo.mergeBase('main', 'side'), base)
  git('checkout', '--quiet', '--orphan', 'alone')
  write('alone.txt', 'alone\n')
  commit('Alone')
  assert.equal(await repo.mergeBase('main', 'alone'), null, 'histories with no commit in common')

  write('untracked.txt', 'new\n')
  assert.equal(await repo.clean(), false, 'an untracked file')
  assert.equal(await repo.clean({ untracked: false }), true, 'no tracked file changed')
  rmSync(join(dir, 'untracked.txt'))
  write('alone.txt', 'edited\n')
  assert.equal(await repo.clean({ untracked: false }), false, 'a tracked file changed')
})

test('a program that outlives its time limit is stopped with everything it started', async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'change-review-run-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const pidFile = join(dir, 'child.pid')
  // The program starts a child that ignores SIGTERM, writes its pid, then waits forever.
  const script = `
    const { spawn } = require('node:child_process')
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", ${JSON.stringify(pidFile)}], { stdio: 'ignore' })
    setInterval(() => {}, 1000)
  `
  const run = await runProgram(process.execPath, ['-e', script], { cwd: dir, timeoutMs: 1_500, graceMs: 200, group: true })

  assert.equal(run.started, true)
  if (!run.started) return
  assert.equal(run.timedOut, true)
  assert.ok(run.code > 128, `a stopped program reports 128 plus its signal, not ${run.code}`)
  const child = Number(readFileSync(pidFile, 'utf8'))
  assert.equal(await gone(child), true, 'the child it started is gone too')
})

/** Whether a process is gone within a second: a killed process can take a moment to be reaped. */
async function gone(pid: number): Promise<boolean> {
  for (let tries = 0; tries < 20; tries++) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

test('a program that cannot start says why and is not a run', async () => {
  const run = await runProgram('/no/such/program', [], { cwd: tmpdir(), timeoutMs: 5_000 })
  assert.equal(run.started, false)
  assert.match(run.started ? '' : run.reason, /ENOENT/)
})

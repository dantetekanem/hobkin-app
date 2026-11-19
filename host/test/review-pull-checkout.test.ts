import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { GhCall } from '../src/review/gh.ts'
import { gitIn, type GitRun } from '../src/review/assessment.ts'
import { ownCloneOf, pullCheckout, pullRefs } from '../src/review/pull-checkout.ts'
import { temporaryDirectory } from './support.ts'

const GITHUB_URL = 'https://github.com/acme/shop.git'
const target = { kind: 'pull' as const, owner: 'acme', repo: 'shop', number: 12 }

const gitAt = (repo: string) => (...args: string[]) =>
  execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()

/**
 * "GitHub" for one repository: a bare repository on disk with `main` and pull request 12's head, as GitHub keeps them.
 * Clones reach it through `url.<path>.insteadOf`, so their remote still reads as github.com and nothing leaves this Mac.
 */
function github(t: TestContext) {
  const dir = temporaryDirectory(t)
  const bare = join(dir, 'shop.git')
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', bare])
  const work = join(dir, 'work')
  mkdirSync(work)
  const git = gitAt(work)
  const write = (path: string, text: string) => {
    mkdirSync(join(work, path, '..'), { recursive: true })
    writeFileSync(join(work, path), text)
  }
  git('init', '--quiet', '--initial-branch=main')
  write('app/models/cart.rb', 'class Cart\n  def total = 1\nend\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  const base = git('rev-parse', 'HEAD')
  git('push', '--quiet', bare, 'main')
  git('checkout', '--quiet', '-b', 'round-the-total')
  write('app/models/cart.rb', 'class Cart\n  def total = 1.round\nend\n')
  git('commit', '--quiet', '-am', 'Round the total')
  const head = git('rev-parse', 'HEAD')
  git('push', '--quiet', bare, `${head}:refs/pull/12/head`)
  /** main moves on after the user cloned, as it does on GitHub. */
  const moveMain = () => {
    git('checkout', '--quiet', 'main')
    write('README.md', 'Shop\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'Readme')
    git('push', '--quiet', bare, 'main')
    return git('rev-parse', 'HEAD')
  }
  return { bare, base, head, moveMain }
}

/** Points a clone's github.com address at the bare repository on disk. */
const throughDisk = (repo: string, bare: string) => gitAt(repo)('config', `url.file://${bare}.insteadOf`, GITHUB_URL)

/** The user's own clone, in the middle of their own work: a branch of theirs, a staged file and an unsaved edit. */
function userClone(folder: string, bare: string) {
  execFileSync('git', ['clone', '--quiet', bare, folder])
  const git = gitAt(folder)
  git('remote', 'set-url', 'origin', GITHUB_URL)
  throughDisk(folder, bare)
  git('checkout', '--quiet', '-b', 'my-own-work')
  writeFileSync(join(folder, 'staged.txt'), 'staged\n')
  git('add', 'staged.txt')
  writeFileSync(join(folder, 'app/models/cart.rb'), 'class Cart\n  # thinking\n  def total = 1\nend\n')
  return git
}

/** Everything of the user's that a fetch could move. */
const userState = (git: ReturnType<typeof gitAt>) => ({
  branch: git('branch', '--show-current'),
  refs: git('for-each-ref', '--format=%(refname) %(objectname)').split('\n').filter((line) => !line.startsWith('refs/hobkin/')),
  staged: git('diff', '--cached', '--name-status'),
  status: git('status', '--porcelain'),
})

/** git as the checkout runs it, with every call written down. */
function recordingGit() {
  const calls: string[][] = []
  const git: GitRun = (cwd, ...args) => {
    calls.push([cwd, ...args])
    return gitIn(cwd, ...args)
  }
  return { git, calls }
}

const noGh: GhCall = async () => {
  throw new Error('gh is not asked when the user has a clone')
}

test("a pull request is fetched into hobkin's own refs in the user's clone beside a project, and nothing of theirs moves", async (t) => {
  const { bare, base, head, moveMain } = github(t)
  const poetry = temporaryDirectory(t)
  // hobkin knows a project in ~/Poetry/notes. The shop is beside it, with a folder that is no repository and one elsewhere.
  mkdirSync(join(poetry, 'notes'))
  mkdirSync(join(poetry, 'drawings'))
  execFileSync('git', ['init', '--quiet', join(poetry, 'elsewhere')])
  gitAt(join(poetry, 'elsewhere'))('remote', 'add', 'origin', 'https://gitlab.com/acme/shop.git')
  const user = userClone(join(poetry, 'shop'), bare)
  const main = moveMain()
  const before = userState(user)

  const said: string[] = []
  const { git, calls } = recordingGit()
  const checkout = pullCheckout({ root: temporaryDirectory(t), folders: () => [join(poetry, 'notes')], gh: noGh, git })
  const fetched = await checkout.fetch(target, { head, baseBranch: 'main' }, (line) => said.push(line))

  assert.deepEqual(fetched, { repo: join(poetry, 'shop'), base })
  const refs = pullRefs(target)
  assert.equal(user('rev-parse', refs.head), head)
  assert.equal(user('rev-parse', refs.base), main, 'the branch it merges into, as GitHub has it now')
  assert.deepEqual(userState(user), before, 'no branch, remote-tracking ref, index or working tree of the user moved')
  assert.equal(existsSync(join(poetry, 'shop', '.git', 'FETCH_HEAD')), false)
  assert.deepEqual(said, [`Using the clone of acme/shop at ${join(poetry, 'shop')}. Only hobkin's own refs change in it.`, 'Fetching #12 and main from GitHub.'])
  const fetch = calls.find((call) => call[1] === 'fetch')!
  assert.deepEqual(fetch.slice(1), ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--refmap=', 'origin', `+refs/pull/12/head:${refs.head}`, `+refs/heads/main:${refs.base}`])

  // The answer is kept: the folders are not looked through again, and a head already here is not fetched again.
  const looked = calls.filter((call) => call[1] === 'config').length
  assert.equal(await checkout.repoFor(target, head), join(poetry, 'shop'))
  assert.equal(calls.filter((call) => call[1] === 'config').length, looked)
  assert.equal(calls.filter((call) => call[1] === 'fetch').length, 1)
})

test('with no clone on this Mac, hobkin makes a blobless one through gh in its own folder, and signs it in through gh', async (t) => {
  const { bare, base, head } = github(t)
  const root = temporaryDirectory(t)
  const asked: { args: readonly string[]; timeoutMs?: number }[] = []
  // gh as it clones: the repository at its address on GitHub, without checking a branch out.
  const gh: GhCall = async (args, _input, options) => {
    asked.push({ args, timeoutMs: options?.timeoutMs })
    const into = args[3]!
    execFileSync('git', ['clone', '--quiet', '--no-checkout', bare, into])
    gitAt(into)('remote', 'set-url', 'origin', GITHUB_URL)
    throughDisk(into, bare)
    return { kind: 'done', stdout: '' }
  }
  const said: string[] = []
  const checkout = pullCheckout({ root, folders: () => [], gh, credentialHelper: '!/opt/homebrew/bin/gh auth git-credential' })
  const fetched = await checkout.fetch(target, { head, baseBranch: 'main' }, (line) => said.push(line))

  const own = ownCloneOf(root, target)
  assert.equal(own, join(root, 'client', 'review-clones', 'acme', 'shop'))
  assert.deepEqual(fetched, { repo: own, base })
  assert.equal(asked.length, 1)
  assert.deepEqual(asked[0]!.args, ['repo', 'clone', 'acme/shop', `${own}.cloning-${process.pid}`, '--', '--filter=blob:none', '--no-checkout'])
  assert.ok((asked[0]!.timeoutMs ?? 0) > 60_000, 'a clone has longer than a quick read of GitHub')
  const helpers = execFileSync('git', ['-C', own, 'config', '--local', '--get-all', 'credential.https://github.com.helper'], { encoding: 'utf8' })
  assert.deepEqual(helpers.replace(/\n$/, '').split('\n'), ['', '!/opt/homebrew/bin/gh auth git-credential'], 'only gh answers for GitHub in this clone')
  assert.equal(gitAt(own)('rev-parse', pullRefs(target).head), head)
  assert.deepEqual(said.slice(0, 1), ['There is no clone of acme/shop on this Mac, so hobkin makes its own. Its files come from GitHub as they are read.'])
  assert.ok(said.includes('Fetching the changed files.'))

  // A later host finds it again without cloning.
  const later = pullCheckout({ root, folders: () => [], gh })
  assert.equal(await later.repoFor(target, head), own)
  assert.equal(asked.length, 1)
})

test('a clone that fails leaves nothing behind and says why; a head GitHub no longer has is refused', async (t) => {
  const { bare, head } = github(t)
  const root = temporaryDirectory(t)
  const gh: GhCall = async (args) => {
    mkdirSync(join(args[3]!, '.git'), { recursive: true })
    return { kind: 'failed', code: 1, stdout: '', stderr: 'GraphQL: Could not resolve to a Repository with the name acme/shop.\n' }
  }
  const failing = pullCheckout({ root, folders: () => [], gh })
  await assert.rejects(failing.fetch(target, { head, baseBranch: 'main' }), /acme\/shop could not be cloned: gh said: GraphQL: Could not resolve to a Repository/)
  assert.deepEqual([existsSync(ownCloneOf(root, target)), existsSync(`${ownCloneOf(root, target)}.cloning-${process.pid}`)], [false, false], 'no half-made clone stays')

  const poetry = temporaryDirectory(t)
  userClone(join(poetry, 'shop'), bare)
  const checkout = pullCheckout({ root, folders: () => [join(poetry, 'shop')], gh: noGh })
  await assert.rejects(checkout.fetch(target, { head: 'f'.repeat(40), baseBranch: 'main' }), /#12 is no longer at fffffff on GitHub: it moved while it was fetched/)
})

test("a pull request on a named code host is fetched from the user's own bare clone through the host's own ref, into refs of that host, moving nothing of theirs", async (t) => {
  const { bare, base, head } = github(t)
  // The user's bare clone of the repository, as the code host file lists it.
  const clone = join(temporaryDirectory(t), 'shop.git')
  execFileSync('git', ['clone', '--quiet', '--bare', bare, clone])
  const before = gitAt(clone)('for-each-ref', '--format=%(refname) %(objectname)')
  const corp = { name: 'corp', web: 'https://git.example.invalid', api: ['corp-api'], git: join(bare, '..', '{repo}.git').replace('shop.git', '{repo}.git'), headRef: 'refs/pull/{number}/head', clones: { 'acme/shop': clone }, checkout: false, merge: false }
  const named = { ...target, host: 'corp' }
  const { git, calls } = recordingGit()
  const checkout = pullCheckout({ root: temporaryDirectory(t), folders: () => [], gh: noGh, git, hostOf: (name) => (name === 'corp' ? corp : undefined) })

  const said: string[] = []
  const fetched = await checkout.fetch(named, { head, baseBranch: 'main', headBranch: 'round-the-total' }, (line) => said.push(line))
  assert.deepEqual(fetched, { repo: clone, base })
  const refs = pullRefs(named)
  assert.deepEqual(refs, { head: 'refs/hobkin/review/corp/pull/12/head', base: 'refs/hobkin/review/corp/pull/12/base' }, 'apart from a GitHub pull request of the same number')
  assert.equal(gitAt(clone)('rev-parse', refs.head), head)
  // Only hobkin's refs were added: every ref of the user's is where it was.
  const after = gitAt(clone)('for-each-ref', '--format=%(refname) %(objectname)').split('\n').filter((line) => !line.startsWith('refs/hobkin/'))
  assert.deepEqual(after, before.split('\n'))
  const fetches = calls.filter((call) => call.includes('fetch'))
  assert.ok(fetches.every((call) => call.includes('--no-write-fetch-head') && call.includes('--refmap=') && call.includes(join(bare, '..', 'shop.git'))), JSON.stringify(fetches))
  assert.ok(said.some((line) => /corp/.test(line)) && !said.some((line) => /GitHub/.test(line)), said.join('\n'))

  // A host the code host file does not name is refused.
  await assert.rejects(checkout.fetch({ ...target, host: 'other' }, { head, baseBranch: 'main' }), /other is not a code host the code host file names/)
})

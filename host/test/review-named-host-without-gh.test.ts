import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { spawnGh } from '../src/review/gh.ts'
import { ownCloneOf, pullRefs } from '../src/review/pull-checkout.ts'
import { hostReviews } from '../src/review/seat.ts'
import { temporaryDirectory } from './support.ts'

const target = { kind: 'pull' as const, host: 'corp', owner: 'acme', repo: 'shop', number: 7 }
const id = 'pr:corp:acme/shop/7'

const gitAt = (repo: string) => (...args: string[]) =>
  execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()

/** The code host's repository acme/shop, bare in `folder`: main at the start, and pull request 7's head one commit over it. */
function hostRepository(folder: string) {
  const work = join(folder, 'work')
  mkdirSync(join(work, 'app'), { recursive: true })
  const git = gitAt(work)
  git('init', '--quiet', '--initial-branch=main')
  writeFileSync(join(work, 'app/cart.rb'), 'class Cart\n  def total = 1\nend\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  const base = git('rev-parse', 'HEAD')

  writeFileSync(join(work, 'app/cart.rb'), 'class Cart\n  def total = 1.round\nend\n')
  git('commit', '--quiet', '-am', 'Round')
  const head = git('rev-parse', 'HEAD')

  const bare = join(folder, 'repos', 'acme', 'shop.git')
  mkdirSync(join(folder, 'repos', 'acme'), { recursive: true })
  execFileSync('git', ['init', '--quiet', '--bare', bare])
  git('push', '--quiet', bare, `${base}:refs/heads/main`, `${head}:refs/pull/7/head`)
  return { base, head }
}

/** A stand-in for the code host's API command: it answers each path from `answers`, and writes down every call. */
function standInApi(folder: string, answers: Record<string, unknown>) {
  const answersFile = join(folder, 'answers.json')
  const callsFile = join(folder, 'calls.jsonl')
  const program = join(folder, 'corp-api')
  writeFileSync(answersFile, JSON.stringify(answers))
  writeFileSync(
    program,
    `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
const method = args[0] === '--method' ? args[1] : 'GET'
const path = args[0] === '--method' ? args[2] : args[0]
const input = fs.readFileSync(0, 'utf8')
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ method, path, input }) + '\\n')
const answer = JSON.parse(fs.readFileSync(${JSON.stringify(answersFile)}, 'utf8'))[path]
if (!answer) {
  process.stderr.write('HTTP 404: ' + path + '\\n')
  process.exit(1)
}
process.stdout.write(JSON.stringify(answer))
`,
  )
  chmodSync(program, 0o755)

  const calls = () => {
    if (!existsSync(callsFile)) return []
    return readFileSync(callsFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { method: string; path: string; input: string })
  }
  return { program, calls }
}

/** A named code host on this Mac, as the code host file names it: its repository on disk and its API command a stand-in. */
function namedHost(t: TestContext) {
  const folder = temporaryDirectory(t)
  const { base, head } = hostRepository(folder)
  const api = standInApi(folder, {
    'repos/acme/shop/pulls/7': {
      state: 'open',
      title: 'Round the total',
      body: 'Rounds it.',
      base: { ref: 'main', sha: base },
      head: { ref: 'round', sha: head },
      user: { login: 'someone' },
    },
    'repos/acme/shop/pulls/7/reviews': { html_url: 'https://git.example.invalid/acme/shop/pull/7#review-1' },
    user: { login: 'me' },
  })
  const host = {
    name: 'corp',
    web: 'https://git.example.invalid',
    api: [api.program],
    git: join(folder, 'repos', '{owner}', '{repo}.git'),
    // A host that allows no checkout gets no AI review and no call-graph scan, so the live seat starts neither.
    checkout: false,
  }
  return { host, base, head, apiCalls: api.calls }
}

/** A live host's review seat on a Mac with no gh, whose home names the code host in its code host file. */
function liveSeatWithoutGh(t: TestContext, host: object) {
  const root = temporaryDirectory(t)
  const data = temporaryDirectory(t)
  mkdirSync(join(data, 'client'), { recursive: true })
  writeFileSync(join(data, 'client', 'code-hosts.json'), JSON.stringify({ hosts: [host] }))
  const reviews = hostReviews({
    root,
    live: true,
    data: () => data,
    work: () => null,
    app: () => ({ workAction: async () => ({}) }),
    runtime: async () => undefined,
    // What main.ts hands a live host whatever the Mac has: spawnGh(), which on a Mac with no gh answers that it is missing.
    gh: spawnGh({ file: null }),
  })
  t.after(() => reviews.close())
  return { root, reviews }
}

test("a live host on a Mac with no gh still checks out a named host's pull request, reads it, and posts its verdict through that host", async (t) => {
  const { host, base, head, apiCalls } = namedHost(t)
  const { root, reviews } = liveSeatWithoutGh(t, host)

  reviews.prepare(id, { asked: true })
  await reviews.settled(id)
  assert.equal(reviews.status(id).state, 'ready', reviews.status(id).error ?? 'no error said')
  const { review } = reviews.get(id)
  assert.deepEqual([review.change.title, review.change.base, review.change.head], ['Round the total', base, head], 'read through the named host, not the sample change')
  const clone = ownCloneOf(root, target)
  assert.equal(gitAt(clone)('rev-parse', pullRefs(target).head), head, "checked out in hobkin's own clone, with git from the host's git address")

  const preview = await reviews.preview(id, 'comment', 'Reads well.', head)
  await reviews.verdict(id, 'comment', 'Reads well.', preview.confirm, head)
  const posted = apiCalls().filter((call) => call.method !== 'GET')
  assert.deepEqual(posted.map((call) => [call.method, call.path]), [['POST', 'repos/acme/shop/pulls/7/reviews']], 'the verdict went through the named host')
})

test('a live host on a Mac with no gh reads no GitHub pull request, and says gh is missing', async (t) => {
  const { host } = namedHost(t)
  const { reviews } = liveSeatWithoutGh(t, host)
  const github = 'pr:acme/shop/8'

  reviews.prepare(github, { asked: true })
  await reviews.settled(github)
  assert.equal(reviews.status(github).state, 'failed')
  assert.match(reviews.status(github).error ?? '', /gh is not installed/)
})

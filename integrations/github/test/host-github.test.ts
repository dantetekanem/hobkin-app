import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { GitHubPull } from '#shared/protocol/github.ts'
import { findGh, type GhOutcome } from '#host/review/gh.ts'
import { temporaryDirectory } from '../../../host/test/support.ts'
import { execGh, GH_ARGS, GH_QUERY, ghSource, readAnswer } from '../host/gh.ts'
import { GITHUB_EVERY_MS, GitHub, type GitHubRead, type GitHubSource } from '../host/github.ts'
import { sampleGitHubSource } from '../host/sample.ts'

/** A token in the shape gh stores. It must never reach the state or the log. */
const TOKEN = 'gho_FAKEtoken0123456789abcdefghijklmnopq'

const rollup = (state: string | null) => ({ nodes: [{ commit: { statusCheckRollup: state === null ? null : { state } } }] })

/** A pull request as gh's answer has it, with only what a test changes given. */
function pullNode(number: number, rest: Record<string, unknown> = {}) {
  return {
    number,
    title: `Pull ${number}`,
    url: `https://github.com/octo/app/pull/${number}`,
    updatedAt: '2026-11-09T10:00:00Z',
    isDraft: false,
    reviewDecision: null,
    repository: { nameWithOwner: 'octo/app' },
    author: { login: 'mira' },
    labels: { nodes: [] },
    latestReviews: { nodes: [] },
    reviewRequests: { totalCount: 0 },
    commits: rollup(null),
    ...rest,
  }
}

function issueNode(number: number, updatedAt: string, rest: Record<string, unknown> = {}) {
  return { number, title: `Issue ${number}`, url: `https://github.com/octo/app/issues/${number}`, updatedAt, repository: { nameWithOwner: 'octo/app' }, labels: { nodes: [] }, ...rest }
}

interface AnswerParts {
  reviews?: unknown[]
  pulls?: unknown[]
  assigned?: unknown[]
  authored?: unknown[]
  counts?: Partial<Record<'reviews' | 'pulls' | 'assigned' | 'authored', number>>
  errors?: unknown[]
}

/** gh's answer to the read, as `gh api graphql` prints it. */
function answer({ reviews = [], pulls = [], assigned = [], authored = [], counts = {}, errors }: AnswerParts = {}): string {
  const search = (nodes: unknown[], count = nodes.length) => ({ issueCount: count, nodes })
  return JSON.stringify({
    data: {
      viewer: { login: 'octocat' },
      reviews: search(reviews, counts.reviews),
      pulls: search(pulls, counts.pulls),
      assigned: search(assigned, counts.assigned),
      authored: search(authored, counts.authored),
    },
    ...(errors ? { errors } : {}),
  })
}

/** The read, which must have found gh signed in. */
function connected(read: GitHubRead): Extract<GitHubRead, { found: 'connected' }> {
  if (read.found !== 'connected') assert.fail(`expected a connected read, got ${JSON.stringify(read)}`)
  return read
}

test('reads the three lists from one gh answer', () => {
  const stdout = answer({
    // A node GitHub left empty, and one it hid, stand among the real ones.
    reviews: [pullNode(7, { reviewRequests: { totalCount: 1 }, commits: rollup('SUCCESS'), labels: { nodes: [{ name: 'docs' }, null] }, additions: 64, deletions: 12, changedFiles: 3 }), {}, null],
    pulls: [pullNode(3, { reviewDecision: 'APPROVED', commits: rollup('SUCCESS'), author: { login: 'octocat' } }), pullNode(4, { isDraft: true, author: null })],
    // Issue 11 is both assigned to the user and opened by them.
    assigned: [issueNode(10, '2026-11-08T09:00:00Z', { labels: { nodes: [{ name: 'bug' }] } }), issueNode(11, '2026-11-09T09:00:00Z'), null],
    authored: [issueNode(11, '2026-11-09T09:00:00Z'), issueNode(12, '2026-11-09T12:00:00Z')],
    counts: { pulls: 120 },
  })

  const read = connected(readAnswer(stdout))

  assert.equal(read.login, 'octocat')
  const expected: GitHubPull = {
    repo: 'octo/app',
    number: 7,
    title: 'Pull 7',
    labels: ['docs'],
    updatedAt: '2026-11-09T10:00:00Z',
    url: 'https://github.com/octo/app/pull/7',
    draft: false,
    author: 'mira',
    review: 'waiting',
    checks: 'passing',
    additions: 64,
    deletions: 12,
    changedFiles: 3,
  }
  assert.deepEqual(read.lists.reviews, [expected], 'a node GitHub left empty or hid is skipped')
  assert.deepEqual(Object.keys(read.lists.pulls[0]!).filter((key) => ['additions', 'deletions', 'changedFiles'].includes(key)), [], 'a size GitHub did not send is left out')
  assert.deepEqual(
    read.lists.pulls.map(({ number, draft, author, review, checks }) => ({ number, draft, author, review, checks })),
    [
      { number: 3, draft: false, author: 'octocat', review: 'approved', checks: 'passing' },
      { number: 4, draft: true, author: null, review: 'none', checks: 'none' },
    ],
  )
  // An issue both assigned to the user and opened by them is listed once, with both said. The most recently updated come first.
  assert.deepEqual(
    read.lists.issues.map(({ number, assigned, authored, labels }) => ({ number, assigned, authored, labels })),
    [
      { number: 12, assigned: false, authored: true, labels: [] },
      { number: 11, assigned: true, authored: true, labels: [] },
      { number: 10, assigned: true, authored: false, labels: ['bug'] },
    ],
  )
  assert.deepEqual(read.lists.more, { reviews: false, pulls: true, issues: false }, 'GitHub found 120 pull requests and sent two')
  assert.equal(read.note, null)
})

test("a pull request's head commit, when it was opened and when its head was committed come from the same read, each only when GitHub sent it whole", () => {
  const head = 'a'.repeat(40)
  const commits = (committedDate: unknown) => ({ nodes: [{ commit: { committedDate, statusCheckRollup: { state: 'SUCCESS' } } }] })
  const stdout = answer({
    pulls: [
      pullNode(3, { headRefOid: head, createdAt: '2026-11-01T09:00:00Z', commits: commits('2026-11-08T10:00:00Z') }),
      // Not a commit, not a time: left out, and the rest of the row is read as before.
      pullNode(4, { headRefOid: 'main', createdAt: 'yesterday', commits: commits(7) }),
      // A cached answer from before these were asked for.
      pullNode(5),
    ],
  })

  const pulls = connected(readAnswer(stdout)).lists.pulls

  assert.deepEqual(
    pulls.map(({ number, head, openedAt, pushedAt, checks }) => ({ number, head, openedAt, pushedAt, checks })),
    [
      { number: 3, head, openedAt: '2026-11-01T09:00:00Z', pushedAt: '2026-11-08T10:00:00Z', checks: 'passing' },
      { number: 4, head: undefined, openedAt: undefined, pushedAt: undefined, checks: 'passing' },
      { number: 5, head: undefined, openedAt: undefined, pushedAt: undefined, checks: 'none' },
    ],
  )
  assert.deepEqual(Object.keys(pulls[2]!).filter((key) => ['head', 'openedAt', 'pushedAt'].includes(key)), [], 'none sent, none kept')
  // Still the one fixed read: the same searches, each asking for these as well.
  assert.match(GH_QUERY, /fragment pull on PullRequest \{\n  number title url updatedAt state createdAt headRefOid /)
  assert.match(GH_QUERY, /commits\(last: 1\) \{ nodes \{ commit \{ committedDate statusCheckRollup \{ state \} \} \} \}/)
  assert.equal(GH_QUERY.match(/search\(/g)?.length, 4)
})

test('a review and its checks read as one of a few plain states', () => {
  const cases: [Record<string, unknown>, GitHubPull['review'], GitHubPull['checks']][] = [
    [{ reviewDecision: 'APPROVED', commits: rollup('SUCCESS') }, 'approved', 'passing'],
    [{ reviewDecision: 'CHANGES_REQUESTED', commits: rollup('FAILURE') }, 'changes-requested', 'failing'],
    [{ reviewDecision: 'REVIEW_REQUIRED', commits: rollup('ERROR') }, 'waiting', 'failing'],
    // Without a required review, the latest review of each reviewer decides, and changes asked for outweigh an approval.
    [{ latestReviews: { nodes: [{ state: 'APPROVED' }, { state: 'CHANGES_REQUESTED' }] }, commits: rollup('PENDING') }, 'changes-requested', 'pending'],
    [{ latestReviews: { nodes: [{ state: 'COMMENTED' }, { state: 'APPROVED' }] }, commits: rollup('EXPECTED') }, 'approved', 'pending'],
    [{ reviewRequests: { totalCount: 2 } }, 'waiting', 'none'],
    [{ latestReviews: { nodes: [{ state: 'COMMENTED' }] }, commits: { nodes: [] } }, 'none', 'none'],
  ]
  for (const [node, review, checks] of cases) {
    const [pull] = connected(readAnswer(answer({ pulls: [pullNode(1, node)] }))).lists.pulls
    assert.deepEqual({ review: pull?.review, checks: pull?.checks }, { review, checks }, JSON.stringify(node))
  }
})

test('an answer that comes with errors keeps what GitHub sent and says what it left out', () => {
  const saml = { type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement.' }
  const read = connected(readAnswer(answer({ pulls: [pullNode(3)], errors: [saml] })))
  assert.equal(read.lists.pulls.length, 1)
  assert.match(read.note ?? '', /SAML enforcement/)

  const nothing = readAnswer(JSON.stringify({ data: null, errors: [{ message: 'Something went wrong while executing your query.' }] }))
  assert.deepEqual(nothing, { found: 'failed', message: 'GitHub could not answer: Something went wrong while executing your query.' })
  assert.equal(readAnswer('<html>').found, 'failed')
})

test('gh runs only the fixed read, and how it ends becomes the connection', async () => {
  const calls: string[][] = []
  /** What the source reads when gh ends the way the test says. */
  const readAfter = (outcome: GhOutcome) =>
    ghSource(async (args) => {
      calls.push([...args])
      return outcome
    }).read()
  const failed = (code: number, stderr: string, stdout = ''): GhOutcome => ({ kind: 'failed', code, stdout, stderr })

  // A signed-in gh answers the one fixed read, and nothing else is ever run.
  const read = await readAfter({ kind: 'done', stdout: answer() })
  assert.equal(connected(read).login, 'octocat')
  assert.deepEqual(calls, [[...GH_ARGS]])
  assert.deepEqual(GH_ARGS.slice(0, 5), ['api', 'graphql', '--hostname', 'github.com', '-f'])
  assert.ok(!calls.flat().some((arg) => arg === 'auth' || arg === 'token'), 'never gh auth token')
  assert.doesNotMatch(GH_QUERY, /\bmutation\b/, 'the query only reads')

  // gh missing, gh not signed in (its exit code 4), and a sign-in GitHub refuses.
  assert.deepEqual(await readAfter({ kind: 'missing' }), { found: 'missing' })
  assert.deepEqual(await readAfter(failed(4, 'To get started with GitHub CLI, please run:  gh auth login')), { found: 'signed-out', message: null })
  const refused = await readAfter(failed(1, 'HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login'))
  assert.deepEqual(refused, { found: 'signed-out', message: 'GitHub no longer accepts the sign-in gh has.' })

  // A read that does not get through says why, with gh's own words on one line.
  const slow = await readAfter({ kind: 'timeout', ms: 20000 })
  assert.deepEqual(slow, { found: 'failed', message: 'GitHub did not answer within 20 seconds.' })
  const offline = await readAfter(failed(1, 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n'))
  assert.deepEqual(offline, { found: 'failed', message: 'gh could not read GitHub: error connecting to api.github.com. check your internet connection or https://githubstatus.com' })

  // A partial answer still counts: gh ends with an error when GitHub's answer carries one.
  const partialAnswer = answer({ pulls: [pullNode(5)], errors: [{ message: 'Resource protected by organization SAML enforcement.' }] })
  const partial = await readAfter(failed(1, 'gh: Resource protected', partialAnswer))
  assert.equal(connected(partial).lists.pulls.length, 1)
})

test('nothing shaped like a token reaches what gh said', async () => {
  const stderr = `HTTP 403: token ${TOKEN} has no access, Authorization: Bearer ${TOKEN}`

  const said = await ghSource(async () => ({ kind: 'failed', code: 1, stdout: '', stderr })).read()

  assert.equal(said.found, 'failed')
  const shown = JSON.stringify(said)
  assert.ok(!shown.includes(TOKEN) && !shown.includes('FAKEtoken'), shown)
})

/** A source whose reads the test answers by hand. */
function handSource() {
  const waiting: ((read: GitHubRead) => void)[] = []
  let reads = 0
  const source: GitHubSource = {
    sample: false,
    read: () => {
      reads += 1
      return new Promise((resolve) => waiting.push(resolve))
    },
  }
  return { source, reads: () => reads, answer: (read: GitHubRead) => waiting.shift()?.(read) }
}

const lists = (count: number) => connected(readAnswer(answer({ pulls: Array.from({ length: count }, (_, index) => pullNode(index + 1)) }))).lists

test('there is never more than one read at a time', async () => {
  const hand = handSource()
  let changes = 0
  const github = new GitHub({ source: hand.source, onChange: () => (changes += 1) })

  const first = github.refresh()
  const second = github.refresh()
  assert.equal(hand.reads(), 1, 'the second refresh waits for the read under way')
  assert.equal(github.state.refreshing, true)
  assert.ok(changes >= 1, 'the UI hears that a read started')

  hand.answer({ found: 'connected', login: 'octocat', lists: lists(2), note: null })
  const [one, two] = await Promise.all([first, second])
  assert.equal(one, two)
  assert.equal(one.refreshing, false)
  assert.equal(one.connection, 'connected')
  assert.equal(one.pulls.length, 2)
  assert.ok(one.refreshedAt)

  // Once it has ended, the next refresh reads again.
  const third = github.refresh()
  assert.equal(hand.reads(), 2)
  hand.answer({ found: 'connected', login: 'octocat', lists: lists(3), note: null })
  assert.equal((await third).pulls.length, 3)
})

test('a failed read keeps what was read before and says what went wrong', async () => {
  const hand = handSource()
  const logged: string[] = []
  const github = new GitHub({ source: hand.source, onChange: () => {}, log: (line) => logged.push(line) })
  const read = (found: GitHubRead) => {
    const done = github.refresh()
    hand.answer(found)
    return done
  }

  const before = await read({ found: 'connected', login: 'octocat', lists: lists(2), note: null })
  const failed = await read({ found: 'failed', message: 'GitHub did not answer within 20 seconds.' })
  assert.equal(failed.connection, 'connected')
  assert.equal(failed.login, 'octocat')
  assert.equal(failed.pulls.length, 2)
  assert.equal(failed.refreshedAt, before.refreshedAt, 'the lists are as old as they were')
  assert.equal(failed.error, 'GitHub did not answer within 20 seconds.')
  assert.match(logged.join('\n'), /did not answer/)

  assert.equal((await read({ found: 'connected', login: 'octocat', lists: lists(1), note: null })).error, null, 'a read that works clears the message')

  const out = await read({ found: 'signed-out', message: null })
  assert.deepEqual({ connection: out.connection, login: out.login, pulls: out.pulls, error: out.error }, { connection: 'signed-out', login: null, pulls: [], error: null })
  const missing = await read({ found: 'missing' })
  assert.equal(missing.connection, 'missing')

  // A source that throws is a failed read too, in words without a token.
  const throwing = new GitHub({ source: { sample: false, read: async () => Promise.reject(Error(`boom ${TOKEN}`)) }, onChange: () => {}, log: (line) => logged.push(line) })
  const thrown = await throwing.refresh()
  assert.equal(thrown.connection, 'unknown')
  assert.match(thrown.error ?? '', /boom/)
  assert.ok(![thrown.error, ...logged].join('\n').includes(TOKEN), 'no token in the state or the log')
})

test('it reads again on a gentle timer, only while someone is looking', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let reads = 0
  let looking = true
  const source: GitHubSource = {
    sample: false,
    read: async () => {
      reads += 1
      return { found: 'connected', login: 'octocat', lists: lists(1), note: null }
    },
  }
  const github = new GitHub({ source, onChange: () => {}, wanted: () => looking })
  github.start()
  await github.refresh()
  assert.equal(reads, 1, 'it reads once when it starts')

  t.mock.timers.tick(GITHUB_EVERY_MS - 1)
  assert.equal(reads, 1)
  t.mock.timers.tick(1)
  assert.equal(reads, 2, 'a minute later it reads again')
  await github.refresh()
  assert.equal(reads, 2, 'a refresh during that read waits for it')

  looking = false
  t.mock.timers.tick(GITHUB_EVERY_MS)
  assert.equal(reads, 2, 'with nobody looking, the timer leaves GitHub alone')

  github.close()
  looking = true
  t.mock.timers.tick(GITHUB_EVERY_MS * 3)
  assert.equal(reads, 2, 'closed, it reads no more')
  assert.equal((await github.refresh()).refreshing, false)
  assert.equal(reads, 2)
})

test('the sample source makes data up and says so', async () => {
  const source = sampleGitHubSource({ delayMs: 0, now: () => Date.parse('2026-11-10T09:00:00Z') })
  assert.equal(source.sample, true)
  const first = connected(await source.read())
  const second = connected(await source.read())
  assert.equal(first.login, 'sample-user')
  assert.ok(first.lists.reviews.length > 0 && first.lists.pulls.length > 0 && first.lists.issues.length > 0)
  assert.ok([...first.lists.pulls, ...first.lists.reviews, ...first.lists.issues].every(({ url }) => url.startsWith('https://github.com/hobkin-sample/')))
  assert.equal(second.lists.reviews.length, first.lists.reviews.length + 1, 'every second read brings one more review request')

  const github = new GitHub({ source, onChange: () => {} })
  assert.equal(github.state.sample, true)
  assert.equal((await github.refresh()).sample, true)
})

/** A stand-in for gh: a shell script that does what the test says. */
function fakeGh(t: Parameters<typeof temporaryDirectory>[0], script: string): string {
  const bin = join(temporaryDirectory(t), 'bin')
  mkdirSync(bin)
  const file = join(bin, 'gh')
  writeFileSync(file, `#!/bin/sh\n${script}\n`)
  chmodSync(file, 0o755)
  return file
}

test('gh runs as its own program, with a time limit', { timeout: 15000 }, async (t) => {
  const answerFile = join(temporaryDirectory(t), 'answer.json')
  writeFileSync(answerFile, answer({ pulls: [pullNode(9)] }))
  const done = await execGh({ file: fakeGh(t, `cat '${answerFile}'`) })(GH_ARGS)
  assert.equal(done.kind, 'done')
  assert.equal(connected(readAnswer(done.kind === 'done' ? done.stdout : '')).lists.pulls[0]?.number, 9)

  const out = await execGh({ file: fakeGh(t, 'echo "To get started with GitHub CLI, please run:  gh auth login" >&2\nexit 4') })(GH_ARGS)
  assert.deepEqual(out.kind === 'failed' && { code: out.code, stderr: out.stderr.trim() }, { code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login' })

  const started = Date.now()
  const hung = await execGh({ file: fakeGh(t, 'exec sleep 5'), timeoutMs: 300 })(GH_ARGS)
  assert.deepEqual(hung, { kind: 'timeout', ms: 300 })
  assert.ok(Date.now() - started < 3000, 'a gh that hangs is stopped')

  assert.deepEqual(await execGh({ file: join(temporaryDirectory(t), 'no-gh-here') })(GH_ARGS), { kind: 'missing' })
  assert.deepEqual(await execGh({ file: null })(GH_ARGS), { kind: 'missing' })
})

test('gh is found on the PATH, or where Homebrew puts it when the PATH is short', (t) => {
  const file = fakeGh(t, 'exit 0')
  const bin = join(file, '..')
  const empty = temporaryDirectory(t)
  assert.equal(findGh({ path: `${empty}:${bin}`, places: [] }), file)
  assert.equal(findGh({ path: empty, places: [bin] }), file, 'an app opened from the Finder has a short PATH')
  assert.equal(findGh({ path: empty, places: [] }), null)
  // A file that cannot run does not count.
  const plain = join(empty, 'gh')
  writeFileSync(plain, 'not a program')
  assert.equal(findGh({ path: empty, places: [] }), null)
})

test('a pull request or an issue GitHub still lists but says is no longer open is left out', () => {
  // GitHub's search can go on listing what just merged for a moment. What it says of each one is believed over the list it came in.
  const read = connected(
    readAnswer(
      answer({
        pulls: [pullNode(3, { state: 'OPEN' }), pullNode(4, { state: 'MERGED' }), pullNode(5, { state: 'CLOSED' }), pullNode(6)],
        assigned: [issueNode(10, '2026-11-08T09:00:00Z', { state: 'CLOSED' }), issueNode(11, '2026-11-09T09:00:00Z', { state: 'OPEN' })],
      }),
    ),
  )
  assert.deepEqual(read.lists.pulls.map((pull) => pull.number), [3, 6], 'an older answer with no state reads as before')
  assert.deepEqual(read.lists.issues.map((issue) => issue.number), [11])
  assert.match(GH_QUERY, /fragment pull on PullRequest \{\n {2}number title url updatedAt state /)
})

test('what the host hears has merged leaves the lists at once, and GitHub is read again now and a little later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let reads = 0
  const read = connected(readAnswer(answer({ pulls: [pullNode(3), pullNode(4)] }))).lists
  const source: GitHubSource = {
    sample: false,
    read: async () => {
      reads += 1
      // GitHub's search still lists the merged one on the first read after it.
      return { found: 'connected', login: 'octocat', lists: read, note: null }
    },
  }
  const changes: number[] = []
  const github = new GitHub({ source, onChange: () => changes.push(github.state.pulls.length) })
  await github.refresh()
  assert.equal(github.state.pulls.length, 2)

  github.closed({ repo: 'octo/app', number: 4 })
  assert.deepEqual(github.state.pulls.map((pull) => pull.number), [3], 'gone before GitHub is asked again')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(github.state.pulls.map((pull) => pull.number), [3], 'and it stays gone when GitHub still lists it a moment later')
  const after = reads
  t.mock.timers.tick(10_000)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(reads, after + 1, 'read once more a little later')
  // By its address too, as a finished change knows its pull request.
  github.closed({ url: 'https://github.com/octo/app/pull/3' })
  assert.deepEqual(github.state.pulls, [])
  github.close()
})

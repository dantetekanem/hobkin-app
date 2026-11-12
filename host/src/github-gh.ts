import { execFile } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { GITHUB_LIMIT, type ChecksState, type GitHubIssue, type GitHubPull, type ReviewState } from '#shared/protocol/github.ts'
import { plainWords, type GitHubRead, type GitHubSource } from './github.ts'

/**
 * Reading GitHub through gh, GitHub's command line tool, with the login gh already has. One fixed GraphQL query reads
 * everything the GitHub page shows. Only `gh api graphql` with that query ever runs: never a write, and never
 * `gh auth token`. gh keeps its token to itself, so nothing here ever holds it.
 */

const search = (name: string, query: string, fragment: 'pull' | 'issue') =>
  `  ${name}: search(type: ISSUE, first: ${GITHUB_LIMIT}, query: "${query} archived:false sort:updated-desc") { issueCount nodes { ...${fragment} } }`

/** The one read. Each search is the same as GitHub's own on github.com. */
export const GH_QUERY = [
  'query HobkinGitHub {',
  '  viewer { login }',
  search('reviews', 'is:pr is:open review-requested:@me', 'pull'),
  search('pulls', 'is:pr is:open author:@me', 'pull'),
  search('assigned', 'is:issue is:open assignee:@me', 'issue'),
  search('authored', 'is:issue is:open author:@me', 'issue'),
  '}',
  'fragment pull on PullRequest {',
  '  number title url updatedAt isDraft reviewDecision additions deletions changedFiles',
  '  repository { nameWithOwner }',
  '  author { login }',
  '  labels(first: 10) { nodes { name } }',
  '  latestReviews(first: 20) { nodes { state } }',
  '  reviewRequests(first: 1) { totalCount }',
  '  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }',
  '}',
  'fragment issue on Issue {',
  '  number title url updatedAt',
  '  repository { nameWithOwner }',
  '  labels(first: 10) { nodes { name } }',
  '}',
].join('\n')

/** The whole command line after `gh`. Nothing in it comes from outside. */
export const GH_ARGS: readonly string[] = ['api', 'graphql', '--hostname', 'github.com', '-f', `query=${GH_QUERY}`]

export const GH_TIMEOUT_MS = 20_000

/** How one run of gh ended. */
export type GhOutcome =
  | { kind: 'done'; stdout: string }
  | { kind: 'missing' }
  | { kind: 'timeout'; ms: number }
  | { kind: 'failed'; code: number | null; stdout: string; stderr: string }

export type GhRunner = (args: readonly string[]) => Promise<GhOutcome>

/** Where Homebrew puts gh. An app opened from the Finder gets a PATH without them. */
export const GH_PLACES: readonly string[] = ['/opt/homebrew/bin', '/usr/local/bin']

/** The gh program to run: the first one on the PATH, then in Homebrew's folders. Null when there is none. */
export function findGh({ path = process.env.PATH ?? '', places = GH_PLACES }: { path?: string; places?: readonly string[] } = {}): string | null {
  for (const folder of [...path.split(delimiter), ...places]) {
    if (!folder) continue
    const file = join(folder, 'gh')
    try {
      accessSync(file, constants.X_OK)
      if (statSync(file).isFile()) return file
    } catch {
      // Not here.
    }
  }
  return null
}

/** gh never asks anything, never shows a spinner or colors, and never says it has an update. */
const QUIET = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1', CLICOLOR: '0' }

/**
 * Runs gh as a program of its own, never through a shell, and stops it when it takes too long. Without `file` it is
 * looked for on every run, so a gh installed while the app is open is found.
 */
export function execGh({ file, timeoutMs = GH_TIMEOUT_MS }: { file?: string | null; timeoutMs?: number } = {}): GhRunner {
  return (args) =>
    new Promise((resolve) => {
      const program = file === undefined ? findGh() : file
      if (!program) return resolve({ kind: 'missing' })
      execFile(program, [...args], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...QUIET }, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (!error) return resolve({ kind: 'done', stdout })

        const { code, killed, signal } = error
        if (code === 'ENOENT') return resolve({ kind: 'missing' })
        if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve({ kind: 'failed', code: null, stdout: '', stderr: "gh's answer was larger than expected." })
        if (killed && signal) return resolve({ kind: 'timeout', ms: timeoutMs })
        resolve({ kind: 'failed', code: typeof code === 'number' ? code : null, stdout, stderr: stderr || error.message })
      })
    })
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** The value at a path of keys, or undefined where the path breaks. */
function at(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((node, key) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), value)
}

const nodesOf = (connection: unknown): unknown[] => {
  const nodes = at(connection, 'nodes')
  return Array.isArray(nodes) ? nodes : []
}

/** What every row has. A node GitHub left empty or hid, as it does for an organization that needs a sign-in of its own, is null. */
function rowOf(node: unknown): Omit<GitHubIssue, 'assigned' | 'authored'> | null {
  const number = at(node, 'number')
  const title = text(at(node, 'title'))
  const url = text(at(node, 'url'))
  const updatedAt = text(at(node, 'updatedAt'))
  const repo = text(at(node, 'repository', 'nameWithOwner'))
  if (typeof number !== 'number' || !title || !url?.startsWith('https://github.com/') || !updatedAt || !repo) return null
  const labels = nodesOf(at(node, 'labels'))
    .map((label) => text(at(label, 'name')))
    .filter((name): name is string => name !== null)
  return { repo, number, title, labels, updatedAt, url }
}

function reviewOf(node: unknown): ReviewState {
  switch (at(node, 'reviewDecision')) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes-requested'
    case 'REVIEW_REQUIRED':
      return 'waiting'
  }
  // No review is required, so the latest review of each reviewer says it. Changes asked for outweigh an approval.
  const states = nodesOf(at(node, 'latestReviews')).map((review) => at(review, 'state'))
  if (states.includes('CHANGES_REQUESTED')) return 'changes-requested'
  if (states.includes('APPROVED')) return 'approved'
  const asked = at(node, 'reviewRequests', 'totalCount')
  return typeof asked === 'number' && asked > 0 ? 'waiting' : 'none'
}

function checksOf(node: unknown): ChecksState {
  switch (at(nodesOf(at(node, 'commits'))[0], 'commit', 'statusCheckRollup', 'state')) {
    case 'SUCCESS':
      return 'passing'
    case 'FAILURE':
    case 'ERROR':
      return 'failing'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'none'
  }
}

/** Lines added and removed, and files changed, when GitHub sent all three. */
function sizeOf(node: unknown): Pick<GitHubPull, 'additions' | 'deletions' | 'changedFiles'> {
  const [additions, deletions, changedFiles] = ['additions', 'deletions', 'changedFiles'].map((key) => at(node, key))
  const counted = [additions, deletions, changedFiles].every((count) => Number.isInteger(count) && (count as number) >= 0)
  return counted ? { additions: additions as number, deletions: deletions as number, changedFiles: changedFiles as number } : {}
}

function pullOf(node: unknown): GitHubPull | null {
  const row = rowOf(node)
  if (!row) return null
  return { ...row, draft: at(node, 'isDraft') === true, author: text(at(node, 'author', 'login')), review: reviewOf(node), checks: checksOf(node), ...sizeOf(node) }
}

const newestFirst = <Row extends { updatedAt: string }>(rows: Row[]): Row[] => [...rows].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

/** Issues assigned to the user and issues they opened, each once, with both said. */
function issuesOf(assigned: unknown[], authored: unknown[]): GitHubIssue[] {
  const byUrl = new Map<string, GitHubIssue>()
  const add = (nodes: unknown[], why: 'assigned' | 'authored') => {
    for (const node of nodes) {
      const row = rowOf(node)
      if (row) byUrl.set(row.url, { ...(byUrl.get(row.url) ?? { ...row, assigned: false, authored: false }), [why]: true })
    }
  }
  add(assigned, 'assigned')
  add(authored, 'authored')
  return newestFirst([...byUrl.values()])
}

/** The first error GitHub's answer carries, in plain words. */
function firstError(answer: unknown): string | null {
  const errors = at(answer, 'errors')
  const message = Array.isArray(errors) ? text(at(errors[0], 'message')) : null
  return message ? plainWords(message) : null
}

/** What `gh api graphql` printed for the read. */
export function readAnswer(stdout: string): GitHubRead {
  let answer: unknown
  try {
    answer = JSON.parse(stdout)
  } catch {
    return { found: 'failed', message: 'gh answered with something that is not JSON.' }
  }
  const problem = firstError(answer)
  const data = at(answer, 'data')
  const login = text(at(data, 'viewer', 'login'))
  if (!login) return { found: 'failed', message: problem ? `GitHub could not answer: ${problem}` : 'GitHub sent no data.' }

  /** One of the query's searches: the nodes it sent, and how many GitHub found in all. */
  const searchOf = (name: string) => ({ nodes: nodesOf(at(data, name)), count: at(data, name, 'issueCount') })
  const reviews = searchOf('reviews')
  const pulls = searchOf('pulls')
  const assigned = searchOf('assigned')
  const authored = searchOf('authored')

  const more = ({ nodes, count }: { nodes: unknown[]; count: unknown }) => typeof count === 'number' && count > nodes.length
  const pullsOf = (nodes: unknown[]) => newestFirst(nodes.map(pullOf).filter((pull): pull is GitHubPull => pull !== null))

  return {
    found: 'connected',
    login,
    lists: {
      reviews: pullsOf(reviews.nodes),
      pulls: pullsOf(pulls.nodes),
      issues: issuesOf(assigned.nodes, authored.nodes),
      more: { reviews: more(reviews), pulls: more(pulls), issues: more(assigned) || more(authored) },
    },
    note: problem ? `GitHub left some results out: ${problem}` : null,
  }
}

function readOf(outcome: GhOutcome): GitHubRead {
  switch (outcome.kind) {
    case 'missing':
      return { found: 'missing' }
    case 'timeout':
      return { found: 'failed', message: `GitHub did not answer within ${Math.round(outcome.ms / 1000)} seconds.` }
    case 'done':
      return readAnswer(outcome.stdout)
    case 'failed': {
      // gh's own exit code for a command that needs a sign-in it does not have.
      if (outcome.code === 4) return { found: 'signed-out', message: null }
      if (/HTTP 401|Bad credentials/i.test(outcome.stderr)) return { found: 'signed-out', message: 'GitHub no longer accepts the sign-in gh has.' }
      // GitHub sent data and an error with it, and gh ended on the error. What it sent still counts.
      const partial = outcome.stdout.trim() ? readAnswer(outcome.stdout) : null
      if (partial?.found === 'connected') return partial
      const said = plainWords(outcome.stderr)
      return { found: 'failed', message: `gh could not read GitHub: ${said || `it ended with code ${outcome.code ?? 'unknown'}.`}` }
    }
  }
}

/** The user's GitHub, read through gh. Without a runner, gh runs for real, read only. */
export function ghSource(run: GhRunner = execGh()): GitHubSource {
  return { sample: false, read: async () => readOf(await run(GH_ARGS)) }
}

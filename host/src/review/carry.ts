/**
 * Carrying a review to a change's new commit instead of building it again (spec 058, A5). A review holds when only the
 * start moved under the change, or only specs or Markdown were added on top of it, and nothing it read changed:
 *
 * - its commits are the same ones on a newer start (`git range-diff` says each pair is the same), or every commit after
 *   the one it was built for touches only `_specs/` or Markdown;
 * - every file it read is the same, at the new start on its base side and at the new commit on its head side, and so is
 *   every test file a run of its change review held;
 * - the call-graph scan at the new commit finds the same callers of each changed definition;
 * - and the change's tests, run once at the new commit, pass there.
 *
 * Then the review and its change review are copied to the new commit, saying they were carried and from where, and no
 * model is asked. Anything that cannot be read, or does not match, carries nothing: the review is built again in its
 * turn. This can let a change merge on a review that was not rebuilt, so it is strict.
 */
import { execFile, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import { count } from '#shared/review/prose.ts'
import type { ReviewTarget } from '#shared/review/ids.ts'
import type { Review } from '#shared/review/types.ts'
import type { Vicinity, VicinityLink } from '#shared/review/vicinity.ts'
import { detectRunbooks } from '../../../packages/change-review/src/proof.ts'
import { assessmentFolder, gitIn, type GitRun } from './assessment.ts'
import { movedSince } from './landing.ts'
import type { Prepared, ReviewStore } from './store.ts'
import { fileName, fileRole, isTestPath } from '#shared/review/paths.ts'
import { importCandidates, relativeImports } from '#shared/review/units.ts'

const run = promisify(execFile)
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }

/** A file as it is at a commit, exactly, or null when the commit does not have it. Throws when git cannot tell. */
export type ShowAt = (repo: string, commit: string, path: string) => Promise<string | null>

export const gitShow: ShowAt = async (repo, commit, path) => {
  try {
    return (await run('git', ['-C', repo, 'show', `${commit}:${path}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60_000, env: GIT_ENV })).stdout
  } catch (error) {
    const said = (error as { stderr?: string }).stderr ?? ''
    if (/invalid object name|bad object|unknown revision/i.test(said)) throw new Error(`${commit.slice(0, 7)} is not in the repository`)
    // The commit is there and has no such file.
    if (/does not exist in|exists on disk, but not in/i.test(said)) return null
    throw error
  }
}

/** Specs and docs folders: what can be added on top of a change and leave its code the same, when nothing names them. */
const SPECS_OR_DOCS = /^_specs\/|(?:^|\/)docs?\//
/** Manifests and lockfiles: what a change runs with comes from them. */
const DEPENDENCIES = /(?:^|\/)(?:package\.json|[^/]*lock[^/]*\.(?:json|yaml|yml|lock|txt)|[^/]*\.lock|Gemfile|[^/]*\.gemspec|Cargo\.toml|go\.(?:mod|sum)|pyproject\.toml|requirements[^/]*\.txt|Pipfile|composer\.json|mix\.exs|\.tool-versions|\.nvmrc|\.node-version|\.ruby-version|Dockerfile|docker-compose[^/]*)$/i
/** Configuration, read at load or at run time. */
const CONFIG = /(?:^|\/)(?:config|configs|\.config|settings)\/|(?:^|\/)\.env[^/]*$|(?:^|\/)[^/]+\.config\.[cm]?[jt]s$|(?:^|\/)tsconfig[^/]*\.json$|\.(?:ya?ml|toml|ini|cfg|conf|properties)$/i
/** Migrations and schemas: what the data is. */
const MIGRATIONS = /(?:^|\/)(?:db\/migrate|migrations?)\/|(?:^|\/)(?:schema|structure)\.(?:rb|sql|prisma|graphql)$|\.prisma$/i
/** The code whose imports can be followed here: JavaScript and TypeScript. */
const FOLLOWED = /\.(?:[cm]?[jt]sx?)$/

export type CarryCheck = { carries: true; base: string; why: string; tests: string[] } | { carries: false; why: string }

export interface CarryInput {
  repo: string
  /** The branch the change merges into. */
  into: string
  /** The review at the commit it was built for, with both sides of every file it read. */
  built: Prepared
  /** Its change review's graph.json, for the test files its runs held. */
  graph: unknown
  /** The commit the change is at now. */
  head: string
  /** The call-graph scan of the change at its new commit. */
  scan: (base: string, head: string) => Promise<Vicinity>
  git?: GitRun
  show?: ShowAt
}

/** The test files the change review's runs at the commit ran: those it holds the change's tests to. */
export function testsRunIn(graph: unknown): string[] {
  const runs = graph != null && typeof graph === 'object' ? (graph as { runs?: unknown }).runs : undefined
  if (!Array.isArray(runs)) return []
  const files = runs.flatMap((entry) => {
    const ran = entry != null && typeof entry === 'object' ? (entry as { kind?: unknown; tests?: unknown }) : {}
    return ran.kind === 'baseline' && Array.isArray(ran.tests) ? ran.tests.filter((path): path is string => typeof path === 'string' && path !== '') : []
  })
  return [...new Set(files)].sort()
}

/** What a caller of a changed definition is called, as the review names its node: a route by its words, else its symbol. */
function callerKey(link: VicinityLink): string {
  const route = link.entry?.route
  const name = route ? `${route.verbs.join('/')} ${route.path}` : link.call.routes == null && link.entry?.kind === 'command' ? link.other.path : link.other.symbol
  return `${link.other.path}::${name}`
}

/** The callers one call away from the changed code the review shows, as `path::name`. */
function shownCallers(review: Review): Set<string> {
  return new Set(review.nodes.filter((node) => node.kind === 'context' && node.lifecycle?.role === 'caller' && node.lifecycle.hops === 1).map((node) => `${node.subtitle}::${node.title}`))
}

/** The callers one call away the scan finds now, as `path::name`, leaving out changed code that calls the change, which is no context. */
function scannedCallers(vicinity: Vicinity, review: Review): Set<string> {
  const holds = (anchor: Review['nodes'][number]['anchors'][number], { startLine, endLine }: VicinityLink['other']) => anchor.side === 'added' && anchor.startLine <= endLine && startLine <= anchor.endLine
  const isChanged = (other: VicinityLink['other']) => review.nodes.some((node) => node.kind === 'code' && node.subtitle === other.path && node.anchors.some((anchor) => holds(anchor, other)))
  const callers = vicinity.links.filter((link) => link.direction === 'caller' && link.hops === 1 && !isChanged(link.other))
  return new Set(callers.map(callerKey))
}

const sameSets = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((key) => b.has(key))

/** What the change could depend on: every file it read and its tests, what they import, what its changed lines call, and their words. */
interface Reach {
  paths: Set<string>
  texts: string[]
  /** Every import of the change and its tests could be followed. */
  followed: boolean
}

async function reachOf(repo: string, head: string, built: Prepared, tests: readonly string[], vicinity: Vicinity, show: ShowAt): Promise<Reach> {
  // The change's own files are those whose two sides differ; the others it read are context.
  const changed = new Map(built.files.filter((file) => file.base !== file.head).map((file) => [file.path, file.head]))
  const texts = built.files.flatMap((file) => (file.head != null ? [file.head] : []))
  const paths = new Set([...built.files.map((file) => file.path), ...tests])
  for (const link of vicinity.links) if (link.direction === 'callee') paths.add(link.other.path)
  let followed = true
  for (const path of [...changed.keys(), ...tests]) {
    if (!FOLLOWED.test(path)) followed = false
    const text = changed.has(path) ? changed.get(path) : await show(repo, head, path)
    if (text == null) continue
    if (tests.includes(path)) texts.push(text)
    for (const specifier of relativeImports(text)) {
      const candidates = importCandidates(path, specifier)
      for (const candidate of candidates) paths.add(candidate)
      const found = (await Promise.all(candidates.slice(0, 6).map((candidate) => show(repo, head, candidate)))).find((imported) => imported != null)
      if (found != null) texts.push(found)
    }
  }
  return { paths, texts, followed }
}

/** Why a file the start moved by can change what the change does, or null when nothing of the change can reach it. */
function dependsOn(path: string, reach: Reach): string | null {
  if (isTestPath(path)) return `the test ${path} changed`
  if (DEPENDENCIES.test(path)) return `${path}, which says what it runs with, changed`
  if (MIGRATIONS.test(path)) return `${path}, a migration or a schema, changed`
  if (CONFIG.test(path)) return `${path}, its configuration, changed`
  if (reach.paths.has(path)) return `${path}, which the change or its tests use, changed`
  if (reach.texts.some((text) => text.includes(fileName(path)))) return `${path}, which the change or its tests name, changed`
  if (!reach.followed && fileRole(path) !== 'file') return `${path} changed, and what the change imports could not be followed`
  return null
}

/** Whether a review holds at the change's new commit, and why, before its tests run there. Never throws. */
export async function carryCheck({ repo, into, built, graph, head, scan, git = gitIn, show = gitShow }: CarryInput): Promise<CarryCheck> {
  const no = (why: string): CarryCheck => ({ carries: false, why })
  try {
    const { review, files } = built
    const from = review.change.head
    if (from === head) return no('It is at the commit it was built for.')
    const base = (await git(repo, 'merge-base', head, into)).trim()
    if (!/^[0-9a-f]{40}$/.test(base)) return no(`The start of ${head.slice(0, 7)} could not be found.`)

    // Every file it read, the same on both sides.
    for (const file of files) {
      const [atHead, atBase] = await Promise.all([show(repo, head, file.path), show(repo, base, file.oldPath ?? file.path)])
      if (atHead !== file.head || atBase !== file.base) return no(`${file.path} is not as the review read it.`)
    }
    // Every test file its runs held, the same at the new commit.
    const tests = testsRunIn(graph)
    if (tests.length === 0) return no('Its change review ran no test there to run again.')
    for (const path of tests) {
      const [before, now] = await Promise.all([show(repo, from, path), show(repo, head, path)])
      if (before == null || before !== now) return no(`The test ${path} changed since.`)
    }
    const vicinity = await scan(base, head)
    if (vicinity.notice && vicinity.links.length === 0) return no(`The call-graph scan could not run: ${vicinity.notice}`)
    const reach = await reachOf(repo, head, built, tests, vicinity, show)

    // What moved: only specs or docs nothing names on top, or the same commits on a newer start that moved by nothing
    // the change could depend on.
    let why: string
    const descends = await git(repo, 'merge-base', '--is-ancestor', from, head).then(() => true, () => false)
    if (descends) {
      const touched = (await git(repo, 'diff', '--name-only', from, head)).split('\n').filter(Boolean)
      if (touched.length === 0) return no('Nothing changed since the commit it was built for, yet it moved.')
      const code = touched.find((path) => !SPECS_OR_DOCS.test(path) || reach.texts.some((text) => text.includes(fileName(path))))
      if (code) return no(`Its code changed since the commit it was built for: ${code} is no spec or document nothing reads.`)
      why = 'Only specs or docs nothing reads changed since the commit it was built for, so the code it read is the same.'
    } else {
      const tip = (await git(repo, 'rev-parse', '--verify', into)).trim()
      const moved = await movedSince({ repo, from, to: head, tip, git })
      if (!moved.rebased || !moved.same) return no('Its commits are not the same ones on a newer start.')
      const startMoved = review.change.base === base ? [] : (await git(repo, 'diff', '--name-only', review.change.base, base)).split('\n').filter(Boolean)
      for (const path of startMoved) {
        const reason = dependsOn(path, reach)
        if (reason) return no(`Its start moved under something it depends on: ${reason}.`)
      }
      why = `Only its start moved: the same commits on ${base.slice(0, 7)}, and nothing it depends on changed.`
    }

    // The same callers of each changed definition.
    if (!sameSets(shownCallers(review), scannedCallers(vicinity, review))) return no('The scan finds other callers of the changed code now.')
    return { carries: true, base, why, tests }
  } catch (error) {
    return no(`It could not be checked: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Runs test files in a checkout and says whether they all passed. */
export type TestRun = (tree: string, files: readonly string[], signal?: AbortSignal) => Promise<{ passed: boolean; why?: string }>

/** How many tests a run passed, failed and skipped, as its runner wrote them. */
interface Counted {
  passed: number
  failed: number
  skipped: number
}

/**
 * The tests a runner counted in its output: node's TAP, Minitest's, RSpec's, Jest's or Vitest's summary. Null when none
 * of them is there, so the run is not counted at all.
 */
export function countedIn(output: string, file = ''): Counted | null {
  // node's test runner: `# pass 3` in TAP, `ℹ pass 3` in its spec reporter. A file with no test in it passes as one
  // test named by the file itself, which is no test that ran.
  const tap = (name: string) => Number(new RegExp(`^(?:#|ℹ) ${name} (\\d+)\\s*$`, 'm').exec(output)?.[1] ?? Number.NaN)
  if (Number.isFinite(tap('pass'))) {
    const named = file ? new RegExp(`^\\s*(?:✔|ok \\d+ -) ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'gm') : null
    const empty = named ? (output.match(named)?.length ?? 0) : 0
    return { passed: tap('pass') - empty, failed: tap('fail') || 0, skipped: (tap('skipped') || 0) + (tap('todo') || 0) }
  }
  const minitest = /(\d+) runs, \d+ assertions, (\d+) failures, (\d+) errors, (\d+) skips/.exec(output)
  if (minitest) {
    const [runs, failures, errors, skips] = minitest.slice(1).map(Number) as [number, number, number, number]
    return { passed: runs - failures - errors - skips, failed: failures + errors, skipped: skips }
  }
  const rspec = /(\d+) examples?, (\d+) failures?(?:, (\d+) pending)?/.exec(output)
  if (rspec) {
    const [examples, failures, pending = 0] = rspec.slice(1).map((value) => Number(value ?? 0)) as [number, number, number]
    return { passed: examples - failures - pending, failed: failures, skipped: pending }
  }
  const summary = /^\s*Tests:?\s+(.+)$/m.exec(output)?.[1]
  if (summary && /\d+ (?:passed|failed)/.test(summary)) {
    const of = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(summary)?.[1] ?? 0)
    return { passed: of('passed'), failed: of('failed'), skipped: of('skipped') + of('todo') + of('pending') }
  }
  return null
}

/** One test file run with its runner: the exit and what the runner wrote. */
function runOne(tree: string, command: readonly string[], env: Record<string, string>, timeoutMs: number, file: string, signal?: AbortSignal): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const [program, ...args] = command
    // A host run under node's own test runner hands its children a protocol of its own: they report in plain text here.
    const { NODE_TEST_CONTEXT: _context, ...inherited } = process.env
    const child = spawn(program!, [...args, file], { cwd: tree, env: { ...inherited, ...env }, stdio: ['ignore', 'pipe', 'pipe'], ...(signal ? { signal } : {}) })
    const said: Buffer[] = []
    let size = 0
    const keep = (chunk: Buffer) => {
      size += chunk.length
      if (size <= 4 * 1024 * 1024) said.push(chunk)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.on('error', () => resolve({ code: null, output: '' }))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output: Buffer.concat(said).toString('utf8') })
    })
  })
}

/**
 * The change's tests in the review's checkout, each file on its own with the runner that takes it, as the change review
 * runs them. They pass only where the runner counted at least one test passed and none failed or skipped: a run that
 * exits well with every test skipped, or with no test at all, is no pass, and neither is one whose count cannot be read.
 */
export const runTests: TestRun = async (tree, files, signal) => {
  const books = detectRunbooks(tree)
  const takes = (accepts: readonly string[], path: string) => accepts.length === 0 || accepts.some((ending) => path.endsWith(ending))
  for (const file of files) {
    const book = books.find((entry) => takes(entry.accepts, file))
    if (!book) return { passed: false, why: `No runner here takes ${file}.` }
    const { code, output } = await runOne(tree, book.command, book.env, book.timeoutMs, file, signal)
    const counted = countedIn(output, file)
    if (!counted) return { passed: false, why: `${file}: ${book.source} said nothing that counts its tests (exit ${String(code)}).` }
    if (counted.failed > 0 || code !== 0) return { passed: false, why: `${file}: ${count(counted.failed, 'test')} failed (exit ${String(code)}).` }
    if (counted.skipped > 0) return { passed: false, why: `${file}: ${count(counted.skipped, 'test')} skipped, so the change's tests did not all run.` }
    if (counted.passed < 1) return { passed: false, why: `${file}: no test ran.` }
  }
  return { passed: true }
}

/** Written whole beside it, then put in place. */
function writeWhole(file: string, text: string) {
  const next = `${file}.${process.pid}.next`
  writeFileSync(next, text, { mode: 0o600 })
  renameSync(next, file)
}

/**
 * Copies a review that holds to the change's new commit: its graph review, rewritten for the new start and commit, and
 * its change review's files, with a summary that says it was carried, from where, and that the change's tests passed.
 */
export interface CarriedCopy {
  root: string
  store: ReviewStore
  target: ReviewTarget
  /** The review at the commit it was built for. */
  built: Prepared
  /** The change's new commit, and the start it is on. */
  head: string
  base: string
  why: string
  /** How many test files ran at the new commit. */
  tests: number
  /** When it was carried, as an ISO time. */
  at: string
}

export function copyCarried({ root, store, target, built, head, base, why, tests, at }: CarriedCopy): void {
  const from = built.review.change.head
  const old = assessmentFolder(root, target, from)
  const summary = JSON.parse(readFileSync(join(old, 'summary.json'), 'utf8')) as AssessmentSummary
  const folder = assessmentFolder(root, target, head)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  for (const name of readdirSync(old)) {
    if (name === 'summary.json' || name === 'failed.json' || name === 'restarted.json' || !existsSync(join(old, name))) continue
    copyFileSync(join(old, name), join(folder, name))
  }
  const review: Review = { ...built.review, change: { ...built.review.change, head, base } }
  store.write(target, review, built.files, { ...(built.meta ?? { storyBy: 'host' }), preparedAt: at })
  // Last, so a review is never carried without its words.
  writeWhole(join(folder, 'summary.json'), JSON.stringify({ ...summary, at, carried: { from, why, tests } }))
}

/** What a carry did: carried, from which commit and why, or not, and why, so the review is built again in its turn. */
export type Carried = { carried: true; from: string; why: string } | { carried: false; why: string }

/**
 * Carries a change's newest review to the commit the change is at now, when it holds there: its check, then the
 * change's tests once at the new commit in the review's checkout, then the copy. No model is asked.
 */
export async function carryReview({
  root,
  store,
  inTree,
  target,
  repo,
  into,
  head,
  scan,
  tests = runTests,
  now = Date.now,
}: {
  root: string
  store: ReviewStore
  /** The review's checkout at a commit, lent one user at a time, as the change review takes it. */
  inTree: <Value>(target: ReviewTarget, repo: string, head: string, use: (tree: string) => Promise<Value>, base: string) => Promise<Value>
  target: ReviewTarget
  repo: string
  into: string
  head: string
  scan: CarryInput['scan']
  tests?: TestRun
  now?: () => number
}): Promise<Carried> {
  const built = store.latest(target)
  if (!built) return { carried: false, why: 'There is no review to carry.' }
  const from = built.review.change.head
  const folder = assessmentFolder(root, target, from)
  let graph: unknown
  try {
    if (!existsSync(join(folder, 'summary.json'))) return { carried: false, why: 'Its change review did not finish.' }
    graph = JSON.parse(readFileSync(join(folder, 'graph.json'), 'utf8'))
  } catch {
    return { carried: false, why: 'Its change review cannot be read.' }
  }
  const check = await carryCheck({ repo, into, built, graph, head, scan })
  if (!check.carries) return { carried: false, why: check.why }
  try {
    const ran = await inTree(target, repo, head, (tree) => tests(tree, check.tests), check.base)
    if (!ran.passed) return { carried: false, why: `Its tests did not pass at ${head.slice(0, 7)}${ran.why ? `: ${ran.why}` : '.'}` }
    copyCarried({ root, store, target, built, head, base: check.base, why: check.why, tests: check.tests.length, at: new Date(now()).toISOString() })
  } catch (error) {
    return { carried: false, why: `It could not be carried: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { carried: true, from, why: check.why }
}

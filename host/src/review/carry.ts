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
import type { ReviewTarget } from '#shared/review/ids.ts'
import type { Review } from '#shared/review/types.ts'
import type { Vicinity, VicinityLink } from '#shared/review/vicinity.ts'
import { detectRunbooks } from '../../../packages/change-review/src/proof.ts'
import { assessmentFolder, gitIn, type GitRun } from './assessment.ts'
import { movedSince } from './landing.ts'
import type { Prepared, ReviewStore } from './store.ts'

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

/** Specs and Markdown: what hobkin's own rule counts as the same code (`proofs.mjs`). */
const SAME_CODE = /^_specs\/|\.(?:md|markdown)$/i

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
  const isChanged = ({ path, startLine, endLine }: VicinityLink['other']) =>
    review.nodes.some((node) => node.kind === 'code' && node.subtitle === path && node.anchors.some((anchor) => anchor.side === 'added' && anchor.startLine <= endLine && startLine <= anchor.endLine))
  return new Set(vicinity.links.filter((link) => link.direction === 'caller' && link.hops === 1 && !isChanged(link.other)).map(callerKey))
}

const sameSets = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((key) => b.has(key))

/** Whether a review holds at the change's new commit, and why, before its tests run there. Never throws. */
export async function carryCheck({ repo, into, built, graph, head, scan, git = gitIn, show = gitShow }: CarryInput): Promise<CarryCheck> {
  const no = (why: string): CarryCheck => ({ carries: false, why })
  try {
    const { review, files } = built
    const from = review.change.head
    if (from === head) return no('It is at the commit it was built for.')
    const base = (await git(repo, 'merge-base', head, into)).trim()
    if (!/^[0-9a-f]{40}$/.test(base)) return no(`The start of ${head.slice(0, 7)} could not be found.`)

    // What moved: the same commits on a newer start, or only specs or Markdown on top.
    let why: string
    const descends = await git(repo, 'merge-base', '--is-ancestor', from, head).then(() => true, () => false)
    if (descends) {
      const touched = (await git(repo, 'diff', '--name-only', from, head)).split('\n').filter(Boolean)
      if (touched.length === 0 || !touched.every((path) => SAME_CODE.test(path))) return no('Its code changed since the commit it was built for.')
      if (touched.some((path) => files.some((file) => file.path === path))) return no('A spec or a document it read changed since.')
      why = 'Only specs or Markdown changed since the commit it was built for, so the code it read is the same.'
    } else {
      const tip = (await git(repo, 'rev-parse', '--verify', into)).trim()
      const moved = await movedSince({ repo, from, to: head, tip, git })
      if (!moved.rebased || !moved.same) return no('Its commits are not the same ones on a newer start.')
      why = `Only its start moved: the same commits on ${base.slice(0, 7)}, and nothing it read changed.`
    }

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
    // The same callers of each changed definition.
    const vicinity = await scan(base, head)
    if (vicinity.notice && vicinity.links.length === 0) return no(`The call-graph scan could not run: ${vicinity.notice}`)
    if (!sameSets(shownCallers(review), scannedCallers(vicinity, review))) return no('The scan finds other callers of the changed code now.')
    return { carries: true, base, why, tests }
  } catch (error) {
    return no(`It could not be checked: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Runs test files in a checkout and says whether they all passed. */
export type TestRun = (tree: string, files: readonly string[], signal?: AbortSignal) => Promise<{ passed: boolean; why?: string }>

/**
 * The change's tests in the review's checkout, each file with the runner that takes it, as the change review would run
 * them at the change's commit. A file no runner takes is not run, and then they did not pass.
 */
export const runTests: TestRun = async (tree, files, signal) => {
  const books = detectRunbooks(tree)
  const takes = (accepts: readonly string[], path: string) => accepts.length === 0 || accepts.some((ending) => path.endsWith(ending))
  const left = new Set(files)
  for (const book of books) {
    const mine = [...left].filter((path) => takes(book.accepts, path))
    if (!mine.length) continue
    for (const path of mine) left.delete(path)
    const [program, ...args] = book.command
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(program!, [...args, ...mine], { cwd: tree, env: { ...process.env, ...book.env }, stdio: 'ignore', ...(signal ? { signal } : {}) })
      const timer = setTimeout(() => child.kill('SIGTERM'), book.timeoutMs)
      child.on('error', () => resolve(null))
      child.on('close', (exit) => {
        clearTimeout(timer)
        resolve(exit)
      })
    })
    if (code !== 0) return { passed: false, why: `${book.source} did not pass ${mine.join(', ')} (exit ${String(code)}).` }
  }
  return left.size ? { passed: false, why: `No runner here takes ${[...left].join(', ')}.` } : { passed: true }
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
export function copyCarried({ root, store, target, built, head, base, why, tests, at }: { root: string; store: ReviewStore; target: ReviewTarget; built: Prepared; head: string; base: string; why: string; tests: number; at: string }): void {
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

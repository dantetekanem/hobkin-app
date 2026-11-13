/**
 * The change review of a finished hobkin change or of a GitHub pull request (spec 032): the host checks the change out
 * in a review worktree of its own and runs the change-review package on it in the background. Triage, the node map
 * with proof from the project's own tests, a level per unit and the story the user reads. One review runs at a time,
 * because a project's tests are heavy, and each commit is reviewed once. What it writes stays in the home beside the
 * change's review, so it opens at once and survives a restart. While it runs, its status says what it reviews and keeps
 * a short log of what it did, in plain words.
 *
 * The engine stands apart from this app (`packages/change-review`); this file only hands it a checkout, a range and a
 * model, and reads back what it wrote.
 */
import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { reviewFolder, reviewIdOf, type ReviewTarget } from '#shared/review/ids.ts'
import { LEVEL_WORDS, type AssessmentLogLine, type AssessmentRequest, type AssessmentStatus, type AssessmentSummary, type ChangeAssessment, type Level, type StoryWords, type Unit, type Units } from '#shared/review/assessment.ts'
import { count } from '#shared/review/prose.ts'
import type { Review } from '#shared/review/types.ts'
import { STEP_IDS } from '../../../packages/change-review/src/types.ts'
import { unitStory, unitWords, type UnitPlace, type UnitRun } from './unit-story.ts'

const run = promisify(execFile)
const GIT_TIMEOUT_MS = 120_000

/** What the engine is asked to do: review the change from `base` to `head`, checked out at `cwd`, writing into `out`. */
export interface AssessRequest {
  cwd: string
  base: string
  head: string
  out: string
  description: { source: 'pull-request' | 'commits' | 'none'; title?: string; body?: string }
  signal: AbortSignal
  /** Called whenever the engine rewrites its progress, with the progress as it wrote it. */
  onProgress: (progress: ProgressLike) => void
}

/** The engine's answer, as far as the host needs it: the level of each unit, to sum up on the card. */
export interface AssessResult {
  units: { units: { level: 'safe' | 'mid' | 'high'; critical: boolean }[] }
  /** Whether a model wrote the story's words and checked it, or the facts alone did. */
  storyBy: 'model' | 'host'
}

/** The engine. `change-review`'s `reviewChange` in a live host; a fake in tests. */
export type AssessRun = (request: AssessRequest) => Promise<AssessResult>

/** Progress as the engine writes it (`review-progress/1`). Only what the host shows is read. */
export interface ProgressLike {
  percent: number
  now: string
  eta_seconds: number | null
  steps: { id: string; status: string; done: number; total: number; seconds: number | null; note?: string }[]
}

/** What the host reads of a node in the engine's graph.json. */
interface GraphNode {
  id: string
  kind: string
  symbol: string
  path: string
  /** At head, or at base for a removed one. */
  lines: [number, number]
  change: 'added' | 'modified' | 'removed' | 'none'
  level: { current: Level } | null
  critical: boolean
  /** A removed definition something still refers to says so here. */
  extras?: { broken?: string }
  /** The test runs that concern it. */
  runs?: { kind: string; node?: string; tests?: string[]; failed?: string[]; failed_at?: { path: string; line: number }[] }[]
  /** Its proof, with what it rests on: `tests were not run: …` when no test could run. */
  facts?: { proof?: { evidence?: string } }
}

const RANK: Record<Level, number> = { safe: 0, mid: 1, high: 2 }
const worse = (a: Level, b: Level) => (RANK[b] > RANK[a] ? b : a)

/**
 * The graph review with the change review's levels laid over it, so the levels show on the Review page: a code or file
 * node takes the worst level of the rated definitions its lines at head overlap, and a step the worst of its focus.
 * Nothing else changes.
 */
export function withLevels(review: Review, assessment: Pick<ChangeAssessment, 'nodes'>): Review {
  if (!assessment.nodes.length) return review
  const pathOf = new Map(review.files.map((file) => [file.id, file.path]))
  /** The worst rated definition a node's lines at head overlap: its level, and the unit of the story that tells it. */
  const rate = (node: Review['nodes'][number]): ChangeAssessment['nodes'][number] | undefined => {
    let found: ChangeAssessment['nodes'][number] | undefined
    for (const anchor of node.anchors) {
      if (anchor.side !== 'added') continue
      const path = pathOf.get(anchor.fileId)
      for (const rated of assessment.nodes) {
        if (rated.path !== path || rated.lines[1] < anchor.startLine || rated.lines[0] > anchor.endLine) continue
        if (!found || RANK[rated.level] > RANK[found.level]) found = rated
      }
    }
    return found
  }
  const nodes = review.nodes.map((node) => {
    const rated = node.kind === 'code' || node.kind === 'file' ? rate(node) : undefined
    return rated ? { ...node, level: rated.level, ...(rated.unit ? { unit: rated.unit } : {}) } : node
  })
  const levelOf = new Map(nodes.map((node) => [node.id, node.level]))
  const story = review.story.map((step) => {
    const levels = step.focus.map((id) => levelOf.get(id)).filter((level): level is Level => Boolean(level))
    return levels.length ? { ...step, level: levels.reduce(worse) } : step
  })
  return { ...review, nodes, story }
}

/** Runs git in a folder, as itself: no shell, a timeout, and never a prompt for a password. */
export type GitRun = (cwd: string, ...args: string[]) => Promise<string>

/** git with this time limit, for work that reaches GitHub and may take longer, such as a fetch. */
export const gitWithin =
  (timeoutMs: number): GitRun =>
  async (cwd, ...args) =>
    (await run('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim()

export const gitIn: GitRun = gitWithin(GIT_TIMEOUT_MS)

/** Only a linked worktree has a `.git` file, so a folder that passes this is never the project's own. */
const isLinkedTree = (tree: string) => Boolean(statSync(join(tree, '.git'), { throwIfNoEntry: false })?.isFile())

/**
 * The review's own checkout of a project, at `head`, clean. It is a linked worktree kept between reviews (no clone,
 * no copy of the history), detached so it holds no branch. What a review changed in it, or left behind, is thrown
 * away before the next one: it is the review's, never the user's folder. A tree that cannot be readied, such as one
 * whose link to the repository broke, would fail every review after it, so it moves aside for a new one, as hobkin's
 * own trees do. Installed dependencies of the project's own folder are linked in, so its tests run without an install.
 */
export async function readyReviewTree({ repo, tree, head, git = gitIn, log }: { repo: string; tree: string; head: string; git?: GitRun; log?: (line: string) => void }): Promise<string> {
  if (resolve(tree) === resolve(repo)) throw new Error('A review tree is never the project’s own folder.')
  if (existsSync(tree) && !isLinkedTree(tree)) throw new Error(`${tree} is not a review worktree, so it is left alone.`)
  const atHead = async () => {
    const at = await git(tree, 'rev-parse', 'HEAD')
    if (at !== head) throw new Error(`The review tree is at ${at.slice(0, 7)}, not ${head.slice(0, 7)}.`)
  }
  if (existsSync(tree)) {
    try {
      await git(tree, 'checkout', '--quiet', '--detach', '--force', head)
      // Untracked files a run left behind go. Ignored ones, such as an install, stay.
      await git(tree, 'clean', '-fdq')
      await atHead()
    } catch (error) {
      // It may hold something, so it is never deleted. Git drops its entry as the new tree is made, and any lock in there goes with it.
      const aside = `${tree}-broken-${new Date().toISOString().replace(/[:.]/g, '-')}`
      renameSync(tree, aside)
      const why = (error as { stderr?: string }).stderr?.trim().split('\n', 1)[0] || (error instanceof Error ? error.message : String(error))
      log?.(`The review tree could not be readied (${why}), so it moved to ${aside} and a new one is made.`)
    }
  }
  if (!existsSync(tree)) {
    mkdirSync(dirname(tree), { recursive: true, mode: 0o700 })
    // A tree deleted or moved aside keeps its entry until git is told.
    await git(repo, 'worktree', 'prune')
    await git(repo, 'worktree', 'add', '--quiet', '--detach', tree, head)
    await atHead()
  }
  await linkInstalls({ repo, tree, git })
  return tree
}

/** Folders of installed dependencies, linked from the project's folder into the tree when git ignores them there. */
const INSTALLS = ['node_modules']

/** Caches tools keep inside an install. Never linked, so a tool run in the tree makes its own there, not in the project. */
const CACHES = new Set(['.cache', '.vite', '.vite-temp', '.vitest'])

/**
 * The tree gets a real folder of that name, holding a link to every entry of the project's own but its caches. A link
 * in place of the folder would not match an ignore rule written for a folder (`node_modules/`), so the tree would look
 * changed and the proof step, which needs a clean checkout, would refuse it. The links follow the project at every
 * review: what it gained is linked, and a link to what it lost goes. What the tree made there itself stays.
 */
async function linkInstalls({ repo, tree, git }: { repo: string; tree: string; git: GitRun }) {
  for (const name of INSTALLS) {
    const from = join(repo, name)
    const to = join(tree, name)
    const there = lstatSync(to, { throwIfNoEntry: false })
    if (!existsSync(from) || (there && !there.isDirectory())) continue
    if (!there) mkdirSync(to)
    const ignored = await git(tree, 'check-ignore', '-q', name).then(() => true, () => false)
    if (!ignored) {
      if (!there) rmdirSync(to)
      continue
    }
    for (const entry of readdirSync(to)) {
      const link = join(to, entry)
      // A link whose install is gone, or one to a cache, which an older tree linked into the project.
      if (lstatSync(link).isSymbolicLink() && (!existsSync(link) || CACHES.has(entry))) unlinkSync(link)
    }
    for (const entry of readdirSync(from)) {
      if (!CACHES.has(entry) && !lstatSync(join(to, entry), { throwIfNoEntry: false })) symlinkSync(join(from, entry), join(to, entry))
    }
  }
}

const short = (head: string) => head.slice(0, 12)

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Written in full beside the file, then put in place, so a reader never sees half of it. */
function writeWhole(file: string, text: string) {
  const next = `${file}.${process.pid}.next`
  writeFileSync(next, text, { mode: 0o600 })
  renameSync(next, file)
}

function readJson<Value>(file: string): Value | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Value
  } catch {
    return null
  }
}

/** Where a change's reviews keep their artifacts: one folder per commit, beside the change's graph review. */
export function assessmentFolder(root: string, target: ReviewTarget, head: string) {
  return join(root, 'client', 'reviews', reviewFolder(target), 'change-review', short(head))
}

/** The card's summary of finished units: the worst level, whether any is critical, and how many need the user. */
export function summarize(result: AssessResult, at: string): AssessmentSummary {
  const units = result.units.units
  const countAt = (level: Level) => units.filter((unit) => unit.level === level).length
  const worstLevel: Level = countAt('high') > 0 ? 'high' : countAt('mid') > 0 ? 'mid' : 'safe'
  return {
    level: worstLevel,
    critical: units.some((unit) => unit.critical),
    needsYou: countAt('high'),
    worthALook: countAt('mid'),
    safe: countAt('safe'),
    storyBy: result.storyBy,
    at,
  }
}

/** A pull request, as a review target. */
type PullTarget = Extract<ReviewTarget, { kind: 'pull' }>

/** The review tree of a target's repository: one per project, and one per pull request repository. */
export function treeOf(root: string, target: ReviewTarget): string {
  return join(root, 'client', 'review-trees', target.kind === 'change' ? target.slug : `pr+${target.owner}+${target.repo}`)
}

/** The most lines a run's log keeps: the latest. */
export const LOG_LINES = 40

/** Every step of a run, none started, for a run that waits its turn: the engine plans all of them every time. */
export const pendingSteps = (): NonNullable<AssessmentStatus['steps']> => STEP_IDS.map((id) => ({ id, status: 'pending', done: 0, total: 1, seconds: null }))

/** Each step of the engine, in plain words, for the log. */
const STEP_WORDS: Record<string, string> = {
  triage: 'Sorting the changed files',
  'map-search': 'Finding every changed definition',
  'map-proof': "Running the project's tests",
  'risk-floor': 'Rating each definition',
  'risk-model': 'The careful model pass',
  shape: 'Grouping the definitions into units',
  story: 'Writing the story',
  'blind-check': 'The blind check',
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/**
 * What the engine says it is doing, as a line of the log in plain words. Its step's name goes, a test run says what it
 * showed, and a step that ended says how.
 */
export function progressWords(now: string): string {
  const ran = /^map-proof: (baseline|revert|probe) run for (.+): (\d+) test files?, exit (\d+)$/.exec(now)
  if (ran) {
    const [, kind, who, files, exit] = ran
    const tests = count(Number(files), 'test file')
    const failed = exit !== '0'
    if (kind === 'baseline' && who === 'every candidate test') return `Ran ${tests} at the change's commit: ${failed ? 'some fail' : 'they pass'}.`
    if (kind === 'baseline') return `Ran ${tests} of ${who} again, on their own: ${failed ? 'they still fail' : 'they pass'}.`
    if (kind === 'revert') return `Put ${who} back as it was and ran ${tests}: ${failed ? 'they fail, so they prove it' : 'they still pass, so they do not prove it'}.`
    return `Made ${who} fail and ran ${tests}: ${failed ? 'they notice, so they prove it' : 'they do not notice'}.`
  }
  const step = /^([a-z-]+): (.*)$/.exec(now)
  if (!step || !STEP_WORDS[step[1]!]) return sentence(capitalized(now))
  const [, id, said] = step
  const name = STEP_WORDS[id!]!
  if (said === 'done') return `${name}: done.`
  const ended = /^(skipped|failed), (.*)$/.exec(said!)
  if (ended) return `${name}: ${ended[1]}, ${sentence(ended[2]!)}`
  return sentence(capitalized(said!))
}

/** A finished run's levels in words: the worst, then how many parts sit at each. */
function finishedWords(summary: AssessmentSummary): string {
  const parts = [
    summary.needsYou ? `${count(summary.needsYou, 'part')} ${summary.needsYou === 1 ? 'needs' : 'need'} you` : '',
    summary.worthALook ? `${count(summary.worthALook, 'part')} ${summary.worthALook === 1 ? 'is' : 'are'} worth a look` : '',
    summary.safe ? `${count(summary.safe, 'part')} ${summary.safe === 1 ? 'is' : 'are'} safe` : '',
  ].filter(Boolean)
  return `${LEVEL_WORDS[summary.level]}${summary.critical ? ', with something critical' : ''}.${parts.length ? ` ${capitalized(parts.join(', '))}.` : ''}`
}

export interface AssessmentsOptions {
  root: string
  run: AssessRun
  /** A finished change's project folder, or null when hobkin knows none. */
  repoOf: (slug: string) => string | null
  /** A pull request's repository on this Mac, with its head in it, found, cloned or fetched as needed. Without it no pull request is reviewed. */
  pullRepo?: (target: PullTarget, head: string, say: (text: string) => void) => Promise<string>
  git?: GitRun
  onChange?: () => void
  /** A run finished and its review is ready, with its summary and what it reviewed. Once for each run that finishes. */
  onReady?: (ready: { target: ReviewTarget; head: string; summary: AssessmentSummary; request?: AssessmentRequest }) => void
  log?: (line: string) => void
  now?: () => number
}

/** One change review to run. */
export interface AssessJob {
  target: ReviewTarget
  head: string
  base: string
  description: AssessRequest['description']
  /** What it reviews, for its status. */
  request?: AssessmentRequest
  /** What the preparation of its graph did before it, so its log reads from the start. */
  log?: readonly AssessmentLogLine[]
  /** When the user asked for it, so the time a window shows counts from there. */
  startedAt?: string
}

/** What a run reviews, its log, and when it was asked for, kept beside how it stands. */
interface RunRecord {
  request?: AssessmentRequest
  log: AssessmentLogLine[]
  startedAt: string
}

/** Units in the order the story numbers them: high first, then mid, then safe, each in the order the units came. */
const inStoryOrder = (units: readonly Unit[]) => (['high', 'mid', 'safe'] as const).flatMap((level) => units.filter((unit) => unit.level === level))

/**
 * The words a story was written with, read back from it: its heading, its "Does" line, and each unit's heading and
 * "What changed", where they differ from the unit's own. For a run that kept them nowhere else.
 */
export function wordsInStory(story: string, units: Units | null): StoryWords | null {
  if (!units) return null
  const numbered = inStoryOrder(units.units)
  const said: NonNullable<StoryWords['units']> = {}
  let unit: Unit | undefined
  let fence = ''
  for (const line of story.split('\n')) {
    // Code blocks hold the change's own lines, never the story's words.
    const mark = /^(`{3,})/.exec(line)?.[1]
    if (fence) {
      if (mark && mark.length >= fence.length && line.trim() === mark) fence = ''
      continue
    }
    if (mark) {
      fence = mark
      continue
    }
    const heading = /^### (\d+)\. (.+) \((?:high|mid|safe)(?:, critical)?\)$/.exec(line)
    if (heading) {
      unit = numbered[Number(heading[1]) - 1]
      if (unit && heading[2] !== unit.title) said[unit.id] = { title: heading[2]! }
      continue
    }
    const what = /^\*\*What changed:\*\* (.+)$/.exec(line)?.[1]
    if (unit && what && what !== unit.what) said[unit.id] = { ...said[unit.id], what }
  }
  const title = story.split('\n').find((line) => line.startsWith('# '))?.slice(2).trim()
  const does = story.split('\n').find((line) => line.startsWith('**Does:** '))?.slice('**Does:** '.length).trim()
  return { ...(title ? { title } : {}), ...(does ? { does } : {}), units: said }
}

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/**
 * A unit as the window shows it: the model's title and what changed first, and the engine's own words as plain as it
 * writes them now, for a run an older engine wrote: no stop number, no rule name, an entry point named once.
 */
export function toldUnit(unit: Unit, said?: { title?: string; what?: string }): Unit {
  // A unit an engine wrote has every field; one without them keeps its own, with the model's words over them.
  if (typeof unit.where !== 'string' || typeof unit.what !== 'string' || !Array.isArray(unit.why_level)) return { ...unit, ...(said?.title ? { title: said.title } : {}), ...(said?.what ? { what: said.what } : {}) }
  const where = unit.where
    .replace(/^Stop \d+\. /, '')
    .replace(/^Outside the request path: (.)/, (_all, first: string) => first.toUpperCase())
    .replace(/^Reached from (.+?)\.( |$)/, (_all, list: string, rest: string) => `Reached from ${[...new Set(list.split(', ').map((entry) => entry.replace(/ \([\w -]+\)$/, '')))].join(', ')}.${rest}`)
  const why = unit.why_level.filter((line) => !/^Floor rule \d+\.$/.test(line)).map((line) => (/^Floor rule \d+: /.test(line) ? capitalize(line.replace(/^Floor rule \d+: /, '')) : line))
  const old = /^`([^`]+)` in `[^`]+` \(lines \d+ to \d+\) was (changed|added|removed), with (\d+) changed lines?\./.exec(unit.what)
  const lines = old ? `${old[3]} ${old[3] === '1' ? 'line' : 'lines'}` : ''
  const plain = old ? (old[2] === 'added' ? `Adds \`${old[1]}\`, ${lines}.` : old[2] === 'removed' ? `Removes \`${old[1]}\`.` : `Changes ${lines} in \`${old[1]}\`.`) : unit.what
  return { ...unit, title: said?.title ?? unit.title, what: said?.what ?? plain, where, why_level: why }
}

/** How the change review's proof says no test could run, before why. */
const NOT_RUN = 'tests were not run: '

/** Why a run that close() stopped failed. */
const STOPPED = 'The review was stopped before it finished.'

/** Every change review this host has run or is running, one at a time, each commit once. */
export class Assessments {
  private readonly queue: AssessJob[] = []
  private readonly live = new Map<string, AssessmentStatus>()
  private readonly records = new Map<string, RunRecord>()
  /** The last one waiting for each review tree, so a tree has one user at a time. */
  private readonly turns = new Map<string, Promise<void>>()
  private readonly controller = new AbortController()
  private working: Promise<void> | null = null
  private readonly options: AssessmentsOptions

  constructor(options: AssessmentsOptions) {
    this.options = options
  }

  private key = (target: ReviewTarget, head: string) => `${reviewIdOf(target)}@${head}`

  private clockIso() {
    return new Date((this.options.now ?? Date.now)()).toISOString()
  }

  private set(target: ReviewTarget, head: string, status: AssessmentStatus) {
    this.live.set(this.key(target, head), status)
    this.options.onChange?.()
  }

  /** Adds a line to the run's log, keeping the latest `LOG_LINES`. */
  private say(target: ReviewTarget, head: string, text: string, step?: string) {
    const record = this.records.get(this.key(target, head))
    if (!record) return
    record.log.push({ at: this.clockIso(), ...(step ? { step } : {}), text })
    if (record.log.length > LOG_LINES) record.log.splice(0, record.log.length - LOG_LINES)
  }

  /** How the review of this commit stands: from this host's memory, else from what an earlier run left in the home. */
  status(target: ReviewTarget, head: string | null): AssessmentStatus {
    if (!head) return { state: 'idle', head: null }
    const record = this.records.get(this.key(target, head))
    const kept = record ? { ...(record.request ? { request: record.request } : {}), ...(record.log.length ? { log: [...record.log] } : {}) } : {}
    const known = this.live.get(this.key(target, head))
    if (known) return { ...known, ...kept }
    const folder = assessmentFolder(this.options.root, target, head)
    const summary = readJson<AssessmentSummary>(join(folder, 'summary.json'))
    if (summary) return { state: 'ready', head, summary }
    if (existsSync(join(folder, 'progress.json'))) return { state: 'failed', head, error: 'An earlier review of this commit stopped before it finished.' }
    return { state: 'idle', head }
  }

  /**
   * Reviews a change at `head` in the background. A commit already reviewed, queued or under way is left as it is, so
   * the same commit is never reviewed twice. `again` reviews it once more.
   */
  start(job: AssessJob, { again = false }: { again?: boolean } = {}): AssessmentStatus {
    const now = this.status(job.target, job.head)
    if (now.state === 'queued' || now.state === 'running') return now
    if (now.state === 'ready' && !again) return now
    if (this.queue.some((entry) => this.key(entry.target, entry.head) === this.key(job.target, job.head))) return now
    const startedAt = job.startedAt ?? this.clockIso()
    this.records.set(this.key(job.target, job.head), { ...(job.request ? { request: job.request } : {}), log: (job.log ?? []).slice(-LOG_LINES), startedAt })
    if (this.working) this.say(job.target, job.head, 'Waiting for the change review before it to finish.')
    this.queue.push(job)
    this.set(job.target, job.head, { state: 'queued', head: job.head, startedAt, percent: 0, eta: null, now: 'waiting its turn', steps: pendingSteps() })
    this.working ??= this.work().finally(() => {
      this.working = null
    })
    return this.status(job.target, job.head)
  }

  private async work() {
    // Nothing runs on the caller's turn: `start` only queues, and the host publishes its state first.
    await Promise.resolve()
    for (let job = this.queue.shift(); job; job = this.queue.shift()) {
      if (this.controller.signal.aborted) return
      await this.one(job).catch((error: unknown) => {
        const message = messageOf(error)
        this.options.log?.(`Change review of ${reviewIdOf(job.target)} at ${job.head.slice(0, 7)} failed: ${message}`)
        this.say(job.target, job.head, `Stopped: ${message}`)
        this.set(job.target, job.head, { state: 'failed', head: job.head, error: message })
      })
    }
  }

  /** The repository a target's change is in on this Mac: a project's own folder, or a pull request's clone. */
  private async repoFor(target: ReviewTarget, head: string, say: (text: string) => void): Promise<string> {
    if (target.kind === 'change') {
      const repo = this.options.repoOf(target.slug)
      if (!repo) throw new Error(`hobkin knows no folder for the project ${target.slug}.`)
      return repo
    }
    if (!this.options.pullRepo) throw new Error('This host checks out no pull requests, so it cannot review one.')
    return this.options.pullRepo(target, head, say)
  }

  /**
   * Readies the review tree of the target's repository at `head` and lends it to `use`, one user at a time, so a run's
   * tests and a preparation's scan never share a checkout. The tree is the review's own, never the user's folder.
   */
  async inTree<Value>(target: ReviewTarget, repo: string, head: string, use: (tree: string) => Promise<Value>, say?: (text: string) => void): Promise<Value> {
    const tree = treeOf(this.options.root, target)
    const before = this.turns.get(tree) ?? Promise.resolve()
    let release = () => {}
    const mine = new Promise<void>((resolve) => (release = resolve))
    const tail = before.then(() => mine)
    this.turns.set(tree, tail)
    try {
      await before
      say?.(`Readying the review checkout at ${head.slice(0, 7)}.`)
      await readyReviewTree({ repo, tree, head, git: this.options.git ?? gitIn, log: this.options.log })
      return await use(tree)
    } finally {
      release()
      if (this.turns.get(tree) === tail) this.turns.delete(tree)
    }
  }

  private async one({ target, head, base, description }: AssessJob) {
    const { root } = this.options
    const { signal } = this.controller
    const say = (text: string, step?: string) => this.say(target, head, text, step)
    // Every update of a run says when it started, so a window that opens late still counts from the start.
    const startedAt = this.records.get(this.key(target, head))?.startedAt ?? this.clockIso()
    const running = (status: Omit<AssessmentStatus, 'state' | 'head' | 'startedAt'>) => this.set(target, head, { state: 'running', head, startedAt, ...status })
    running({ percent: 0, now: 'checking the change out in the review tree', eta: null, steps: pendingSteps() })
    const repo = await this.repoFor(target, head, say)
    if (signal.aborted) throw new Error(STOPPED)
    const result = await this.inTree(
      target,
      repo,
      head,
      async (tree) => {
        if (signal.aborted) throw new Error(STOPPED)
        const out = assessmentFolder(root, target, head)
        mkdirSync(out, { recursive: true, mode: 0o700 })
        // The run rewrites the story and its units, so a summary of the last one never stands beside them.
        rmSync(join(out, 'summary.json'), { force: true })
        let said = ''
        return this.options.run({
          cwd: tree,
          base,
          head,
          out,
          description,
          signal,
          onProgress: (progress) => {
            if (progress.now !== said) {
              said = progress.now
              say(progressWords(progress.now), progress.steps.find((step) => step.status === 'running')?.id)
            }
            running({
              percent: progress.percent,
              now: progress.now,
              eta: progress.eta_seconds,
              steps: progress.steps.map(({ id, status, done, total, seconds, note }) => ({ id, status, done, total, seconds, ...(note ? { note } : {}) })),
            })
          },
        })
      },
      say,
    )
    // A run stopped on the way has not finished, whatever it answered, so no summary says it has.
    if (signal.aborted) throw new Error(STOPPED)
    const summary = summarize(result, this.clockIso())
    writeWhole(join(assessmentFolder(root, target, head), 'summary.json'), JSON.stringify(summary))
    say(`Finished: ${finishedWords(summary)}`)
    this.set(target, head, { state: 'ready', head, summary })
    try {
      const request = this.records.get(this.key(target, head))?.request
      this.options.onReady?.({ target, head, summary, ...(request ? { request } : {}) })
    } catch (error) {
      this.options.log?.(`Change review of ${reviewIdOf(target)} at ${head.slice(0, 7)}: what was told of it failed: ${messageOf(error)}`)
    }
  }

  /**
   * What a finished review wrote: the story and its units, for the Review screen. Null until one is ready. The units
   * carry the model's words where it wrote some, so the window shows them first.
   */
  read(target: ReviewTarget, head: string): ChangeAssessment | null {
    const folder = assessmentFolder(this.options.root, target, head)
    const summary = readJson<AssessmentSummary>(join(folder, 'summary.json'))
    if (!summary) return null
    let story: string
    try {
      story = readFileSync(join(folder, 'story.md'), 'utf8')
    } catch {
      return null
    }
    const written = readJson<Units>(join(folder, 'units.json'))
    // A run from before story-words.json kept the model's words in its story only.
    const words = readJson<StoryWords>(join(folder, 'story-words.json')) ?? (summary.storyBy === 'model' ? wordsInStory(story, written) : null)
    const units = written && { ...written, units: written.units.map((unit) => toldUnit(unit, words?.units?.[unit.id])) }
    const graph = readJson<{ nodes?: GraphNode[] }>(join(folder, 'graph.json'))
    const unitOf = new Map((units?.units ?? []).flatMap((unit) => unit.nodes.map((node) => [node, unit] as const)))
    return {
      head,
      summary,
      story,
      units,
      triage: readJson(join(folder, 'triage.json')),
      blind: readJson(join(folder, 'blind-check.json')),
      progress: readJson(join(folder, 'progress.json')),
      // A node is at its unit's level, as the story tells it: the graph keeps only its own, and an unverified node is
      // high in its unit whatever the graph says. A removed one sits on lines at base, so it lays no level over head.
      nodes: (graph?.nodes ?? []).flatMap((node) => {
        const unit = unitOf.get(node.id)
        const level = unit?.level ?? node.level?.current
        if (node.kind === 'test' || node.change === 'removed' || !level) return []
        return [{ id: node.id, symbol: node.symbol, path: node.path, lines: node.lines, level, critical: node.critical, unit: unit?.id ?? null }]
      }),
    }
  }

  /**
   * The review as its change review tells it: each node at its unit's level, and one step per unit in the order the
   * story walks, after an opening with the change's claim. Null until a change review is ready for the review's commit.
   */
  present(target: ReviewTarget, review: Review): Review | null {
    const assessment = this.read(target, review.change.head)
    if (!assessment?.units) return null
    const folder = assessmentFolder(this.options.root, target, review.change.head)
    const graph = readJson<{ nodes?: GraphNode[] }>(join(folder, 'graph.json'))
    const places: UnitPlace[] = (graph?.nodes ?? []).map(({ id, kind, symbol, path, lines, change, extras }) => ({ id, kind, symbol, path, lines, change, ...(extras?.broken ? { broken: true } : {}) }))
    // Every run once: a run that concerns several definitions is listed under each of them.
    const runs = new Map<string, UnitRun>()
    for (const node of graph?.nodes ?? []) {
      for (const run of node.runs ?? []) runs.set(JSON.stringify([run.kind, run.node ?? null, run.tests ?? []]), { kind: run.kind, ...(run.node ? { node: run.node } : {}), tests: run.tests ?? [], failed: run.failed ?? [], ...(run.failed_at ? { failed_at: run.failed_at } : {}) })
    }
    const words = readJson<StoryWords>(join(folder, 'story-words.json'))
    const levelled = withLevels(review, assessment)
    // When no test could run, every definition's proof says why.
    const notRun = (graph?.nodes ?? []).map((node) => node.facts?.proof?.evidence ?? '').find((evidence) => evidence.startsWith(NOT_RUN))?.slice(NOT_RUN.length)
    const nodes = unitWords(levelled, { units: assessment.units.units, places, words, runs: [...runs.values()], ...(runs.size === 0 && notRun ? { notRun } : {}) })
    const told = { ...levelled, nodes }
    const story = unitStory(told, { units: assessment.units.units, places, words, story: assessment.story, buckets: assessment.triage?.buckets ?? [] })
    return { ...told, story }
  }

  /** Waits for whatever is queued or under way. For tests and for closing. */
  async settled(): Promise<void> {
    while (this.working) await this.working
  }

  /** A change review of this target is waiting or under way, at any commit. */
  busy(target: ReviewTarget): boolean {
    const mine = `${reviewIdOf(target)}@`
    return [...this.live].some(([key, status]) => key.startsWith(mine) && (status.state === 'queued' || status.state === 'running'))
  }

  /** Forgets what this host remembers of a target's change reviews, once its files are gone. */
  forget(target: ReviewTarget): void {
    const mine = `${reviewIdOf(target)}@`
    for (const map of [this.live, this.records]) for (const key of [...map.keys()]) if (key.startsWith(mine)) map.delete(key)
  }

  close(): void {
    this.controller.abort()
    this.queue.length = 0
  }
}

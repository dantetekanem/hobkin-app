/**
 * The change review of a finished hobkin change (spec 032): once a change ships, the host checks it out in a review
 * worktree of its own and runs the change-review package on it in the background. Triage, the node map with proof
 * from the project's own tests, a level per unit and the story the user reads. One review runs at a time, because a
 * project's tests are heavy, and each commit is reviewed once. What it writes stays in the home beside the change's
 * review, so it opens at once and survives a restart.
 *
 * The engine stands apart from this app (`packages/change-review`); this file only hands it a checkout, a range and a
 * model, and reads back what it wrote.
 */
import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { reviewFolder, reviewIdOf, type ReviewTarget } from '#shared/review/ids.ts'
import type { AssessmentStatus, AssessmentSummary, ChangeAssessment, Level, Units } from '#shared/review/assessment.ts'
import type { Review } from '#shared/review/types.ts'

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

/** What the host reads of a rated node in the engine's graph.json. */
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

export const gitIn: GitRun = async (cwd, ...args) =>
  (await run('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim()

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
  const level = units.some((unit) => unit.level === 'high') ? 'high' : units.some((unit) => unit.level === 'mid') ? 'mid' : 'safe'
  return {
    level,
    critical: units.some((unit) => unit.critical),
    needsYou: units.filter((unit) => unit.level === 'high').length,
    worthALook: units.filter((unit) => unit.level === 'mid').length,
    safe: units.filter((unit) => unit.level === 'safe').length,
    storyBy: result.storyBy,
    at,
  }
}

export interface AssessmentsOptions {
  root: string
  run: AssessRun
  /** The project's own folder, or null when hobkin knows none. */
  repoOf: (slug: string) => string | null
  git?: GitRun
  onChange?: () => void
  log?: (line: string) => void
  now?: () => number
}

interface Job {
  target: ReviewTarget & { kind: 'change' }
  head: string
  base: string
  description: AssessRequest['description']
}

/** Why a run that close() stopped failed. */
const STOPPED = 'The review was stopped before it finished.'

/** Every change review this host has run or is running, one at a time, each commit once. */
export class Assessments {
  private readonly queue: Job[] = []
  private readonly live = new Map<string, AssessmentStatus>()
  private readonly controller = new AbortController()
  private working: Promise<void> | null = null
  private readonly options: AssessmentsOptions

  constructor(options: AssessmentsOptions) {
    this.options = options
  }

  private key = (target: ReviewTarget, head: string) => `${reviewIdOf(target)}@${head}`

  private set(target: ReviewTarget, head: string, status: AssessmentStatus) {
    this.live.set(this.key(target, head), status)
    this.options.onChange?.()
  }

  /** How the review of this commit stands: from this host's memory, else from what an earlier run left in the home. */
  status(target: ReviewTarget, head: string | null): AssessmentStatus {
    if (!head) return { state: 'idle', head: null }
    const known = this.live.get(this.key(target, head))
    if (known) return known
    const folder = assessmentFolder(this.options.root, target, head)
    const summary = readJson<AssessmentSummary>(join(folder, 'summary.json'))
    if (summary) return { state: 'ready', head, summary }
    if (existsSync(join(folder, 'progress.json'))) return { state: 'failed', head, error: 'An earlier review of this commit stopped before it finished.' }
    return { state: 'idle', head }
  }

  /**
   * Reviews a finished change at `head` in the background. A commit already reviewed, queued or under way is left as
   * it is, so the same commit is never reviewed twice. `again` reviews it once more.
   */
  start(job: Job, { again = false }: { again?: boolean } = {}): AssessmentStatus {
    const now = this.status(job.target, job.head)
    if (now.state === 'queued' || now.state === 'running') return now
    if (now.state === 'ready' && !again) return now
    if (this.queue.some((entry) => this.key(entry.target, entry.head) === this.key(job.target, job.head))) return now
    this.queue.push(job)
    this.set(job.target, job.head, { state: 'queued', head: job.head })
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
        const message = error instanceof Error ? error.message : String(error)
        this.options.log?.(`Change review of ${reviewIdOf(job.target)} at ${job.head.slice(0, 7)} failed: ${message}`)
        this.set(job.target, job.head, { state: 'failed', head: job.head, error: message })
      })
    }
  }

  private async one({ target, head, base, description }: Job) {
    const { root, repoOf, git = gitIn, log } = this.options
    const { signal } = this.controller
    const repo = repoOf(target.slug)
    if (!repo) throw new Error(`hobkin knows no folder for the project ${target.slug}.`)
    this.set(target, head, { state: 'running', head, percent: 0, now: 'checking the change out in the review tree' })
    const tree = await readyReviewTree({ repo, tree: join(root, 'client', 'review-trees', target.slug), head, git, log })
    if (signal.aborted) throw new Error(STOPPED)
    const out = assessmentFolder(root, target, head)
    mkdirSync(out, { recursive: true, mode: 0o700 })
    // The run rewrites the story and its units, so a summary of the last one never stands beside them.
    rmSync(join(out, 'summary.json'), { force: true })
    const result = await this.options.run({
      cwd: tree,
      base,
      head,
      out,
      description,
      signal,
      onProgress: (progress) =>
        this.set(target, head, {
          state: 'running',
          head,
          percent: progress.percent,
          now: progress.now,
          eta: progress.eta_seconds,
          steps: progress.steps.map(({ id, status, done, total, seconds, note }) => ({ id, status, done, total, seconds, ...(note ? { note } : {}) })),
        }),
    })
    // A run stopped on the way has not finished, whatever it answered, so no summary says it has.
    if (signal.aborted) throw new Error(STOPPED)
    const summary = summarize(result, new Date((this.options.now ?? Date.now)()).toISOString())
    writeWhole(join(out, 'summary.json'), JSON.stringify(summary))
    this.set(target, head, { state: 'ready', head, summary })
  }

  /** What a finished review wrote: the story and its units, for the Review screen. Null until one is ready. */
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
    const units = readJson<Units>(join(folder, 'units.json'))
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

  /** Waits for whatever is queued or under way. For tests and for closing. */
  async settled(): Promise<void> {
    while (this.working) await this.working
  }

  close(): void {
    this.controller.abort()
    this.queue.length = 0
  }
}

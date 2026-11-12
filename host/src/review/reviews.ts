/**
 * Change Review in the host: reviews prepared in the background, kept as artifacts in the home, and opened at once.
 *
 * A review is prepared once for each commit of its change. The host reads the change and owns every code range: it
 * draws the graph and checks it before anyone sees it. Then the change review (spec 032) runs on it, for a finished
 * change and a pull request alike, and once that is ready the review is told as its units. A change that moves to a
 * new commit gets a new review, and the old one stays where it was. Specs: 005-review-model, 009-review-notes, 032.
 */
import { createHash } from 'node:crypto'
import { completeReview, draftReview } from '#shared/review/prepare.ts'
import { reviewIdOf, targetOfReviewId, type ReviewTarget } from '#shared/review/ids.ts'
import { detached as detachedNotes, foldNotes, type Note, type NoteEntry, type NoteIntent, type NoteTarget } from '#shared/review/notes.ts'
import type { AssessmentLogLine, AssessmentRequest, AssessmentStatus } from '#shared/review/assessment.ts'
import { count } from '#shared/review/prose.ts'
import { IDLE_STATUS, type OpenedReview, type ReviewCursor, type ReviewLanding, type ReviewList, type ReviewListItem, type ReviewNotes, type ReviewStatus, type VerdictPreview } from '#shared/review/status.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { openReview } from '#shared/review/validate.ts'
import { askForChanges, pullReviewPost, type PullReviewPost, type Verdict } from '#shared/review/verdict.ts'
import { Unavailable } from '../commands.ts'
import { LOG_LINES, pendingSteps, type Assessments } from './assessment.ts'
import { ghText, type GhCall } from './gh.ts'
import type { MergePlan, Moved } from './landing.ts'
import type { ReviewSource } from './sources.ts'
import type { Prepared, ReviewStore } from './store.ts'

/** Something to prepare in the background, with what says it changed: a change's commit, or when a pull request last changed on GitHub. */
export interface Watched {
  id: string
  head?: string | null
  updatedAt?: string | null
}

/** What a finished change's card says a yes does, from the Work screen (`011-work`). */
export interface ChangeCard {
  /** How its yes lands it: hobkin's `merge`, `mergePr` or `refreshMerge`. */
  landing: 'merge' | 'mergePr' | 'refreshMerge'
  /** What a yes does, in hobkin's words. */
  yes: string
  /** Its branch, when it has one. */
  branch: string | null
  /** Its pull request's address, once one is open. */
  pr: string | null
}

/** Where a finished change's pull request goes: its GitHub repository as `owner/name`, the branch it merges into, and its own. */
export interface PublishPlan {
  slug: string
  repo: string
  base: string
  branch: string
}

/** Opens a finished change's pull request once the review says yes. */
export interface Publisher {
  /** Where the pull request would go. Throws, with the reason, when the change cannot have one. */
  plan(slug: string, branch: string): Promise<PublishPlan>
  /** Pushes the branch at the reviewed commit and opens the pull request. */
  open(plan: PublishPlan, pull: { head: string; title: string; body: string }): Promise<{ url: string }>
}

export interface ReviewsOptions {
  store: ReviewStore
  sources: { change: ReviewSource; pull: ReviewSource }
  /** hobkin's work actions, for a verdict on a finished change. Throws with the reason while hobkin is not open. */
  work: () => { workAction(action: string, slug?: unknown, value?: unknown, extra?: unknown): Promise<unknown> }
  /** The card of a finished change, or null when hobkin no longer lists it. */
  card: (slug: string, item: string) => ChangeCard | null
  /** gh, for a verdict on a pull request. A host given none posts nothing. */
  gh?: GhCall
  /** Opens a finished change's pull request. A host given none opens none. */
  publish?: Publisher
  /** The commit a change is at now, as the app already knows it without asking anyone. Null when it does not know. */
  head?: (target: ReviewTarget) => string | null
  onChange?: () => void
  log?: (line: string) => void
  now?: () => number
  /**
   * The change review (spec 032) of finished changes and pull requests: started once a review's graph is ready, one
   * commit once, and read back when the review opens. A host given none reviews nothing that way, and its reviews keep
   * the host's own steps.
   */
  assessments?: Assessments
  /**
   * A pull request's review the user asked for is ready, on a host with no change reviews. With them, the change review
   * tells it once it is ready instead, and a review the background prepared on its own is not told at all.
   */
  onReady?: (ready: { target: ReviewTarget; review: Review; at: string }) => void
  /** What a review is about before its file can say: a finished change's title and project, as the Work screen has them. */
  describe?: (target: ReviewTarget) => { title: string; project: string } | null
  /**
   * Where a finished change stands in hobkin's own records after a yes: merged, being brought up to date to merge, or
   * neither (null). A change hobkin no longer lists as finished may simply be merged, which is no error.
   */
  landing?: (target: ChangeTarget) => ReviewLanding | null
  /**
   * How a yes lands a finished change now, from git: straight away when it merges cleanly, brought up to date first only
   * when it conflicts, and at the commit its branch is at now. A host given none lands it the way its card says.
   */
  merging?: (target: ChangeTarget, change: { reviewed: string; current: string; pr: boolean }) => Promise<MergePlan>
}

/** A finished hobkin change, as a review target. */
type ChangeTarget = Extract<ReviewTarget, { kind: 'change' }>

interface Job {
  target: ReviewTarget
  head: string | null
  refresh: boolean
}

/** A finished change's pull request: where it goes, and what it says. */
interface Publication {
  plan: PublishPlan
  pull: { head: string; title: string; body: string }
}

/** How a pull request is merged, as its repository allows: squashed, with a merge commit, or rebased. */
type MergeMethod = 'squash' | 'merge' | 'rebase'

/** What approve and merge does to a pull request: the review it posts first, if any, and how it merges. */
interface Merge {
  post: PullReviewPost | null
  method: MergeMethod
  base: string
  /** The user opened it: GitHub lets nobody approve their own pull request. */
  mine: boolean
}

/** A verdict's preview, with the review, card and pull request it was built from. */
interface Planned {
  preview: VerdictPreview
  review: Review
  /** Null for a pull request from GitHub. */
  card: ChangeCard | null
  /** For `approve` on a finished change. */
  publication?: Publication
  /** For `approve-merge` on a pull request. */
  merge?: Merge
  /** For `approve-merge` on a finished change, with git's word on how it lands. */
  plan?: MergePlan
  /** Nothing is left to do, and this says why: it merged already, or it is being brought up to date to merge. */
  done?: string
}

/** What a preparation did, for the log its change review takes over, and what it reviews once it is read. */
interface RunLog {
  head: string | null
  startedAt: string
  lines: AssessmentLogLine[]
  request?: AssessmentRequest
  /** Why it stopped, when it did. */
  error?: string
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** What a review is about when neither a run nor hobkin nor the home can say: the target's own names. */
const aboutFromTarget = (target: ReviewTarget) =>
  target.kind === 'change' ? { title: target.item, project: target.slug } : { title: `#${target.number}`, project: `${target.owner}/${target.repo}` }

/** What a change review reviews, as its status says it: the project, the title, both commits and the size. */
function requestOf(target: ReviewTarget, review: Review): AssessmentRequest {
  const { change } = review
  return {
    kind: target.kind,
    project: change.project,
    ...(target.kind === 'pull' ? { number: target.number } : {}),
    title: change.title,
    base: change.base,
    head: change.head,
    files: change.files,
    added: change.additions,
    removed: change.deletions,
  }
}

/** A few names, quoted: `"a", "b" and 3 more`. */
function some(names: readonly string[], shown = 3): string {
  const quoted = names.slice(0, shown).map((name) => `"${name}"`)
  if (names.length > shown) return `${quoted.join(', ')} and ${names.length - shown} more`
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}` : (quoted[0] ?? '')
}

/** What moved on a branch since its review, in a line. */
function movedWords({ rebased, same, subjects }: Moved, into: string, at: string): string {
  if (rebased && same) return `Since this review it was rebased onto ${into}: the same change, now at ${at}.`
  const which = subjects.length ? `: ${some(subjects)}` : ''
  if (rebased) return `Since this review it was written again, and is now at ${at}${which}.`
  return `Since this review it gained ${count(subjects.length, 'commit')}${which}.`
}

/** What a yes does to a finished change, line by line, as git says it lands now. */
function landingLines(plan: MergePlan, pr: string | null): string[] {
  const at = plan.head.slice(0, 7)
  const how =
    plan.route === 'refreshMerge'
      ? `It conflicts with ${plan.into}: an agent brings it up to date, then hobkin merges it.`
      : plan.route === 'mergePr'
        ? `Merge its pull request on GitHub${pr ? `, ${pr}` : ''}, at ${at}.`
        : plan.merges === 'fast-forward'
          ? `Merge it into ${plan.into} on this machine: ${plan.into} moves up to ${at}. Nothing is pushed.`
          : `Merge it into ${plan.into} on this machine, with a merge commit. Nothing is pushed.`
  const moved = plan.moved ? movedWords(plan.moved, plan.into, at) : null
  return [how, ...(moved ? [moved] : []), moved ? `This merges ${at}, the commit shown here.` : `At commit ${at}, the one this review was built from.`]
}

/** A merged change, in the words a verdict on it answers with. */
const mergedWords = (landing: ReviewLanding) => `Already merged${landing.into ? ` into ${landing.into}` : ''}${landing.sha ? ` at ${landing.sha.slice(0, 7)}` : ''}.`

/** The words for how a pull request is merged, in a preview. */
const MERGE_WORDS: Record<MergeMethod, string> = {
  squash: 'by squashing its commits into one',
  merge: 'with a merge commit',
  rebase: 'by rebasing its commits onto it',
}

/** How often an opened review asks where its change is now, when the app does not already know. */
export const LOOK_AGAIN_MS = 60_000

/**
 * The rules the host draws a graph by. A review asked for whose graph was drawn by older rules is drawn again: 2 is the
 * graph whose nodes say what they are and whose tests, dependencies and pull request life cycles are wired.
 */
export const GRAPH_RULES = 2

/** Every review the host has prepared or is preparing, and what to do with them. */
export class Reviews {
  private readonly statuses = new Map<string, ReviewStatus>()
  private readonly queue: Job[] = []
  private readonly running = new Map<string, Promise<void>>()
  private readonly opened = new Map<string, Prepared>()
  /** The version of each watched review last looked at, so the background looks at each version once. */
  private readonly watched = new Map<string, string>()
  private readonly controller = new AbortController()
  private working = false
  /** When each review last asked where its change is now. */
  private readonly lookedAt = new Map<string, number>()
  /** How many notes hobkin has written, so two in the same millisecond still have their own ids. */
  private written = 0
  /** The reviews someone asked for, by the window or by hobkin, as against what the background prepares by itself. */
  private readonly asked = new Set<string>()
  /** When each review's status last changed, in milliseconds by the host's clock. */
  private readonly changedAt = new Map<string, number>()
  /** What each review is about, as its change read when it was prepared. */
  private readonly about = new Map<string, { title: string; project: string }>()
  /** What each review's latest preparation did. */
  private readonly runs = new Map<string, RunLog>()
  private readonly options: ReviewsOptions

  constructor(options: ReviewsOptions) {
    this.options = options
  }

  private now() {
    return (this.options.now ?? Date.now)()
  }

  /** `at` is when it changed, for a caller that has read the clock already. */
  private set(id: string, change: Partial<ReviewStatus>, at = this.now()) {
    const next = { ...this.stored(id), ...change }
    // A start is only said while something is queued or under way.
    if (next.phase == null) delete next.startedAt
    this.statuses.set(id, next)
    this.changedAt.set(id, at)
    this.options.onChange?.()
  }

  /** Adds a line to what the review's preparation did, keeping the latest. */
  private say(id: string, text: string) {
    const run = this.runs.get(id)
    if (!run) return
    run.lines.push({ at: new Date(this.now()).toISOString(), text })
    if (run.lines.length > LOG_LINES) run.lines.splice(0, run.lines.length - LOG_LINES)
  }

  private target(id: string): ReviewTarget {
    const target = targetOfReviewId(id)
    if (!target) throw new Error(`There is no review named ${id}.`)
    return target
  }

  /** What this host knows of a review's preparation, before asking where its change is now. */
  private stored(id: string): ReviewStatus {
    const known = this.statuses.get(id)
    if (known) return known
    // A review prepared before the host started is ready from its file.
    const newest = this.options.store.newest(this.target(id))
    if (!newest) return IDLE_STATUS(id)
    return { ...IDLE_STATUS(id), state: 'ready', preparedAt: newest.meta?.preparedAt ?? new Date(newest.at).toISOString(), storyBy: newest.meta?.storyBy ?? null }
  }

  /** A preparation of this review is waiting or under way. */
  private preparing(id: string): boolean {
    return this.running.has(id) || this.queue.some((job) => reviewIdOf(job.target) === id)
  }

  /**
   * How a review's change review stands at `head`: as it runs or ran; queued behind the graph it starts from while that
   * is prepared, with what the preparation did so far; or failed, with why, when the preparation could not finish.
   * Undefined on a host with no change reviews.
   */
  private assessmentOf(id: string, target: ReviewTarget, head: string | null): AssessmentStatus | undefined {
    const { assessments } = this.options
    if (!assessments) return undefined
    const known = assessments.status(target, head)
    const run = this.runs.get(id)
    if (!run || known.state === 'queued' || known.state === 'running' || (head && run.head && run.head !== head)) return known
    const preparing = this.preparing(id)
    if (!preparing && !(run.error && (known.state === 'idle' || known.state === 'failed'))) return known
    const shared = { head: run.head ?? head, startedAt: run.startedAt, ...(run.request ? { request: run.request } : {}), log: [...run.lines] }
    if (!preparing) return { state: 'failed', ...shared, error: run.error }
    return { state: 'queued', ...shared, percent: 0, eta: null, now: run.lines.at(-1)?.text ?? 'Waiting for its turn.', steps: pendingSteps() }
  }

  /**
   * How a review's preparation stands. A ready review is outdated when its change is at a commit no review was built
   * for: it still opens, and says so, until a newer one is ready.
   */
  status(id: string): ReviewStatus {
    const target = this.target(id)
    const known = this.stored(id)
    const head = this.options.head?.(target) ?? known.head
    const at = head ?? this.opened.get(id)?.review.change.head ?? null
    const assessment = this.assessmentOf(id, target, at)
    const landing = this.landingOf(target)
    // A branch being brought up to date on the user's word moves as it should: that is no newer change to review.
    const stale = known.state === 'ready' && head != null && !this.options.store.has(target, head) && landing?.state !== 'refreshing'
    return { ...known, head, stale, ...(assessment ? { assessment } : {}), ...(landing ? { landing } : {}) }
  }

  /** Where a finished change stands after a yes, as hobkin's records say. Null for a pull request, or when nothing was said yet. */
  private landingOf(target: ReviewTarget): ReviewLanding | null {
    if (target.kind !== 'change' || !this.options.landing) return null
    try {
      return this.options.landing(target)
    } catch (error) {
      this.options.log?.(`Review ${reviewIdOf(target)} could not read how its change landed: ${messageOf(error)}`)
      return null
    }
  }

  /**
   * Every review the host knows, newest first: what it prepared or is preparing since it started, and every review in
   * the home. Each says what it is about, how its preparation stands, and how its change review does, without its steps
   * or its log.
   */
  list(): ReviewList {
    const stored = new Map(this.options.store.list().map((entry) => [reviewIdOf(entry.target), entry]))
    const items = [...new Set([...this.statuses.keys(), ...stored.keys()])].flatMap((id): { item: ReviewListItem; at: number }[] => {
      const target = targetOfReviewId(id)
      if (!target) return []
      const status = this.status(id)
      const kept = stored.get(id)
      const head = status.head ?? kept?.change?.head ?? null
      const about = this.about.get(id) ?? this.options.describe?.(target) ?? kept?.change ?? aboutFromTarget(target)
      const known = this.assessmentOf(id, target, head)
      const times = [this.changedAt.get(id), Date.parse(status.preparedAt ?? ''), Date.parse(known?.summary?.at ?? ''), Date.parse(known?.startedAt ?? '')].filter(
        (time): time is number => time != null && Number.isFinite(time),
      )
      const at = times.length > 0 ? Math.max(...times) : (kept?.at ?? 0)
      const item: ReviewListItem = {
        id,
        kind: target.kind,
        title: about.title,
        project: about.project,
        head,
        state: status.state,
        phase: status.phase,
        ...(status.startedAt ? { startedAt: status.startedAt } : {}),
        error: status.error,
        ...(known ? { assessment: forList(known) } : {}),
        updatedAt: new Date(at).toISOString(),
      }
      return [{ item, at }]
    })
    return { reviews: items.sort((a, b) => b.at - a.at || a.item.id.localeCompare(b.item.id)).map(({ item }) => item) }
  }

  /**
   * Asks where the change is now, at most once a minute for each review, so an opened review can say it is outdated.
   * A pull request is asked of GitHub. Nothing is prepared here: the reviewer chooses when to rebuild.
   */
  async lookAgain(id: string, now: () => number = this.options.now ?? Date.now): Promise<void> {
    const target = this.target(id)
    const at = now()
    const last = this.lookedAt.get(id)
    if ((last != null && at - last < LOOK_AGAIN_MS) || this.landingOf(target)?.state === 'merged') return
    this.lookedAt.set(id, at)
    try {
      const head = await (target.kind === 'change' ? this.options.sources.change : this.options.sources.pull).head(target)
      if (head && head !== this.stored(id).head) this.set(id, { head }, at)
    } catch (error) {
      this.options.log?.(`Review ${id} could not look up its commit: ${messageOf(error)}`)
    }
  }

  /**
   * Prepares a review in the background, and answers at once with how it stands. A review already prepared for the
   * change's commit is used without a run, and one already under way is joined. A ready review stays ready, and opens,
   * while a newer one is prepared. `refresh` prepares it again even for the same commit. `asked` says someone asked
   * for it, the window or hobkin, so hobkin says in its chat when a pull request's review they asked for is ready.
   */
  prepare(id: string, { refresh = false, asked = false }: { refresh?: boolean; asked?: boolean } = {}): ReviewStatus {
    const target = this.target(id)
    const now = this.status(id)
    // Merged: there is nothing left to review, and its status says so.
    if (now.landing?.state === 'merged') return now
    if (asked) this.asked.add(id)
    const waiting = this.queue.find((job) => reviewIdOf(job.target) === id)
    if (waiting) {
      waiting.refresh ||= refresh
      return now
    }
    if (this.running.has(id) && !refresh) return now
    const ahead = this.queue.length + this.running.size
    this.queue.push({ target, head: null, refresh })
    const at = this.now()
    const startedAt = new Date(at).toISOString()
    this.runs.set(id, { head: null, startedAt, lines: [] })
    if (ahead > 0) this.say(id, `Waiting for ${count(ahead, 'review')} ahead of it.`)
    this.set(id, { state: now.state === 'ready' ? 'ready' : 'preparing', phase: 'queued', startedAt }, at)
    void this.work()
    return this.status(id)
  }

  private async work() {
    if (this.working) return
    this.working = true
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        const id = reviewIdOf(job.target)
        const run = this.run(job).catch((error: unknown) => {
          const message = messageOf(error)
          this.asked.delete(id)
          this.options.log?.(`Review ${id} could not be prepared: ${message}`)
          const log = this.runs.get(id)
          if (log) log.error = message
          this.say(id, `Stopped: ${message}`)
          // An older review still opens, and says the newer one could not be prepared.
          this.set(id, { state: this.options.store.newest(job.target) ? 'ready' : 'failed', phase: null, error: message })
        })
        this.running.set(id, run)
        await run
        this.running.delete(id)
        if (this.controller.signal.aborted) return
      }
    } finally {
      this.working = false
    }
  }

  private async run({ target, refresh }: Job) {
    const id = reviewIdOf(target)
    const { store } = this.options
    const source = target.kind === 'change' ? this.options.sources.change : this.options.sources.pull
    const say = (text: string) => this.say(id, text)
    this.set(id, { phase: 'reading', error: null })
    say(target.kind === 'pull' ? `Asking GitHub where #${target.number} is.` : 'Looking up the commit the change is at.')
    const head = await source.head(target)
    if (!head) throw new Error(target.kind === 'change' ? 'This change has no branch to read any more.' : 'This pull request is not open any more.')
    const log = this.runs.get(id)
    if (log) log.head = head
    // Ready, but for an older commit: it opens while the newer one is prepared.
    this.set(id, { head, stale: this.status(id).state === 'ready' && !store.has(target, head) })

    // One preparation for each commit: a review already made for it is used as it is, unless older rules drew its graph.
    const kept = refresh ? null : store.read(target, head)
    const cached = kept?.meta?.graph === GRAPH_RULES ? kept : null
    if (cached) {
      say(`The graph of ${head.slice(0, 7)} is drawn already.`)
      // Ready already, so there is no news to tell.
      this.asked.delete(id)
      this.opened.delete(id)
      if (log) log.request = requestOf(target, cached.review)
      this.set(id, { state: 'ready', phase: null, stale: false, preparedAt: cached.meta?.preparedAt ?? this.status(id).preparedAt, storyBy: cached.meta?.storyBy ?? null })
      this.assess(target, cached.review)
      return
    }

    const input = await source.read(target, head, { say, titled: (title) => this.about.set(id, { title, project: aboutFromTarget(target).project }) })
    this.about.set(id, { title: input.change.title, project: input.change.project })
    const { capture } = input
    if (log) log.request = { kind: target.kind, project: input.change.project, ...(target.kind === 'pull' ? { number: target.number } : {}), title: input.change.title, base: capture.base, head, files: capture.files.length, added: capture.additions, removed: capture.deletions }
    say(`Read ${count(capture.files.length, 'changed file')}: ${count(capture.additions, 'line')} added and ${count(capture.deletions, 'line')} removed.`)
    // No model narrates the graph: the change review tells the change (spec 032), and the graph keeps the host's steps.
    const draft = await draftReview({ ...input, id })
    this.set(id, { phase: 'checking' })
    const { review: completed, corrections } = await completeReview(draft)
    for (const line of corrections) this.options.log?.(`Review ${id}: ${line}`)
    // A pull request's description is shown as its author wrote it. Nothing in the review rests on it.
    const review = input.description === undefined ? completed : { ...completed, change: { ...completed.change, description: input.description } }

    const files = filesOf(draft.input.capture.files, draft.headFiles, review)
    const meta = { preparedAt: new Date(this.now()).toISOString(), storyBy: 'host' as const, graph: GRAPH_RULES }
    store.write(target, review, files, meta)
    say(`Drew the graph: ${count(review.nodes.length, 'node')} and ${count(review.edges.length, 'wire')}.`)
    this.opened.set(id, { review, files, meta })
    this.set(id, { state: 'ready', phase: null, stale: false, ...meta })
    const told = this.asked.delete(id)
    if (told && target.kind === 'pull' && !this.options.assessments) {
      try {
        this.options.onReady?.({ target, review, at: meta.preparedAt })
      } catch (error) {
        this.options.log?.(`Review ${id}: what was told of it failed: ${messageOf(error)}`)
      }
    }
    // Prepared again on the user's word: the change review runs again too.
    this.assess(target, review, { again: refresh })
  }

  /** Starts the change review at the commit the review's graph was built for. Never stops the graph. */
  private assess(target: ReviewTarget, review: Review, { again = false }: { again?: boolean } = {}) {
    const { assessments } = this.options
    if (!assessments) return
    const { change } = review
    const run = this.runs.get(reviewIdOf(target))
    try {
      assessments.start(
        {
          target,
          head: change.head,
          base: change.base,
          // A pull request's title and description are claims the review checks, never instructions.
          description: target.kind === 'pull' ? { source: 'pull-request', title: change.title, ...(change.description ? { body: change.description } : {}) } : { source: 'commits', title: change.title },
          request: requestOf(target, review),
          ...(run?.head === change.head ? { log: run.lines, startedAt: run.startedAt } : {}),
        },
        { again },
      )
    } catch (error) {
      this.options.log?.(`Review ${reviewIdOf(target)}: the change review could not start: ${messageOf(error)}`)
    }
  }

  /** Waits for whatever preparation of this review is under way. For tests and for closing. */
  async settled(id?: string): Promise<void> {
    while (this.working || (id && this.running.has(id))) await Promise.all([...this.running.values()])
  }

  private loaded(id: string): Prepared {
    const known = this.opened.get(id)
    if (known) return known
    const target = this.target(id)
    const status = this.status(id)
    const cached = (status.head && this.options.store.read(target, status.head)) || this.options.store.latest(target)
    if (!cached) {
      if (status.state === 'failed') throw new Unavailable(`This review could not be prepared: ${status.error}`)
      throw new Unavailable('This review is still being prepared.')
    }
    // The same check the window would run: a review whose anchors no longer match its files is refused.
    const byId = new Map(cached.files.map((file) => [file.fileId, file]))
    openReview(cached.review, (fileId, side) => (side === 'added' ? byId.get(fileId)?.head : byId.get(fileId)?.base) ?? null)
    this.opened.set(id, cached)
    return cached
  }

  /**
   * The review as the user reads it. Once its change review is ready it is told as its units, with their levels on
   * the graph. Until then it has no steps but its opening and closing: the host's own steps only count lines, and are no
   * review. On a host with no change reviews it stays as it was prepared.
   */
  private shown(target: ReviewTarget, review: Review): Review {
    const { assessments } = this.options
    if (!assessments) return review
    return assessments.present(target, review) ?? { ...review, story: review.story.filter((step) => step.kind !== 'walk').map(({ travel: _travel, ...step }) => step) }
  }

  /** The prepared review as the user reads it, with the reviewer's notes. */
  get(id: string): OpenedReview {
    const { review } = this.loaded(id)
    // Opening a review is when its change is looked up, when the app does not already know where it is.
    if (!this.options.head?.(this.target(id))) void this.lookAgain(id)
    const status = this.status(id)
    const target = this.target(id)
    const { assessments } = this.options
    const assessment = this.assessmentOf(id, target, review.change.head)
    return {
      review: this.shown(target, review),
      notes: this.options.store.notes(target),
      status: { ...status, stale: status.head != null && status.head !== review.change.head && status.landing?.state !== 'refreshing', ...(assessment ? { assessment } : {}) },
      ...(assessments ? { assessment: assessments.read(target, review.change.head) } : {}),
    }
  }

  /** Both sides of one file of a prepared review. */
  file(id: string, fileId: string): ReviewFileContents {
    const file = this.loaded(id).files.find((entry) => entry.fileId === fileId)
    if (!file) throw new Error(`${fileId} is not a file of this review.`)
    return file
  }

  /**
   * Keeps the reviewer's notes in the home, sent or not, so they come back after a restart. The window's log is laid
   * over what the home has, so a note hobkin left that the window has not seen yet stays, and one the window removed goes.
   */
  saveNotes(id: string, notes: ReviewNotes): void {
    const target = this.target(id)
    const saved = this.options.store.notes(target).entries as NoteEntry[]
    // Folded, so the file holds each note once however often it was changed.
    const merged = foldNotes([...saved, ...notes.entries])
    this.options.store.saveNotes(target, { entries: merged.map((note) => ({ op: 'put', note })), draft: notes.draft })
  }

  /** Moves the reviewer's view to a step, by its number from 1 in the story they read, or to a node. The window follows. */
  show(id: string, place: { step?: number; node?: string }): ReviewCursor {
    const review = this.shown(this.target(id), this.loaded(id).review)
    const { step, node } = place
    if ((step == null) === (node == null)) throw new Unavailable('Name a step or a node to show, and only one.')
    if (step != null && !isStepNumber(step, review)) throw new Unavailable(`This review has ${review.story.length} steps.`)
    if (node != null && !review.nodes.some((entry) => entry.id === node)) throw new Unavailable(`This review has no node ${node}.`)
    const cursor: ReviewCursor = { ...(step != null ? { step } : {}), ...(node != null ? { node } : {}), at: (this.options.now ?? Date.now)() }
    this.set(id, { cursor }, cursor.at)
    return cursor
  }

  /**
   * A note hobkin leaves on a review, signed as hobkin: on a node, on a wire, or on a step. It is taken on the step
   * that shows what it is about, so it reads in the story where the reviewer meets it.
   */
  note(id: string, { intent, text, step, node, wire }: { intent: NoteIntent; text: string; step?: number; node?: string; wire?: string }): Note {
    const target = this.target(id)
    const review = this.shown(target, this.loaded(id).review)
    const edge = wire == null ? undefined : review.edges.find((entry) => entry.id === wire)
    if (node != null && !review.nodes.some((entry) => entry.id === node)) throw new Unavailable(`This review has no node ${node}.`)
    if (wire != null && !edge) throw new Unavailable(`This review has no wire ${wire}.`)
    if (step != null && !isStepNumber(step, review)) throw new Unavailable(`This review has ${review.story.length} steps.`)
    const about: NoteTarget = node != null ? { kind: 'node', node } : edge ? { kind: 'wire', wire: edge.id } : { kind: 'step' }
    const shown = [node, edge?.from, edge?.to].filter((entry): entry is string => entry != null)
    const cursor = this.stored(id).cursor?.step
    const taken =
      (step != null ? review.story[step - 1] : undefined) ??
      review.story.find((entry) => entry.focus.some((focused) => shown.includes(focused))) ??
      (cursor != null ? review.story[cursor - 1] : undefined) ??
      review.story.find((entry) => entry.kind === 'walk') ??
      review.story[0]!
    const at = (this.options.now ?? Date.now)()
    const note: Note = { id: `hobkin-${at.toString(36)}-${(this.written += 1)}`, step: taken.id, target: about, intent, text: text.trim(), author: 'hobkin', at }
    const saved = this.options.store.notes(target)
    const notes = foldNotes([...(saved.entries as NoteEntry[]), { op: 'put', note }])
    this.options.store.saveNotes(target, { entries: notes.map((entry) => ({ op: 'put', note: entry })), draft: saved.draft })
    this.set(id, { notesAt: at }, at)
    return note
  }

  /**
   * What a verdict will do, built from the review and the notes in the home, with the token that lets it go.
   * Nothing is sent here. `head` is the commit of the review on the user's screen: when the host holds a review of
   * another commit, prepared again since, it is refused, so nobody answers one review with what another would do.
   */
  async preview(id: string, verdict: Verdict, summary: string, head?: string): Promise<VerdictPreview> {
    return (await this.planned(id, verdict, summary, head)).preview
  }

  /** The preview, and the review, card and pull request it was built from, so a verdict does exactly what was shown. */
  private async planned(id: string, verdict: Verdict, summary: string, head?: string): Promise<Planned> {
    const target = this.target(id)
    const { files, review: prepared } = this.loaded(id)
    const review = this.shown(target, prepared)
    const at = review.change.head
    // Every token holds the commit it was shown for, so no verdict ever acts on another one.
    const token = (...shown: unknown[]) => sha256(JSON.stringify([target.kind, id, verdict, at, ...shown]))
    // A merged change is merged whatever the verdict, and one being brought up to date to merge has the user's word already.
    const landing = this.landingOf(target)
    if (landing?.state === 'merged') return { review, card: null, done: mergedWords(landing), preview: { verdict, lines: [mergedWords(landing)], confirm: token('merged', landing.sha ?? null) } }
    if (landing?.state === 'refreshing' && verdict === 'approve-merge') {
      const said = landing.message ?? 'It is being brought up to date already, and hobkin merges it once that run ends well.'
      return { review, card: null, done: said, preview: { verdict, lines: [said], confirm: token('refreshing') } }
    }
    // Approve and merge lands where the branch is now and says what moved, so a moved head is no refusal there.
    const lands = target.kind === 'change' && verdict === 'approve-merge' && this.options.merging != null
    if (head != null && !at.startsWith(head) && !lands) throw new Unavailable(`This review is for commit ${head.slice(0, 7)}; the change has moved to ${at.slice(0, 7)}. Rebuild the review and look again.`)
    const notes = foldNotes(this.options.store.notes(target).entries as NoteEntry[])
    const byId = new Map(files.map((file) => [file.fileId, file]))
    const loose = new Set(detachedNotes(notes, (fileId, side) => (side === 'added' ? byId.get(fileId)?.head : byId.get(fileId)?.base) ?? null))

    if (target.kind === 'pull') {
      const name = `${target.owner}/${target.repo}#${target.number}`
      const lineComments = (post: PullReviewPost) => (post.comments.length ? `with ${post.comments.length === 1 ? 'one comment' : `${post.comments.length} comments`} on lines` : 'with no comments on lines')
      const pinned = `At commit ${at.slice(0, 7)}, the one this review was built from. GitHub refuses if the pull request has moved since.`
      if (verdict === 'approve-merge') {
        const { mine, method, base } = await this.pullFacts(target)
        // GitHub lets nobody approve their own pull request: what the user wrote still goes, as a comment, and then it merges.
        const post = pullReviewPost(review, notes, mine ? 'comment' : 'approve', summary, loose)
        const says = !mine || post.comments.length > 0 || post.body !== 'Commented.'
        const lines = mine
          ? [
              'GitHub does not let you approve your own pull request, so this merges it without an approval.',
              ...(says ? [`Comment on ${name} on GitHub first, as you, through gh, ${lineComments(post)}.`] : []),
              `Merge ${name} into ${base} ${MERGE_WORDS[method]}, as you, through gh.`,
              pinned,
            ]
          : [`Approve ${name} on GitHub, as you, through gh, ${lineComments(post)}.`, `Then merge it into ${base} ${MERGE_WORDS[method]}.`, pinned]
        const merge: Merge = { post: says ? post : null, method, base, mine }
        return { review, card: null, merge, preview: { verdict, lines, ...(says ? { post } : {}), confirm: token(merge) } }
      }
      // GitHub would refuse it, so it is refused here, before anything is sent.
      if (verdict === 'approve' && this.options.gh && (await this.pullFacts(target)).mine) {
        throw new Unavailable('GitHub does not let you approve your own pull request. Approve and merge merges it without an approval, or leave a comment.')
      }
      const post = pullReviewPost(review, notes, verdict, summary, loose)
      const words = { comment: 'Comment on', approve: 'Approve', 'request-changes': 'Ask for changes on' }[verdict]
      const lines = [`${words} ${name} on GitHub, as you, through gh.`, `At commit ${at.slice(0, 7)}, the one this review was built from.`, `${lineComments(post).replace(/^w/, 'W')}.`]
      return { review, card: null, preview: { verdict, lines, post, confirm: token(post) } }
    }

    const card = this.options.card(target.slug, target.item)
    if (!card) throw new Unavailable('hobkin no longer lists this change as finished.')
    if (verdict === 'comment') throw new Unavailable('A finished change has nobody to comment to. Approve it, approve and merge it, or ask for changes.')
    if (verdict === 'approve') {
      const publication = await this.publication(target.slug, card, review)
      const { plan, pull } = publication
      const lines = [
        `Push ${plan.branch} at ${pull.head.slice(0, 7)} to ${plan.repo} on GitHub, as you.`,
        `Open a pull request from it into ${plan.base}, titled "${pull.title}".`,
        `Its description: ${pull.body}`,
        'Nothing is merged.',
      ]
      return { review, card, publication, preview: { verdict, lines, confirm: token(plan, pull) } }
    }
    if (verdict === 'approve-merge' && this.options.merging) {
      // Pinned to where the branch is now, as the preview shows it: the yes merges exactly that commit.
      const reviewed = head != null && !at.startsWith(head) ? head : at
      let plan: MergePlan
      try {
        plan = await this.options.merging(target, { reviewed, current: this.options.head?.(target) ?? at, pr: card.pr != null })
      } catch (error) {
        throw new Unavailable(messageOf(error))
      }
      return { review, card, plan, preview: { verdict, lines: landingLines(plan, card.pr), confirm: token(plan) } }
    }
    if (verdict === 'approve-merge') {
      return { review, card, preview: { verdict, lines: [card.yes, `At commit ${at.slice(0, 7)}, the one this review was built from. A branch that moved since is refused.`], confirm: token(card.landing) } }
    }
    const note = askForChanges(review, notes, summary)
    if (!note) throw new Unavailable('There is nothing to ask for yet. Write a comment, or say what to change.')
    return { review, card, preview: { verdict, lines: ["hobkin's agent goes back to this change with your notes:"], note, confirm: token(note) } }
  }

  /**
   * What GitHub says of a pull request before it is approved or merged: whether the user opened it, the branch it merges
   * into, and how its repository lets it be merged, squashed first, then with a merge commit, then rebased.
   */
  private async pullFacts(target: Extract<ReviewTarget, { kind: 'pull' }>): Promise<{ mine: boolean; method: MergeMethod; base: string }> {
    const { gh } = this.options
    if (!gh) throw new Unavailable('This host merges nothing on GitHub.')
    const api = async <Value>(path: string) => JSON.parse(await ghText(gh, ['api', '--hostname', 'github.com', path])) as Value
    const repo = `repos/${target.owner}/${target.repo}`
    type Facts = [{ login?: string }, { user?: { login?: string }; base?: { ref?: string } }, { allow_squash_merge?: boolean; allow_merge_commit?: boolean; allow_rebase_merge?: boolean }]
    let facts: Facts
    try {
      facts = (await Promise.all([api('user'), api(`${repo}/pulls/${target.number}`), api(repo)])) as Facts
    } catch (error) {
      throw new Unavailable(messageOf(error))
    }
    const [viewer, pull, settings] = facts
    const method: MergeMethod | null = settings.allow_squash_merge === true ? 'squash' : settings.allow_merge_commit !== false ? 'merge' : settings.allow_rebase_merge !== false ? 'rebase' : null
    if (!method) throw new Unavailable(`${target.owner}/${target.repo} allows no way to merge a pull request.`)
    const mine = Boolean(viewer.login && pull.user?.login && viewer.login.toLowerCase() === pull.user.login.toLowerCase())
    return { mine, method, base: pull.base?.ref ?? 'its base branch' }
  }

  /**
   * Does a verdict the user confirmed: only when `confirm` is the token of exactly what they were shown, and `head`,
   * when given, the commit of the review they were shown. A pull request gets one GitHub review through gh, and
   * approve and merge merges it too; a finished change gets one of hobkin's own work actions.
   */
  async verdict(id: string, verdict: Verdict, summary: string, confirm: string, head?: string): Promise<{ message: string }> {
    // Done with what the token was checked against: a review prepared again meanwhile is never the one acted on.
    const { preview, review, card, publication, merge, plan, done } = await this.planned(id, verdict, summary, head)
    if (preview.confirm !== confirm) throw new Unavailable('What would be sent has changed since it was shown. Look at it again before sending.')
    const target = this.target(id)
    if (done) return { message: done }

    if (target.kind === 'pull') {
      const { gh } = this.options
      if (!gh) throw new Unavailable('This host posts nothing to GitHub.')
      const name = `${target.owner}/${target.repo}#${target.number}`
      const post = async (body: PullReviewPost) => {
        const answer = await ghText(gh, ['api', '--hostname', 'github.com', '--method', 'POST', `repos/${target.owner}/${target.repo}/pulls/${target.number}/reviews`, '--input', '-'], JSON.stringify(body))
        // The comments went with it, so they are never sent twice.
        this.markSent(target, verdict)
        return (JSON.parse(answer || '{}') as { html_url?: string }).html_url
      }
      if (merge) {
        const posted = merge.post ? await post(merge.post) : null
        try {
          // `sha` is the commit this review was built from: GitHub refuses the merge if the pull request has moved since.
          await ghText(gh, ['api', '--hostname', 'github.com', '--method', 'PUT', `repos/${target.owner}/${target.repo}/pulls/${target.number}/merge`, '--input', '-'], JSON.stringify({ sha: review.change.head, merge_method: merge.method }))
        } catch (error) {
          if (merge.post) throw new Error(`${merge.mine ? 'Your comments went' : 'It was approved'} on GitHub, but it was not merged: ${messageOf(error)}`)
          throw error
        }
        const before = merge.post ? (merge.mine ? ', after your comments' : ', after approving it') : ''
        return { message: `Merged ${name} into ${merge.base}${before}.${posted ? ` ${posted}` : ''}` }
      }
      const posted = await post(preview.post!)
      return { message: `Posted to GitHub${posted ? `: ${posted}` : '.'}` }
    }

    if (publication) {
      const { url } = await this.options.publish!.open(publication.plan, publication.pull)
      return { message: `Opened ${url}` }
    }
    const said =
      verdict === 'approve-merge'
        ? await this.options.work().workAction(plan?.route ?? card!.landing, target.slug, target.item, { head: plan?.head ?? review.change.head })
        : await this.options.work().workAction('ask', target.slug, target.item, preview.note ?? '')
    this.markSent(target, verdict)
    return { message: String((said as { message?: unknown } | null)?.message ?? 'Done.') }
  }

  /** Where a finished change's pull request would go, and what it would say. Refused, with the reason, when it cannot have one. */
  private async publication(slug: string, card: ChangeCard, review: Review): Promise<Publication> {
    if (card.pr) throw new Unavailable(`The pull request for this change is already open: ${card.pr}. Approve and merge it, or ask for changes.`)
    if (!this.options.publish) throw new Unavailable('This host cannot open pull requests.')
    if (!card.branch) throw new Unavailable('This change has no branch to push.')
    let plan: PublishPlan
    try {
      plan = await this.options.publish.plan(slug, card.branch)
    } catch (error) {
      throw new Unavailable(messageOf(error))
    }
    return { plan, pull: { head: review.change.head, title: review.change.title, body: review.summary } }
  }

  /** A verdict that went takes its comments with it: they are marked sent, so they are never sent twice. */
  private markSent(target: ReviewTarget, verdict: Verdict) {
    if ((verdict === 'approve' || verdict === 'approve-merge') && target.kind === 'change') return
    const saved = this.options.store.notes(target)
    const at = (this.options.now ?? Date.now)()
    const entries = foldNotes(saved.entries as NoteEntry[]).map((note) => ({ op: 'put' as const, note: note.intent === 'comment' && note.sent == null ? { ...note, sent: at } : note }))
    this.options.store.saveNotes(target, { entries, draft: saved.draft })
  }

  /**
   * Prepares in the background what will be reviewed: finished changes and pull requests waiting for the user. Each
   * version of one is looked at once: a change at a commit with no review yet is prepared, and a pull request that
   * changed on GitHub since its review is looked at again. No more than `limit` wait or run at a time, so the rest
   * are looked at as those finish. A failure is not tried again until the change moves.
   */
  watch(wanted: readonly Watched[], limit = 3): void {
    const { store } = this.options
    for (const { id, head = null, updatedAt = null } of wanted) {
      if (this.queue.length + this.running.size >= limit) return
      const version = `${head ?? ''}@${updatedAt ?? ''}`
      const target = targetOfReviewId(id)
      if (!target || this.watched.get(id) === version || this.statuses.get(id)?.phase) continue
      // A change being brought up to date or merged on the user's word is not reviewed again for its new commit.
      if (this.landingOf(target)) continue
      this.watched.set(id, version)
      // The host calls this as it publishes its state. Nothing here may stop that.
      try {
        const newest = store.newest(target)
        const moved = head ? !store.has(target, head) : updatedAt ? Date.parse(updatedAt) > (newest?.at ?? 0) : false
        if (!newest || moved) this.prepare(id)
        else if (target.kind === 'change' && head && this.options.assessments?.status(target, head).state === 'idle') {
          const stored = store.read(target, head)
          if (stored) this.assess(target, stored.review)
        }
      } catch (error) {
        this.options.log?.(`Review ${id} was not prepared in the background: ${messageOf(error)}`)
      }
    }
  }

  close(): void {
    this.controller.abort()
    this.queue.length = 0
    this.options.assessments?.close()
  }
}

/** Whether `step` is a step of the review, numbered from 1. */
function isStepNumber(step: number, review: Review): boolean {
  return Number.isInteger(step) && step >= 1 && step <= review.story.length
}

/** A change review's status as a list shows it: the steps and the log are for the review that is open. */
function forList({ steps: _steps, log: _log, ...status }: AssessmentStatus): AssessmentStatus {
  return status
}

/** Both sides of every file the review points into: the change's own, and the unchanged files context reads. */
function filesOf(captured: readonly { id: string; path: string; oldPath?: string; base: string | null; head: string | null; binary: boolean }[], headFiles: ReadonlyMap<string, string>, review: Review): ReviewFileContents[] {
  return review.files.map((file) => {
    const found = captured.find((entry) => entry.id === file.id)
    if (found) return { fileId: file.id, path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}), base: found.base, head: found.head, binary: found.binary }
    const text = headFiles.get(file.path) ?? null
    return { fileId: file.id, path: file.path, base: text, head: text, binary: false }
  })
}

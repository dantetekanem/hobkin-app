/**
 * Change Review in the host: reviews prepared in the background, kept as artifacts in the home, and opened at once.
 *
 * A review is prepared once for each commit of its change. The host reads the change and owns every code range,
 * the agent with the change-review skill arranges the story, and the host checks what it returns before anyone
 * sees it. A change that moves to a new commit gets a new review, and the old one stays where it was.
 * Specs: 005-review-model, 009-review-notes.
 */
import { createHash } from 'node:crypto'
import { completeReview, draftReview, modelRequest } from '#shared/review/prepare.ts'
import { reviewIdOf, targetOfReviewId, type ReviewTarget } from '#shared/review/ids.ts'
import { detached as detachedNotes, foldNotes, type Note, type NoteEntry, type NoteIntent, type NoteTarget } from '#shared/review/notes.ts'
import { IDLE_STATUS, type OpenedReview, type ReviewCursor, type ReviewNotes, type ReviewStatus, type VerdictPreview } from '#shared/review/status.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { openReview } from '#shared/review/validate.ts'
import { askForChanges, pullReviewPost, type Verdict } from '#shared/review/verdict.ts'
import { Unavailable } from '../commands.ts'
import { agentPrompt, changeReviewSkill, type ReviewAgent } from './agent.ts'
import { withLevels, type Assessments } from './assessment.ts'
import { ghText, type GhCall } from './gh.ts'
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
  agent: ReviewAgent
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
  /** The skill, so a test can hand in its own. */
  skill?: () => string
  now?: () => number
  /**
   * The change review of finished changes (spec 032): started once a change's graph is ready, one commit once, and
   * read back when the review opens. A host given none reviews nothing that way.
   */
  assessments?: Assessments
}

interface Job {
  target: ReviewTarget
  head: string | null
  refresh: boolean
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** How often an opened review asks where its change is now, when the app does not already know. */
export const LOOK_AGAIN_MS = 60_000

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
  private readonly options: ReviewsOptions

  constructor(options: ReviewsOptions) {
    this.options = options
  }

  private set(id: string, change: Partial<ReviewStatus>) {
    this.statuses.set(id, { ...this.stored(id), ...change })
    this.options.onChange?.()
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

  /**
   * How a review's preparation stands. A ready review is outdated when its change is at a commit no review was built
   * for: it still opens, and says so, until a newer one is ready.
   */
  status(id: string): ReviewStatus {
    const target = this.target(id)
    const known = this.stored(id)
    const head = this.options.head?.(target) ?? known.head
    const at = head ?? this.opened.get(id)?.review.change.head ?? null
    const assessment = target.kind === 'change' && this.options.assessments ? { assessment: this.options.assessments.status(target, at) } : {}
    return { ...known, head, stale: known.state === 'ready' && head != null && !this.options.store.has(target, head), ...assessment }
  }

  /**
   * Asks where the change is now, at most once a minute for each review, so an opened review can say it is outdated.
   * A pull request is asked of GitHub. Nothing is prepared here: the reviewer chooses when to rebuild.
   */
  async lookAgain(id: string, now: () => number = this.options.now ?? Date.now): Promise<void> {
    const target = this.target(id)
    const at = now()
    const last = this.lookedAt.get(id)
    if (last != null && at - last < LOOK_AGAIN_MS) return
    this.lookedAt.set(id, at)
    try {
      const head = await (target.kind === 'change' ? this.options.sources.change : this.options.sources.pull).head(target)
      if (head && head !== this.stored(id).head) this.set(id, { head })
    } catch (error) {
      this.options.log?.(`Review ${id} could not look up its commit: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Prepares a review in the background, and answers at once with how it stands. A review already prepared for the
   * change's commit is used without a run, and one already under way is joined. A ready review stays ready, and opens,
   * while a newer one is prepared. `refresh` prepares it again even for the same commit.
   */
  prepare(id: string, { refresh = false }: { refresh?: boolean } = {}): ReviewStatus {
    const target = this.target(id)
    const now = this.status(id)
    const waiting = this.queue.find((job) => reviewIdOf(job.target) === id)
    if (waiting) {
      waiting.refresh ||= refresh
      return now
    }
    if (this.running.has(id) && !refresh) return now
    this.queue.push({ target, head: null, refresh })
    this.set(id, { state: now.state === 'ready' ? 'ready' : 'preparing', phase: 'queued' })
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
          const message = error instanceof Error ? error.message : String(error)
          this.options.log?.(`Review ${id} could not be prepared: ${message}`)
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
    const { store, agent } = this.options
    const source = target.kind === 'change' ? this.options.sources.change : this.options.sources.pull
    this.set(id, { phase: 'reading', error: null })
    const head = await source.head(target)
    if (!head) throw new Error(target.kind === 'change' ? 'This change has no branch to read any more.' : 'This pull request is not open any more.')
    // Ready, but for an older commit: it opens while the newer one is prepared.
    this.set(id, { head, stale: this.status(id).state === 'ready' && !store.has(target, head) })

    // One preparation for each commit: a review already made for it is used as it is.
    const cached = refresh ? null : store.read(target, head)
    if (cached) {
      this.opened.delete(id)
      this.set(id, { state: 'ready', phase: null, stale: false, preparedAt: cached.meta?.preparedAt ?? this.status(id).preparedAt, storyBy: cached.meta?.storyBy ?? null })
      this.assess(target, cached.review)
      return
    }

    const input = await source.read(target, head)
    const draft = await draftReview({ ...input, id })
    // A finished change is told by its change review (spec 032), so no model narrates its graph: the host's steps do.
    // A pull request from GitHub, which gets no change review, keeps its narrated walk.
    let written: string | null = null
    if (target.kind === 'pull') {
      this.set(id, { phase: 'arranging' })
      const system = (this.options.skill ?? changeReviewSkill)()
      written = await agent({ system, prompt: agentPrompt(modelRequest(draft)), signal: this.controller.signal })
    }
    this.set(id, { phase: 'checking' })
    const { review: completed, corrections } = await completeReview(draft, written ?? undefined)
    for (const line of corrections) this.options.log?.(`Review ${id}: ${line}`)
    // A pull request's description is shown as its author wrote it. Nothing in the review rests on it.
    const review = input.description === undefined ? completed : { ...completed, change: { ...completed.change, description: input.description } }

    const files = filesOf(draft.input.capture.files, draft.headFiles, review)
    const meta = { preparedAt: new Date((this.options.now ?? Date.now)()).toISOString(), storyBy: written ? ('agent' as const) : ('host' as const) }
    store.write(target, review, files, meta)
    this.opened.set(id, { review, files, meta })
    this.set(id, { state: 'ready', phase: null, stale: false, ...meta })
    // Prepared again on the user's word: the change review runs again too.
    this.assess(target, review, { again: refresh })
  }

  /** Starts the change review of a finished change at the commit its graph was built for. Never stops the graph. */
  private assess(target: ReviewTarget, review: Review, { again = false }: { again?: boolean } = {}) {
    if (target.kind !== 'change' || !this.options.assessments) return
    try {
      this.options.assessments.start({ target, head: review.change.head, base: review.change.base, description: { source: 'commits', title: review.change.title } }, { again })
    } catch (error) {
      this.options.log?.(`Review ${reviewIdOf(target)}: the change review could not start: ${error instanceof Error ? error.message : String(error)}`)
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

  /** The prepared review, with the reviewer's notes. */
  get(id: string): OpenedReview {
    const { review } = this.loaded(id)
    // Opening a review is when its change is looked up, when the app does not already know where it is.
    if (!this.options.head?.(this.target(id))) void this.lookAgain(id)
    const status = this.status(id)
    const target = this.target(id)
    const assessment = target.kind === 'change' ? (this.options.assessments?.read(target, review.change.head) ?? null) : null
    return {
      review: assessment ? withLevels(review, assessment) : review,
      notes: this.options.store.notes(target),
      status: { ...status, stale: status.head != null && status.head !== review.change.head, ...(target.kind === 'change' && this.options.assessments ? { assessment: this.options.assessments.status(target, review.change.head) } : {}) },
      ...(target.kind === 'change' ? { assessment } : {}),
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

  /** Moves the reviewer's view to a step, by its number from 1, or to a node. The window follows. */
  show(id: string, place: { step?: number; node?: string }): ReviewCursor {
    const { review } = this.loaded(id)
    const { step, node } = place
    if ((step == null) === (node == null)) throw new Unavailable('Name a step or a node to show, and only one.')
    if (step != null && !(Number.isInteger(step) && step >= 1 && step <= review.story.length)) throw new Unavailable(`This review has ${review.story.length} steps.`)
    if (node != null && !review.nodes.some((entry) => entry.id === node)) throw new Unavailable(`This review has no node ${node}.`)
    const cursor: ReviewCursor = { ...(step != null ? { step } : {}), ...(node != null ? { node } : {}), at: (this.options.now ?? Date.now)() }
    this.set(id, { cursor })
    return cursor
  }

  /**
   * A note hobkin leaves on a review, signed as hobkin: on a node, on a wire, or on a step. It is taken on the step
   * that shows what it is about, so it reads in the story where the reviewer meets it.
   */
  note(id: string, { intent, text, step, node, wire }: { intent: NoteIntent; text: string; step?: number; node?: string; wire?: string }): Note {
    const target = this.target(id)
    const { review } = this.loaded(id)
    const edge = wire == null ? undefined : review.edges.find((entry) => entry.id === wire)
    if (node != null && !review.nodes.some((entry) => entry.id === node)) throw new Unavailable(`This review has no node ${node}.`)
    if (wire != null && !edge) throw new Unavailable(`This review has no wire ${wire}.`)
    if (step != null && !(Number.isInteger(step) && step >= 1 && step <= review.story.length)) throw new Unavailable(`This review has ${review.story.length} steps.`)
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
    this.set(id, { notesAt: at })
    return note
  }

  /**
   * What a verdict will do, built from the review and the notes in the home, with the token that lets it go.
   * Nothing is sent here.
   */
  async preview(id: string, verdict: Verdict, summary: string): Promise<VerdictPreview> {
    const target = this.target(id)
    const { review, files } = this.loaded(id)
    const notes = foldNotes(this.options.store.notes(target).entries as NoteEntry[])
    const byId = new Map(files.map((file) => [file.fileId, file]))
    const loose = new Set(detachedNotes(notes, (fileId, side) => (side === 'added' ? byId.get(fileId)?.head : byId.get(fileId)?.base) ?? null))

    if (target.kind === 'pull') {
      if (verdict === 'approve-merge') throw new Unavailable('A pull request from GitHub gets a review here. Merge it on GitHub.')
      const post = pullReviewPost(review, notes, verdict, summary, loose)
      const words = { comment: 'Comment on', approve: 'Approve', 'request-changes': 'Ask for changes on' }[verdict]
      const lines = [
        `${words} ${target.owner}/${target.repo}#${target.number} on GitHub, as you, through gh.`,
        `At commit ${review.change.head.slice(0, 7)}, the one this review was built from.`,
        post.comments.length ? `With ${post.comments.length === 1 ? 'one comment' : `${post.comments.length} comments`} on lines.` : 'With no comments on lines.',
      ]
      return { verdict, lines, post, confirm: sha256(JSON.stringify(['pull', id, post])) }
    }

    const card = this.options.card(target.slug, target.item)
    if (!card) throw new Unavailable('hobkin no longer lists this change as finished.')
    if (verdict === 'comment') throw new Unavailable('A finished change has nobody to comment to. Approve it, approve and merge it, or ask for changes.')
    if (verdict === 'approve') {
      const { plan, pull } = await this.publication(target.slug, card, review)
      const lines = [
        `Push ${plan.branch} at ${pull.head.slice(0, 7)} to ${plan.repo} on GitHub, as you.`,
        `Open a pull request from it into ${plan.base}, titled as this change.`,
        'Nothing is merged.',
      ]
      return { verdict, lines, confirm: sha256(JSON.stringify(['change', id, verdict, plan, pull])) }
    }
    if (verdict === 'approve-merge') {
      return { verdict, lines: [card.yes, `At commit ${review.change.head.slice(0, 7)}, the one this review was built from. A branch that moved since is refused.`], confirm: sha256(JSON.stringify(['change', id, verdict, card.landing, review.change.head])) }
    }
    const note = askForChanges(review, notes, summary)
    if (!note) throw new Unavailable('There is nothing to ask for yet. Write a comment, or say what to change.')
    return { verdict, lines: ["hobkin's agent goes back to this change with your notes:"], note, confirm: sha256(JSON.stringify(['change', id, verdict, note])) }
  }

  /**
   * Does a verdict the user confirmed: only when `confirm` is the token of exactly what they were shown. A pull request
   * gets one GitHub review through gh, and a finished change one of hobkin's own work actions.
   */
  async verdict(id: string, verdict: Verdict, summary: string, confirm: string): Promise<{ message: string }> {
    const preview = await this.preview(id, verdict, summary)
    if (preview.confirm !== confirm) throw new Unavailable('What would be sent has changed since it was shown. Look at it again before sending.')
    const target = this.target(id)

    if (target.kind === 'pull') {
      if (!this.options.gh) throw new Unavailable('This host posts nothing to GitHub.')
      const answer = await ghText(this.options.gh, ['api', '--hostname', 'github.com', '--method', 'POST', `repos/${target.owner}/${target.repo}/pulls/${target.number}/reviews`, '--input', '-'], JSON.stringify(preview.post))
      const posted = JSON.parse(answer || '{}') as { html_url?: string }
      this.markSent(target, verdict)
      return { message: `Posted to GitHub${posted.html_url ? `: ${posted.html_url}` : '.'}` }
    }

    const { review } = this.loaded(id)
    const card = this.options.card(target.slug, target.item)!
    if (verdict === 'approve') {
      const { plan, pull } = await this.publication(target.slug, card, review)
      const { url } = await this.options.publish!.open(plan, pull)
      return { message: `Opened ${url}` }
    }
    const said =
      verdict === 'approve-merge'
        ? await this.options.work().workAction(card.landing, target.slug, target.item, { head: review.change.head })
        : await this.options.work().workAction('ask', target.slug, target.item, preview.note ?? '')
    this.markSent(target, verdict)
    return { message: String((said as { message?: unknown } | null)?.message ?? 'Done.') }
  }

  /** Where a finished change's pull request would go, and what it would say. Refused, with the reason, when it cannot have one. */
  private async publication(slug: string, card: ChangeCard, review: Review): Promise<{ plan: PublishPlan; pull: { head: string; title: string; body: string } }> {
    if (card.pr) throw new Unavailable(`The pull request for this change is already open: ${card.pr}. Approve and merge it, or ask for changes.`)
    if (!this.options.publish) throw new Unavailable('This host cannot open pull requests.')
    if (!card.branch) throw new Unavailable('This change has no branch to push.')
    let plan: PublishPlan
    try {
      plan = await this.options.publish.plan(slug, card.branch)
    } catch (error) {
      throw new Unavailable(error instanceof Error ? error.message : String(error))
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
        this.options.log?.(`Review ${id} was not prepared in the background: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  close(): void {
    this.controller.abort()
    this.queue.length = 0
    this.options.assessments?.close()
  }
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

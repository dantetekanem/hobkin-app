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
import { detached as detachedNotes, foldNotes, type NoteEntry } from '#shared/review/notes.ts'
import { IDLE_STATUS, type OpenedReview, type ReviewNotes, type ReviewStatus, type VerdictPreview } from '#shared/review/status.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { openReview } from '#shared/review/validate.ts'
import { askForChanges, pullReviewPost, type Verdict } from '#shared/review/verdict.ts'
import { Unavailable } from '../commands.ts'
import { agentPrompt, changeReviewSkill, type ReviewAgent } from './agent.ts'
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
  onChange?: () => void
  log?: (line: string) => void
  /** The skill, so a test can hand in its own. */
  skill?: () => string
  now?: () => number
}

interface Job {
  target: ReviewTarget
  head: string | null
  refresh: boolean
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

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
  private readonly options: ReviewsOptions

  constructor(options: ReviewsOptions) {
    this.options = options
  }

  private set(id: string, change: Partial<ReviewStatus>) {
    this.statuses.set(id, { ...(this.statuses.get(id) ?? IDLE_STATUS(id)), ...change })
    this.options.onChange?.()
  }

  private target(id: string): ReviewTarget {
    const target = targetOfReviewId(id)
    if (!target) throw new Error(`There is no review named ${id}.`)
    return target
  }

  /** How a review's preparation stands. */
  status(id: string): ReviewStatus {
    const known = this.statuses.get(id)
    if (known) return known
    // A review prepared before the host started is ready from its file.
    const newest = this.options.store.newest(this.target(id))
    if (!newest) return IDLE_STATUS(id)
    return { ...IDLE_STATUS(id), state: 'ready', preparedAt: newest.meta?.preparedAt ?? new Date(newest.at).toISOString(), storyBy: newest.meta?.storyBy ?? null }
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
      return
    }

    const input = await source.read(target, head)
    const draft = await draftReview({ ...input, id })
    this.set(id, { phase: 'arranging' })
    const system = (this.options.skill ?? changeReviewSkill)()
    const written = await agent({ system, prompt: agentPrompt(modelRequest(draft)), signal: this.controller.signal })
    this.set(id, { phase: 'checking' })
    const { review, corrections } = await completeReview(draft, written ?? undefined)
    for (const line of corrections) this.options.log?.(`Review ${id}: ${line}`)

    const files = filesOf(draft.input.capture.files, draft.headFiles, review)
    const meta = { preparedAt: new Date((this.options.now ?? Date.now)()).toISOString(), storyBy: written ? ('agent' as const) : ('host' as const) }
    store.write(target, review, files, meta)
    this.opened.set(id, { review, files, meta })
    this.set(id, { state: 'ready', phase: null, stale: false, ...meta })
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
    const status = this.status(id)
    return { review, notes: this.options.store.notes(this.target(id)), status: { ...status, stale: status.head != null && status.head !== review.change.head } }
  }

  /** Both sides of one file of a prepared review. */
  file(id: string, fileId: string): ReviewFileContents {
    const file = this.loaded(id).files.find((entry) => entry.fileId === fileId)
    if (!file) throw new Error(`${fileId} is not a file of this review.`)
    return file
  }

  /** Keeps the reviewer's notes in the home, sent or not, so they come back after a restart. */
  saveNotes(id: string, notes: ReviewNotes): void {
    // Folded, so the file holds each note once however often it was changed.
    this.options.store.saveNotes(this.target(id), { entries: foldNotes(notes.entries).map((note) => ({ op: 'put', note })), draft: notes.draft })
  }

  /**
   * What a verdict will do, built from the review and the notes in the home, with the token that lets it go.
   * Nothing is sent here.
   */
  preview(id: string, verdict: Verdict, summary: string): VerdictPreview {
    const target = this.target(id)
    const { review, files } = this.loaded(id)
    const notes = foldNotes(this.options.store.notes(target).entries as NoteEntry[])
    const byId = new Map(files.map((file) => [file.fileId, file]))
    const loose = new Set(detachedNotes(notes, (fileId, side) => (side === 'added' ? byId.get(fileId)?.head : byId.get(fileId)?.base) ?? null))

    if (target.kind === 'pull') {
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
    if (verdict === 'comment') throw new Unavailable('A finished change has nobody to comment to. Approve it, or ask for changes.')
    if (verdict === 'approve') {
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
    const preview = this.preview(id, verdict, summary)
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
    const said =
      verdict === 'approve'
        ? await this.options.work().workAction(card.landing, target.slug, target.item, { head: review.change.head })
        : await this.options.work().workAction('ask', target.slug, target.item, preview.note ?? '')
    this.markSent(target, verdict)
    return { message: String((said as { message?: unknown } | null)?.message ?? 'Done.') }
  }

  /** A verdict that went takes its comments with it: they are marked sent, so they are never sent twice. */
  private markSent(target: ReviewTarget, verdict: Verdict) {
    if (verdict === 'approve' && target.kind === 'change') return
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
      } catch (error) {
        this.options.log?.(`Review ${id} was not prepared in the background: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  close(): void {
    this.controller.abort()
    this.queue.length = 0
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

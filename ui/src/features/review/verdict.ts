import { createStore } from 'zustand/vanilla'
import type { CommandArgs, CommandResults } from '#shared/commands/registry.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { Note } from '#shared/review/notes.ts'
import type { PullOwner, ReviewLanding, VerdictPreview } from '#shared/review/status.ts'
import { usersComments, type Verdict } from '#shared/review/verdict.ts'

type VerdictCommand = 'review.preview' | 'review.verdict' | 'review.remove'
export type VerdictCommands = <Name extends VerdictCommand>(name: Name, args: CommandArgs<Name>) => Promise<CommandResults[Name]>
interface State {
  busy: boolean
  preview: VerdictPreview | null
  error: string | null
  message: string | null
}

/** What the panel says when an older host refuses a finished change that hobkin no longer lists: it merged or was closed. */
export const NO_LONGER_WAITING = 'This change is no longer waiting: it was merged or closed.'
const NO_LONGER_LISTED = /hobkin no longer lists this change as finished/i

/** A refusal as the panel shows it: the host's own words, as an error, except a change that is gone, which is no failure. */
function refusal(error: unknown): Pick<State, 'error' | 'message'> {
  const said = error instanceof Error ? error.message : String(error)
  return NO_LONGER_LISTED.test(said) ? { error: null, message: NO_LONGER_WAITING } : { error: said, message: null }
}

/**
 * One explicit confirmation, bound to this mounted target, the commit of the review on screen (`head`) and its saved
 * notes. Both yeses name that commit, so the host refuses them, and says why, once the review it holds is for another.
 * A row of the AI Reviews list that knows no commit names none: only a no is chosen there, which holds wherever the change is.
 * `done` hears of a verdict the host did, with the host's words, even when the panel that asked for it has gone since.
 * The verdict is under way until what `done` does next has started. `failed` hears of a verdict the host could not do
 * once the user had confirmed it, with the host's reason, and hands it to hobkin: a yes the user gave is never left as
 * a dead end. It answers whether hobkin has it. A discard is never handed over (`handsOver`).
 */
interface VerdictOptions {
  id: string
  head?: string | null
  command: VerdictCommands
  saveNotes: () => Promise<void>
  current: () => boolean
  done?: (verdict: Verdict, message: string) => void | Promise<void>
  failed?: (verdict: Verdict, reason: string) => Promise<boolean>
}

/** What the panel says once a verdict that could not be done is with hobkin. */
const HANDED_OVER = 'It could not be done by itself, so hobkin was asked to sort it out:'

/**
 * Whether a verdict the host could not do goes to hobkin to sort out. A discard never does: it closes, says no and
 * deletes, and its refusals are what keep that to exactly what the user was shown, such as a branch that moved or a
 * folder of theirs that holds it. An agent told to do it anyway could do it by other means, unpinned. The user sees why.
 */
export const handsOver = (verdict: Verdict): boolean => verdict !== 'discard' && verdict !== 'discard-branch'

export function createVerdict({ id, head, command, saveNotes, current, done, failed }: VerdictOptions) {
  const store = createStore<State>(() => ({ busy: false, preview: null, error: null, message: null }))
  let generation = 0
  let disposed = false
  let choice: Verdict | null = null
  const active = (turn: number) => !disposed && generation === turn && current()
  const cancel = () => {
    generation++
    choice = null
    store.setState({ preview: null, busy: false })
  }
  const preview = async (verdict: Verdict) => {
    if (disposed || store.getState().busy || !current()) return
    const turn = ++generation
    choice = null
    store.setState({ busy: true, preview: null, error: null, message: null })
    try {
      await saveNotes()
      if (!active(turn)) return
      const result = await command('review.preview', { id, verdict, summary: '', ...(head ? { head } : {}) })
      if (!active(turn)) return
      choice = verdict
      store.setState({ preview: result })
    } catch (error) {
      if (active(turn)) store.setState(refusal(error))
    } finally {
      if (active(turn)) store.setState({ busy: false })
    }
  }
  const confirm = async () => {
    const shown = store.getState().preview
    if (!shown || !choice || store.getState().busy || !current() || disposed) return
    const turn = ++generation
    const verdict = choice
    choice = null
    store.setState({ busy: true, preview: null, error: null })
    try {
      const result = await command('review.verdict', { id, verdict, summary: '', confirm: shown.confirm, ...(head ? { head } : {}) })
      if (active(turn)) store.setState({ message: result.message })
      await done?.(verdict, result.message)
    } catch (error) {
      const said = refusal(error)
      // The user said yes and it did not happen: hobkin gets it, with the reason, to fix what stops it. Never a discard.
      const handed = said.error && failed && handsOver(verdict) ? await failed(verdict, said.error).catch(() => false) : false
      if (active(turn)) store.setState(handed ? { error: null, message: `${HANDED_OVER} ${said.error}` } : said)
    } finally {
      if (active(turn)) store.setState({ busy: false })
    }
  }
  const dispose = () => {
    cancel()
    disposed = true
  }
  const connect = () => {
    disposed = false
    return dispose
  }
  return Object.assign(store, { preview, confirm, cancel, dispose, connect })
}

/**
 * Whether a verdict takes the reviewer's comments with it, as the host marks them: every verdict but a finished change's
 * Approve and Approve and merge, which leave them for the fixes, and the two discards, which post no review.
 */
export function sendsComments(id: string, verdict: Verdict): boolean {
  if (verdict === 'discard' || verdict === 'discard-branch') return false
  return !(targetOfReviewId(id)?.kind === 'change' && (verdict === 'approve' || verdict === 'approve-merge'))
}

/**
 * The comments not sent yet that a verdict on this review can take: on a pull request only the user's own, since
 * hobkin's notes never go there; on a finished change every comment, for the fixes.
 */
export function verdictComments(id: string, notes: readonly Note[]): string[] {
  const unsent = verdictKind(id) === 'pull' ? usersComments(notes) : notes.filter((note) => note.intent === 'comment' && note.sent == null)
  return unsent.map((note) => note.id)
}

/**
 * True for a key held down, which must not give the second click. A choice waiting for its second click holds the
 * keyboard as soon as the host has said what will happen, and the key that gave the first may still be down then, such
 * as Enter on the choice. A held key goes on as repeats, and only a key pressed anew confirms. Enter and Space are the
 * keys that press a button.
 */
export function heldDown({ key, repeat }: { key: string; repeat: boolean }): boolean {
  return repeat && (key === 'Enter' || key === ' ')
}

/** The message that hands hobkin a verdict the host could not do: what was chosen, why it failed, and what is wanted. */
export function handOver(kind: 'change' | 'pull', verdict: Verdict, reason: string): string {
  const label = VERDICT_CHOICES[kind].find((choice) => choice.verdict === verdict)?.label ?? verdict
  return `I chose "${label}" on this ${kind === 'pull' ? 'pull request' : 'change'} and it could not be done: ${reason} Fix what stops it and do it, or tell me exactly what you need from me first.`
}

/** How long a choice waits for its second click, in milliseconds. */
export const CONFIRM_MS = 10_000

/** One choice of the verdict: its words, what it says while the host does it, and its key, which is the click on it. */
export interface VerdictChoice {
  verdict: Verdict
  label: string
  doing: string
  keys?: string
}

/** The verdict's choices in the order the panel shows them: for a finished hobkin change, and for a pull request from GitHub. */
export const VERDICT_CHOICES: Record<'change' | 'pull', readonly VerdictChoice[]> = {
  change: [
    { verdict: 'approve', label: 'Approve', doing: 'Opening its pull request…', keys: 'A' },
    { verdict: 'approve-merge', label: 'Approve and merge', doing: 'Merging…', keys: 'M' },
    { verdict: 'request-changes', label: 'Send fixes', doing: 'Sending…', keys: 'X' },
    // The no. It has no key of its own, so it is never one slip away: it is clicked, or walked to, and then confirmed.
    { verdict: 'discard', label: 'Remove', doing: 'Removing…' },
    // The no, and its branch deleted too. Last, and with no key either.
    { verdict: 'discard-branch', label: 'Remove and delete branch', doing: 'Deleting…' },
  ],
  pull: [
    { verdict: 'approve', label: 'Approve', doing: 'Posting…', keys: 'A' },
    { verdict: 'approve-merge', label: 'Approve and merge', doing: 'Merging…', keys: 'M' },
    // A pull request is only commented on or approved: the user does not send one back from here.
    { verdict: 'comment', label: 'Comment', doing: 'Posting…' },
    { verdict: 'discard', label: 'Remove', doing: 'Closing…' },
    { verdict: 'discard-branch', label: 'Remove and delete branch', doing: 'Deleting…' },
  ],
}

/** What someone else's pull request can get here: it is approved or commented on, and its author merges or closes it. */
const THEIRS = new Set<Verdict>(['approve', 'comment'])

/**
 * The choices a review offers, and why some are missing. A pull request that is not the user's, as its review recorded
 * it, offers only Approve and Comment, and says that merging or closing it is left to its author. A review prepared
 * before that was recorded reads as someone else's until it is reviewed again.
 */
export function verdictChoices(id: string, owner?: PullOwner | null): { choices: readonly VerdictChoice[]; why: string | null } {
  const kind = verdictKind(id)
  if (kind === 'change' || owner?.mine) return { choices: VERDICT_CHOICES[kind], why: null }
  const why = owner?.author ? `This pull request is by ${owner.author}: merging or closing it is left to them.` : 'Merging or closing this pull request is left to its author.'
  return { choices: VERDICT_CHOICES.pull.filter((choice) => THEIRS.has(choice.verdict)), why }
}

/** Whether a review is of a pull request from GitHub or of a finished hobkin change, which have their own choices. */
export function verdictKind(id: string): 'change' | 'pull' {
  return targetOfReviewId(id)?.kind === 'pull' ? 'pull' : 'change'
}

/**
 * The verdict buttons of the review panel, confirmed in place. Every choice is the host's own verdict: the first click
 * shows exactly what it will do and the button waits for a second (`press`, `armed`), and a second click within ten
 * seconds does it. After that, or on `cancel`, the button goes back. The comments it takes, as the notes stood when the
 * host showed it (`comments`), are marked sent once it is done (`markSent`), as the host marks them in the home, and
 * `landed` hears of every verdict the host did.
 */
interface VerdictChoicesOptions extends Omit<VerdictOptions, 'done'> {
  comments?: () => string[]
  markSent?: (ids: readonly string[]) => void
  landed?: (verdict: Verdict, message: string) => void | Promise<void>
}

export function createVerdictChoices({ comments = () => [], markSent = () => {}, landed, ...options }: VerdictChoicesOptions) {
  let carried: string[] = []
  let waiting: ReturnType<typeof setTimeout> | undefined
  const flow = createVerdict({
    ...options,
    done: (verdict, message) => {
      if (carried.length > 0) markSent(carried)
      carried = []
      return landed?.(verdict, message)
    },
  })
  // The ten seconds start when the host has said what the choice will do, and end with it.
  flow.subscribe((state, before) => {
    if (state.preview === before.preview) return
    clearTimeout(waiting)
    waiting = state.preview ? setTimeout(() => flow.cancel(), CONFIRM_MS) : undefined
  })
  const choose = async (verdict: Verdict): Promise<void> => {
    carried = []
    await flow.preview(verdict)
    if (flow.getState().preview?.verdict === verdict && sendsComments(options.id, verdict)) carried = comments()
  }
  /** A click on a choice: the first shows what it will do, and a second while that shows does it. A click while the host works does nothing. */
  const press = (verdict: Verdict): Promise<void> => {
    const { busy, preview } = flow.getState()
    if (busy) return Promise.resolve()
    return preview?.verdict === verdict ? flow.confirm() : choose(verdict)
  }
  /** The choice waiting for its second click, if one is. */
  const armed = (): Verdict | null => flow.getState().preview?.verdict ?? null
  return Object.assign(flow, { choose, press, armed })
}

/** The review screen, as a verdict that has landed sees it. */
export interface VerdictScreen {
  /** What the review on it is of: a finished hobkin change, or a pull request from GitHub. */
  kind: 'change' | 'pull'
  /** Whether the reviewer is still on this review. */
  here: () => boolean
  close: () => void
  celebrate: (kind: 'tada' | 'done', message: string) => void
  /** How the finished change lands now, as the host says: null when it says nothing. */
  landing: () => Promise<ReviewLanding | null>
}

/**
 * What the review does once the host took a verdict: it closes, in every case, if the reviewer is still on it. Approve
 * and merge says "Merged!" once it is known to have merged: a pull request, which GitHub merged, or a finished change
 * the host says merged. A change an agent brings up to date first does not keep the review open: the yes is given, and
 * the merge that follows shows nothing here. A host that says nothing of how the change lands, as when hobkin hands the
 * merge to a session, or an older host, is never taken for a merge: like every other verdict, it closes the review with
 * a short confirmation of what the host did. A review the reviewer has left is never closed. It answers whether it closed
 * the review, which is when a story goes on to the next one.
 */
export async function afterVerdict(verdict: Verdict, message: string, screen: VerdictScreen): Promise<boolean> {
  const closeWith = (kind: 'tada' | 'done') => {
    screen.celebrate(kind, message)
    const closes = screen.here()
    if (closes) screen.close()
    return closes
  }

  if (verdict !== 'approve-merge') return closeWith('done')
  if (screen.kind === 'pull') return closeWith('tada')
  const landing = await screen.landing().catch(() => null)
  return closeWith(landing?.state === 'merged' ? 'tada' : 'done')
}

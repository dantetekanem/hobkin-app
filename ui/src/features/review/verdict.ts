import { createStore } from 'zustand/vanilla'
import type { CommandArgs, CommandResults } from '#shared/commands/registry.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { VerdictPreview } from '#shared/review/status.ts'
import type { Verdict } from '#shared/review/verdict.ts'

type VerdictCommand = 'review.preview' | 'review.verdict'
export type VerdictCommands = <Name extends VerdictCommand>(name: Name, args: CommandArgs<Name>) => Promise<CommandResults[Name]>
interface State {
  busy: boolean
  preview: VerdictPreview | null
  error: string | null
  message: string | null
}

/**
 * One explicit confirmation, bound to this mounted target, the commit of the review on screen (`head`) and its saved
 * notes. Both yeses name that commit, so the host refuses them, and says why, once the review it holds is for another.
 * `done` hears of a verdict the host did, with the host's words, even when the panel that asked for it has gone since.
 */
interface VerdictOptions {
  id: string
  head: string
  command: VerdictCommands
  saveNotes: () => Promise<void>
  current: () => boolean
  done?: (verdict: Verdict, message: string) => void
}

export function createVerdict({ id, head, command, saveNotes, current, done }: VerdictOptions) {
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
      const result = await command('review.preview', { id, verdict, summary: '', head })
      if (!active(turn)) return
      choice = verdict
      store.setState({ preview: result })
    } catch (error) {
      if (active(turn)) store.setState({ error: error instanceof Error ? error.message : String(error) })
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
      const result = await command('review.verdict', { id, verdict, summary: '', confirm: shown.confirm, head })
      if (active(turn)) store.setState({ message: result.message })
      done?.(verdict, result.message)
    } catch (error) {
      if (active(turn)) store.setState({ error: error instanceof Error ? error.message : String(error) })
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
 * Approve and Approve and merge, which leave them for the fixes.
 */
export function sendsComments(id: string, verdict: Verdict): boolean {
  return !(targetOfReviewId(id)?.kind === 'change' && (verdict === 'approve' || verdict === 'approve-merge'))
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
  ],
  pull: [
    { verdict: 'approve', label: 'Approve', doing: 'Posting…', keys: 'A' },
    { verdict: 'approve-merge', label: 'Approve and merge', doing: 'Merging…', keys: 'M' },
    { verdict: 'request-changes', label: 'Request changes', doing: 'Posting…', keys: 'X' },
    { verdict: 'comment', label: 'Comment', doing: 'Posting…' },
  ],
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
  landed?: (verdict: Verdict, message: string) => void
}

export function createVerdictChoices({ comments = () => [], markSent = () => {}, landed, ...options }: VerdictChoicesOptions) {
  let carried: string[] = []
  let waiting: ReturnType<typeof setTimeout> | undefined
  const flow = createVerdict({
    ...options,
    done: (verdict, message) => {
      if (carried.length > 0) markSent(carried)
      carried = []
      landed?.(verdict, message)
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

/**
 * What the review does once a verdict has landed: it closes, a merged change with a "Tada!" and every other verdict
 * with a short confirmation of what the host did.
 */
export function afterVerdict(verdict: Verdict, message: string, screen: { close: () => void; celebrate: (kind: 'tada' | 'done', message: string) => void }): void {
  screen.celebrate(verdict === 'approve-merge' ? 'tada' : 'done', message)
  screen.close()
}

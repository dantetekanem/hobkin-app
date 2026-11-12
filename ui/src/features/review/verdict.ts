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
 * `done` hears of a verdict the host did, even when the panel that asked for it has gone since.
 */
export function createVerdict({ id, head, command, saveNotes, current, done }: { id: string; head: string; command: VerdictCommands; saveNotes: () => Promise<void>; current: () => boolean; done?: (verdict: Verdict) => void }) {
  const store = createStore<State>(() => ({ busy: false, preview: null, error: null, message: null }))
  let generation = 0
  let disposed = false
  let choice: Verdict | null = null
  const active = (turn: number) => !disposed && generation === turn && current()
  const cancel = () => { generation++; choice = null; store.setState({ preview: null, busy: false }) }
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
      done?.(verdict)
    } catch (error) {
      if (active(turn)) store.setState({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (active(turn)) store.setState({ busy: false })
    }
  }
  const dispose = () => { cancel(); disposed = true }
  return Object.assign(store, { preview, confirm, cancel, dispose, connect: () => { disposed = false; return dispose } })
}

/**
 * Whether a verdict takes the reviewer's comments with it, as the host marks them: every verdict but a finished change's
 * Approve and Approve and merge, which leave them for the fixes.
 */
export function sendsComments(id: string, verdict: Verdict): boolean {
  return !(targetOfReviewId(id)?.kind === 'change' && (verdict === 'approve' || verdict === 'approve-merge'))
}

/**
 * True for a key held down, which must not press the second yes. The yes takes the keyboard as soon as the host has said
 * what will happen, and the key that asked for it may still be down then, such as Enter on its choice. A held key goes
 * on as repeats, and only a key pressed anew says yes. Enter and Space are the keys that press a button.
 */
export function heldDown({ key, repeat }: { key: string; repeat: boolean }): boolean {
  return repeat && (key === 'Enter' || key === ' ')
}

/**
 * The verdict buttons of the review panel. Every choice is the host's own verdict: the first yes shows exactly what it
 * will do (`choose`), and the second does it (`confirm`). The comments it takes, as the notes stood when the host showed
 * it (`comments`), are marked sent once it is done (`markSent`), as the host marks them in the home.
 */
export function createVerdictChoices({ comments = () => [], markSent = () => {}, ...options }: Omit<Parameters<typeof createVerdict>[0], 'done'> & { comments?: () => string[]; markSent?: (ids: readonly string[]) => void }) {
  let carried: string[] = []
  const flow = createVerdict({
    ...options,
    done: () => {
      if (carried.length > 0) markSent(carried)
      carried = []
    },
  })
  const choose = async (verdict: Verdict): Promise<void> => {
    carried = []
    await flow.preview(verdict)
    if (flow.getState().preview?.verdict === verdict && sendsComments(options.id, verdict)) carried = comments()
  }
  return Object.assign(flow, { choose })
}

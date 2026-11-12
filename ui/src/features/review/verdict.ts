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

/** One explicit confirmation, bound to this mounted target and its saved notes. */
export function createVerdict({ id, command, saveNotes, current }: { id: string; command: VerdictCommands; saveNotes: () => Promise<void>; current: () => boolean }) {
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
      const result = await command('review.preview', { id, verdict, summary: '' })
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
      const result = await command('review.verdict', { id, verdict, summary: '', confirm: shown.confirm })
      if (active(turn)) store.setState({ message: result.message })
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
 * The verdicts the host carries out itself, after it has said exactly what they will do: a finished hobkin change's
 * Approve, which opens its pull request, and Approve and merge, which lands it as its card does. hobkin's main agent is
 * told the verdict is the reviewer's, so these never go to it as words.
 */
export function shownFirst(id: string, verdict: Verdict): boolean {
  return targetOfReviewId(id)?.kind === 'change' && (verdict === 'approve' || verdict === 'approve-merge')
}

/**
 * The verdict buttons of the review panel. A choice the host carries out shows what it will do on the first yes and
 * does it on the second (`confirm`). Any other choice, Send fixes and a pull request's own, is asked of hobkin by `ask`.
 */
export function createVerdictChoices({ ask, ...options }: Parameters<typeof createVerdict>[0] & { ask: (verdict: Verdict) => Promise<void> }) {
  const flow = createVerdict(options)
  const choose = (verdict: Verdict): Promise<void> => {
    if (shownFirst(options.id, verdict)) return flow.preview(verdict)
    // Asking hobkin instead: what the host showed or said last is not what happens now.
    flow.cancel()
    flow.setState({ error: null, message: null })
    return ask(verdict)
  }
  return Object.assign(flow, { choose })
}

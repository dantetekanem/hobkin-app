/**
 * "Make it a stack" (spec 060): a press asks the host to start an agent that splits the change into layers, then opens
 * that agent's page. hobkin's code plans nothing. This is the button's state and what a press does, as plain data and one
 * small store, so the review's panel and the rows of the AI Reviews list share it and each case is tested without a window.
 */
import { createStore } from 'zustand/vanilla'

/** Only a change above this many changed lines (additions plus deletions) is offered a stack. */
export const BIG_CHANGE_LINES = 300

/** What the host answers: the hobkin it started, or the one already there for this change (`already`, nothing new started). */
export interface StackStarted {
  hobkin: string
  run: string | null
  already: boolean
}

export type StackCommand = (id: string) => Promise<StackStarted>

export const SAMPLE_STACK = 'A sample review starts nothing.'

export interface StackButtonInput {
  /** The change merged: it has no button. */
  merged: boolean
  /** The host is starting the agent now. */
  busy: boolean
  /** The change's additions plus its deletions, as the size row shows them. */
  lines: number
}

export interface StackButtonState {
  shown: boolean
  /** The call is on its way: the button says so in place, and a press does nothing. */
  busy: boolean
  tooltip: string
}

export function stackButton({ merged, busy, lines }: StackButtonInput): StackButtonState {
  if (merged || lines <= BIG_CHANGE_LINES) return { shown: false, busy: false, tooltip: '' }
  const tooltip = `${lines.toLocaleString('en-US')} changed lines, more than a reviewer takes in at a sitting. An agent splits the change into layers.`
  return { shown: true, busy, tooltip }
}

/** A row of the AI Reviews list offers a stack only when it knows its change is above `BIG_CHANGE_LINES`. */
export const rowOffersStack = ({ lines }: { lines?: number }) => stackButton({ merged: false, busy: false, lines: lines ?? 0 }).shown

/** Shift+S: puts the keyboard on the button wherever the review draws it. Nothing happens, and false comes back, when it has none. */
export function focusStackButton(root: { querySelector(selector: string): { focus(options?: { preventScroll: boolean }): void } | null } | null): boolean {
  const button = root?.querySelector('[data-rv-stack]')
  button?.focus({ preventScroll: true })
  return button != null
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * What a press does. With no host (a sample review) it says so and starts nothing. Otherwise it asks the host once: while
 * that call is on its way a second press is ignored, and when it answers `opened` gets the hobkin so the window can show
 * its page. A refusal is kept as `error` until the next press.
 */
export function createStackStart({ id, live, command, opened, sample = SAMPLE_STACK }: { id: string; live: boolean; command: StackCommand; opened: (hobkin: string) => void; sample?: string }) {
  const store = createStore<{ busy: boolean; error: string | null }>(() => ({ busy: false, error: null }))
  const press = async () => {
    if (store.getState().busy) return
    if (!live) return store.setState({ error: sample })
    store.setState({ busy: true, error: null })
    try {
      const answer = await command(id)
      opened(answer.hobkin)
    } catch (error) {
      store.setState({ error: messageOf(error) })
    } finally {
      store.setState({ busy: false })
    }
  }
  return Object.assign(store, { press })
}

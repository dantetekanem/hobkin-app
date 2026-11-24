/**
 * "Make it a stack" (spec 060): a press asks the host to start an agent that splits the change into layers, then opens
 * that agent's page. hobkin's code plans nothing. This is the button's state and what a press does, as plain data and one
 * small store, so the review's panel and the rows of the AI Reviews list share it and each case is tested without a window.
 */
import { createStore } from 'zustand/vanilla'

/** Past this many changed lines (additions plus deletions) the button is drawn for attention. */
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
  /** Past `BIG_CHANGE_LINES`: drawn in the attention color of the Outdated notice. About size, never about risk. */
  emphasized: boolean
  /** The call is on its way: the button says so in place, and a press does nothing. */
  busy: boolean
  tooltip: string
}

export function stackButton({ merged, busy, lines }: StackButtonInput): StackButtonState {
  if (merged) return { shown: false, emphasized: false, busy: false, tooltip: '' }
  const big = lines > BIG_CHANGE_LINES
  const tooltip = big
    ? `${lines.toLocaleString('en-US')} changed lines, more than a reviewer takes in at a sitting. An agent splits it into layers.`
    : 'An agent splits this change into layers a reviewer reads one at a time.'
  return { shown: true, emphasized: big, busy, tooltip }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * What a press does. With no host (a sample review) it says so and starts nothing. Otherwise it asks the host once: while
 * that call is on its way a second press is ignored, and when it answers `opened` gets the hobkin so the window can show
 * its page. A refusal is kept as `error` until the next press.
 */
export function createStackStart({ id, live, command, opened }: { id: string; live: boolean; command: StackCommand; opened: (hobkin: string) => void }) {
  const store = createStore<{ busy: boolean; error: string | null }>(() => ({ busy: false, error: null }))
  const press = async () => {
    if (store.getState().busy) return
    if (!live) return store.setState({ error: SAMPLE_STACK })
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

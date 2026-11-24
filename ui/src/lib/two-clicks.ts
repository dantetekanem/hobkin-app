import { createStore } from 'zustand/vanilla'

/**
 * A button that asks twice, as a verdict in Review does: the first click arms it, and it waits ten seconds for a
 * second, which does the thing. Escape, leaving the button or the ten seconds take the first click back. Work's Close
 * without merging and an integration's own close buttons use it. Pure, so the timing is tested without a window.
 */

/** How long the button waits for its second click. */
export const CONFIRM_MS = 10_000

interface TwoClicksState<Choice extends string> {
  /** The first click came, and the button waits for the second. */
  armed: boolean
  /** What the second click does it with, when the button offers more than one way (a reason to close with). */
  choice: Choice
  /** The thing is being done. */
  busy: boolean
  /** What came of the last time: the words it answered with, or why it was refused. */
  said: { tone: 'done' | 'refused'; text: string } | null
}

interface TwoClicksOptions<Choice extends string> {
  /** What the second click does, with the choice made. It answers what was done, or throws why not. */
  run: (choice: Choice) => Promise<string>
  /** The choice made before the user makes one. */
  initial: Choice
  confirmMs?: number
}

export function createTwoClicks<Choice extends string = string>({ run, initial, confirmMs = CONFIRM_MS }: TwoClicksOptions<Choice>) {
  const store = createStore<TwoClicksState<Choice>>(() => ({ armed: false, choice: initial, busy: false, said: null }))
  let waiting: ReturnType<typeof setTimeout> | undefined
  const wait = () => {
    clearTimeout(waiting)
    waiting = setTimeout(() => store.setState({ armed: false }), confirmMs)
  }
  /** Takes the first click back, as Escape or leaving the button does. */
  const cancel = () => {
    clearTimeout(waiting)
    store.setState({ armed: false })
  }
  /** A click: the first arms it, and a second while it waits does the thing. A click while it is being done does nothing. */
  const press = async (): Promise<void> => {
    const { armed, busy, choice } = store.getState()
    if (busy) return
    if (!armed) {
      store.setState({ armed: true, said: null })
      return wait()
    }
    clearTimeout(waiting)
    store.setState({ armed: false, busy: true })
    try {
      store.setState({ busy: false, said: { tone: 'done', text: await run(choice) } })
    } catch (error) {
      store.setState({ busy: false, said: { tone: 'refused', text: error instanceof Error ? error.message : String(error) } })
    }
  }
  /** The choice the second click does it with. Choosing another while it waits gives it its ten seconds again. */
  const choose = (choice: Choice) => {
    if (choice === store.getState().choice) return
    store.setState({ choice })
    if (store.getState().armed) wait()
  }
  const dispose = () => clearTimeout(waiting)
  return Object.assign(store, { press, choose, cancel, dispose })
}

export type TwoClicks<Choice extends string = string> = ReturnType<typeof createTwoClicks<Choice>>

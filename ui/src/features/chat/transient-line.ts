/** How long a refusal or a failed action stays above the input. */
export const TRANSIENT_MS = 7000

/**
 * The time a line above the input has left. `show` starts it, `hold` pauses it while the line is being read (pointer or
 * focus on it), `release` resumes with what was left, and `clear` cancels it. When it runs out, `dismiss` is called.
 */
export function transientLine(dismiss: () => void, ms = TRANSIENT_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let left = 0
  let startedAt = 0
  const run = () => {
    startedAt = Date.now()
    timer = setTimeout(() => {
      timer = undefined
      left = 0
      dismiss()
    }, left)
  }
  const stop = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }
  return {
    show() {
      stop()
      left = ms
      run()
    },
    hold() {
      if (timer === undefined) return
      stop()
      left -= Date.now() - startedAt
    },
    release() {
      if (timer === undefined && left > 0) run()
    },
    clear() {
      stop()
      left = 0
    },
  }
}

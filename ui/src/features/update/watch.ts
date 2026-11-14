/** The version an `update-ready` event or an `update_status` answer names, or null when it names none. */
export function readyVersion(value: unknown): string | null {
  const version = typeof value === 'object' && value !== null ? (value as { version?: unknown }).version : value
  return typeof version === 'string' && version.trim() !== '' ? version.trim() : null
}

export interface UpdateWatchDeps {
  status: () => Promise<unknown>
  onReady: (listener: (payload: unknown) => void) => Promise<() => void>
  show: (version: string) => void
}

/**
 * Tells `show` which version is ready: the one the shell already holds, and any that arrives later. A window outside
 * the Mac app, or a shell without the updater, makes both calls fail, and then nothing is shown. Returns how to stop.
 */
export function watchUpdate({ status, onReady, show }: UpdateWatchDeps): () => void {
  let stopped = false
  let shown: string | null = null
  const ready = (payload: unknown) => {
    const version = readyVersion(payload)
    if (stopped || !version || version === shown) return
    shown = version
    show(version)
  }
  let unlisten: (() => void) | null = null
  // The listener goes first so an update that lands during the status question is not missed.
  onReady(ready).then(
    (stop) => {
      // Stopped before the listener was in place: take it out again at once.
      if (stopped) stop()
      else unlisten = stop
    },
    () => {},
  )
  status().then(ready, () => {})
  return () => {
    stopped = true
    unlisten?.()
  }
}

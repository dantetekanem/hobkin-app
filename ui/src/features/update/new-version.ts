import type { VersionStatus } from '#shared/protocol/version.ts'

export interface NewVersionDeps {
  /** The host's `version.read`. */
  read: () => Promise<VersionStatus>
  show: (status: VersionStatus) => void
  /** Calls `look` again on a schedule, and returns how to stop. */
  every: (look: () => void) => () => void
}

/**
 * Tells `show` of a new version of hobkin the host found on GitHub (`077-new-version`): at once, and each time `every`
 * asks again. Each version shows once, and again when what stands in the way of it changes. A read that fails shows
 * nothing, and the next ask tries again. Returns how to stop.
 */
export function watchNewVersion({ read, show, every }: NewVersionDeps): () => void {
  let stopped = false
  let shownNotice: string | null = null

  const showIfNew = (status: VersionStatus) => {
    if (stopped) return
    if (!status.available || !status.newest) return
    const notice = `${status.newest} ${status.inTheWay ?? ''}`
    if (notice === shownNotice) return
    shownNotice = notice
    show(status)
  }
  const look = () => {
    read().then(showIfNew, () => {
      // Nothing to show: the next ask tries again.
    })
  }

  look()
  const stopAsking = every(look)
  return () => {
    stopped = true
    stopAsking()
  }
}

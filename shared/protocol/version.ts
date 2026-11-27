/** What a copy of hobkin run from git knows of its version and the newest one on GitHub (`077-new-version`). */
export interface VersionStatus {
  /** This copy's version: its package.json as it is on disk. Null when that cannot be read. */
  current: string | null
  /** The newest version on the default branch of the copy's origin, once a look found it. */
  newest: string | null
  /** The newest is higher than this copy's. */
  available: boolean
  /** What stands between this copy and a plain fast-forward to the newest, such as uncommitted changes. Null when nothing does. */
  inTheWay: string | null
  /** Why the last look found nothing: a host that is not live, a release build, an origin out of reach. Null when it worked. */
  problem: string | null
  /** When the last look finished, as an ISO time, or null before the first. */
  checkedAt: string | null
  /** The default branch of the copy's origin, where the newest version is, once hobkin looked. */
  branch: string | null
}

/** The agent Update opened to bring the copy up to date: a durable hobkin, already there when `already`. */
export interface UpdateAgent {
  hobkin: string
  run: string | null
  already: boolean
}

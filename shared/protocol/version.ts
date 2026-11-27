/** What a copy of hobkin run from git knows of its version and the newest one on GitHub (`077-new-version`). */
export interface VersionStatus {
  /** This copy's version: its package.json as it is on disk. Null when that cannot be read. */
  current: string | null
  /** The newest version on the default branch of the copy's origin, once a look found it. */
  newest: string | null
  /** The newest is higher than this copy's. */
  available: boolean
  /** Why Update can't bring this copy up to the newest by itself, or null when it can. */
  blocked: string | null
  /** Why the last look found nothing: a host that is not live, a release build, an origin out of reach. Null when it worked. */
  problem: string | null
  /** When the last look finished, as an ISO time, or null before the first. */
  checkedAt: string | null
}

/** What Update did. */
export interface VersionUpdated {
  /** The version this copy is at now. */
  version: string
  /** hobkin restarts into it by itself once nothing runs. When false, the user restarts hobkin. */
  restarts: boolean
}

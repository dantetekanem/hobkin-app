/**
 * Local automatic backup of hobkin's own records in its home, each a timestamped .zip. Working copies of projects, what
 * runs leave beside their reports, run transcripts and the search index are left out, and so is anything hobkin did not
 * write that agents or other programs left in the home. The host does the work; the window shows it.
 */
export const BACKUP_CADENCES = ['hourly', 'daily'] as const
export type BackupCadence = (typeof BACKUP_CADENCES)[number]

export const BACKUP_LIMIT_MAX = 100

export interface BackupConfig {
  enabled: boolean
  cadence: BackupCadence
  /** How many backups are kept. The oldest go first. The copies a restore takes first are kept apart (`BACKUP_SAFETY_KEPT`). */
  limit: number
}

/** Off until the user turns it on. Every backup is a whole copy of the records, so the oldest go past the limit. */
export const DEFAULT_BACKUP_CONFIG: BackupConfig = { enabled: false, cadence: 'daily', limit: 10 }

/** A backup file in the backups folder. `at` is when it was taken, in milliseconds. */
export interface BackupEntry {
  name: string
  at: number
  bytes: number
}

export interface BackupState {
  config: BackupConfig
  /** Newest first. */
  backups: BackupEntry[]
  /** What is running now. */
  busy: 'backup' | 'restore' | null
  /** Why the last automatic or manual backup failed, until one succeeds. */
  lastError: string | null
  /** When the next automatic backup runs, in milliseconds. Null when automatic backup is off. */
  nextAt: number | null
  /** The folder the backups are kept in, outside the home. */
  directory: string
  /**
   * What the newest backup could not take (a file it could not read, or a name zip cannot be given), by path in the
   * home, while that backup is kept. A restore leaves those files as they are. Null when it took everything.
   */
  skipped: { name: string; paths: string[] } | null
  /**
   * What the newest backup left out because hobkin did not write it (an agent's build, a VM, a download) at the home's
   * root, in `runtime/` or in a project's folder, largest first, while that backup is kept. Not a failure: a restore
   * leaves them where they are. Null when there was none.
   */
  strays: { name: string; entries: BackupStray[] } | null
}

/** Something a backup left out as not hobkin's own, by path in the home, with its size on disk when it could be measured. */
export interface BackupStray {
  path: string
  bytes: number | null
}

/** A backup file's name: UTC time to the second, and a mark for the copy a restore takes of the data it replaces. */
export const BACKUP_NAME = /^hobkin-backup-(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)(-before-restore)?\.zip$/

/** How many of the copies a restore takes first are kept, apart from the limit, so a restore can be undone. */
export const BACKUP_SAFETY_KEPT = 3

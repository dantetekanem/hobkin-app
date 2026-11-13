/** Bytes used and the total of a pool, such as memory, swap or a disk. */
export interface Pool {
  usedBytes: number
  totalBytes: number
}

export interface Battery {
  percent: number
  charging: boolean
}

/** What the machine the host runs on is doing now. Null where it could not be read. */
export interface SystemMetrics {
  /** Busy share of all cores, 0 to 100. */
  cpuPercent: number | null
  cpu: { model: string; cores: number; arch: string }
  /** The operating system, such as "macOS 15.1 (Darwin 24.1.0)". */
  os: string
  uptimeSeconds: number
  /** Processes waiting for a core, averaged over 1, 5 and 15 minutes. */
  loadAverage: [number, number, number]
  memory: Pool
  swap: Pool | null
  /** Null on a machine with no battery. */
  battery: Battery | null
  /** The volume hobkin's home is on. */
  disk: Pool | null
  host: { node: string; pid: number; rssBytes: number; uptimeSeconds: number }
}

/** What hobkin's own data says about how long and how much the user has used it. */
export interface UsageFacts {
  /** When the home was first set up (ISO time), or null when its config does not say. */
  firstLoginAt: string | null
  /** Main conversation files in the home, counting each one a reset left behind. */
  conversations: number
  /** Everything in hobkin's home, in bytes. Null when it could not be measured. */
  homeBytes: number | null
  /** The folder the backups are kept in, in bytes. Null when it could not be measured (or does not exist yet). */
  backupsBytes: number | null
}

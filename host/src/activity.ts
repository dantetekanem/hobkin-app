/**
 * hobkin keeps a job's activity (its messages and tool calls, the snapshot's `jobActivity`) only while the job runs.
 * The host keeps the last of it for the jobs that ended most recently, so an agent's canvas can still be read once
 * the agent has finished (011 A3). What hobkin sends for a job that runs always stands as it is.
 */
export class ActivityKeeper {
  private readonly most: number
  /** Jobs that ended, the one that ended last at the end, with the last activity hobkin sent for each. */
  private readonly ended = new Map<string, unknown>()
  private running: Record<string, unknown> = {}

  constructor({ most = 20 }: { most?: number } = {}) {
    this.most = most
  }

  /** The snapshot with the activity of the jobs running now and of those that ended most recently. */
  keep<Snapshot extends object>(snapshot: Snapshot): Snapshot & { jobActivity: Record<string, unknown> } {
    const now = (snapshot as { jobActivity?: unknown }).jobActivity
    // A snapshot that says nothing of activity, such as a view the terminal saved, changes nothing kept.
    if (now && typeof now === 'object') this.follow(now as Record<string, unknown>)

    return {
      ...snapshot,
      jobActivity: { ...Object.fromEntries(this.ended), ...this.running },
    }
  }

  /** A job hobkin sent last time and not now has ended: its last activity moves to the ended ones. */
  private follow(running: Record<string, unknown>): void {
    for (const [id, activity] of Object.entries(this.running)) {
      if (id in running) continue
      // Delete first, so the one that ended last is at the end.
      this.ended.delete(id)
      this.ended.set(id, activity)
    }
    for (const id of Object.keys(running)) this.ended.delete(id)

    for (const oldest of this.ended.keys()) {
      if (this.ended.size <= this.most) break
      this.ended.delete(oldest)
    }
    this.running = { ...running }
  }
}

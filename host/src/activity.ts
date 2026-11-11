/**
 * hobkin keeps a job's activity (its messages and tool calls, the snapshot's `jobActivity`) and the agents it spawned
 * (`jobChildren`) only while the job runs. The host keeps the last of both for the jobs that ended most recently, so
 * an agent's canvas can still be read once the agent has finished (011 A3). What hobkin sends for a job that runs
 * always stands as it is.
 */
interface Job {
  activity: unknown
  children?: unknown
}

type Jobs = Record<string, unknown>

export class ActivityKeeper {
  private readonly most: number
  /** Jobs that ended, the one that ended last at the end, with the last of each that hobkin sent. */
  private readonly ended = new Map<string, Job>()
  private running: Record<string, Job> = {}

  constructor({ most = 20 }: { most?: number } = {}) {
    this.most = most
  }

  /** The snapshot with the activity and agents of the jobs running now and of those that ended most recently. */
  keep<Snapshot extends object>(snapshot: Snapshot): Snapshot & { jobActivity: Jobs; jobChildren: Jobs } {
    const { jobActivity: now, jobChildren } = snapshot as { jobActivity?: unknown; jobChildren?: unknown }
    // A snapshot that says nothing of activity, such as a view the terminal saved, changes nothing kept.
    if (now && typeof now === 'object') this.follow(now as Jobs, jobChildren && typeof jobChildren === 'object' ? (jobChildren as Jobs) : {})

    const jobs = [...this.ended, ...Object.entries(this.running)]
    return {
      ...snapshot,
      jobActivity: Object.fromEntries(jobs.map(([id, job]) => [id, job.activity])),
      // hobkin lists only the jobs that spawned agents, and so does this.
      jobChildren: Object.fromEntries(jobs.filter(([, job]) => job.children !== undefined).map(([id, job]) => [id, job.children])),
    }
  }

  /** A job hobkin sent last time and not now has ended: what it last sent moves to the ended ones. */
  private follow(activity: Jobs, children: Jobs): void {
    for (const [id, job] of Object.entries(this.running)) {
      if (id in activity) continue
      // Delete first, so the one that ended last is at the end.
      this.ended.delete(id)
      this.ended.set(id, job)
    }
    for (const id of Object.keys(activity)) this.ended.delete(id)

    for (const oldest of this.ended.keys()) {
      if (this.ended.size <= this.most) break
      this.ended.delete(oldest)
    }
    this.running = Object.fromEntries(Object.entries(activity).map(([id, entries]) => [id, { activity: entries, children: children[id] }]))
  }
}

/** Retain real parent feeds and bounded last-known child groups after the runtime releases their roots. */
interface Job {
  activity?: unknown
  children?: unknown
}

type Jobs = Record<string, unknown>

/** A missing source is not proof of termination. Legacy reports keep their original meanings. */
function lastKnown(children: unknown): unknown {
  if (!Array.isArray(children)) return children
  return children.map((child) => {
    if (!['queued', 'running', 'cancelling'].includes(child?.state)) return child
    return { ...child, state: 'unknown' }
  })
}

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
    // Saved views with neither key change nothing kept. Children can outlive their parent's feed.
    const activity = now && typeof now === 'object' ? now as Jobs : undefined
    const children = jobChildren && typeof jobChildren === 'object' ? jobChildren as Jobs : undefined
    if (activity || children) this.follow(activity ?? {}, children ?? {})

    const jobs = [...this.ended, ...Object.entries(this.running)]
    return {
      ...snapshot,
      jobActivity: Object.fromEntries(jobs.filter(([, job]) => job.activity !== undefined).map(([id, job]) => [id, job.activity])),
      // hobkin lists only the jobs that spawned agents, and so does this.
      jobChildren: Object.fromEntries(jobs.filter(([, job]) => job.children !== undefined).map(([id, job]) => [id, job.children])),
    }
  }

  /** A job hobkin sent last time and not now has ended: what it last sent moves to the ended ones. */
  private follow(activity: Jobs, children: Jobs): void {
    const roots = new Set([...Object.keys(activity), ...Object.keys(children)])
    const current = Object.fromEntries([...roots].map((id) => {
      const previous = this.running[id] ?? this.ended.get(id)
      return [id, {
        activity: activity[id] ?? previous?.activity,
        children: children[id] ?? lastKnown(previous?.children),
      }]
    }))
    for (const [id, job] of Object.entries(this.running)) {
      if (roots.has(id)) continue
      // Delete first, so the one that ended last is at the end.
      this.ended.delete(id)
      this.ended.set(id, { ...job, children: lastKnown(job.children) })
    }
    for (const id of roots) this.ended.delete(id)

    for (const oldest of this.ended.keys()) {
      if (this.ended.size <= this.most) break
      this.ended.delete(oldest)
    }
    this.running = current
  }
}

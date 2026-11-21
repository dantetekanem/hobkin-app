/** Retain real parent feeds and bounded last-known child groups after the runtime releases their roots. */
interface Job {
  activity?: unknown
  children?: unknown
}

type Jobs = Record<string, unknown>

/**
 * A helper's row without its steps. hobkin keeps each helper's latest words and calls with its row, and resends every
 * run's helpers whole whenever one of them moves, but the window draws only who they are and how they stand. So the
 * steps stay here: a helper's words and calls send nothing, and its rows travel small.
 */
function withoutSteps(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || !('activity' in row)) return row
    const { activity: _steps, ...rest } = row as Record<string, unknown>
    return rest
  })
}

const LIVE = ['queued', 'running', 'cancelling']

/** A missing source is not proof of termination. Legacy reports keep their original meanings. A list with nothing live stays the same list. */
function lastKnown(children: unknown): unknown {
  if (!Array.isArray(children) || !children.some((child) => LIVE.includes(child?.state))) return children
  return children.map((child) => {
    if (!LIVE.includes(child?.state)) return child
    return { ...child, state: 'unknown' }
  })
}

/** Two values that encode alike as JSON: the same keys in the same order, each with the same value. */
function sameFields(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const keys = Object.keys(left)
  const others = Object.keys(right)
  return keys.length === others.length && keys.every((key, index) => key === others[index] && (left as Record<string, unknown>)[key] === (right as Record<string, unknown>)[key])
}

/**
 * hobkin copies every helper row on each publish. Rows that read the same as the ones given last time are given as
 * that same list, so the host does not encode them again and a publish with nothing new sends nothing.
 */
function sameRowsAs(held: unknown, rows: unknown): unknown {
  const same = Array.isArray(held) && Array.isArray(rows) && held.length === rows.length && rows.every((row, index) => sameFields(held[index], row))
  return same ? held : rows
}

export class ActivityKeeper {
  private readonly most: number
  /** Jobs that ended, the one that ended last at the end, with the last of each that hobkin sent. */
  private readonly ended = new Map<string, Job>()
  private running: Record<string, Job> = {}
  /** The main chat's helper rows and every job's, as last given, so the same rows are given as the same objects. */
  private mainChildren: unknown = undefined
  private jobChildren: Jobs = {}

  constructor({ most = 20 }: { most?: number } = {}) {
    this.most = most
  }

  /**
   * The snapshot with the activity and agents of the jobs running now and of those that ended most recently. Helpers'
   * rows, a job's and the main chat's, come without their steps (`withoutSteps`), and as the lists given last time
   * while they read the same (`sameRowsAs`).
   */
  keep<Snapshot extends object>(snapshot: Snapshot): Snapshot & { jobActivity: Jobs; jobChildren: Jobs } {
    const { jobActivity: now, jobChildren, mainChildren } = snapshot as { jobActivity?: unknown; jobChildren?: unknown; mainChildren?: unknown }
    // Saved views with neither key change nothing kept. Children can outlive their parent's feed.
    const activity = now && typeof now === 'object' ? now as Jobs : undefined
    const children = jobChildren && typeof jobChildren === 'object'
      ? Object.fromEntries(Object.entries(jobChildren).map(([id, rows]) => [id, sameRowsAs((this.running[id] ?? this.ended.get(id))?.children, withoutSteps(rows))]))
      : undefined
    if (activity || children) this.follow(activity ?? {}, children ?? {})
    if (Array.isArray(mainChildren)) this.mainChildren = sameRowsAs(this.mainChildren, withoutSteps(mainChildren))

    const jobs = [...this.ended, ...Object.entries(this.running)]
    // hobkin lists only the jobs that spawned agents, and so does this.
    const kept = Object.fromEntries(jobs.filter(([, job]) => job.children !== undefined).map(([id, job]) => [id, job.children]))
    this.jobChildren = sameFields(this.jobChildren, kept) ? this.jobChildren : kept
    return {
      ...snapshot,
      ...(Array.isArray(mainChildren) ? { mainChildren: this.mainChildren } : {}),
      jobActivity: Object.fromEntries(jobs.filter(([, job]) => job.activity !== undefined).map(([id, job]) => [id, job.activity])),
      jobChildren: this.jobChildren,
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

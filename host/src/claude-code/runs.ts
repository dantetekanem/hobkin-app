/**
 * The runs the host sent to Claude Code (033-claude-code-agents), so the window can tell them apart. hobkin's own record
 * of a run says Pi, because the host routes inside the harness hobkin is given (`route.ts`), so the host marks each such
 * run of the snapshot `onClaudeCode` on its way to the window, by the harness id the route was given. A host that
 * restarts has forgotten the runs it routed before, and their rows go without the mark.
 */

interface Row {
  harnessId?: unknown
}

export class ClaudeRuns {
  /** Harness ids, the latest last. */
  private readonly ids = new Set<string>()
  private readonly most: number
  /** Bumped by each run routed, so marked rows are made again only then or when hobkin's rows change. */
  private version = 0
  private made: { from: unknown; version: number; runs: unknown[] } | null = null

  constructor({ most = 200 }: { most?: number } = {}) {
    this.most = most
  }

  /** The route sent the run with this harness id to Claude Code. */
  readonly routed = (harnessId: string): void => {
    this.ids.delete(harnessId)
    this.ids.add(harnessId)

    for (const oldest of this.ids) {
      if (this.ids.size <= this.most) break
      this.ids.delete(oldest)
    }
    this.version++
  }

  /**
   * The snapshot with each run the host sent to Claude Code marked. The same snapshot while none of its runs is, and the
   * same rows while hobkin's rows and the routed runs stay the same, so the window is not sent them again.
   */
  mark<Snapshot extends object>(snapshot: Snapshot): Snapshot {
    const { runs } = snapshot as { runs?: unknown }
    if (!Array.isArray(runs) || this.ids.size === 0) return snapshot

    const made = this.made
    if (made && made.from === runs && made.version === this.version) {
      return { ...snapshot, runs: made.runs }
    }

    if (!runs.some(this.isRouted)) return snapshot

    const marked = runs.map((row) => (this.isRouted(row) ? { ...row, onClaudeCode: true as const } : row))
    this.made = { from: runs, version: this.version, runs: marked }
    return { ...snapshot, runs: marked }
  }

  /** A row of a run the route sent to Claude Code. */
  private readonly isRouted = (row: Row | null | undefined): boolean => typeof row?.harnessId === 'string' && this.ids.has(row.harnessId)
}

/**
 * hobkin's plan of everything that could run next (`src/cli/work/plan.mjs`), typed here because hobkin ships plain JavaScript.
 * The queue's whole list is read from it, since the status hobkin sends the window keeps only its first rows.
 */

declare module 'hobkin/src/cli/work/plan.mjs' {
  /** One entry of the plan, in hobkin's order. Only the fields the queue shows are named. */
  export interface PlanEntry {
    key: string
    kind: string
    slug?: string | null
    project?: string
    item?: { id?: string } | null
    title: string
    grade?: string | null
    why?: string | null
    waiting?: string | null
    skipped?: boolean
    picked?: boolean
    pickedNow?: boolean
    estimate?: { fresh?: number } | null
  }
  export interface Plan {
    entries: PlanEntry[]
    /** How many workers are free. */
    free: number
  }
  export function planWork(root: string, options?: Record<string, unknown>): Plan
  /** What an entry waits for: its own wait, or a free worker when none is. */
  export function rowWait(entry: { waiting?: string | null; pickedNow?: boolean }, free: number): string | null
}

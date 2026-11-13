/**
 * The parts of hobkin that running its other agents on Claude Code touches (`033-claude-code-agents`), typed here
 * because hobkin ships plain JavaScript. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/harnesses.mjs' {
  type Harness = (request: Record<string, unknown>, options?: unknown) => Promise<unknown>
  /** hobkin's Pi harness: runs one job request on Pi and resolves its result. */
  export const runHarness: Harness
  /** A job that loads tools gets its extensions named up front. */
  export function namingExtensions(run: Harness): Harness
  /** What a work run is told, for a harness that cannot take it as a system prompt. */
  export function workDirections(purpose: string): string
}

declare module 'hobkin/src/cli/work/usage.mjs' {
  type Harness = (request: Record<string, unknown>, options?: unknown) => Promise<unknown>
  /** Adds the usage reader to a job's extensions. */
  export function readingUsage(run: Harness): Harness
}

declare module 'hobkin/src/cli/job-activity.mjs' {
  /** Allowlisted display data for one run, reduced from Pi's events. */
  export class JobActivity {
    constructor(options?: { most?: number })
    accept(event: unknown): void
    snapshot(): { id: string; kind: 'assistant' | 'tool'; text?: string; name?: string; state?: string; input?: string; output?: string }[]
  }
}

declare module 'hobkin/src/cli/work/store.mjs' {
  /** What a session file records a run spent, and the session it belongs to. */
  export function sessionUsage(file: string): { tokens: number; cached: number; usd: number; sessionId: string | null }
  /** What a running session has spent, reading only what was added since `seen`. */
  export function followUsage(
    file: string,
    seen?: { offset: number; tokens: number; cached: number },
  ): { offset: number; tokens: number; cached: number }
  /** What stopped a run, in the provider's own words, or null. */
  export function sessionError(file: string): string | null
}

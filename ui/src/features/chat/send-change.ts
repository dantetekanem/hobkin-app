import type { Effort } from '#shared/tiers/tiers.ts'

/** Which agent a change from the message box is for: a working agent by its run, or a durable hobkin by its id. */
export type ChangeTarget = { agent: string } | { hobkin: string }

type Run = (name: 'agent.change' | 'hobkin.change', args: Record<string, unknown>) => Promise<{ message: string }>

/**
 * Sends a change read from the message box (`changeLine`) to the host, and answers with what it said: what the agent
 * works on now, or why not. A window with no host only has sample agents, which have no model to change.
 */
export async function sendChange(
  target: ChangeTarget,
  change: { model?: string; effort?: Effort },
  { live, run }: { live: boolean; run: Run },
): Promise<{ ok: true; message: string } | { ok: false; why: string }> {
  if (!live) return { ok: false, why: 'A sample agent has no model to change.' }
  try {
    const done = 'agent' in target ? await run('agent.change', { run: target.agent, ...change }) : await run('hobkin.change', { id: target.hobkin, ...change })
    return { ok: true, message: done.message }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  }
}

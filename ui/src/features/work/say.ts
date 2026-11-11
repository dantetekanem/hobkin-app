import { runCommand } from '@/lib/host/index.ts'
import type { AgentSendResult } from './agent-threads.ts'

/**
 * Passes what the user typed to an agent while it works, as steering through hobkin's own `message_check`
 * (`agent.say` in the host, 011-work A14). The sample agents of a window with no host keep the words in the window,
 * as before. Nothing is sent once the agent has finished, and the answer says why.
 */
export async function sayToAgent(agentId: string, text: string, { live, noteId }: { live: boolean; noteId?: string }): Promise<AgentSendResult> {
  if (!live) return { sent: true, local: true }
  try {
    const result = await runCommand('agent.say', { run: agentId, text, noteId })
    return result?.queued === true ? { sent: true } : { sent: false, uncertain: true, why: 'The host did not confirm queuing this note.' }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    const refused = code === 'unavailable' || code === 'invalid-arguments' || code === 'unknown-command'
    return { sent: false, why: error instanceof Error ? error.message : String(error), uncertain: !refused }
  }
}

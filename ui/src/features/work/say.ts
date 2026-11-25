import { runCommand } from '@/lib/host/index.ts'
import type { AgentSendResult } from './agent-threads.ts'
import type { TalkQueue } from './talk.ts'

/**
 * Passes what the user typed to an agent while it works, as steering through hobkin's own `message_check`
 * (`agent.say` in the host, 011-work A14), with the images attached for it by hobkin's names for them. The sample
 * agents of a window with no host keep the words in the window, as before. Nothing is sent once the agent has
 * finished, and the answer says why.
 */
export async function sayToAgent(agentId: string, text: string, { live, noteId, images = [], queue }: { live: boolean; noteId?: string; images?: readonly string[]; queue?: TalkQueue }): Promise<AgentSendResult> {
  if (!live) return { sent: true, local: true }
  try {
    const result = await runCommand('agent.say', { run: agentId, ...(text ? { text } : {}), ...(images.length ? { images: [...images] } : {}), noteId, ...(queue ? { queue } : {}) })
    if (result?.queued !== true) return { sent: false, uncertain: true, why: 'The host did not confirm queuing this note.' }
    return result.unsent?.length ? { sent: true, unsent: result.unsent } : { sent: true }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    const refused = code === 'unavailable' || code === 'invalid-arguments' || code === 'unknown-command'
    return { sent: false, why: error instanceof Error ? error.message : String(error), uncertain: !refused }
  }
}

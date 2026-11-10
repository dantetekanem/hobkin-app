import { runCommand } from '@/lib/host/index.ts'

/**
 * Passes what the user typed to an agent while it works, as steering through hobkin's own `message_check`
 * (`agent.say` in the host, 011-work A14). The sample agents of a window with no host keep the words in the window,
 * as before. Nothing is sent once the agent has finished, and the answer says why.
 */
export async function sayToAgent(agentId: string, text: string, { live }: { live: boolean }): Promise<{ sent: true } | { sent: false; why: string }> {
  if (!live) return { sent: true }
  try {
    await runCommand('agent.say', { run: agentId, text })
    return { sent: true }
  } catch (error) {
    return { sent: false, why: error instanceof Error ? error.message : String(error) }
  }
}

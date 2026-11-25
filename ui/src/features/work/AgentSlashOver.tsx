import type { RefObject } from 'react'
import { AgentModelChoiceOver } from '@/app/AgentModelChoice.tsx'
import { SlashPanel } from '@/features/chat/SlashPanel.tsx'
import type { PageSlash } from './use-agent-slash.ts'

/**
 * What an agent's page draws over its message box for a message that starts with a slash: the list of commands, as the
 * main chat has it, and the choice of tier or model /model opens. It goes inside the box's own relative frame, and
 * the choice is drawn only once /model opened it.
 */
export function AgentSlashOver({ slash, agentId, box, input }: { slash: PageSlash; agentId: string; box: RefObject<HTMLFormElement | null>; input: RefObject<HTMLTextAreaElement | null> }) {
  const { target, open, onOpenChange } = slash.choice
  return (
    <>
      <SlashPanel {...slash.panel} />
      {target ? <AgentModelChoiceOver agentId={agentId} target={target} open={open} onOpenChange={onOpenChange} anchor={box} back={input} /> : null}
    </>
  )
}

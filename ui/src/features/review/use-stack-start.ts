import { useMemo } from 'react'
import { useStore } from 'zustand'
import { hobkinAgentId } from '#shared/protocol/hobkins.ts'
import { useView } from '@/app/view-store.ts'
import { runCommand } from '@/lib/host/index.ts'
import { createStackStart } from './stack-start.ts'

/** "Make it a stack" for one review: what the host is doing, its refusal if it gave one, and the press. */
export function useStackStart(id: string, live: boolean) {
  const flow = useMemo(
    () => createStackStart({ id, live, command: (id) => runCommand('review.stack', { id }), opened: (hobkin) => useView.getState().openAgentCanvas(hobkinAgentId(hobkin)) }),
    [id, live],
  )
  const { busy, error } = useStore(flow)
  return { busy, error, press: flow.press }
}

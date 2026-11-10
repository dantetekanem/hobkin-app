import { createContext, useContext } from 'react'
import type { EntrancePlan } from './entrance-plan.ts'

/** The entrance being played, or null when nodes and wires should simply be there. */
export const EntranceContext = createContext<EntrancePlan | null>(null)

export function useEntrance(nodeId: string): { delay: number } | null {
  const plan = useContext(EntranceContext)
  return plan ? { delay: plan.nodes[nodeId] ?? 0 } : null
}

export function useWireEntrance(edgeId: string): { delay: number } | null {
  const plan = useContext(EntranceContext)
  return plan ? { delay: plan.wires[edgeId] ?? 0 } : null
}

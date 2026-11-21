import { createContext, useContext } from 'react'
import type { EntrancePlan } from './entrance-plan.ts'

/** The entrance being played, or null when nodes and wires should simply be there. */
export const EntranceContext = createContext<EntrancePlan | null>(null)

/** When a node arrives, and whether it only fades in: a large graph's entrance moves nothing (spec 053). */
export function useEntrance(nodeId: string): { delay: number; quiet: boolean } | null {
  const plan = useContext(EntranceContext)
  return plan ? { delay: plan.nodes[nodeId] ?? 0, quiet: plan.quiet } : null
}

/** When a wire draws in. A large graph's wires draw in no entrance: they are simply there. */
export function useWireEntrance(edgeId: string): { delay: number } | null {
  const plan = useContext(EntranceContext)
  return plan && !plan.quiet ? { delay: plan.wires[edgeId] ?? 0 } : null
}

import { agentControls, useAgentControl } from '@/app/running-agents.ts'
import { hostStore } from '@/lib/host/index.ts'
import { executionKey, executionTargets, forceStopStep } from './actions.ts'
import { useExecution } from './store.ts'

/**
 * Control+X on an agent's page that is not a durable hobkin's (`019-keyboard`): Force Stop, asking first. It opens the
 * page's own Force Stop question, so the key and the button confirm each other, and Escape takes it back there. False
 * when the run cannot be forced, as once it has finished, so the key keeps its usual meaning.
 */
export function pressForceStopOf(agentId: string | null): boolean {
  if (!agentId) return false
  const control = executionTargets(hostStore.getState()).find((target) => target.kind === 'run' && target.runId === agentId)
  // Pending as the button counts it: this window's confirmation, or the host still forcing it.
  const pending = agentControls.pending(agentId, 'force') || (control !== undefined && useExecution.getState().pending[executionKey(control, 'force')] === true)
  const step = forceStopStep({ runId: agentId, asking: useAgentControl.getState().target, canForce: control?.canForce === true, pending })
  if (step === 'ask') agentControls.request(agentId, 'force')
  else if (step === 'force') void agentControls.confirm()
  return step !== null
}

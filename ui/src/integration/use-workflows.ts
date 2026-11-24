import { useMemo } from 'react'
import { runCommand } from '../lib/host/client.ts'
import { useHost } from '../lib/host/hooks.ts'
import { workflowRowsOf, type WorkflowRow } from './workflows.ts'

/**
 * The workflows an integration has, as the host lists them: its own card or screen shows its press buttons from these.
 * Empty with no host, and from a host whose runtime has none. With no id, every integration's.
 */
export function useWorkflows(integration?: string): readonly WorkflowRow[] {
  const rows = useHost((state) => state.snapshot.schedules)
  return useMemo(() => workflowRowsOf(rows, integration), [rows, integration])
}

/** Starts one run of a workflow now, by its id `<integration>/<name>`. Rejects with the host's reason. */
export function runWorkflow(id: string): Promise<{ run: string }> {
  return runCommand('workflow.run', { id })
}

/** Turns a workflow on or off. Rejects with the host's reason. */
export function setWorkflowEnabled(id: string, on: boolean): Promise<{ id: string; enabled: boolean }> {
  return runCommand('workflow.enable', { id, on })
}

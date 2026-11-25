import type { HostHandlers } from './commands.ts'
import { Unavailable } from './commands.ts'
import type { HobkinApplication } from 'hobkin/src/cli/application.mjs'

/**
 * An integration's workflows (_specs/065-integration-drops): routines in its `workflows/` folder that hobkin's runtime
 * reads. These start one on the user's press and turn one on or off, through the application's own calls. A runtime
 * from before workflows has none of those calls, and the commands say so.
 */

export interface WorkflowSeat {
  /** hobkin's application. Throws, with the reason, while hobkin is not open in this host. */
  app: () => Pick<HobkinApplication, 'startWorkflow' | 'setWorkflowEnabled'>
}

const NO_WORKFLOWS = "hobkin's runtime in this host has no workflows yet."

/** The runtime's refusal, passed on as the command's, in its own words. */
const refused = (error: unknown): never => {
  throw new Unavailable(error instanceof Error ? error.message : String(error))
}

/** The application's call to start a workflow, or the reason it cannot. */
export function startOf(app: Pick<HobkinApplication, 'startWorkflow'>): (id: string, input?: unknown) => Promise<{ run: string }> {
  const { startWorkflow } = app
  if (typeof startWorkflow !== 'function') throw new Unavailable(NO_WORKFLOWS)
  return (id, input) => startWorkflow.call(app, id, input).catch(refused)
}

export function workflowHandlers({ app }: WorkflowSeat): Pick<HostHandlers, 'workflow.run' | 'workflow.enable'> {
  return {
    'workflow.run': ({ id }) => startOf(app())(id),
    'workflow.enable': async ({ id, on }) => {
      const current = app()
      const { setWorkflowEnabled } = current
      if (typeof setWorkflowEnabled !== 'function') throw new Unavailable(NO_WORKFLOWS)
      try {
        return await setWorkflowEnabled.call(current, id, on)
      } catch (error) {
        return refused(error)
      }
    },
  }
}

import { randomUUID } from 'node:crypto'
import type { CommandArgs } from '#shared/commands/registry.ts'
import type { HostHandlers } from './commands.ts'

/**
 * A routine's switch, its times and Run now, each through hobkin's own runner: `change` writes the routine's file the
 * way hobkin checks every routine file (`changeSchedule` in its `src/cli/schedules.mjs`), and `trigger` runs it once,
 * as the main agent's run_routine does. Each answers once hobkin's snapshot has the change, and a refusal comes back
 * in hobkin's words. Spec: 010-routines.
 */

type RoutineChange = { enabled: boolean } | Pick<CommandArgs<'routine.times'>, 'at' | 'window'>

/** What the host needs of hobkin's application for its routines. */
export interface RoutinesApp {
  runner: object
  refresh(): Promise<unknown>
}

/** hobkin's runner, as far as routines call it. `hobkin-work.d.ts` types it only as far as Work calls it. */
interface RoutineRunner {
  trigger(scheduleId: string, requestId: string): Promise<{ id: string }>
  change(scheduleId: string, change: RoutineChange): Promise<unknown>
}
const runnerOf = (hobkin: RoutinesApp) => hobkin.runner as RoutineRunner

export function routineHandlers({ app }: { app: () => RoutinesApp }): Pick<HostHandlers, 'routine.run' | 'routine.enable' | 'routine.times'> {
  const change = async (id: string, to: RoutineChange) => {
    const hobkin = app()
    await runnerOf(hobkin).change(id, to)
    await hobkin.refresh()
    return { ok: true } as const
  }

  return {
    'routine.run': async ({ id }) => {
      const hobkin = app()
      // Each press is a request of its own. hobkin refuses another while the routine runs.
      const started = await runnerOf(hobkin).trigger(id, `client:${randomUUID()}`)
      await hobkin.refresh()
      return { run: started.id }
    },
    'routine.enable': ({ id, enabled }) => change(id, { enabled }),
    'routine.times': ({ id, at, window }) => change(id, window ? { window } : { at }),
  }
}

import type { RunSummary } from '#shared/protocol/snapshot.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
import { Unavailable, type HostHandlers } from './commands.ts'
import { changeFrom } from './model-name.ts'

/**
 * The agents and routines hobkin runs, stopped or told something while they work, through hobkin's own ways of
 * doing both. They are the snapshot's runs, the same ones the window lists (`agentsFrom` in the UI), by run id.
 * Spec: 011-work.
 */

/** What the host needs of hobkin's application for its agents. */
export interface AgentsApp {
  workAction(action: string, slug?: unknown, value?: unknown, extra?: unknown): Promise<unknown>
  kill(runId: string): Promise<boolean>
  runner: { messageCheck(request: { scheduleId?: string; runId?: string; noteId?: string; message?: string }): Promise<unknown> }
  /** Absent in a runtime from before an agent could change its model while it works. */
  runtime?: { changeRun?(runId: string, change: { model?: string; effort?: string }): Promise<{ model: string | null; effort: string | null }> }
}

export interface AgentsSeat {
  /** hobkin's application. Throws, with the reason, while hobkin is not open in this host. */
  app: () => AgentsApp
  /** hobkin's runs as its snapshot lists them now. */
  runs: () => readonly RunSummary[]
  /** The models Pi can use now, read again, or null while it has not listed them. */
  models?: () => Promise<ModelsState | null>
}

/** The two ways the terminal's k stops a work agent. */
const STOPS = { 'for-now': 'later', 'not-approved': 'decline' } as const

const messageOf = (result: unknown) => String((result as { message?: unknown } | null)?.message ?? '')

export function agentHandlers({ app, runs, models }: AgentsSeat): Pick<HostHandlers, 'agent.stop' | 'agent.say' | 'agent.change'> {
  /** The run, while it runs. hobkin's own conversation is no agent: its turn stops from the input. */
  const running = (id: string, ended: string): RunSummary => {
    const run = runs().find((entry) => entry.id === id)
    if (run?.kind === 'main') throw new Unavailable("That is hobkin's own conversation. Its turn stops from the input.")
    if (!run || run.state !== 'running') throw new Unavailable(ended)
    return run
  }

  /** The schedules of the running jobs that take messages. Asked without a schedule, `message_check` lists them. */
  const takingMessages = async (): Promise<string[]> => {
    const listed = (await app().runner.messageCheck({})) as { running?: { scheduleId?: string }[] } | null
    return (listed?.running ?? []).flatMap(({ scheduleId }) => (scheduleId ? [scheduleId] : []))
  }

  return {
    'agent.change': async ({ run: id, model, effort }) => {
      const run = runs().find((entry) => entry.id === id)
      if (run?.kind === 'main') throw new Unavailable("hobkin's own conversation changes its model in Settings.")
      if (!run || run.state !== 'running') throw new Unavailable('That agent is not working.')
      const changeRun = app().runtime?.changeRun
      if (!changeRun) throw new Unavailable('This hobkin cannot change a working agent yet. Restart the app to load it.')

      const asked = changeFrom((await models?.()) ?? null, { model, effort }, run.model)
      if ('problem' in asked) throw new Unavailable(asked.problem)
      try {
        const held = await changeRun.call(app().runtime, id, asked.change)
        return { message: `It works on ${held.model ?? 'its model'} at ${held.effort ?? 'its level'} from its next step.` }
      } catch (error) {
        throw error instanceof Unavailable || !(error instanceof Error) ? error : new Unavailable(error.message)
      }
    },
    'agent.stop': async ({ run: id, how = 'for-now' }) => {
      const run = running(id, 'It had already finished, so nothing was stopped.')

      // A work agent stops as k stops it in the terminal, and what the user picked is told the way a card's choice is.
      if (run.work) {
        const told = await app().workAction('stop', id, STOPS[how])
        return { message: messageOf(told) }
      }

      // Anything else is cancelled, as k does on a job.
      const stopped = await app().kill(id)
      if (!stopped) throw new Unavailable('It had already finished, so nothing was stopped.')
      return { message: `Stopped "${run.title}".` }
    },
    'agent.say': async ({ run: id, text, noteId }) => {
      const run = running(id, 'It has finished, so nothing was sent.')

      // The exact run is checked again by the runner, so a schedule rollover cannot redirect the note.
      const reachable = run.scheduleId !== undefined && (await takingMessages()).includes(run.scheduleId)
      if (!reachable) throw new Unavailable('hobkin cannot pass a message to this agent while it runs.')

      try {
        const result = await app().runner.messageCheck({ scheduleId: run.scheduleId, runId: id, noteId, message: text }) as { status?: string } | null
        if (result?.status === 'handled') throw new Unavailable('Pi handled the input without queuing this note.')
        return { queued: result?.status === 'queued' }
      } catch (error) {
        if (error instanceof Error && 'notQueued' in error && error.notQueued === true) throw new Unavailable(error.message)
        throw error
      }
    },
  }
}

import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * The agents and routines hobkin runs, stopped or told something while they work, through hobkin's own ways of
 * doing both. They are the snapshot's runs, the same ones the window lists (`agentsFrom` in the UI), by run id.
 * Spec: 011-work.
 */

/** What the host needs of hobkin's application for its agents. */
export interface AgentsApp {
  workAction(action: string, slug?: unknown, value?: unknown, extra?: unknown): Promise<unknown>
  kill(runId: string): Promise<boolean>
  runner: { messageCheck(request: { scheduleId?: string; message?: string }): Promise<unknown> }
}

export interface AgentsSeat {
  /** hobkin's application. Throws, with the reason, while hobkin is not open in this host. */
  app: () => AgentsApp
  /** hobkin's runs as its snapshot lists them now. */
  runs: () => readonly RunSummary[]
}

/** The two ways the terminal's k stops a work agent. */
const STOPS = { 'for-now': 'later', 'not-approved': 'decline' } as const

const messageOf = (result: unknown) => String((result as { message?: unknown } | null)?.message ?? '')

export function agentHandlers({ app, runs }: AgentsSeat): Pick<HostHandlers, 'agent.stop' | 'agent.say'> {
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
    'agent.say': async ({ run: id, text }) => {
      const run = running(id, 'It has finished, so nothing was sent.')

      // hobkin passes words to a running job as steering, read at its next step, and only to the jobs that take
      // messages. It names them by schedule, and a schedule runs once at a time.
      const reachable = run.scheduleId !== undefined && (await takingMessages()).includes(run.scheduleId)
      if (!reachable) throw new Unavailable('hobkin cannot pass a message to this agent while it runs.')

      await app().runner.messageCheck({ scheduleId: run.scheduleId, message: text })
      return { delivered: true }
    },
  }
}

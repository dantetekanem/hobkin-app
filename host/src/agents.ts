import type { ImageContent, TakenBack, TalkQueue } from 'hobkin/src/cli/application.mjs'
import { ENDED_SCHEDULE_STATES, type AgentSchedule } from '#shared/protocol/schedules.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
import { imageContents, type AgentImages } from './attachments.ts'
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
  runner: {
    messageCheck(request: { scheduleId?: string; runId?: string; noteId?: string; message?: string; images?: ImageContent[]; queue?: TalkQueue }): Promise<unknown>
    /** What waits for a running check's turn, given back. Absent in a runtime from before. */
    takeBack?(request: { scheduleId: string; runId: string }): Promise<{ unsent: TakenBack[] }>
  }
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
  /** The images attached to the messages being written. Without them a message can only be words. */
  images?: AgentImages
  /** The schedules agents keep for themselves, as the window has them (056-agent-schedules). None from a runtime without them. */
  schedules?: () => readonly AgentSchedule[] | undefined
}

/**
 * What a run that waits is waiting for: the soonest of its live schedules to wake it (056-agent-schedules), or its time
 * (spec 053).
 */
function waitingWords(run: RunSummary, schedules: readonly AgentSchedule[] | undefined): string {
  const isOwnLive = ({ owner, state }: AgentSchedule) =>
    owner?.kind === 'run' && owner.id === run.id && state !== undefined && !ENDED_SCHEDULE_STATES.includes(state)
  const firesAt = ({ nextAt }: AgentSchedule) => (nextAt ? Date.parse(nextAt) : Infinity)

  const [soonest] = (schedules ?? []).filter(isOwnLive).toSorted((one, other) => firesAt(one) - firesAt(other))
  if (!soonest) return 'It waits for its time, so nothing reaches it until it carries on.'

  const which = soonest.name ? `its schedule "${soonest.name}"` : 'one of its schedules'
  return `It waits for ${which} to wake it, so nothing reaches it until then.`
}

/** The two ways the terminal's k stops a work agent. */
const STOPS = { 'for-now': 'later', 'not-approved': 'decline' } as const

const messageOf = (result: unknown) => String((result as { message?: unknown } | null)?.message ?? '')

export function agentHandlers({ app, runs, models, images: attached, schedules }: AgentsSeat): Pick<HostHandlers, 'agent.stop' | 'agent.say' | 'agent.change' | 'agent.dequeue'> {
  /**
   * The run, while it runs, or also while it waits for its time when `waits` says so (spec 053). hobkin's own
   * conversation is no agent: its turn stops from the input.
   */
  const running = (id: string, ended: string, { waits = false }: { waits?: boolean } = {}): RunSummary => {
    const run = runs().find((entry) => entry.id === id)
    if (run?.kind === 'main') throw new Unavailable("That is hobkin's own conversation. Its turn stops from the input.")
    if (waits && run?.state === 'waiting') return run
    if (run?.state === 'waiting') throw new Unavailable(waitingWords(run, schedules?.()))
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
      // A run that waits holds no process, and hobkin's kill ends it as it ends a running one.
      const run = running(id, 'It had already finished, so nothing was stopped.', { waits: true })

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
    'agent.say': async ({ run: id, text, images = [], noteId, queue }) => {
      const run = running(id, 'It has finished, so nothing was sent.')

      // The exact run is checked again by the runner, so a schedule rollover cannot redirect the note.
      const reachable = run.scheduleId !== undefined && (await takingMessages()).includes(run.scheduleId)
      if (!reachable) throw new Unavailable('hobkin cannot pass a message to this agent while it runs.')

      // The images attached for it go with the words, and a message of pictures alone gets hobkin's own words.
      const pictures = images.length ? { images: imageContents(attached, images) } : {}
      const message = text?.trim() ? text : attached?.wordsAlone() ?? ''
      try {
        const asked = { scheduleId: run.scheduleId, runId: id, noteId, message, ...pictures, ...(queue ? { queue } : {}) }
        const result = await app().runner.messageCheck(asked) as { status?: string; unsent?: TakenBack[] } | null
        // Pi has the images now, so they leave the draft.
        if (images.length) attached?.given(images)
        if (result?.status === 'handled') throw new Unavailable('Pi handled the input without queuing this note.')
        // What the turn it interrupted never read goes back to the input.
        return { queued: result?.status === 'queued', ...(result?.unsent ? { unsent: result.unsent } : {}) }
      } catch (error) {
        if (error instanceof Error && 'notQueued' in error && error.notQueued === true) throw new Unavailable(error.message)
        throw error
      }
    },
    'agent.dequeue': async ({ run: id }) => {
      const run = running(id, 'It has finished, so nothing waits for it.')
      const takeBack = app().runner.takeBack
      if (!takeBack) throw new Unavailable('This hobkin cannot take messages back from an agent yet. Restart the app to load it.')
      if (run.scheduleId === undefined) throw new Unavailable('hobkin cannot pass a message to this agent while it runs.')
      try {
        const { unsent } = await takeBack.call(app().runner, { scheduleId: run.scheduleId, runId: id })
        return { unsent }
      } catch (error) {
        if (error instanceof Error && 'notQueued' in error && error.notQueued === true) throw new Unavailable(error.message)
        throw error
      }
    },
  }
}

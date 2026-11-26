import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { runStepOutput, runStepsBefore } from 'hobkin/src/cli/run-steps.mjs'
import { Unavailable, type HostHandlers } from './commands.ts'

/** hobkin's record of a run, as far as finding its saved session goes. */
interface SavedRun {
  kind?: string
  harness?: string
  harnessId?: string
  legacy?: boolean
  /** A durable hobkin's turn: the hobkin it belongs to. */
  hobkin?: { id?: string }
  startedAt?: string
  finishedAt?: string
}

export interface OlderStepsSeat {
  /** hobkin's data folder. */
  data: () => string
  /** hobkin's record of its runs. */
  state: () => Promise<{ runs: Record<string, SavedRun> }>
}

const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i
const HOBKIN_ID = /^[\da-f]{8}$/

/** Where a run's steps are saved: its session file and, for a turn that shares it with other turns, when the turn began and ended. */
interface Saved {
  file: string
  since?: number
  until?: number
}

/** `name` in the home's own `folder`, as a regular file with one name, or Unavailable as `why` says. */
async function ownFile(seat: OlderStepsSeat, folderName: string, name: string, why: string): Promise<string> {
  try {
    const folder = join(await realpath(seat.data()), folderName)
    const file = join(folder, name)
    const [parent, saved] = await Promise.all([lstat(folder), lstat(file)])
    if (!parent.isDirectory() || (await realpath(folder)) !== folder || !saved.isFile() || saved.nlink !== 1) throw Error('Not a saved session')
    return file
  } catch {
    throw new Unavailable(why)
  }
}

/**
 * A durable hobkin's turn, read from the hobkin's one conversation (`hobkins/<id>.jsonl`, `034-durable-hobkins`) between the turn's
 * start and end, as hobkin recorded them. A turn on Claude Code saves no Pi conversation.
 */
async function turnOf(seat: OlderStepsSeat, run: SavedRun): Promise<Saved> {
  const id = run.hobkin?.id ?? ''
  const since = Date.parse(run.startedAt ?? '')
  if (run.kind !== 'background' || run.harness !== 'pi' || !HOBKIN_ID.test(id) || !Number.isFinite(since)) {
    throw new Unavailable("This turn has no saved Pi conversation to read its steps from.")
  }
  const why = "The hobkin's saved conversation is missing or unavailable: only a regular file in its own hobkins folder is read."
  const file = await ownFile(seat, 'hobkins', `${id}.jsonl`, why)
  const until = Date.parse(run.finishedAt ?? '')
  return { file, since, ...(Number.isFinite(until) ? { until } : {}) }
}

/**
 * A run's saved Pi session, found from hobkin's own record of the run, never from what the window says, and read only
 * as a regular file in the home's own folder for it: every native Pi job saves `jobs/<harnessId>.jsonl`, and a durable
 * hobkin's turns save to the hobkin's conversation.
 */
async function sessionOf(seat: OlderStepsSeat, job: string): Promise<Saved> {
  const { runs } = await seat.state()
  const run = Object.hasOwn(runs, job) ? runs[job] : undefined
  if (!run) throw new Unavailable('That run is not one hobkin knows.')
  if (run.hobkin) return turnOf(seat, run)
  if (run.kind !== 'background' || run.harness !== 'pi' || run.legacy || !UUID.test(run.harnessId ?? '')) {
    throw new Unavailable('This run has no saved Pi session to read its earlier steps from.')
  }
  const why = "The run's saved session is missing or unavailable: only a regular file in its own jobs folder is read."
  return { file: await ownFile(seat, 'jobs', `${run.harnessId}.jsonl`, why) }
}

/** hobkin's reading of a saved session, with a session it cannot read said as one that is not available. */
function readSaved<Value>(read: () => Value): Value {
  try {
    return read()
  } catch (error) {
    throw new Unavailable(`The run's saved session cannot be read: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** A run's steps that its feed let go, and a tool's whole output, read back from the run's saved session. */
export function olderStepsHandlers(seat: OlderStepsSeat): Pick<HostHandlers, 'activity.before' | 'activity.output'> {
  return {
    'activity.before': async ({ job, before, at }) => {
      const { file, since, until } = await sessionOf(seat, job)
      return readSaved(() => runStepsBefore(file, { before: before ?? null, at: at ?? null, since: since ?? null, until: until ?? null }))
    },
    'activity.output': async ({ job, id }) => {
      const { file } = await sessionOf(seat, job)
      return readSaved(() => runStepOutput(file, id))
    },
  }
}

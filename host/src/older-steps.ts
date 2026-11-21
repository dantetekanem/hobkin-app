import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { runStepOutput, runStepsBefore } from 'hobkin/src/cli/run-steps.mjs'
import { Unavailable, type HostHandlers } from './commands.ts'

export interface OlderStepsSeat {
  /** hobkin's data folder. */
  data: () => string
  /** hobkin's record of its runs. */
  state: () => Promise<{ runs: Record<string, { kind?: string; harness?: string; harnessId?: string; legacy?: boolean }> }>
}

const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

/**
 * A run's saved Pi session, found from hobkin's own record of the run, never from what the window says, and read only
 * as a regular file in the home's own jobs folder, where every native Pi job saves `jobs/<harnessId>.jsonl`.
 */
async function sessionOf(seat: OlderStepsSeat, job: string): Promise<string> {
  const { runs } = await seat.state()
  const run = Object.hasOwn(runs, job) ? runs[job] : undefined
  if (!run) throw new Unavailable('That run is not one hobkin knows.')
  if (run.kind !== 'background' || run.harness !== 'pi' || run.legacy || !UUID.test(run.harnessId ?? '')) {
    throw new Unavailable('This run has no saved Pi session to read its earlier steps from.')
  }
  try {
    const folder = join(await realpath(seat.data()), 'jobs')
    const file = join(folder, `${run.harnessId}.jsonl`)
    const [parent, saved] = await Promise.all([lstat(folder), lstat(file)])
    if (!parent.isDirectory() || (await realpath(folder)) !== folder || !saved.isFile() || saved.nlink !== 1) throw Error('Not a job file')
    return file
  } catch {
    throw new Unavailable("The run's saved session is missing or unavailable: only a regular file in its own jobs folder is read.")
  }
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
      const file = await sessionOf(seat, job)
      return readSaved(() => runStepsBefore(file, { before: before ?? null, at: at ?? null }))
    },
    'activity.output': async ({ job, id }) => {
      const file = await sessionOf(seat, job)
      return readSaved(() => runStepOutput(file, id))
    },
  }
}

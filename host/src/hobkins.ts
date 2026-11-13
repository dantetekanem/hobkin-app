import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { DurableHobkins } from 'hobkin/src/cli/application.mjs'
import type { CommandName } from '#shared/commands/registry.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * The durable hobkins' commands (034-durable-hobkins), passed to hobkin's runtime as they are. The window starts,
 * talks to and ends them. hobkin may read, list and message them (`hobkin: true` on `hobkin.read`, `hobkin.list` and
 * `hobkin.tell`): a message through its `client` tool is the main hobkin's, never the user's. The runtime keeps the
 * conversations and starts each turn as a run, so this checks only what the host knows: the folder and what can run.
 */

export interface HobkinsSeat {
  /** hobkin's application. Throws, with the reason, while hobkin is not open in this host. */
  app: () => { hobkins?: DurableHobkins }
  /** Why Claude Code cannot run now, in plain words, or null when it can. */
  claudeMissing: () => Promise<string | null>
  /** Why Pi cannot run this model at this thinking level now, or null when it can. */
  modelProblem: (model: string, effort: string) => Promise<string | null> | string | null
  /** The user's home folder, for a folder that starts with ~. */
  home?: string
}

type Names = Extract<CommandName, `hobkin.${string}`>

const OLD_RUNTIME = 'This hobkin does not have durable hobkins yet. Restart the app to load them.'
const NO_MESSAGES = 'This hobkin cannot pass messages between hobkins yet. Restart the app to load them.'

export function hobkinHandlers({ app, claudeMissing, modelProblem, home = homedir() }: HobkinsSeat): Pick<HostHandlers, Names> {
  const durable = (): DurableHobkins => {
    const hobkins = app().hobkins
    if (!hobkins) throw new Unavailable(OLD_RUNTIME)
    return hobkins
  }

  /** What the runtime does, with its refusals told as the command's reason. */
  const ask = async <T>(run: (hobkins: DurableHobkins) => Promise<T>): Promise<T> => {
    const hobkins = durable()
    try {
      return await run(hobkins)
    } catch (error) {
      if (error instanceof Unavailable || !(error instanceof Error)) throw error
      throw new Unavailable(error.message)
    }
  }

  /** The folder as an absolute path, or why it cannot be one. */
  const folder = (cwd: string): string => {
    const path = cwd === '~' ? home : cwd.startsWith('~/') ? join(home, cwd.slice(2)) : cwd
    if (!isAbsolute(path)) throw new Unavailable('The folder must be a full path, such as ~/Projects/app.')
    let isFolder = false
    try {
      isFolder = statSync(path).isDirectory()
    } catch {
      // Not there.
    }
    if (!isFolder) throw new Unavailable(`The folder ${path} is not there.`)
    return path
  }

  return {
    'hobkin.start': async ({ text, cwd, engine, title }) => {
      durable()
      const path = folder(cwd)
      if (engine.kind === 'claude') {
        const missing = await claudeMissing()
        if (missing) throw new Unavailable(missing)
      }
      if (engine.kind === 'pi') {
        const problem = await modelProblem(engine.model, engine.effort)
        if (problem) throw new Unavailable(problem)
      }
      return ask((hobkins) => hobkins.start({ cwd: path, engine, ...(text === undefined ? {} : { text }), ...(title === undefined ? {} : { title }) }))
    },
    'hobkin.say': ({ id, text, noteId }) => ask((hobkins) => hobkins.say(id, { text, ...(noteId === undefined ? {} : { noteId }) })),
    'hobkin.end': ({ id }) => ask((hobkins) => hobkins.end(id)),
    'hobkin.rename': ({ id, title }) => ask((hobkins) => hobkins.rename(id, title)),
    'hobkin.seen': ({ id }) => ask((hobkins) => hobkins.seen(id)),
    'hobkin.read': ({ id }) => ask((hobkins) => hobkins.read(id)),
    'hobkin.list': () => ask((hobkins) => {
      if (!hobkins.reach) throw new Unavailable(NO_MESSAGES)
      return hobkins.reach()
    }),
    'hobkin.tell': ({ id, text }) => ask((hobkins) => {
      if (!hobkins.tell) throw new Unavailable(NO_MESSAGES)
      return hobkins.tell(id, { text })
    }),
  }
}

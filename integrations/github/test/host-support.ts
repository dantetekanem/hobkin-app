import { Check } from 'typebox/value'
import { Unavailable, type CommandOutcome } from '#host/commands.ts'
import type { HostContext, HostPart } from '#host/integration-contract.ts'
import type { GhCall } from '#host/review/gh.ts'
import type { WorkApp } from '#host/work.ts'
import manifest from '../integration.ts'
import githubPart from '../host.ts'
import type { GitHubSource } from '../host/github.ts'

/** What a test gives a part: its own gh, hobkin's application, home and snapshot, and what it hears. */
export interface Fakes {
  source?: GitHubSource
  gh?: GhCall
  app?: WorkApp
  root?: string
  /** The `work` key of hobkin's snapshot. */
  work?: unknown
  live?: boolean
  connected?: () => boolean
}

export function fakeContext(fakes: Fakes = {}) {
  const heard = { changed: 0, logs: [] as string[] }
  const context: HostContext = {
    id: 'github',
    live: fakes.live ?? false,
    ...(fakes.gh ? { gh: fakes.gh } : {}),
    options: fakes.source ? { source: fakes.source } : {},
    log: (line) => void heard.logs.push(line),
    changed: () => void heard.changed++,
    connected: fakes.connected ?? (() => true),
    hobkin: () => fakes.app ?? (() => { throw new Unavailable('hobkin is not open.') })(),
    dataRoot: () => fakes.root ?? (() => { throw new Unavailable('hobkin is not open.') })(),
    snapshotWork: () => fakes.work,
    startWorkflow: async () => { throw new Unavailable('hobkin is not open.') },
  }
  return { context, heard }
}

export async function partFor(fakes: Fakes = {}): Promise<HostPart & { heard: ReturnType<typeof fakeContext>['heard'] }> {
  const { context, heard } = fakeContext(fakes)
  return Object.assign(await githubPart(context), { heard })
}

/** A command as the host runs it: its arguments checked against the manifest first, and what the handler throws turned into a refusal. */
export async function run(part: HostPart, name: string, args: unknown): Promise<CommandOutcome> {
  const command = manifest.commands[name as keyof typeof manifest.commands]
  if (!Check(command.args, args ?? {})) return { ok: false, error: { code: 'invalid-arguments', message: `${name} was given the wrong arguments.` } }
  const handler = part.handlers?.[name]
  if (!handler) return { ok: false, error: { code: 'unavailable', message: `${name} does not run in the host.` } }
  try {
    return { ok: true, value: await (handler as (args: unknown) => unknown)(args ?? {}) }
  } catch (error) {
    return { ok: false, error: { code: error instanceof Unavailable ? 'unavailable' : 'failed', message: error instanceof Error ? error.message : String(error) } }
  }
}

export const takes = (name: keyof typeof manifest.commands, args: unknown) => Check(manifest.commands[name].args, args)

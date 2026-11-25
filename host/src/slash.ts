import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HobkinApplication } from 'hobkin/src/cli/application.mjs'
import type { SlashAgent, SlashCommand, SlashOutcome } from '#shared/protocol/slash.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { Unavailable } from './commands.ts'

/**
 * The slash commands of the message input: hobkin's own, as the terminal app has them, and the ones Pi offers
 * for the main session, or on an agent's page for that agent's own session. Each run is counted in the home, so the
 * list can put the most used first.
 */

/** hobkin's commands and their one line each, in the terminal app's order (`localCommands` in `src/cli/ui.mjs`). */
const HOBKIN_COMMANDS: readonly [name: string, description: string][] = [
  ['/help', 'what hobkin can do'],
  ['/setup', 'get hobkin ready'],
  ['/clear', 'hide visible chat'],
  ['/reset', 'start a fresh main context'],
  ['/navigate', 'teach me how to navigate'],
  ['/work', 'work with agents on projects'],
  ['/learning', 'learn from outcomes'],
  ['/feedback', 'report a bug or an idea (not built yet)'],
]

// What the terminal app sends and says for these (`src/cli/ui.mjs`).
const SETUP_REQUEST = 'Help me set up hobkin.'
const LEARNING_ON = 'Learning on. Every agent now gets what past outcomes taught. Run hobkin learning to see it.'
const LEARNING_OFF = 'Learning off. Nothing is judged, and agents get nothing.'

/** The terminal app's help, without the command the app answers Unavailable for, and with the one the app adds. */
export const helpGuide = () =>
  readFileSync(fileURLToPath(import.meta.resolve('hobkin/src/prompts/help.md')), 'utf8')
    .trim()
    .split('\n')
    .filter((line) => !/^- `\/feedback`/.test(line))
    .flatMap((line) => (line.startsWith('- `/reset`') ? [line, '- `/navigate` teaches you how to get around with the keyboard'] : [line]))
    .join('\n')

interface PiCommand {
  name?: unknown
  invocationName?: unknown
  description?: unknown
  /** As `get_commands` says it: `extension`, `prompt` or `skill`. */
  source?: unknown
}

/** A command Pi offers a session, with its slash, and whether it runs as an extension's code or becomes a message. */
interface Offered {
  name: string
  description: string
  extension: boolean
}

/** The main session as far as its commands go. An in-process session and one behind a launcher answer differently. */
interface CommandSource {
  child?: { request(type: 'get_commands'): Promise<{ commands?: PiCommand[] }> }
  extensionRunner?: { getRegisteredCommands?(): PiCommand[] }
  promptTemplates?: PiCommand[]
  resourceLoader?: { getSkills?(): { skills?: PiCommand[] } }
}

/**
 * What hobkin offers for an agent's own session, by run or by durable hobkin. Each is absent in a runtime from before
 * agents' commands, and the runner's `message_check` is how words reach a working run.
 */
interface AgentSessions {
  runtime?: { runCommands?(runId: string): Promise<PiCommand[]> }
  runner: { messageCheck(request: { scheduleId: string; runId: string; message: string }): Promise<{ status?: string } | null> }
  hobkins?: {
    commands?(id: string): Promise<PiCommand[]>
    read(id: string): Promise<{ hobkin: { state: string } }>
    say(id: string, args: { text: string }): Promise<{ started: boolean; run: string }>
  }
}

/** Pi's listing as the input shows it: each with its slash and its first line. */
function offered(listed: readonly PiCommand[]): Offered[] {
  return listed
    .filter(({ name }) => typeof name === 'string' && name.length > 0)
    .map(({ name, description, source }) => ({
      name: `/${String(name)}`,
      description: typeof description === 'string' && description.trim() ? description.trim().split('\n', 1)[0]!.slice(0, 120) : 'a Pi command',
      extension: source === 'extension',
    }))
}

/** What Pi offers for this session: extension commands, prompt templates and skills, as its own `get_commands` lists them. */
async function piCommands(main: CommandSource | null | undefined): Promise<Offered[]> {
  if (!main) return []
  try {
    const listed = main.child
      ? ((await main.child.request('get_commands')).commands ?? [])
      : [
          ...(main.extensionRunner?.getRegisteredCommands?.() ?? []).map(({ invocationName, description }) => ({ name: invocationName, description, source: 'extension' })),
          ...(main.promptTemplates ?? []),
          ...(main.resourceLoader?.getSkills?.().skills ?? []).map(({ name, description }) => ({ name: `skill:${String(name)}`, description })),
        ]
    return offered(listed)
  } catch {
    // The list is a convenience. A session that cannot say what it offers still takes messages.
    return []
  }
}

/** What Pi offers an agent's own session, or none while no process holds it. */
async function agentCommands(app: AgentSessions | null, agent: SlashAgent): Promise<Offered[]> {
  try {
    const listed = 'run' in agent ? await app?.runtime?.runCommands?.(agent.run) : await app?.hobkins?.commands?.(agent.hobkin)
    return offered(listed ?? [])
  } catch {
    // A run that is not working, or a hobkin between processes, offers nothing now. Its page still takes messages.
    return []
  }
}

/** The agent a command's arguments name, or none for the main chat's. */
export const slashAgent = ({ run, hobkin }: { run?: string; hobkin?: string }): SlashAgent | undefined =>
  run !== undefined ? { run } : hobkin !== undefined ? { hobkin } : undefined

export interface SlashOptions {
  /** The home the counts are kept in. */
  root: string
  /** Hides the messages on screen for good, as `/clear` does. hobkin's own conversation keeps them. */
  clear: () => Promise<void>
  /** hobkin's runs as its snapshot lists them now, for the schedule a working run takes messages by. */
  runs?: () => readonly RunSummary[]
}

export class SlashCommands {
  private readonly options: SlashOptions
  private readonly file: string
  private counts: Record<string, number>

  constructor(options: SlashOptions) {
    this.options = options
    this.file = join(options.root, 'client', 'slash-counts.json')
    this.counts = this.read()
  }

  private read(): Record<string, number> {
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as { version?: number; counts?: Record<string, unknown> }
      if (saved.version !== 1) return {}
      return Object.fromEntries(Object.entries(saved.counts ?? {}).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && (entry[1] as number) > 0))
    } catch {
      // No file yet, or one that cannot be read: the counts start over, and nothing else depends on them.
      return {}
    }
  }

  private count(name: string): void {
    this.counts = { ...this.counts, [name]: (this.counts[name] ?? 0) + 1 }
    mkdirSync(join(this.options.root, 'client'), { recursive: true, mode: 0o700 })
    const draft = `${this.file}.${process.pid}.tmp`
    writeFileSync(draft, `${JSON.stringify({ version: 1, counts: this.counts })}\n`, { mode: 0o600 })
    renameSync(draft, this.file)
  }

  /** Pi's commands by name, each with how often it was run, leaving out the names hobkin's own take. */
  private piRows(offers: readonly Offered[], taken: ReadonlySet<string> = new Set()): SlashCommand[] {
    return offers
      .filter(({ name }) => !taken.has(name))
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(({ name, description }): SlashCommand => ({ name, description, source: 'pi', count: this.counts[name] ?? 0 }))
  }

  /**
   * Every command the input can run now, with how often each was run. hobkin's come first, then Pi's by name. An agent's
   * page lists what Pi offers that agent's own session; hobkin's own are the main chat's.
   */
  async list(app: HobkinApplication | null, agent?: SlashAgent): Promise<SlashCommand[]> {
    if (agent) return this.piRows(await agentCommands(app as AgentSessions | null, agent))
    const own = HOBKIN_COMMANDS.map(([name, description]): SlashCommand => ({ name, description, source: 'hobkin', count: this.counts[name] ?? 0 }))
    const pi = this.piRows(await piCommands(app?.runtime.main as CommandSource | undefined), new Set(own.map(({ name }) => name)))
    return [...own, ...pi]
  }

  /** Runs a command the way the terminal app does, in the main chat or in an agent's own session, and counts it once it ran. */
  async run(app: HobkinApplication, name: string, args: string, agent?: SlashAgent): Promise<SlashOutcome> {
    if (agent) {
      const command = (await agentCommands(app as unknown as AgentSessions, agent)).find((listed) => listed.name === name)
      if (!command) throw Error(`There is no command ${name}.`)
      const outcome = await this.runForAgent(app as unknown as AgentSessions, agent, command, args)
      this.count(name)
      return outcome
    }

    const command = (await this.list(app)).find((listed) => listed.name === name)
    if (!command) throw Error(`There is no command ${name}.`)

    const outcome = command.source === 'pi' ? await this.runPi(app, name, args) : await this.runOwn(app, name)
    this.count(name)
    return outcome
  }

  /**
   * An agent's command goes to its session as typed, without a note's mark ahead of it, so Pi runs it there as the
   * terminal would: an extension command runs, and a template or skill becomes the message it expands to. A working
   * run hears it through `message_check`; a durable hobkin as its own words, which start its next turn while it waits.
   * Its process is gone between turns, so an extension command waits for a turn to run in.
   */
  private async runForAgent(app: AgentSessions, agent: SlashAgent, command: Offered, args: string): Promise<SlashOutcome> {
    const text = args ? `${command.name} ${args}` : command.name
    const ran = { said: `Ran ${command.name}.` }
    if ('hobkin' in agent) {
      const hobkins = app.hobkins!
      try {
        if (command.extension && (await hobkins.read(agent.hobkin)).hobkin.state !== 'working') throw new Unavailable(`It runs ${command.name} only while it works.`)
        const said = await hobkins.say(agent.hobkin, { text })
        return command.extension ? ran : { sent: { run: said.run, started: said.started } }
      } catch (error) {
        // hobkin's refusals are plain sentences, told as the command's reason.
        throw error instanceof Unavailable || !(error instanceof Error) ? error : new Unavailable(error.message)
      }
    }

    const run = this.options.runs?.().find(({ id }) => id === agent.run)
    const scheduleId = run?.state === 'running' ? run.scheduleId : undefined
    if (!scheduleId) throw new Unavailable('It is not working, so nothing was sent.')
    try {
      await app.runner.messageCheck({ scheduleId, runId: agent.run, message: text })
    } catch (error) {
      throw error instanceof Error && 'notQueued' in error ? new Unavailable(error.message) : error
    }
    return command.extension ? ran : { sent: { run: agent.run, started: false } }
  }

  /** Pi runs its own commands when it is given their text. It goes in without hobkin's notes ahead of it, which would hide the slash. */
  private async runPi(app: HobkinApplication, name: string, args: string): Promise<SlashOutcome> {
    await app.runtime.send(args ? `${name} ${args}` : name)
    return {}
  }

  private async runOwn(app: HobkinApplication, name: string): Promise<SlashOutcome> {
    switch (name) {
      case '/help':
        return { shown: helpGuide() }
      case '/setup':
        await app.send(SETUP_REQUEST)
        return {}
      case '/clear':
        await this.options.clear()
        return { said: 'Visible chat cleared. Context and history are kept.' }
      case '/reset':
        await app.reset()
        return { said: 'Main context reset.' }
      case '/learning':
        return { said: (await app.toggleLearning()).enabled ? LEARNING_ON : LEARNING_OFF }
      case '/work':
        // The app opens its Work screen itself. The host only counts the run.
        return {}
      default:
        // Feedback leaves this machine on a yes, so it waits for its own screen.
        throw new Unavailable('Sending feedback from the app is not built yet.')
    }
  }
}

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HobkinApplication } from 'hobkin/src/cli/application.mjs'
import type { SlashCommand, SlashOutcome } from '#shared/protocol/slash.ts'
import { Unavailable } from './commands.ts'

/**
 * The slash commands of the message input: hobkin's own, as the terminal app has them, and the ones Pi offers
 * for the main session. Each run is counted in the home, so the list can put the most used first.
 */

/** hobkin's commands and their one line each, in the terminal app's order (`localCommands` in `src/cli/ui.mjs`). */
const HOBKIN_COMMANDS: readonly [name: string, description: string][] = [
  ['/help', 'what hobkin can do'],
  ['/setup', 'get hobkin ready'],
  ['/clear', 'hide visible chat'],
  ['/reset', 'start a fresh main context'],
  ['/work', 'work mode'],
  ['/learning', 'learn from outcomes'],
  ['/feedback', 'report a bug or an idea'],
]

// What the terminal app sends and says for these (`src/cli/ui.mjs`).
const SETUP_REQUEST = 'Help me set up hobkin.'
const LEARNING_ON = 'Learning on. Every agent now gets what past outcomes taught. Run hobkin learning to see it.'
const LEARNING_OFF = 'Learning off. Nothing is judged, and agents get nothing.'

const helpGuide = () => readFileSync(fileURLToPath(import.meta.resolve('hobkin/src/prompts/help.md')), 'utf8').trim()

interface PiCommand {
  name?: unknown
  invocationName?: unknown
  description?: unknown
}

/** The main session as far as its commands go. An in-process session and one behind a launcher answer differently. */
interface CommandSource {
  child?: { request(type: 'get_commands'): Promise<{ commands?: PiCommand[] }> }
  extensionRunner?: { getRegisteredCommands?(): PiCommand[] }
  promptTemplates?: PiCommand[]
  resourceLoader?: { getSkills?(): { skills?: PiCommand[] } }
}

/** What Pi offers for this session: extension commands, prompt templates and skills, as its own `get_commands` lists them. */
async function piCommands(main: CommandSource | null | undefined): Promise<[name: string, description: string][]> {
  if (!main) return []
  try {
    const listed = main.child
      ? ((await main.child.request('get_commands')).commands ?? [])
      : [
          ...(main.extensionRunner?.getRegisteredCommands?.() ?? []).map(({ invocationName, description }) => ({ name: invocationName, description })),
          ...(main.promptTemplates ?? []),
          ...(main.resourceLoader?.getSkills?.().skills ?? []).map(({ name, description }) => ({ name: `skill:${String(name)}`, description })),
        ]
    return listed
      .filter(({ name }) => typeof name === 'string' && name.length > 0)
      .map(({ name, description }): [string, string] => [`/${String(name)}`, typeof description === 'string' && description.trim() ? description.trim().split('\n', 1)[0]!.slice(0, 120) : 'a Pi command'])
  } catch {
    // The list is a convenience. A session that cannot say what it offers still takes messages.
    return []
  }
}

export interface SlashOptions {
  /** The home the counts are kept in. */
  root: string
  /** Hides the messages on screen for good, as `/clear` does. hobkin's own conversation keeps them. */
  clear: () => Promise<void>
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

  /** Every command the input can run now, with how often each was run. hobkin's come first, then Pi's by name. */
  async list(app: HobkinApplication | null): Promise<SlashCommand[]> {
    const own = HOBKIN_COMMANDS.map(([name, description]): SlashCommand => ({ name, description, source: 'hobkin', count: this.counts[name] ?? 0 }))
    const taken = new Set(own.map(({ name }) => name))
    const pi = (await piCommands(app?.runtime.main as CommandSource | undefined))
      .filter(([name]) => !taken.has(name))
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([name, description]): SlashCommand => ({ name, description, source: 'pi', count: this.counts[name] ?? 0 }))
    return [...own, ...pi]
  }

  /** Runs a command the way the terminal app does, and counts it once it ran. */
  async run(app: HobkinApplication, name: string, args: string): Promise<SlashOutcome> {
    const command = (await this.list(app)).find((listed) => listed.name === name)
    if (!command) throw Error(`There is no command ${name}.`)

    const outcome = command.source === 'pi' ? await this.runPi(app, name, args) : await this.runOwn(app, name)
    this.count(name)
    return outcome
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
      default:
        // Work mode starts agents in a folder, and feedback leaves this machine on a yes. Both wait for their own screens.
        throw new Unavailable(`${name} is not in the app yet. Use it in the terminal app.`)
    }
  }
}

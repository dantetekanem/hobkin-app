import { Type } from 'typebox'
import { COMMANDS, isCommand, type CommandDefinition } from '#shared/commands/registry.ts'
import type { CommandOutcome } from './commands.ts'

/**
 * hobkin's way into the app: one tool, `client`, that lists, describes and runs the app's own commands
 * (`013-hobkin-access`). Only the commands marked for hobkin run through it. One that changes something outside
 * the app, such as Pi's setup, needs the user's yes in the window, so hobkin is told to send the user there.
 */

export const CLIENT_TOOL = 'client'

export interface ClientToolOptions {
  /** Runs a command exactly as a click in the window does, arguments checked first. */
  run: (name: string, args: unknown) => Promise<CommandOutcome>
}

const parameters = Type.Object(
  {
    action: Type.Union([Type.Literal('list'), Type.Literal('describe'), Type.Literal('run')], { description: 'list: the commands hobkin may run. describe: one command and its arguments. run: run one.' }),
    name: Type.Optional(Type.String({ description: 'The command, such as signin.start. For describe and run.' })),
    args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'The command arguments. For run.' })),
  },
  { additionalProperties: false },
)

interface ClientToolCall {
  action: 'list' | 'describe' | 'run'
  name?: string
  args?: Record<string, unknown>
}

const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: value })

/** The command, when hobkin may run it. Otherwise why not, in words hobkin can pass on. */
function commandFor(name: string | undefined): [string, CommandDefinition] {
  if (!name || !isCommand(name)) throw Error(`There is no command named "${name ?? ''}". Use the list action to see them.`)
  const command = COMMANDS[name] as CommandDefinition
  if (command.outside) throw Error(`${name} changes something outside the app, so it needs the user's yes in the window. Tell the user where to do it.`)
  if (!command.hobkin) throw Error(`hobkin cannot run ${name} through this tool.`)
  return [name, command]
}

export function createClientTool({ run }: ClientToolOptions) {
  return {
    name: CLIENT_TOOL,
    label: 'hobkin app',
    description: [
      "Use the hobkin app's own commands, the ones its window runs for the user's clicks.",
      'Through it you can list the model providers Pi knows and whether each is connected, say how to set up an API key without the key passing through the app, and start or cancel a sign-in to a provider such as a ChatGPT or Claude subscription, which the user then approves in the browser.',
      'canvas.show opens a panel beside the screens with a web page (http or https) when you have something to show, such as an app you are testing; canvas.close sends it away.',
      'Start with action "list". Never ask the user for a key, token or password: give them the steps from models.key-help instead.',
    ].join(' '),
    promptSnippet: "client: run the hobkin app's commands, such as listing model providers or starting a sign-in",
    parameters,
    async execute(_id: string, { action, name, args }: ClientToolCall) {
      if (action === 'list') {
        return reply(
          Object.entries(COMMANDS as Record<string, CommandDefinition>)
            .filter(([, command]) => command.hobkin && !command.outside)
            .map(([command, { description }]) => ({ name: command, description })),
        )
      }
      const [command, { description, args: schema }] = commandFor(name)
      if (action === 'describe') return reply({ name: command, description, args: schema })

      const outcome = await run(command, args ?? {})
      if (!outcome.ok) throw Error(outcome.error.message)
      return reply(outcome.value)
    },
  }
}

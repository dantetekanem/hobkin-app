import { Unavailable } from '#host/commands.ts'
import { Type } from 'typebox'
import { defineTool, type CommandCall, type CommandDone, type HostPartFactory, type ToolCall } from '#host/integration-contract.ts'

/** What a test hands this part: where it writes down what it hears, and when to refuse or to fail. */
interface Options {
  heard?: unknown[]
  refuse?: (call: CommandCall) => string | null
  fail?: boolean
  pulls?: { mine: []; waiting: []; sample: boolean } | null
  /** Words the after hook takes out of what an agent reads. */
  hide?: string
  failClosed?: boolean
}

const factory: HostPartFactory = (context) => {
  const options = context.options as Options
  const heard = (what: string, detail: unknown) => options.heard?.push({ what, detail })
  const failing = (what: string) => {
    if (options.fail) throw Error(`${what} fails`)
  }
  let said = 0
  context.log('ready')
  return {
    tools: [
      defineTool({
        name: 'shout',
        description: 'Say a line back in capitals, and name the agent that asked.',
        parameters: Type.Object({ text: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
        agents: ['main', 'runs'],
        execute: ({ text }, run) => {
          if (text === 'explode') throw Error('it exploded')
          return `${run.agent}: ${text.toUpperCase()}`
        },
      }),
    ],
    toolHooks: {
      tools: ['echo_shout', 'bash'],
      failClosed: options.failClosed,
      before: (call) => {
        heard('tool-before', { agent: call.agent, name: call.name, args: call.args })
        failing('before hook')
        if (call.args.text === 'forbidden') return { block: 'echo does not say that.' }
        if (call.name === 'bash' && typeof call.args.command === 'string') return { args: { ...call.args, command: `${call.args.command} --quiet` } }
      },
      after: (call, result) => {
        heard('tool-after', { name: call.name, text: result.text })
        if (options.hide && result.text.includes(options.hide)) return { text: result.text.replaceAll(options.hide, '***') }
      },
    },
    state: () => ({ said }),
    handlers: {
      'echo.say': ({ text }: { text: string }) => {
        said += 1
        context.changed()
        return { said: text }
      },
      'echo.quiet': () => ({ ok: true }),
    },
    beforeCommand(call) {
      heard('before', { name: call.name, from: call.from })
      failing('beforeCommand')
      const why = options.refuse?.(call)
      if (why) throw new Unavailable(why)
    },
    afterCommand(done: CommandDone) {
      heard('after', { name: done.name, from: done.from, ok: done.outcome.ok })
      failing('afterCommand')
    },
    onToolCall(call: ToolCall) {
      heard('tool', { agent: call.agent, id: call.id, name: call.name, state: call.state })
      failing('onToolCall')
    },
    onMerged(pull) {
      heard('merged', pull)
      failing('onMerged')
    },
    pulls: () => options.pulls ?? null,
    start: () => heard('start', null),
    close: () => heard('close', null),
  }
}

export default factory

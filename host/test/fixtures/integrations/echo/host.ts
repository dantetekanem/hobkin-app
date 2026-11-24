import { Unavailable } from '#host/commands.ts'
import type { CommandCall, CommandDone, HostPartFactory, ToolCall } from '#host/integration-contract.ts'

/** What a test hands this part: where it writes down what it hears, and when to refuse or to fail. */
interface Options {
  heard?: unknown[]
  refuse?: (call: CommandCall) => string | null
  fail?: boolean
  pulls?: { mine: []; waiting: []; sample: boolean } | null
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

import type { PiSessionEvent } from 'hobkin/src/cli/application.mjs'
import type { ActivityEntry, JobActivity } from '#shared/protocol/activity.ts'
import type { ToolCall } from './integration-contract.ts'

/** The `agent` of a call hobkin's main conversation made. */
export const MAIN_AGENT = '#main'

/** What a tool gave back as text: Pi's result holds text blocks, and an older shape may be the text itself. */
function outputOf(result: unknown): string | undefined {
  if (typeof result === 'string') return result
  const content = (result as { content?: unknown } | null | undefined)?.content
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap((block: unknown) => {
    const { type, text } = (block ?? {}) as { type?: unknown; text?: unknown }
    return type === 'text' && typeof text === 'string' ? [text] : []
  })
  return text.length ? text.join('\n') : undefined
}

export interface ToolCallOptions {
  /**
   * The first look at the runs' activity only takes note of what is there, giving the calls still running but not the
   * ones that already ended: they ended before this watcher began. A host starting over would otherwise tell every
   * integration about the whole past. Off by default.
   */
  skipFirstLook?: boolean
}

type Phase = 'started' | 'ended'

/**
 * Turns what agents do into the tool calls an integration hears (`onToolCall`): each call is given once as it starts
 * and once as it ends. A call first seen already ended gives only its end. The main conversation's calls come from
 * Pi's events, with their arguments as Pi gave them; each run's come from its activity feed in the snapshot's
 * `jobActivity`, with the arguments as the JSON text hobkin keeps. Nothing here knows who listens.
 */
export class ToolCallWatcher {
  private readonly phases = new Map<string, Phase>()
  private looked = false
  private readonly skipFirstLook: boolean
  private readonly emit: (call: ToolCall) => void

  constructor(emit: (call: ToolCall) => void, { skipFirstLook = false }: ToolCallOptions = {}) {
    this.emit = emit
    this.skipFirstLook = skipFirstLook
  }

  /** One of Pi's session events from hobkin's main conversation. Any other event is ignored. */
  event(event: PiSessionEvent): void {
    if (event.type !== 'tool_execution_start' && event.type !== 'tool_execution_end') return
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : ''
    if (!id) return
    const name = typeof event.toolName === 'string' ? event.toolName : ''
    const key = `${MAIN_AGENT}\0${id}`
    if (event.type === 'tool_execution_start') {
      if (this.phases.has(key)) return
      this.phases.set(key, 'started')
      this.emit({ agent: MAIN_AGENT, id, name, args: event.args, state: 'running' })
      return
    }
    // The main conversation gives each call's end once, so the note of it is not kept.
    this.phases.delete(key)
    const output = outputOf(event.result)
    this.emit({ agent: MAIN_AGENT, id, name, args: event.args, state: event.isError === true ? 'failed' : 'completed', ...(output === undefined ? {} : { output }) })
  }

  /** The runs' activity as the snapshot holds it now, looked at on every publish. */
  activity(jobs: JobActivity | undefined): void {
    const first = !this.looked
    this.looked = true
    const present = new Set<string>()
    for (const [agent, entries] of Object.entries(jobs ?? {})) {
      if (agent === MAIN_AGENT || !Array.isArray(entries)) continue
      for (const entry of entries) {
        if (entry?.kind !== 'tool' || typeof entry.id !== 'string') continue
        const key = `${agent}\0${entry.id}`
        present.add(key)
        this.see(agent, entry, key, first && this.skipFirstLook)
      }
    }
    // A run that has gone from the snapshot, or an entry its feed let go, is forgotten.
    for (const key of this.phases.keys()) if (!key.startsWith(`${MAIN_AGENT}\0`) && !present.has(key)) this.phases.delete(key)
  }

  private see(agent: string, entry: ActivityEntry, key: string, history: boolean): void {
    const id = entry.id.replace(/^tool:/, '')
    const phase = this.phases.get(key)
    const ended = entry.state === 'completed' || entry.state === 'failed'
    if (phase === 'ended') return
    if (ended) {
      this.phases.set(key, 'ended')
      if (!history) this.emit(this.callOf(agent, id, entry, entry.state as 'completed' | 'failed'))
      return
    }
    if (phase === 'started') return
    this.phases.set(key, 'started')
    this.emit(this.callOf(agent, id, entry, 'running'))
  }

  private callOf(agent: string, id: string, entry: ActivityEntry, state: ToolCall['state']): ToolCall {
    return { agent, id, name: entry.name ?? '', args: entry.input, state, ...(state !== 'running' && entry.output !== undefined ? { output: entry.output } : {}) }
  }
}

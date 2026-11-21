import { randomUUID } from 'node:crypto'

/**
 * Claude Code's stream, as a Pi run gives it (`033-claude-code-agents`). `claude -p --output-format stream-json` prints
 * one record per line. This turns them into the events hobkin's `JobActivity` reads from a Pi run, so the dock and the
 * agent canvas draw a Claude run unchanged, and into lines of a session file in Pi's format, so Work reads its usage,
 * its activity and its identity as it reads a Pi run's. Pure: nothing here reads or writes anything.
 */

/** A record Claude Code printed. */
export type ClaudeRecord = Record<string, unknown>
/** An event as a Pi run gives it. */
export type PiEvent = Record<string, unknown>
/** A line for the run's session file. */
export type SessionLine = Record<string, unknown>

export interface StreamOptions {
  /** The folder the run works in, for the session file's header. */
  cwd: string
  now?: () => Date
  newId?: () => string
}

interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

interface Reply {
  id: string
  model: string
  usage: Usage
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const recordsIn = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : [])
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')
const tokensOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
const none = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
const isEmpty = (usage: Usage) => !usage.input && !usage.output && !usage.cacheRead && !usage.cacheWrite
const fresh = (usage: Usage) => usage.input + usage.cacheWrite + usage.output
// How much of a failed call's words its session line keeps. hobkin's hold brief shows less of each.
const MAX_FAILURE = 2000

/** Claude's counts are running totals within a reply, so the largest seen is the latest. */
function merge(usage: Usage, counted: unknown): void {
  if (!isRecord(counted)) return
  usage.input = Math.max(usage.input, tokensOf(counted.input_tokens))
  usage.output = Math.max(usage.output, tokensOf(counted.output_tokens))
  usage.cacheRead = Math.max(usage.cacheRead, tokensOf(counted.cache_read_input_tokens))
  usage.cacheWrite = Math.max(usage.cacheWrite, tokensOf(counted.cache_creation_input_tokens))
}

/** The words in a message's content. Claude gives a string, or blocks with text and images among them. */
function textIn(content: unknown, separator: string): string {
  if (typeof content === 'string') return content
  return recordsIn(content)
    .filter((block) => block.type === 'text')
    .map((block) => textOf(block.text))
    .join(separator)
}

// Claude's Bash tool opens a failed command's result with "Exit code N". Pi's closes it with the line the canvas reads.
const EXIT = /^Exit code (\d+)\n?/
function piOutput(tool: string, text: string, isError: boolean): string {
  const exit = isError && /^bash$/i.test(tool) ? EXIT.exec(text) : null
  if (!exit) return text
  const printed = text.slice(exit[0].length)
  return `${printed ? `${printed}\n\n` : ''}Command exited with code ${exit[1]}`
}

const messageStart = (): PiEvent => ({ type: 'message_start', message: { role: 'assistant' } })
const textDelta = (text: string): PiEvent => ({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } })
const messageEnd = (role: 'assistant' | 'user', text: string, images: unknown[] = []): PiEvent => ({ type: 'message_end', message: { role, content: [{ type: 'text', text }, ...images] } })

/** The images in a user message, as Pi names them, without their bytes: hobkin's runner counts them to match a note. */
const imagesIn = (content: unknown) =>
  recordsIn(content)
    .filter((block) => block.type === 'image')
    .map((block) => ({ type: 'image', mimeType: textOf(isRecord(block.source) ? block.source.media_type : undefined) }))

export class ClaudeStream {
  /** Claude's own session id, from its first `system` `init` record. */
  sessionId: string | null = null
  /** The model Claude says it runs. */
  model: string | null = null
  /** The fresh tokens the session lines hold: input, cache writes and output, as Work counts them. */
  tokens = 0
  /** The last `result` record. The run's last one decides how it ended. */
  result: ClaudeRecord | null = null

  private readonly cwd: string
  private readonly now: () => Date
  private readonly newId: () => string
  /** The text block Claude is writing, opened by its stream events and closed by the record that carries it whole. */
  private open: { index: unknown; text: string } | null = null
  /** Receipts that arrived while a text block was open. Sent at once, they would split its words in two. */
  private held: PiEvent[] = []
  private reply: Reply | null = null
  private readonly recorded = new Set<string>()
  private readonly counted = none()
  private readonly tools = new Map<string, string>()

  constructor({ cwd, now = () => new Date(), newId = randomUUID }: StreamOptions) {
    this.cwd = cwd
    this.now = now
    this.newId = newId
  }

  /** One record: the events it gives and the session lines it adds. */
  accept(record: ClaudeRecord): { events: PiEvent[]; lines: SessionLine[] } {
    const events: PiEvent[] = []
    const lines: SessionLine[] = []
    // Claude's own subagents report under their Agent call. Their work is not drawn, but its tool results show it is alive,
    // and each result's line names its tool.
    if (typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id) {
      if (record.type === 'assistant' && isRecord(record.message)) {
        for (const block of recordsIn(record.message.content)) {
          if (block.type === 'tool_use' && textOf(block.id)) this.tools.set(textOf(block.id), textOf(block.name))
        }
      }
      if (record.type === 'user') this.toolResults(record, lines)
      return { events, lines }
    }
    if (record.type === 'system' && record.subtype === 'init') this.started(record, lines)
    else if (record.type === 'stream_event' && isRecord(record.event)) this.streamed(record.event, events, lines)
    else if (record.type === 'assistant' && isRecord(record.message)) this.assistant(record.message, events, lines)
    else if (record.type === 'user' && isRecord(record.message)) this.user(record, events, lines)
    else if (record.type === 'result') {
      this.close(events)
      this.flush(lines)
      this.countElsewhere(record.modelUsage, lines)
      this.result = record
    }
    return { events, lines }
  }

  /** The stream ended: words still open close as they stand, and the last reply's usage is recorded. */
  end(): { events: PiEvent[]; lines: SessionLine[] } {
    const events: PiEvent[] = []
    const lines: SessionLine[] = []
    this.close(events)
    this.flush(lines)
    return { events, lines }
  }

  /** The line that says why the run failed, in the provider's words, as Pi records an error. Null before any session. */
  failed(reason: string): SessionLine | null {
    return this.sessionId ? this.line({ ...this.assistantMessage(none()), stopReason: 'error', errorMessage: reason }) : null
  }

  private started(record: ClaudeRecord, lines: SessionLine[]): void {
    if (this.sessionId || !textOf(record.session_id)) return
    this.sessionId = textOf(record.session_id)
    this.model = textOf(record.model) || null
    lines.push({
      type: 'session',
      version: 3,
      id: this.sessionId,
      timestamp: this.now().toISOString(),
      cwd: this.cwd,
    })
  }

  private streamed(event: Record<string, unknown>, events: PiEvent[], lines: SessionLine[]): void {
    if (event.type === 'message_start') {
      this.close(events)
      if (isRecord(event.message)) this.meter(event.message, lines)
    } else if (event.type === 'content_block_start') {
      this.close(events)
      const block = isRecord(event.content_block) ? event.content_block : {}
      if (block.type !== 'text') return
      this.open = { index: event.index, text: textOf(block.text) }
      events.push(messageStart())
      if (this.open.text) events.push(textDelta(this.open.text))
    } else if (event.type === 'content_block_delta') {
      const change = isRecord(event.delta) ? event.delta : {}
      const text = textOf(change.text)
      if (!this.open || event.index !== this.open.index) return
      if (change.type !== 'text_delta' || !text) return
      this.open.text += text
      events.push(textDelta(text))
    } else if (event.type === 'message_delta' && this.reply) {
      merge(this.reply.usage, event.usage)
    }
  }

  private assistant(message: Record<string, unknown>, events: PiEvent[], lines: SessionLine[]): void {
    this.meter(message, lines)
    for (const block of recordsIn(message.content)) {
      if (block.type === 'text') {
        const text = textOf(block.text)
        if (this.open) this.close(events, text)
        else if (text.trim()) events.push(messageStart(), messageEnd('assistant', text))
      } else if (block.type === 'tool_use' && textOf(block.id)) {
        this.close(events)
        this.tools.set(textOf(block.id), textOf(block.name))
        events.push({
          type: 'tool_execution_start',
          toolCallId: textOf(block.id),
          toolName: textOf(block.name),
          args: isRecord(block.input) ? block.input : {},
        })
      }
    }
  }

  private user(record: ClaudeRecord, events: PiEvent[], lines: SessionLine[]): void {
    const message = record.message as Record<string, unknown>
    if (record.isReplay === true) {
      const said = textIn(message.content, '')
      if (!said) return
      const end = messageEnd('user', said, imagesIn(message.content))
      if (this.open) this.held.push(end)
      else events.push(end)
      return
    }
    const results = recordsIn(message.content).filter((block) => block.type === 'tool_result')
    if (!results.length) return
    this.close(events)
    this.flush(lines)
    for (const block of results) {
      const id = textOf(block.tool_use_id)
      const name = this.tools.get(id) || 'tool'
      const isError = block.is_error === true
      const output = piOutput(name, textIn(block.content, '\n'), isError)
      events.push({
        type: 'tool_execution_end',
        toolCallId: id,
        toolName: name,
        isError,
        result: { content: [{ type: 'text', text: output }] },
      })
    }
    this.toolResults(record, lines)
  }

  /** A line for each tool result, as Pi writes one. hobkin's hold brief reads a failed call's tool and words from it. */
  private toolResults(record: ClaudeRecord, lines: SessionLine[]): void {
    const message = isRecord(record.message) ? record.message : {}
    for (const block of recordsIn(message.content)) {
      if (block.type !== 'tool_result') continue
      const id = textOf(block.tool_use_id)
      const isError = block.is_error === true
      const content = isError ? [{ type: 'text', text: textIn(block.content, '\n').slice(0, MAX_FAILURE) }] : []
      this.add(lines, { role: 'toolResult', toolCallId: id, toolName: this.tools.get(id) || 'tool', content, isError })
    }
  }

  private close(events: PiEvent[], text?: string): void {
    if (!this.open) return
    events.push(messageEnd('assistant', text ?? this.open.text), ...this.held)
    this.open = null
    this.held = []
  }

  /** Each reply is one line, written once its usage is final: when the next one starts, a tool result comes back, or the turn ends. */
  private meter(message: Record<string, unknown>, lines: SessionLine[]): void {
    const id = textOf(message.id)
    if (!id || this.recorded.has(id)) return
    if (this.reply && this.reply.id !== id) this.flush(lines)
    this.reply ??= { id, model: textOf(message.model) || this.model || 'claude', usage: none() }
    merge(this.reply.usage, message.usage)
  }

  private flush(lines: SessionLine[]): void {
    const reply = this.reply
    if (!reply) return
    this.reply = null
    this.recorded.add(reply.id)
    this.record(lines, reply.usage, reply.model)
  }

  /**
   * Claude's result counts every model call of the session, its subagents' and its own helpers' among them. Whatever
   * that count holds beyond the replies recorded goes in as one more line, so Work counts all that the run spent.
   */
  private countElsewhere(modelUsage: unknown, lines: SessionLine[]): void {
    if (!isRecord(modelUsage)) return
    const total = none()
    for (const counted of Object.values(modelUsage)) {
      if (!isRecord(counted)) continue
      total.input += tokensOf(counted.inputTokens)
      total.output += tokensOf(counted.outputTokens)
      total.cacheRead += tokensOf(counted.cacheReadInputTokens)
      total.cacheWrite += tokensOf(counted.cacheCreationInputTokens)
    }
    this.record(lines, {
      input: Math.max(0, total.input - this.counted.input),
      output: Math.max(0, total.output - this.counted.output),
      cacheRead: Math.max(0, total.cacheRead - this.counted.cacheRead),
      cacheWrite: Math.max(0, total.cacheWrite - this.counted.cacheWrite),
    })
  }

  private record(lines: SessionLine[], usage: Usage, model?: string): void {
    if (isEmpty(usage) || !this.sessionId) return
    this.counted.input += usage.input
    this.counted.output += usage.output
    this.counted.cacheRead += usage.cacheRead
    this.counted.cacheWrite += usage.cacheWrite
    this.tokens += fresh(usage)
    this.add(lines, { ...this.assistantMessage(usage, model), stopReason: 'stop' })
  }

  private assistantMessage(usage: Usage, model = this.model ?? 'claude'): Record<string, unknown> {
    const totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite
    return { role: 'assistant', provider: 'anthropic', model, usage: { ...usage, totalTokens, cost: { total: 0 } } }
  }

  private add(lines: SessionLine[], message: Record<string, unknown>): void {
    if (this.sessionId) lines.push(this.line(message))
  }

  private line(message: Record<string, unknown>): SessionLine {
    return { type: 'message', id: this.newId(), timestamp: this.now().toISOString(), message }
  }
}

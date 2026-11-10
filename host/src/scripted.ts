import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import type { HarnessRequest, MainSession, MainSessionOptions } from 'hobkin/src/cli/application.mjs'
import { loadPiAi, loadPiCodingAgent, type PiEventStream } from './pi.ts'

/**
 * The development model. It is Pi's real session, with its storage, steering queue and events, and only the
 * call to a provider replaced by a script. hobkin's own tests replace the same call (`test/cli-conversation-controls.test.mjs`).
 * Nothing here reads a credential or opens a connection.
 */

export interface ScriptedCall {
  /** The newest user message, with any note hobkin put ahead of the user's words. */
  prompt: string
  /** The images that came with it, as the model gets them: base64 and a type. */
  images: { mimeType: string; data: string }[]
  /** How many calls came before this one. */
  index: number
  /** What the tool the model called last gave back, when this call follows one. */
  toolResult?: { name: string; text: string; failed: boolean }
}

export interface ScriptedReply {
  text: string
  /** Shown as thinking before the text. */
  thinking?: string
  /** Milliseconds between words. */
  chunkMs?: number
  /** Keep the turn open after the text until it is stopped. */
  hold?: boolean
  /** End the turn with this error instead of a reply. */
  failure?: string
  /** Call a tool after the text. Pi runs it and calls the model again with what it gave back. */
  toolCall?: { name: string; arguments: Record<string, unknown> }
}

/** A tool the app adds to the main session, in Pi's shape. */
export interface SessionTool {
  name: string
}

export interface ScriptedOptions {
  /** What the model says. The built-in script answers when this is absent. */
  reply?: (call: ScriptedCall) => ScriptedReply | Promise<ScriptedReply>
  /** Tools the app adds to the session. They are the only tools the scripted session can run. */
  tools?: readonly SessionTool[]
}

export const SCRIPTED_MODEL = { provider: 'hobkin-client', id: 'scripted' } as const

const MARKDOWN_SAMPLE = [
  '## A scripted reply',
  '',
  'Markdown from the model renders here: **bold**, *italic*, `code` and [a link](https://hobkin.dev).',
  '',
  '- First item',
  '- Second item',
  '',
  '| Screen | State |',
  '| --- | --- |',
  '| Conversation | live |',
  '| Review | sample |',
  '',
  '```ts',
  'const greeting = "hello"',
  '```',
  '',
  'Raw HTML stays text: <script>alert(1)</script> and <img src=x onerror=alert(1)>.',
].join('\n')

const SLOW_TEXT = 'This reply arrives slowly, one word at a time, so there is time to scroll up, send another message to steer it, or stop it.'

/** The last thing the user typed, which follows any note hobkin sent ahead of it. */
const typedPart = (prompt: string) => prompt.trim().split('\n').at(-1)?.trim() ?? ''

/** Words for a provider, as someone asking hobkin to connect it would say them. */
const PROVIDER_WORDS: [words: RegExp, id: string, name: string][] = [
  [/\b(claude|anthropic)\b/, 'anthropic', 'Anthropic'],
  [/\b(chatgpt|openai|codex)\b/, 'openai', 'OpenAI'],
  [/\b(copilot|github)\b/, 'github-copilot', 'GitHub Copilot'],
  [/\b(grok|xai)\b/, 'xai', 'xAI'],
  [/\bkimi\b/, 'kimi-coding', 'Kimi'],
  [/\bopenrouter\b/, 'openrouter', 'OpenRouter'],
]

const connectCue = (typed: string) => (/\b(connect|sign in|log in|login)\b/.test(typed) ? PROVIDER_WORDS.find(([words]) => words.test(typed)) : undefined)
const listCue = (typed: string) => /\b(which|what|list|show)\b.*\b(models?|providers?)\b/.test(typed)

/** What the model says once the app's `client` tool answered, the way a model that called it would put it. */
function afterTool({ name, text, failed }: NonNullable<ScriptedCall['toolResult']>, typed: string): ScriptedReply {
  if (failed) return { text: `That did not work: ${text}`, chunkMs: 20 }
  const connect = connectCue(typed)
  if (connect) return { text: `I started the ${connect[2]} sign-in. Approve it in the browser, and ${connect[2]} shows as connected here.`, chunkMs: 20 }
  if (name === 'client' && listCue(typed)) {
    try {
      const { providers } = JSON.parse(text) as { providers: { name: string; connected: boolean }[] }
      const on = providers.filter(({ connected }) => connected).map((provider) => provider.name)
      const off = providers.filter(({ connected }) => !connected).map((provider) => provider.name)
      return { text: `Pi reaches ${on.join(', ') || 'no provider yet'}. Not connected: ${off.join(', ') || 'none'}.`, chunkMs: 20 }
    } catch {
      // Not the list after all. The plain words below say what came back.
    }
  }
  return { text: `The app answered: ${text.slice(0, 400)}`, chunkMs: 20 }
}

/** A few words steer the built-in script, so each state of the conversation can be seen without a real model. */
export function builtInReply({ prompt, images, toolResult }: ScriptedCall): ScriptedReply {
  const typed = typedPart(prompt)
  const lower = typed.toLowerCase()
  const cue = lower.split(/\s+/, 1)[0]
  if (toolResult) return afterTool(toolResult, lower)
  if (images.length) return { text: `The scripted model got ${images.length === 1 ? '1 image' : `${images.length} images`} with: "${typed.slice(0, 200)}".`, chunkMs: 30 }

  // The script uses the app's `client` tool the way a real model would, for the two things hobkin helps set up.
  const connect = connectCue(lower)
  if (connect) return { text: '', toolCall: { name: 'client', arguments: { action: 'run', name: 'signin.start', args: { provider: connect[1] } } } }
  if (listCue(lower)) return { text: '', toolCall: { name: 'client', arguments: { action: 'run', name: 'models.list' } } }
  if (cue === 'hold') return { text: 'Holding this turn open. Stop it to end it.', hold: true, chunkMs: 30 }
  if (cue === 'slow') return { text: SLOW_TEXT, chunkMs: 400 }
  if (cue === 'fail') return { text: '', failure: 'The scripted model failed, as asked.' }
  if (cue === 'markdown') return { text: MARKDOWN_SAMPLE, chunkMs: 15 }
  if (cue === 'think') return { thinking: 'Weighing what to say.', text: 'That took a moment of thought.', chunkMs: 60 }

  return {
    text: `This is the scripted model, so nothing was spent. You said: "${typed.slice(0, 200)}". Try "markdown", "slow", "hold", "think" or "fail" to see how the conversation handles each, or "connect my Claude subscription" and "which providers are connected" to see hobkin use the app.`,
    chunkMs: 30,
  }
}

const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }

interface ScriptedMessage {
  role: 'assistant'
  content: ({ type: 'text'; text: string } | { type: 'thinking'; thinking: string } | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> })[]
  stopReason: string
  errorMessage?: string
  [key: string]: unknown
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((part) => part?.type === 'text').map((part) => String(part.text)).join('\n')
}

const imagesOf = (content: unknown): ScriptedCall['images'] => {
  if (!Array.isArray(content)) return []
  return content.filter((part) => part?.type === 'image').map((part) => ({ mimeType: String(part.mimeType), data: String(part.data) }))
}

const lastUser = (messages: { role?: string; content?: unknown }[]) => messages.findLast((message) => message.role === 'user')?.content

/** What the last tool gave back, when the model is being called again after one. */
function lastToolResult(messages: { role?: string; content?: unknown; toolName?: unknown; isError?: unknown }[]): ScriptedCall['toolResult'] {
  const last = messages.at(-1)
  if (last?.role !== 'toolResult') return undefined
  return { name: String(last.toolName ?? ''), text: textOf(last.content), failed: last.isError === true }
}

/** Rejects as soon as the signal aborts, so a held or slow reply ends the moment the turn is stopped. */
function unlessAborted<Value>(work: Promise<Value>, signal?: AbortSignal): Promise<Value> {
  if (!signal) return work
  return new Promise((resolve, reject) => {
    const stop = () => reject(Error('Aborted'))
    if (signal.aborted) return stop()
    signal.addEventListener('abort', stop, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop))
  })
}

const words = (text: string) => text.match(/\S+\s*|\s+/g) ?? []

/** Streams one reply through the events a provider would send. */
async function play(stream: PiEventStream, message: ScriptedMessage, reply: Promise<ScriptedReply>, signal?: AbortSignal) {
  try {
    const { text, thinking, chunkMs = 0, hold = false, failure, toolCall } = await unlessAborted(reply, signal)
    stream.push({ type: 'start', partial: message })

    const write = async (index: number, kind: 'text' | 'thinking', value: string) => {
      const block = kind === 'text' ? { type: 'text' as const, text: '' } : { type: 'thinking' as const, thinking: '' }
      message.content[index] = block
      stream.push({ type: `${kind}_start`, contentIndex: index, partial: message })
      for (const delta of words(value)) {
        if (chunkMs) await unlessAborted(pause(chunkMs), signal)
        else signal?.throwIfAborted()
        if (block.type === 'text') block.text += delta
        else block.thinking += delta
        stream.push({ type: `${kind}_delta`, contentIndex: index, delta, partial: message })
      }
      stream.push({ type: `${kind}_end`, contentIndex: index, content: value, partial: message })
    }

    if (thinking) await write(message.content.length, 'thinking', thinking)
    if (failure) throw Error(failure)
    if (text || !toolCall) await write(message.content.length, 'text', text)
    if (toolCall) {
      // The call goes out whole: Pi checks its arguments, runs the tool and calls the model again with the result.
      const index = message.content.length
      const call = { type: 'toolCall' as const, id: `scripted-${randomUUID()}`, name: toolCall.name, arguments: toolCall.arguments }
      message.content[index] = call
      stream.push({ type: 'toolcall_start', contentIndex: index, partial: message })
      stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(toolCall.arguments), partial: message })
      stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: call, partial: message })
      message.stopReason = 'toolUse'
      stream.push({ type: 'done', reason: 'toolUse', message })
      return
    }
    if (hold) await unlessAborted(new Promise<never>(() => {}), signal)
    stream.push({ type: 'done', reason: 'stop', message })
  } catch (error) {
    // What it already said stays in the message, as with a real model that is stopped.
    const reason = signal?.aborted ? 'aborted' : 'error'
    Object.assign(message, { stopReason: reason, ...(reason === 'error' ? { errorMessage: error instanceof Error ? error.message : String(error) } : {}) })
    stream.push({ type: 'error', reason, error: message })
  } finally {
    stream.end()
  }
}

export interface ScriptedModel {
  /** hobkin's `createMain`: its own Pi session, answered by the script. */
  createMain: (options: MainSessionOptions) => Promise<MainSession>
  /** The same seam for any other session hobkin opens in this process. */
  dependencies: { agentDir: string; createSession: (options: Record<string, unknown>) => Promise<{ session: unknown }> }
  /** The job runner for routines and work. It runs nothing and says so. */
  runHarness: (request: HarnessRequest) => Promise<unknown>
}

export async function createScriptedModel(root: string, { reply = builtInReply, tools = [] }: ScriptedOptions = {}): Promise<ScriptedModel> {
  const [pi, ai, { openPiSession }] = await Promise.all([loadPiCodingAgent(), loadPiAi(), import('hobkin/src/cli/pi-session.mjs')])
  // Its own agent folder inside the home, so Pi's real settings, extensions and credentials are never read.
  const agentDir = join(root, 'client', 'scripted-agent')
  const model = {
    ...SCRIPTED_MODEL,
    name: 'Scripted model',
    api: 'openai-completions',
    baseUrl: 'https://scripted.invalid',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const models = await pi.ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: null,
    modelsStorePath: join(agentDir, 'models.json'),
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  // The script needs no credential, and Pi would refuse a model that has none.
  models.hasConfiguredAuth = () => true

  let calls = 0
  const dependencies: ScriptedModel['dependencies'] = {
    agentDir,
    createSession: async (options) => {
      const created = await pi.createAgentSession({
        ...options,
        agentDir,
        modelRuntime: models,
        model,
        customTools: [...((options.customTools as unknown[] | undefined) ?? []), ...tools],
        // Only the app's own tools can run: nothing the script says can touch the machine.
        tools: tools.map(({ name }) => name),
        settingsManager: pi.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
      })
      created.session.agent.streamFunction = (
        selected: { api: string; provider: string; id: string },
        context: { messages: { role?: string; content?: unknown }[] },
        options?: { signal?: AbortSignal },
      ) => {
        const stream = ai.createAssistantMessageEventStream()
        const message: ScriptedMessage = {
          role: 'assistant',
          api: selected.api,
          provider: selected.provider,
          model: selected.id,
          content: [],
          stopReason: 'stop',
          timestamp: Date.now(),
          usage: NO_USAGE,
        }
        const said = lastUser(context.messages)
        const toolResult = lastToolResult(context.messages)
        const call = { prompt: textOf(said), images: imagesOf(said), index: calls++, ...(toolResult ? { toolResult } : {}) }
        void play(stream, message, Promise.resolve().then(() => reply(call)), options?.signal)
        return stream
      }
      return created
    },
  }

  return {
    dependencies,
    // The home's own model and launcher would start a real Pi, so the script's session never sees them.
    createMain: (options) =>
      openPiSession({ ...options, config: { ...options.config, launcher: undefined, main: { ...options.config.main, model: null } } }, dependencies),
    runHarness: async (request) => ({
      id: request.id,
      harness: 'pi',
      status: request.signal?.aborted ? 'interrupted' : 'completed',
      text: 'The scripted job runner ran nothing. Start the host with --live to run real jobs.',
      cost: null,
      model: request.model,
      effort: request.effort,
      sessionId: request.id,
      freshSession: true,
    }),
  }
}

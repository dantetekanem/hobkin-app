import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import type { Ask, AskRequest } from '../questions.ts'

/**
 * What Claude Code would ask the user, asked on the host's question sheet (`033-claude-code-agents`). Claude sends a
 * `can_use_tool` request for each: for AskUserQuestion, the questions it wants answered, and for any other tool, a
 * permission prompt. The answer goes back as Claude's permission result.
 */

/** A `can_use_tool` request's body, as Claude Code sends it. */
export interface ToolRequest {
  tool_name: string
  input: Record<string, unknown>
  tool_use_id?: string
  display_name?: string
  description?: string
  [key: string]: unknown
}

/** Claude's permission result. `updatedInput` carries AskUserQuestion's answers. */
export type PermissionReply = { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }

export interface AskingSetup {
  ask: Ask
  /** Who asks on the sheet: the run's title. */
  from: string
  /** How long a question stays up on the sheet before it counts as put off. */
  answerWaitMs?: number
  /** How long to wait before asking again when the question could not be asked. */
  retryMs?: number
  /** How long to keep trying to ask before Claude goes on without an answer. */
  giveUpMs?: number
}

// Two minutes, so a question nobody answers frees the sheet for others and the agent goes on without its answer.
const ANSWER_WAIT_MS = 120_000
const PUT_OFF = 'The user put these questions off. Go on with your best judgment and say in your report what you assumed.'
const NOBODY = 'Nobody could be asked. Go on with your best judgment and say in your report what you assumed.'
const NOT_APPROVED = 'Nobody approved this, so it did not run. Go on without it or find another way.'
const NOT_ALLOWED = 'The user did not allow this.'
const ALLOW_CHOICES = [{ value: 'allow', label: 'Allow' }, { value: 'deny', label: "Don't allow" }]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')
const deny = (message: string): PermissionReply => ({ behavior: 'deny', message })
const bounded = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

type Asked = { answer: string | { typed: string } } | 'put off' | 'nobody' | 'withdrawn'

/** Asks until the question is up. It could not be asked while another question is up, nobody is there, or the user is typing. */
async function asked(setup: AskingSetup, request: AskRequest, signal: AbortSignal): Promise<Asked> {
  const { retryMs = 2000, giveUpMs = 600_000 } = setup
  const until = Date.now() + giveUpMs
  for (;;) {
    if (signal.aborted) return 'withdrawn'
    let answer: Awaited<ReturnType<Ask>>
    try {
      answer = await setup.ask(request, signal)
    } catch {
      return 'nobody'
    }
    // A withdrawn question resolves as put off.
    if (signal.aborted) return 'withdrawn'
    if (answer === null) return 'put off'
    if (answer !== undefined) return { answer }
    const left = until - Date.now()
    if (left <= 0) return 'nobody'
    try {
      await pause(Math.min(retryMs, left), undefined, { signal })
    } catch {
      return 'withdrawn'
    }
  }
}

const optionsOf = (question: Record<string, unknown>) => (Array.isArray(question.options) ? question.options.filter(isRecord) : [])

/** One of AskUserQuestion's questions as the sheet asks it: its header as the summary line and its options as the choices. */
function sheetQuestion(question: Record<string, unknown>, from: string, waitMs: number): AskRequest {
  const hint = question.multiSelect === true ? 'pick one, or type several' : ''
  const tldr = [textOf(question.header), hint].filter(Boolean).join(' · ')

  return {
    question: textOf(question.question),
    // A choice's value is its place in the list. The answer that picks it is short, and Claude's label can be long.
    choices: optionsOf(question).map((option, index) => {
      const label = textOf(option.label)
      const description = textOf(option.description)
      return { value: String(index + 1), label: description ? `${label}: ${description}` : label }
    }),
    other: true,
    from,
    ...(tldr ? { tldr } : {}),
    waitMs,
    requestId: randomUUID(),
  }
}

async function answerQuestions(input: Record<string, unknown>, setup: AskingSetup, signal: AbortSignal): Promise<PermissionReply | null> {
  const questions = Array.isArray(input.questions) ? input.questions.filter(isRecord) : []
  if (!questions.length) return deny(NOBODY)

  const answers: Record<string, string> = {}
  for (const question of questions) {
    const request = sheetQuestion(question, setup.from, setup.answerWaitMs ?? ANSWER_WAIT_MS)
    const reply = await asked(setup, request, signal)
    if (reply === 'withdrawn') return null
    if (reply === 'put off') return deny(PUT_OFF)
    if (reply === 'nobody') return deny(NOBODY)
    // Claude hears the label of the option picked, or the user's own words.
    const labels = optionsOf(question).map((option) => textOf(option.label))
    answers[request.question] = typeof reply.answer === 'string' ? labels[Number(reply.answer) - 1] ?? reply.answer : reply.answer.typed
  }
  // Claude takes the answers only beside its questions exactly as it asked them, keyed by each question's words.
  return { behavior: 'allow', updatedInput: { questions: input.questions, answers } }
}

/** What Claude wants to do, in plain words. */
function permissionQuestion(request: ToolRequest): string {
  const tool = textOf(request.tool_name)
  const { input } = request
  if (/^bash$/i.test(tool) && textOf(input.command)) return `Run \`${textOf(input.command)}\`?`
  const path = textOf(input.file_path) || textOf(input.notebook_path)
  if (/^(edit|write|notebookedit)$/i.test(tool) && path) return `Change ${path}?`
  return `Use ${textOf(request.display_name) || tool || 'a tool'}?`
}

async function answerPermission(request: ToolRequest, setup: AskingSetup, signal: AbortSignal): Promise<PermissionReply | null> {
  const description = textOf(request.description).trim()
  const reply = await asked(setup, {
    question: permissionQuestion(request),
    choices: ALLOW_CHOICES,
    other: true,
    from: setup.from,
    ...(description ? { tldr: bounded(description, 100) } : {}),
    waitMs: setup.answerWaitMs ?? ANSWER_WAIT_MS,
  }, signal)
  if (reply === 'withdrawn') return null
  if (reply === 'put off' || reply === 'nobody') return deny(NOT_APPROVED)
  if (typeof reply.answer !== 'string') return deny(`The user said: ${reply.answer.typed}`)
  return reply.answer === 'allow' ? { behavior: 'allow', updatedInput: request.input } : deny(NOT_ALLOWED)
}

/**
 * Claude's `can_use_tool` request, answered on the sheet. Null when it was withdrawn first, by Claude or by the run
 * stopping, so nothing goes back.
 */
export function answerToolRequest(request: ToolRequest, setup: AskingSetup, signal: AbortSignal): Promise<PermissionReply | null> {
  const input = isRecord(request.input) ? request.input : {}
  return request.tool_name === 'AskUserQuestion'
    ? answerQuestions(input, setup, signal)
    : answerPermission({ ...request, input }, setup, signal)
}

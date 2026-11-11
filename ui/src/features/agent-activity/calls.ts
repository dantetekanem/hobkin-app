import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { languageOf } from '../review/code/languages.ts'
import { commandOf, doingNow, familyOf, lookOf, pathOf, stateOf, summaryOf, type CallState, type Doing, type ReadOptions } from './steps.ts'

/**
 * The same run in code mode: each tool call as its task, its parameters and its output, in the order they came, with
 * the agent's words as slim rows between them. One row per entry, keyed by the entry's id and made from it alone, so a
 * reconnect that resends the same entries gives the same rows, and rows can later be grouped by any field an entry
 * gains (such as the agent that made it).
 */

/** A string argument on more than one line, such as a file's content, drawn apart from the JSON in its own language. */
export interface LongArgument {
  /** Where it sits in the arguments: `content`, `edits[0].newText`. */
  field: string
  text: string
  language: string | null
}

export interface Call {
  kind: 'call'
  key: string
  entry: ActivityEntry
  name: string
  /** What the call does, as the canvas says it: "Read src/a.ts". */
  task: Doing
  state: CallState
  /** The arguments as indented JSON, each long argument replaced by a pointer down to it. As they came when they are not JSON. */
  parameters: string
  parametersLanguage: 'json' | null
  long: LongArgument[]
  /** What came back. For a call that failed outside a shell it is empty, and `error` says why. */
  output: string
  outputLanguage: string | null
  /** For a read, the line its text starts at. */
  from?: number
  /** Pi's note that a read stopped short. */
  notice?: string
  error?: string
  exitCode?: number
}

export type CallRow = Call | { kind: 'says'; key: string; entry: ActivityEntry; text: string }

const CODE_ARGUMENT = /^(content|text|old_?text|new_?text|old_string|new_string)$/i
const SHELL_ARGUMENT = /^(command|cmd|script)$/i

function parametersOf(entry: ActivityEntry): Pick<Call, 'parameters' | 'parametersLanguage' | 'long'> {
  if (!entry.input) return { parameters: '', parametersLanguage: null, long: [] }
  let value: unknown
  try {
    value = JSON.parse(entry.input)
  } catch {
    return { parameters: entry.input, parametersLanguage: null, long: [] }
  }
  const long: LongArgument[] = []
  const fileLanguage = languageOf(pathOf(entry))
  const pull = (node: unknown, field: string): unknown => {
    if (typeof node === 'string') {
      if (!node.includes('\n')) return node
      const name = field.split(/[.[\]]/).filter(Boolean).at(-1) ?? ''
      long.push({ field, text: node, language: SHELL_ARGUMENT.test(name) ? 'shellscript' : CODE_ARGUMENT.test(name) ? fileLanguage : null })
      return `↓ ${node.replace(/\n$/, '').split('\n').length} lines`
    }
    if (Array.isArray(node)) return node.map((item, index) => pull(item, `${field}[${index}]`))
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, pull(item, field ? `${field}.${key}` : key)]))
    return node
  }
  return { parameters: JSON.stringify(pull(value, ''), null, 2), parametersLanguage: 'json', long }
}

/** Output that is JSON is drawn as indented JSON. */
function maybeJson(text: string): Pick<Call, 'output' | 'outputLanguage'> {
  const trimmed = text.trim()
  if (/^[[{]/.test(trimmed)) {
    try {
      return { output: JSON.stringify(JSON.parse(trimmed), null, 2), outputLanguage: 'json' }
    } catch {
      // Not JSON after all: plain.
    }
  }
  return { output: text, outputLanguage: null }
}

function outputOf(entry: ActivityEntry, options: ReadOptions): Pick<Call, 'output' | 'outputLanguage' | 'from' | 'notice' | 'error' | 'exitCode'> {
  const family = familyOf(entry.name)
  if (family === 'shell') {
    const { output, failure, exitCode } = commandOf(entry, options.ended ?? false)
    return { ...maybeJson(output), ...(failure ? { error: failure } : {}), ...(exitCode === undefined ? {} : { exitCode }) }
  }
  if (stateOf(entry, false) === 'failed') return { output: '', outputLanguage: null, error: (entry.output ?? '').trim() || 'It failed.' }
  if (family === 'read') {
    const look = lookOf(entry, 'read', options)
    return { output: look.text ?? '', outputLanguage: languageOf(look.what), ...(look.from ? { from: look.from } : {}), ...(look.notice ? { notice: look.notice } : {}) }
  }
  return maybeJson(entry.output ?? '')
}

/** The rows of a job's activity in code mode, in order. */
export function callsOf(entries: readonly ActivityEntry[], options: ReadOptions = {}): CallRow[] {
  return entries.flatMap((entry): CallRow[] => {
    if (entry.kind !== 'tool') return entry.text?.trim() ? [{ kind: 'says', key: entry.id, entry, text: entry.text }] : []
    let task = doingNow([entry], options)!
    // A tool the canvas has no words for is already named in its row: its first argument says more.
    if (familyOf(entry.name) === 'other') {
      const summary = summaryOf(entry, options.cwd)
      task = { lead: task.lead, ...(summary ? { subject: summary } : {}), ...(task.failed ? { failed: true } : {}) }
    }
    const state = stateOf(entry, options.ended ?? false)
    return [{ kind: 'call', key: entry.id, entry, name: entry.name ?? 'tool', task, state, ...parametersOf(entry), ...outputOf(entry, options) }]
  })
}

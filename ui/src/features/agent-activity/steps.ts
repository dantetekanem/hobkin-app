import { sameEntry, type ActivityEntry } from '#shared/protocol/activity.ts'
import { proofCheckOf } from '../proofs/proof-match.ts'
import { isTaskTool } from './tasks.ts'

/**
 * A job's activity as the agent's canvas draws it (_specs/021-agent-rendering). hobkin keeps the agent's words and
 * each tool call with its arguments and output, never its thinking. This turns them into steps a person can follow
 * at a glance: what the agent said, the commands it ran folded into one group, each file it changed as one change,
 * and what it read or looked for in one row.
 *
 * Pure, so its rules are tested without a window. Tool arguments are read as Pi's tools take them
 * (`@earendil-works/pi-coding-agent`, `dist/core/tools`).
 */

/** How a tool call stands. One still running when its job ended never finished: it stopped. */
export type CallState = 'running' | 'done' | 'failed' | 'stopped'

export interface Command {
  id: string
  /** The command line as the agent wrote it. */
  command: string
  state: CallState
  /** What it printed, without Pi's closing status line. */
  output: string
  /** Pi's closing status line for a command that failed: "Command exited with code 1", "Command timed out after 30 seconds". */
  failure?: string
  exitCode?: number
  /** When hobkin saw the call made (`ActivityEntry.at`). */
  at?: number
}

/** One place in a file: the text that was there and the text that took its place. */
export interface Hunk {
  oldText: string
  newText: string
}

export interface Change {
  path: string
  /** Each place the file changed, in the order the agent changed it. Where one edit changed what another wrote, the first old text and the latest new one. */
  hunks: Hunk[]
  /** The whole file, once the agent wrote it whole. Later edits apply to it. */
  whole: string | null
  /** How many edit and write calls this change holds. */
  calls: number
  state: CallState
  /** What failed, in Pi's words. A failed call changed nothing. */
  failures: string[]
}

export type LookKind = 'read' | 'search' | 'list' | 'fetch'

/** One read, search, listing or fetch, named by what it was about. */
export interface Look {
  id: string
  kind: LookKind
  /** A path, a pattern, a query or an address. */
  what: string
  /** Where or how much: "in src", "lines 40 to 80". */
  where?: string
  state: CallState
  failure?: string
  /** What a read gave back: the file's text, without Pi's closing note. */
  text?: string
  /** The line that text starts at. */
  from?: number
  /** Pi's note that the read stopped short: "Showing lines 1-2000 of 5120. Use offset=2001 to continue." */
  notice?: string
  /** When hobkin saw the call made (`ActivityEntry.at`). */
  at?: number
}

interface Base {
  /** The id of the step's first entry. It stays as the step grows, so the block on screen stays the same one. */
  key: string
  /** The entries the step was made from, to tell cheaply whether it changed. */
  entries: readonly ActivityEntry[]
}

export type Step =
  | (Base & { kind: 'codemode'; state: CallState })
  | (Base & { kind: 'says'; text: string })
  | (Base & { kind: 'shell'; commands: Command[] })
  | (Base & { kind: 'change'; change: Change })
  | (Base & { kind: 'looks'; looks: Look[] })
  | (Base & { kind: 'tool'; name: string; summary: string; state: CallState; output: string; failure?: string })

/** A message the user sent to the agent while it worked. */
export interface Note {
  id: string
  text: string
  at: number
}

export type ExchangeItem = Step | { kind: 'note'; key: string; note: Note }

/** When a step began: when hobkin saw its first entry. Undefined from a runtime that kept no times. */
export const atOf = (step: Step): number | undefined => step.entries[0]?.at

const timed = (entry: ActivityEntry) => (entry.at === undefined ? {} : { at: entry.at })

export interface ReadOptions {
  /** The job has ended, so nothing in it is still running. */
  ended?: boolean
  /** The agent's folder. Paths inside it are shown from there. */
  cwd?: string
  /** The page shows the agent's tasks in their own line (TaskList.tsx), so a task call is a step only when it failed. */
  tasksOnLine?: boolean
}

const SHELL = /^(bash|sh|zsh|shell|powershell|pwsh|exec|terminal|run_?command)$/i
const CHANGE = /^(edit|write)$/i
const LIST = /^(ls|list_?dir(ectory)?)$/i
const READ = /^(read|read_?file|view)$/i
const FETCH = /fetch|browse/i
const SEARCH = /grep|find|glob|search/i

export type Family = 'shell' | 'change' | LookKind | 'other'

export function familyOf(name: string | undefined): Family {
  const tool = name ?? ''
  if (SHELL.test(tool)) return 'shell'
  if (CHANGE.test(tool)) return 'change'
  if (LIST.test(tool)) return 'list'
  if (READ.test(tool)) return 'read'
  if (FETCH.test(tool)) return 'fetch'
  if (SEARCH.test(tool)) return 'search'
  return 'other'
}

type Args = Record<string, unknown>
const parsed = new WeakMap<ActivityEntry, Args>()

/** A tool's arguments. hobkin sends them as JSON text, and anything that is not an object is kept as `value`. */
function argsOf(entry: ActivityEntry): Args {
  const known = parsed.get(entry)
  if (known) return known
  let args: Args = {}
  if (entry.input) {
    try {
      const value: unknown = JSON.parse(entry.input)
      args = value && typeof value === 'object' && !Array.isArray(value) ? (value as Args) : { value }
    } catch {
      args = { value: entry.input }
    }
  }
  parsed.set(entry, args)
  return args
}

const textOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const firstText = (args: Args, ...names: string[]): string | undefined => names.map((name) => textOf(args[name])).find((value) => value !== undefined)
const firstLine = (text: string) => text.split('\n').find((line) => line.trim())?.trim() ?? ''

export function stateOf(entry: ActivityEntry, ended: boolean): CallState {
  if (entry.state === 'failed') return 'failed'
  if (entry.state === 'running') return ended ? 'stopped' : 'running'
  return 'done'
}

function shortPath(path: string, cwd?: string): string {
  if (!cwd) return path
  const folder = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(folder) ? path.slice(folder.length) : path
}

/** A failed call's message, in Pi's words: its first lines. */
function failureOf(entry: ActivityEntry): string | undefined {
  const text = (entry.output ?? '').trim()
  return text ? text.split('\n').slice(0, 3).join('\n') : undefined
}

// How Pi's shell tools close what a failed command printed (`dist/core/tools/bash.js`).
const STATUS = /(?:^|\n\n)(Command (?:exited with code (\d+)|timed out after [\d.]+ seconds|aborted|terminated without an exit code))\s*$/

export function commandOf(entry: ActivityEntry, ended: boolean): Command {
  const args = argsOf(entry)
  const state = stateOf(entry, ended)
  let output = entry.output ?? ''
  let failure: string | undefined
  let exitCode: number | undefined
  const status = state === 'failed' ? STATUS.exec(output) : null
  if (status) {
    output = output.slice(0, status.index)
    failure = status[1]
    if (status[2]) exitCode = Number(status[2])
  }
  // Pi's words for a command that printed nothing.
  if (output.trim() === '(no output)') output = ''
  return { id: entry.id, command: firstText(args, 'command', 'cmd', 'script', 'value') ?? '', state, output, ...(failure ? { failure } : {}), ...(exitCode === undefined ? {} : { exitCode }), ...timed(entry) }
}

/** The places an edit call changes, in every shape Pi's edit tool takes: `edits`, as a list, one object or JSON text, and the older `oldText` and `newText`. */
function hunksOf(args: Args): Hunk[] {
  let edits: unknown = args.edits
  if (typeof edits === 'string') {
    try {
      edits = JSON.parse(edits)
    } catch {
      edits = undefined
    }
  }
  if (edits && typeof edits === 'object' && !Array.isArray(edits)) edits = [edits]
  const hunk = (edit: unknown): Hunk[] => {
    if (!edit || typeof edit !== 'object') return []
    const oldText = firstText(edit as Args, 'oldText', 'old_string', 'old_text')
    const newText = firstText(edit as Args, 'newText', 'new_string', 'new_text')
    return oldText !== undefined && newText !== undefined ? [{ oldText, newText }] : []
  }
  return [...(Array.isArray(edits) ? edits.flatMap(hunk) : []), ...hunk(args)]
}

const replaceOnce = (text: string, find: string, put: string) => {
  const at = find ? text.indexOf(find) : -1
  return at === -1 ? text : text.slice(0, at) + put + text.slice(at + find.length)
}

function withCall(change: Change, entry: ActivityEntry, ended: boolean): Change {
  const args = argsOf(entry)
  const state = stateOf(entry, ended)
  const calls = change.calls + 1
  if (state === 'failed') return { ...change, calls, failures: [...change.failures, failureOf(entry) ?? 'It failed.'] }

  const content = /^write$/i.test(entry.name ?? '') ? firstText(args, 'content', 'text') : undefined
  if (content !== undefined) return { ...change, calls, whole: content, hunks: [] }

  let { whole, hunks } = change
  for (const hunk of hunksOf(args)) {
    if (whole !== null) {
      whole = replaceOnce(whole, hunk.oldText, hunk.newText)
      continue
    }
    // An edit to text an earlier edit wrote changes that earlier change.
    const at = hunk.oldText ? hunks.findIndex((earlier) => earlier.newText.includes(hunk.oldText)) : -1
    hunks = at === -1 ? [...hunks, hunk] : hunks.with(at, { oldText: hunks[at]!.oldText, newText: replaceOnce(hunks[at]!.newText, hunk.oldText, hunk.newText) })
  }
  return { ...change, calls, whole, hunks }
}

function changeState(entries: readonly ActivityEntry[], ended: boolean): CallState {
  const states = entries.map((entry) => stateOf(entry, ended))
  if (states.includes('running')) return 'running'
  if (states.every((state) => state === 'failed')) return 'failed'
  return states.includes('stopped') ? 'stopped' : 'done'
}

export function pathOf(entry: ActivityEntry, cwd?: string): string {
  const args = argsOf(entry)
  return shortPath(firstText(args, 'path', 'file_path', 'filePath', 'file') ?? '', cwd)
}

export function lookOf(entry: ActivityEntry, kind: LookKind, options: ReadOptions): Look {
  const args = argsOf(entry)
  const state = stateOf(entry, options.ended ?? false)
  const failure = state === 'failed' ? failureOf(entry) : undefined
  const base = { id: entry.id, kind, state, ...(failure ? { failure } : {}), ...timed(entry) }
  const path = (name: string) => shortPath(name, options.cwd)
  if (kind === 'read' || kind === 'list') {
    const what = path(firstText(args, 'path', 'file_path', 'filePath', 'dir', 'value') ?? '.')
    const offset = typeof args.offset === 'number' ? args.offset : undefined
    const limit = typeof args.limit === 'number' ? args.limit : undefined
    const where = kind === 'read' && offset !== undefined ? (limit ? `lines ${offset} to ${offset + limit - 1}` : `from line ${offset}`) : undefined
    const read = kind === 'read' && state !== 'failed' && entry.output ? { ...readText(entry.output), from: offset ?? 1 } : {}
    return { ...base, what, ...(where ? { where } : {}), ...read }
  }
  if (kind === 'fetch') {
    const urls = Array.isArray(args.urls) ? args.urls.filter((url): url is string => typeof url === 'string') : []
    return { ...base, what: firstText(args, 'url', 'href', 'value') ?? urls.join(', ') }
  }
  const queries = Array.isArray(args.queries) ? args.queries.filter((query): query is string => typeof query === 'string') : []
  const what = firstText(args, 'pattern', 'query', 'q', 'glob', 'prompt', 'value') ?? queries.join(', ')
  const folder = firstText(args, 'path', 'dir')
  return { ...base, what, ...(folder ? { where: `in ${path(folder)}` } : {}) }
}

// How Pi's read tool closes a file it read only part of (`dist/core/tools/read.js`).
const READ_NOTICE = /\n\n\[((?:Showing lines \d+-\d+ of \d+|\d+ more lines in file)[^\]\n]*)\]\s*$/

/** A read's output: the file's text, and Pi's closing note apart when it read only part of the file. */
function readText(output: string): { text: string; notice?: string } {
  const notice = READ_NOTICE.exec(output)
  return notice ? { text: output.slice(0, notice.index), notice: notice[1]! } : { text: output }
}

/** The first thing a tool was given, for a tool the canvas has no words of its own for. */
export function summaryOf(entry: ActivityEntry, cwd?: string): string {
  const args = argsOf(entry)
  const first = Object.values(args).find((value) => typeof value === 'string' && value.trim()) as string | undefined
  const line = first ? shortPath(firstLine(first), cwd) : ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/** The steps of a job's activity, in order. */
export function stepsOf(entries: readonly ActivityEntry[], options: ReadOptions = {}): Step[] {
  const ended = options.ended ?? false
  const steps: Step[] = []
  for (const entry of entries) {
    const last = steps.at(-1)
    if (entry.kind !== 'tool') {
      if (entry.text?.trim()) steps.push({ kind: 'says', key: entry.id, entries: [entry], text: entry.text })
      continue
    }
    if (entry.name === 'codemode') {
      steps.push({ kind: 'codemode', key: entry.id, entries: [entry], state: stateOf(entry, ended) })
      continue
    }
    if (options.tasksOnLine && isTaskTool(entry.name) && entry.state !== 'failed') continue
    const family = familyOf(entry.name)
    if (family === 'shell') {
      const command = commandOf(entry, ended)
      if (last?.kind === 'shell') steps[steps.length - 1] = { ...last, entries: [...last.entries, entry], commands: [...last.commands, command] }
      else steps.push({ kind: 'shell', key: entry.id, entries: [entry], commands: [command] })
    } else if (family === 'change') {
      const path = pathOf(entry, options.cwd)
      if (last?.kind === 'change' && last.change.path === path) {
        const all = [...last.entries, entry]
        steps[steps.length - 1] = { ...last, entries: all, change: { ...withCall(last.change, entry, ended), state: changeState(all, ended) } }
      } else {
        const change = withCall({ path, hunks: [], whole: null, calls: 0, state: 'done', failures: [] }, entry, ended)
        steps.push({ kind: 'change', key: entry.id, entries: [entry], change: { ...change, state: changeState([entry], ended) } })
      }
    } else if (family === 'other') {
      const state = stateOf(entry, ended)
      const failure = state === 'failed' ? failureOf(entry) : undefined
      steps.push({ kind: 'tool', key: entry.id, entries: [entry], name: entry.name ?? 'tool', summary: summaryOf(entry, options.cwd), state, output: entry.output ?? '', ...(failure ? { failure } : {}) })
    } else {
      const look = lookOf(entry, family, options)
      if (last?.kind === 'looks') steps[steps.length - 1] = { ...last, entries: [...last.entries, entry], looks: [...last.looks, look] }
      else steps.push({ kind: 'looks', key: entry.id, entries: [entry], looks: [look] })
    }
  }
  return steps
}

/**
 * The agent's steps with the user's messages where they were sent. Each entry is placed by when hobkin first saw it,
 * the time its row shows, and one from a runtime that kept no times by when this window first saw it. Both clocks are
 * this Mac's. A message splits a run of steps around it.
 */
export function exchangeOf(entries: readonly ActivityEntry[], notes: readonly Note[], options: ReadOptions & { seenAt: (id: string) => number | undefined }): ExchangeItem[] {
  const waiting = [...notes].sort((left, right) => left.at - right.at)
  const items: ExchangeItem[] = []
  let run: ActivityEntry[] = []
  const flush = () => {
    items.push(...stepsOf(run, options))
    run = []
  }
  for (const entry of entries) {
    const seen = entry.at ?? options.seenAt(entry.id) ?? -Infinity
    while (waiting.length && waiting[0]!.at < seen) {
      flush()
      const note = waiting.shift()!
      items.push({ kind: 'note', key: `note:${note.id}`, note })
    }
    run.push(entry)
  }
  flush()
  for (const note of waiting) items.push({ kind: 'note', key: `note:${note.id}`, note })
  return items
}

/**
 * Two steps were made from entries that say the same, so they draw the same. A host from before activity steps
 * sends every entry anew on each refresh, so they are compared by what they hold.
 */
export function sameStep(left: Step, right: Step): boolean {
  if (left === right) return true
  return left.kind === right.kind && left.entries.length === right.entries.length && left.entries.every((entry, index) => sameEntry(entry, right.entries[index]!))
}

/**
 * Which commands of a group stay open: the newest, any that is still running, failed or stopped, and every
 * `hobkin proof check`, which draws as the run it started (050-tla-proofs). The rest fold into one row.
 */
export function foldOf(commands: readonly Command[]): { folded: Command[]; open: Command[] } {
  const isOpen = (command: Command, index: number) => index === commands.length - 1 || command.state !== 'done' || proofCheckOf(command.command) !== null
  return { folded: commands.filter((command, index) => !isOpen(command, index)), open: commands.filter(isOpen) }
}

/** The last lines of a text, and how many lines are above them. */
export function tailOf(text: string, most: number): { lines: string[]; hidden: number } {
  const trimmed = text.replace(/\n+$/, '')
  if (!trimmed) return { lines: [], hidden: 0 }
  const lines = trimmed.split('\n')
  return lines.length <= most ? { lines, hidden: 0 } : { lines: lines.slice(-most), hidden: lines.length - most }
}

const times = (count: number) => (count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`)
const some = (count: number, one: string, many: string) => (count === 1 ? `a ${one}` : `${count} ${many}`)

/** A group of reads and searches in a few words: "Read 3 files, searched twice and listed a folder". */
export function looksSummary(looks: readonly Look[]): string {
  const count = (kind: LookKind) => looks.filter((look) => look.kind === kind).length
  const files = new Set(looks.filter((look) => look.kind === 'read').map((look) => look.what)).size
  const parts = [
    files ? `read ${files === 1 ? '1 file' : `${files} files`}` : '',
    count('search') ? `searched ${times(count('search'))}` : '',
    count('list') ? `listed ${some(count('list'), 'folder', 'folders')}` : '',
    count('fetch') ? `fetched ${some(count('fetch'), 'page', 'pages')}` : '',
  ].filter(Boolean)
  const words = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** How many steps the agent has taken: each tool call and each thing it said. */
export function stepCount(entries: readonly ActivityEntry[]): number {
  return entries.filter((entry) => entry.kind === 'tool' || entry.text?.trim()).length
}

/** What the agent is doing now, in one line. `subject` is a command, a path or a pattern, drawn as code. */
export interface Doing {
  lead: string
  subject?: string
  code?: boolean
  /** The subject is a file's or a folder's path, so a line with little room cuts it from its front (`FilePath`). */
  path?: boolean
  failed?: boolean
  /** A few words after the subject, such as "exit code 1". */
  note?: string
}

const DOING: Record<Family, [running: string, done: string, failed: string]> = {
  shell: ['Running', 'Ran', 'Failed'],
  change: ['Editing', 'Edited', 'Could not edit'],
  read: ['Reading', 'Read', 'Could not read'],
  list: ['Listing', 'Listed', 'Could not list'],
  search: ['Searching for', 'Searched for', 'Found nothing for'],
  fetch: ['Fetching', 'Fetched', 'Could not fetch'],
  other: ['Using', 'Used', 'Failed'],
}

/** The last sentence of what the agent wrote, without its Markdown. */
function lastSentence(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const sentence = plain.split(/(?<=[.!?])\s+/).filter(Boolean).at(-1) ?? plain
  return sentence.length > 200 ? `${sentence.slice(0, 199)}…` : sentence
}

export function doingNow(entries: readonly ActivityEntry[], options: ReadOptions = {}): Doing | null {
  const entry = entries.findLast((candidate) => candidate.kind === 'tool' || candidate.text?.trim())
  if (!entry) return null
  if (entry.kind !== 'tool') return { lead: lastSentence(entry.text ?? '') }

  const family = familyOf(entry.name)
  const state = stateOf(entry, options.ended ?? false)
  let subject: string
  if (family === 'shell') subject = firstLine(commandOf(entry, false).command)
  else if (family === 'change') subject = pathOf(entry, options.cwd)
  else if (family === 'other') subject = entry.name ?? 'a tool'
  else subject = lookOf(entry, family, options).what
  const drawn = { ...(family === 'other' ? {} : { code: true }), ...(family === 'change' || family === 'read' || family === 'list' ? { path: true } : {}) }
  const [running, done, failed] = DOING[family]
  const writes = /^write$/i.test(entry.name ?? '')
  const lead = writes ? (state === 'running' ? 'Writing' : 'Wrote') : state === 'running' ? running : done

  if (state === 'failed') {
    const exitCode = family === 'shell' ? commandOf(entry, false).exitCode : undefined
    return { lead: writes ? 'Could not write' : failed, subject, ...drawn, failed: true, ...(exitCode === undefined ? {} : { note: `exit code ${exitCode}` }) }
  }
  if (state === 'stopped') return { lead: 'Stopped', subject, ...drawn }
  return { lead, subject, ...drawn }
}

/** Between steps the agent is thinking: after a tool call or before its first step, while its job runs. Never while a tool runs or it writes. */
export function pauseOf(entries: readonly ActivityEntry[], options: ReadOptions = {}): 'thinking' | null {
  if (options.ended) return null
  const last = entries.findLast((entry) => entry.kind === 'tool' || entry.text?.trim())
  if (!last) return 'thinking'
  return last.kind === 'tool' && last.state !== 'running' ? 'thinking' : null
}

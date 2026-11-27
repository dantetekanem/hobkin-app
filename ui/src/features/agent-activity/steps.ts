import { AGENT_REPORT, sameEntry, type ActivityEntry } from '#shared/protocol/activity.ts'
import { proofCheckOf } from '../proofs/proof-match.ts'
import { isSkillLoad } from './skills.ts'
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
  /**
   * A codemode script, with the tool calls it made (`ActivityEntry.parent`), in order, each the step it makes on its
   * own. Its entries are the script's call and then those calls'.
   */
  | (Base & { kind: 'codemode'; state: CallState; calls: Step[] })
  | (Base & { kind: 'says'; text: string })
  | (Base & { kind: 'shell'; commands: Command[] })
  | (Base & { kind: 'change'; change: Change })
  | (Base & { kind: 'looks'; looks: Look[] })
  | (Base & { kind: 'tool'; name: string; summary: string; state: CallState; output: string; failure?: string })
  /**
   * A report one of the agent's own agents sent back (`AGENT_REPORT`): who sent it, whether it went well, its summary and
   * the report. One that came back in a group has no report in the step, only the teams session and file it is kept in.
   */
  | (Base & { kind: 'report'; from: string; ok: boolean; summary: string; text: string; file?: ReportFile })

/** Where teams keeps a report: its session's folder and the file's name (`teams.report`). */
export interface ReportFile {
  team: string
  file: string
}

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
  /**
   * The page shows the agent's tasks and the skills it loaded in lines of their own (TaskList.tsx, SkillsLine.tsx), so a
   * task call or a skill load is a step only when it failed.
   */
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

/** The entries one step is made from, before it is built. A change's entries are all for one path. */
interface Group {
  kind: Step['kind']
  entries: ActivityEntry[]
  path?: string
}

/** The kind of step a tool call of each family makes. */
const STEP_OF: Record<Family, Group['kind']> = { shell: 'shell', change: 'change', read: 'looks', search: 'looks', list: 'looks', fetch: 'looks', other: 'tool' }

/**
 * The codemode script each tool call belongs to, by entry id: a script's own call, and each call it made, through any
 * call between (`ActivityEntry.parent`). A script that is not in the list, as one the feed let go, has none.
 */
function scriptsOf(entries: readonly ActivityEntry[]): Map<string, string> {
  const scripts = new Map<string, string>()
  for (const entry of entries) {
    if (entry.kind !== 'tool') continue
    const script = entry.parent === undefined ? undefined : scripts.get(entry.parent)
    if (script !== undefined) scripts.set(entry.id, script)
    else if (entry.name === 'codemode') scripts.set(entry.id, entry.id)
  }
  return scripts
}

/** The group a single call makes on its own. */
function groupOf(entry: ActivityEntry, options: ReadOptions): Group {
  const kind = STEP_OF[familyOf(entry.name)]
  if (kind === 'change') return { kind, entries: [entry], path: pathOf(entry, options.cwd) }
  return { kind, entries: [entry] }
}

/**
 * Which entries make which step: words alone, commands in a row, edits to one file in a row, reads and searches in a
 * row, and a codemode script with every call it made, wherever they come.
 */
function groupsOf(entries: readonly ActivityEntry[], options: ReadOptions): Group[] {
  const groups: Group[] = []
  const scripts = scriptsOf(entries)
  const blocks = new Map<string, Group>()
  for (const entry of entries) {
    if (entry.kind !== 'tool') {
      if (entry.text?.trim()) groups.push({ kind: 'says', entries: [entry] })
      continue
    }
    const script = scripts.get(entry.id)
    if (script === entry.id) {
      const block: Group = { kind: 'codemode', entries: [entry] }
      blocks.set(entry.id, block)
      groups.push(block)
      continue
    }
    const block = script === undefined ? undefined : blocks.get(script)
    if (block) {
      block.entries.push(entry)
      continue
    }
    if (entry.name === AGENT_REPORT) {
      groups.push({ kind: 'report', entries: [entry] })
      continue
    }
    if (options.tasksOnLine && isTaskTool(entry.name) && entry.state !== 'failed') continue
    // A failed load is no skill (skills.ts), so it stays a step. A SKILL.md read leaves its group of reads.
    if (options.tasksOnLine && isSkillLoad(entry)) continue

    const kind = STEP_OF[familyOf(entry.name)]
    const path = kind === 'change' ? pathOf(entry, options.cwd) : undefined
    const last = groups.at(-1)
    // Commands join the commands before them, reads and searches the reads, and an edit the edits to its own file.
    const joinsLast = last?.kind === kind && (kind === 'shell' || kind === 'looks' || (kind === 'change' && last.path === path))
    if (joinsLast) last.entries.push(entry)
    else groups.push({ kind, entries: [entry], ...(path === undefined ? {} : { path }) })
  }
  return groups
}

/**
 * A step as it was last built, by its first entry, with what it was built from. The next update builds it again only
 * when its entries changed, and then only from the first entry that did: the commands and reads before it are kept,
 * and a change goes on from the file as the calls before it left it.
 */
interface Built {
  entries: readonly ActivityEntry[]
  ended: boolean
  cwd: string | undefined
  step: Step
  /** A change's file before its last call, for when that call is the one that changed. */
  beforeLast?: Change
}

const built = new WeakMap<ActivityEntry, Built>()

const isRunning = (entry: ActivityEntry) => entry.kind === 'tool' && entry.state === 'running'

/** How many entries from the start the two lists hold as the very same objects. */
function samePrefix(left: readonly ActivityEntry[], right: readonly ActivityEntry[]): number {
  const most = Math.min(left.length, right.length)
  let count = 0
  while (count < most && left[count] === right[count]) count += 1
  return count
}

const NO_CHANGE = (path: string): Change => ({ path, hunks: [], whole: null, calls: 0, state: 'done', failures: [] })

/** The step last built from this group's first entry, when it is of the same kind and read from the same folder. */
function heldStep(group: Group, options: ReadOptions): Built | undefined {
  const held = built.get(group.entries[0]!)
  if (!held || held.cwd !== options.cwd || held.step.kind !== group.kind) return undefined
  return held
}

/** What carries over from the step built before: its entries that are the very same, and whether each reads the same now. */
interface Carried {
  held: Built | undefined
  /** How many of the group's first entries are the very ones the held step was built from. */
  kept: number
  /** The item built before for the entry at `index` still stands. */
  keeps: (index: number) => boolean
}

/**
 * A change's file as the calls kept left it, then each call after them. It goes on after all the calls held, or before
 * the last of them when that one is the call that changed; no job ending changes a file. Anything else starts again.
 */
function changeOn(group: Group, { held, kept }: Carried, ended: boolean): { change: Change; beforeLast: Change | undefined } {
  const { entries } = group
  let change = NO_CHANGE(group.path ?? '')
  let from = 0
  let beforeLast = held?.beforeLast
  if (held?.step.kind === 'change' && kept === held.entries.length) {
    change = held.step.change
    from = kept
  } else if (held?.beforeLast && kept === held.entries.length - 1) {
    change = held.beforeLast
    from = kept
  }

  for (let index = from; index < entries.length; index++) {
    if (index === entries.length - 1) beforeLast = change
    change = withCall(change, entries[index]!, ended)
  }
  return { change: { ...change, state: changeState(entries, ended) }, beforeLast }
}

/** Builds a group's step, keeping the commands and reads that still stand and going on with a change from where it was. */
function buildStep(group: Group, carried: Carried, ended: boolean, options: ReadOptions): { step: Step; beforeLast?: Change } {
  const { entries } = group
  const first = entries[0]!
  const key = first.id
  const { held, keeps } = carried
  switch (group.kind) {
    case 'says':
      return { step: { kind: 'says', key, entries, text: first.text ?? '' } }
    case 'report': {
      const args = argsOf(first)
      const from = firstText(args, 'name') || 'An agent'
      const team = firstText(args, 'team')
      const file = firstText(args, 'file')
      const kept = team && file ? { file: { team, file } } : {}
      return { step: { kind: 'report', key, entries, from, ok: first.state !== 'failed', summary: firstText(args, 'summary') ?? '', text: first.output ?? '', ...kept } }
    }
    case 'codemode': {
      // Each call is built as its own step is, so a call that did not change is the step it was.
      const calls = entries.slice(1).map((entry) => stepOf(groupOf(entry, options), ended, options))
      return { step: { kind: 'codemode', key, entries, state: stateOf(first, ended), calls } }
    }
    case 'tool': {
      const state = stateOf(first, ended)
      const failure = state === 'failed' ? failureOf(first) : undefined
      const step: Step = {
        kind: 'tool',
        key,
        entries,
        name: first.name ?? 'tool',
        summary: summaryOf(first, options.cwd),
        state,
        output: first.output ?? '',
        ...(failure ? { failure } : {}),
      }
      return { step }
    }
    case 'shell': {
      const earlier = held?.step.kind === 'shell' ? held.step.commands : []
      const commands = entries.map((entry, index) => (keeps(index) ? earlier[index]! : commandOf(entry, ended)))
      return { step: { kind: 'shell', key, entries, commands } }
    }
    case 'looks': {
      const earlier = held?.step.kind === 'looks' ? held.step.looks : []
      const looks = entries.map((entry, index) => (keeps(index) ? earlier[index]! : lookOf(entry, familyOf(entry.name) as LookKind, options)))
      return { step: { kind: 'looks', key, entries, looks } }
    }
    case 'change': {
      const { change, beforeLast } = changeOn(group, carried, ended)
      return { step: { kind: 'change', key, entries, change }, beforeLast }
    }
  }
}

function stepOf(group: Group, ended: boolean, options: ReadOptions): Step {
  const { entries } = group
  const held = heldStep(group, options)
  const kept = held ? samePrefix(held.entries, entries) : 0
  // A call that is not running reads the same whether or not the job has ended.
  const readsTheSame = (entry: ActivityEntry) => held?.ended === ended || !isRunning(entry)
  const unchanged = held !== undefined && kept === entries.length && kept === held.entries.length && entries.every(readsTheSame)
  if (unchanged) return held.step

  const keeps = (index: number) => index < kept && readsTheSame(entries[index]!)
  const { step, beforeLast } = buildStep(group, { held, kept, keeps }, ended, options)
  built.set(entries[0]!, { entries, ended, cwd: options.cwd, step, ...(beforeLast ? { beforeLast } : {}) })
  return step
}

/**
 * The steps of a job's activity, in order. A step whose entries are the ones it was last built from is that same
 * object, so what draws it can tell it did not change by reference; one update builds only the steps it touched.
 */
export function stepsOf(entries: readonly ActivityEntry[], options: ReadOptions = {}): Step[] {
  const ended = options.ended ?? false
  return groupsOf(entries, options).map((group) => stepOf(group, ended, options))
}

/**
 * The agent's steps with the user's messages where they were sent. Each entry is placed by when hobkin first saw it,
 * the time its row shows, and one from a runtime that kept no times by when this window first saw it. Both clocks are
 * this Mac's. A message splits a run of steps around it, but not a codemode script's block: the calls the script made
 * after the message stay in it, and the message goes after it.
 */
export function exchangeOf(entries: readonly ActivityEntry[], notes: readonly Note[], options: ReadOptions & { seenAt: (id: string) => number | undefined }): ExchangeItem[] {
  const waiting = [...notes].sort((left, right) => left.at - right.at)
  const scripts = scriptsOf(entries)
  const runOfScript = new Map<string, ActivityEntry[]>()
  let run: ActivityEntry[] = []
  // The runs and the messages between them, in order. A run is made into steps once every call has joined its script.
  const parts: (ActivityEntry[] | Note)[] = [run]
  for (const entry of entries) {
    const script = scripts.get(entry.id)
    const scriptRun = script === undefined ? undefined : runOfScript.get(script)
    if (scriptRun) {
      scriptRun.push(entry)
      continue
    }

    const seen = entry.at ?? options.seenAt(entry.id) ?? -Infinity
    while (waiting.length && waiting[0]!.at < seen) {
      parts.push(waiting.shift()!)
      run = []
      parts.push(run)
    }
    run.push(entry)
    if (script === entry.id) runOfScript.set(entry.id, run)
  }
  parts.push(...waiting)

  return parts.flatMap((part): ExchangeItem[] => {
    if (Array.isArray(part)) return stepsOf(part, options)
    return [{ kind: 'note', key: `note:${part.id}`, note: part }]
  })
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
  if (entry.name === AGENT_REPORT) return { lead: 'Report from', subject: firstText(argsOf(entry), 'name') || 'an agent' }

  const family = familyOf(entry.name)
  const state = stateOf(entry, options.ended ?? false)
  let subject: string
  if (family === 'shell') subject = firstLine(commandOf(entry, false).command)
  else if (family === 'change') subject = pathOf(entry, options.cwd)
  else if (family === 'other') subject = entry.name ?? 'a tool'
  else subject = lookOf(entry, family, options).what
  const aboutPath = family === 'change' || family === 'read' || family === 'list'
  const drawn = {
    ...(family === 'other' ? {} : { code: true }),
    ...(aboutPath ? { path: true } : {}),
  }
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

/**
 * Between steps the agent is thinking: after a tool call or before its first step, while its job runs. Never while a tool
 * runs or it writes. A call another tool made, such as a codemode script's, is that tool's, which still runs.
 */
export function pauseOf(entries: readonly ActivityEntry[], options: ReadOptions = {}): 'thinking' | null {
  if (options.ended) return null
  const last = entries.findLast((entry) => (entry.kind === 'tool' && entry.parent === undefined) || entry.text?.trim())
  if (!last) return 'thinking'
  return last.kind === 'tool' && last.state !== 'running' ? 'thinking' : null
}

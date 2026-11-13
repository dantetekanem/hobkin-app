import type { ActivityEntry } from '#shared/protocol/activity.ts'

/**
 * The agent's task list, as its own task tools left it. Pi's tasks extension (pi-solid-tasks) gives an agent
 * `task_create`, `task_append`, `task_prepend`, `tasks_create_in_batch`, `task_list`, `task_get`, `task_update`,
 * `task_done`, `tasks_done`, `task_wait`, `task_stop` and `task_output`. hobkin keeps each call's arguments and the
 * text it gave back, never its details, so the list is read from those words, in the shapes the extension prints them
 * (`src/index.ts` and `prompts/task-done-handoff.md` in pi-solid-tasks).
 *
 * Pure, so its rules are tested without a window. Reading the same result twice changes nothing.
 */

export type TaskState = 'queued' | 'now' | 'done'

/**
 * The tools that make or change the list, or show it. Their calls are drawn as the list, not as steps. `task_output`
 * is not one: it shows what a background command printed.
 */
const TASK_TOOLS = new Set(['task_create', 'task_append', 'task_prepend', 'tasks_create_in_batch', 'task_list', 'task_get', 'task_update', 'task_done', 'tasks_done', 'task_wait', 'task_stop'])

export const isTaskTool = (name: string | undefined): boolean => TASK_TOOLS.has(name ?? '')

export interface AgentTask {
  /** The number the tools give it, without its #. */
  id: string
  /** Its title. Empty while only its number is known. */
  title: string
  /** What needs to be done, as the agent wrote it. */
  description?: string
  /** What the agent says while it works on it, such as "Writing the report". */
  doing?: string
  state: TaskState
  /** Its place: the finished ones in the order they finished, then the rest in the order they will run. */
  order: number
  /** The title of the group it belongs to, when it is in one. */
  group?: string
}

type Status = 'pending' | 'in_progress' | 'completed'
const STATE: Record<Status, TaskState> = { pending: 'queued', in_progress: 'now', completed: 'done' }

interface Held {
  id: string
  title: string
  description?: string
  doing?: string
  state: TaskState
  parent?: string
}

type Args = Record<string, unknown>
const parsed = new WeakMap<ActivityEntry, Args>()

/** A call's arguments, which hobkin sends as JSON text. Read once per entry: the list is read again on every step. */
function argsOf(entry: ActivityEntry): Args {
  const known = parsed.get(entry)
  if (known) return known
  let args: Args = {}
  try {
    const value: unknown = entry.input ? JSON.parse(entry.input) : null
    if (value && typeof value === 'object' && !Array.isArray(value)) args = value as Args
  } catch {
    /* Not JSON: no arguments to read. */
  }
  parsed.set(entry, args)
  return args
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined)

/** A task's number as the tools take it: digits, sometimes sent as a number. */
function idOf(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  return /^\d+$/.test(id) ? id : undefined
}

const idsIn = (line: string) => [...line.matchAll(/#(\d+)/g)].map((match) => match[1]!)

// The lines the tools print.
const CREATED = /^Task #(\d+) created successfully: (.*)$/m
const QUEUE = /^Execution queue: (.*)$/m
const LISTED = /^([\s│├└─]*)#(\d+) \[(pending|in_progress|completed)\] (.*)$/
const UPDATED = /^Updated task #(\d+)\b/
const DONE = /^Task #(\d+) completed\.\nQueue state: (?:ready|waiting|complete)\n\n([\s\S]*?)(?:\n\n- ready:|$)/
const GOT = /^Task #(\d+): (.*)\nStatus: (pending|in_progress|completed)/
// task_get's description runs until the next line it prints after it.
const GOT_DESCRIPTION = /\nDescription: ([\s\S]*?)(?=\n(?:Parent: #|Progress: \d|Children: |Group status follows|Blocked by: #|Blocks: #|Metadata: \{)|$)/
const STOPPED = /^Task #(\d+) stopped successfully and returned to pending/
const WAITING = /^Waiting on #(\d+): /
// What task_list adds after a title: a group's progress, who owns it, what it waits for.
const BLOCKED = / \[blocked by #\d+(?:, #\d+)*\]$/
const PROGRESS = / \[\d+\/\d+ tasks · \d+%\]$/
const OWNER = / \([^()\s]+\)$/
const PARENT = / \(parent #(\d+)\)$/

class Board {
  readonly tasks = new Map<string, Held>()
  readonly groups = new Map<string, string>()
  /** The open tasks, in the order they will run. */
  queue: string[] = []
  /** The finished ones, in the order they finished. */
  readonly finished: string[] = []

  /** The task with this number, made known with what is new about it. It is placed by whoever asked. */
  know(id: string, fields: { title?: string; description?: string; doing?: string; parent?: string } = {}): Held {
    let held = this.tasks.get(id)
    if (!held) {
      held = { id, title: '', state: 'queued' }
      this.tasks.set(id, held)
    }
    if (fields.title) held.title = fields.title
    if (fields.description) held.description = fields.description
    if (fields.doing) held.doing = fields.doing
    if (fields.parent) held.parent = fields.parent
    return held
  }

  state(id: string, state: TaskState): void {
    const held = this.know(id)
    held.state = state
    if (state === 'done') {
      this.queue = this.queue.filter((other) => other !== id)
      if (!this.finished.includes(id)) this.finished.push(id)
      return
    }
    const at = this.finished.indexOf(id)
    if (at !== -1) this.finished.splice(at, 1)
    if (this.queue.includes(id)) return
    // A task reopened to work on goes first. One only now known waits at the end.
    if (state === 'now') this.queue.unshift(id)
    else this.queue.push(id)
  }

  /** A new task, where the tool put it among the open ones. */
  place(id: string, where: { type?: unknown; taskId?: unknown }): void {
    this.queue = this.queue.filter((other) => other !== id)
    this.queue.splice(this.placeOf(where), 0, id)
  }

  /** Where in the queue a position puts a new task. Beside an anchor it does not hold, at the end. */
  private placeOf(where: { type?: unknown; taskId?: unknown }): number {
    if (where.type === 'beginning') return 0
    const anchor = this.queue.indexOf(idOf(where.taskId) ?? '')
    if (anchor === -1) return this.queue.length
    if (where.type === 'before') return anchor
    if (where.type === 'after') return anchor + 1
    return this.queue.length
  }

  remove(id: string): void {
    this.tasks.delete(id)
    this.groups.delete(id)
    this.queue = this.queue.filter((other) => other !== id)
    const at = this.finished.indexOf(id)
    if (at !== -1) this.finished.splice(at, 1)
  }

  /** Every open task, in order, as a tool listed them. An open one it left out was deleted. */
  openAre(ids: readonly string[]): void {
    const open = new Set(ids.filter((id) => !this.groups.has(id)))
    for (const id of this.queue) {
      if (!open.has(id)) this.tasks.delete(id)
    }
    for (const id of open) {
      const held = this.know(id)
      if (held.state !== 'done') continue
      held.state = 'queued'
      const at = this.finished.indexOf(id)
      if (at !== -1) this.finished.splice(at, 1)
    }
    this.queue = [...open]
  }

  list(): AgentTask[] {
    const placed = [...this.finished, ...this.queue]
    // Defensive: a task known but never placed waits at the end.
    for (const id of this.tasks.keys()) {
      if (!placed.includes(id)) placed.push(id)
    }
    const held = placed.flatMap((id) => this.tasks.get(id) ?? [])
    return held.map((task, order) => {
      const group = task.parent ? this.groups.get(task.parent) : undefined
      return {
        id: task.id,
        title: task.title,
        ...(task.description ? { description: task.description } : {}),
        ...(task.doing ? { doing: task.doing } : {}),
        state: task.state,
        order,
        ...(group ? { group } : {}),
      }
    })
  }
}

/** One task in a whole list a tool printed. */
interface ListedRow {
  id: string
  status: Status
  title?: string
  group?: boolean
  parent?: string
}

/** A whole list a tool printed: every task now, with its state, in the order they run. */
function snapshot(board: Board, rows: readonly ListedRow[], order?: readonly string[]): void {
  for (const row of rows) {
    if (row.group) {
      if (row.title) board.groups.set(row.id, row.title)
      board.tasks.delete(row.id)
      continue
    }
    board.know(row.id, { title: row.title, parent: row.parent })
    if (row.status === 'completed') board.state(row.id, 'done')
  }
  const open = rows.filter((row) => !row.group && row.status !== 'completed')
  board.openAre(order ?? open.map((row) => row.id))
  for (const row of open) board.know(row.id).state = STATE[row.status]
}

/** What task_list printed, line by line. A title is taken as it was given when that is known. */
function listed(board: Board, output: string): void {
  if (output.trim() === 'No tasks found') {
    board.openAre([])
    return
  }
  const rows: ListedRow[] = []
  let group: string | undefined
  for (const line of output.split('\n')) {
    const match = LISTED.exec(line)
    if (!match) continue
    const [, prefix, id, status, rest] = match as unknown as [string, string, string, Status, string]
    const child = prefix.trim() !== ''
    let words = rest.replace(BLOCKED, '')
    const isGroup = PROGRESS.test(words)
    words = words.replace(PROGRESS, '')
    // An owner looks like the end of a title in brackets, so a title already known is taken whole.
    const known = board.tasks.get(id)?.title || board.groups.get(id)
    const title = known && (words === known || words.startsWith(`${known} (`)) ? known : words.replace(OWNER, '')
    if (!child) group = isGroup ? id : undefined
    rows.push({
      id,
      status,
      title,
      ...(isGroup ? { group: true } : {}),
      ...(child && group ? { parent: group } : {}),
    })
  }
  const queue = QUEUE.exec(output)
  snapshot(board, rows, queue ? idsIn(queue[1]!) : undefined)
}

/** What tasks_create_in_batch printed: each new task's line, checked against the titles it was given. */
function batched(board: Board, args: Args, output: string): void {
  // Each item and its children, in the order they were made.
  const items = Array.isArray(args.tasks) ? (args.tasks as Args[]) : []
  const given = items
    .flatMap((item) => [item, ...(Array.isArray(item?.children) ? (item.children as Args[]) : [])])
    .filter((item) => item && typeof item === 'object')
  const givenAs = (title: string) => given.find((item) => text(item.subject)?.split('\n')[0]!.trim() === title.trim())

  for (const line of output.split('\n')) {
    const match = LISTED.exec(line)
    if (!match) continue
    const [, , id, status, rest] = match as unknown as [string, string, string, Status, string]
    const parent = PARENT.exec(rest)?.[1]
    const title = rest.replace(PARENT, '')
    const item = givenAs(title)
    // A line of a description that only looks like a task is not one.
    if (given.length && !item) continue

    if (item?.kind === 'group') {
      board.groups.set(id, title)
      continue
    }
    if (board.tasks.has(id)) continue
    board.know(id, { title, description: text(item?.description), doing: text(item?.activeForm), parent })
    board.state(id, STATE[status])
  }
}

/** What task_done printed: the task finished, then the next one, or every task still open. */
function finished(board: Board, output: string): void {
  const match = DONE.exec(output)
  if (!match) return
  board.state(match[1]!, 'done')
  let context: unknown
  try {
    context = JSON.parse(match[2]!)
  } catch {
    return
  }
  if (!context || typeof context !== 'object') return
  readHandoff(board, context as Args)
}

/** A status from a tool's JSON, which is only trusted once it is one of the three. */
function statusOf(value: unknown): Status | undefined {
  return typeof value === 'string' && Object.hasOwn(STATE, value) ? (value as Status) : undefined
}

/** task_done's context: "ready" names the next task and its group, "waiting" and "complete" list every task still open. */
function readHandoff(board: Board, context: Args): void {
  const parent = context.parent as Args | undefined
  const parentId = idOf(parent?.id)
  const parentTitle = text(parent?.subject)
  if (parentId && parentTitle) board.groups.set(parentId, parentTitle)

  const next = context.nextTask as Args | undefined
  const nextId = idOf(next?.id)
  if (next && nextId && next.kind !== 'group') {
    const placed = board.tasks.has(nextId)
    board.know(nextId, { title: text(next.subject), description: text(next.description), doing: text(next.activeForm), parent: idOf(next.parentId) })
    const status = statusOf(next.status)
    if (!placed && status) board.state(nextId, STATE[status])
  }

  if (!Array.isArray(context.unfinished)) return
  const rows: ListedRow[] = []
  for (const row of context.unfinished as Args[]) {
    const id = idOf(row?.id)
    const status = statusOf(row?.status)
    if (!id || !status) continue
    rows.push({
      id,
      status,
      title: text(row.subject),
      ...(row.kind === 'group' ? { group: true } : {}),
    })
  }
  snapshot(board, rows)
}

function read(board: Board, entry: ActivityEntry): void {
  const output = entry.output ?? ''
  const args = argsOf(entry)
  switch (entry.name) {
    case 'task_create': {
      const match = CREATED.exec(output)
      if (!match) return
      const id = match[1]!
      const title = text(args.subject) ?? match[2]!
      if (args.kind === 'group') {
        board.groups.set(id, title)
        return
      }
      const known = board.tasks.has(id)
      board.know(id, { title, description: text(args.description), doing: text(args.activeForm), parent: idOf(args.parentId) })
      if (!known) board.place(id, (args.position as Args | undefined) ?? {})
      return
    }
    case 'task_append':
    case 'task_prepend': {
      const match = CREATED.exec(output)
      if (!match) return
      const id = match[1]!
      const known = board.tasks.has(id)
      board.know(id, { title: text(args.subject) ?? match[2]!, description: text(args.description), doing: text(args.activeForm), parent: idOf(args.parentId) })
      if (!known) board.place(id, { type: entry.name === 'task_append' ? 'after' : 'before', taskId: args.taskId })
      const queue = QUEUE.exec(output)
      if (queue) board.openAre(idsIn(queue[1]!))
      return
    }
    case 'tasks_create_in_batch':
      return batched(board, args, output)
    case 'task_list':
      return listed(board, output)
    case 'task_get': {
      const match = GOT.exec(output)
      if (!match) return
      const [, id, title, status] = match as unknown as [string, string, string, Status]
      if (board.groups.has(id)) {
        board.groups.set(id, title)
        return
      }
      board.know(id, { title, description: GOT_DESCRIPTION.exec(output)?.[1]?.trim() })
      board.state(id, STATE[status])
      return
    }
    case 'task_update': {
      const match = UPDATED.exec(output)
      const id = idOf(args.taskId)
      if (!match || match[1] !== id) return
      if (args.status === 'deleted') return board.remove(id)
      if (board.groups.has(id)) {
        if (text(args.subject)) board.groups.set(id, text(args.subject)!)
        return
      }
      const known = board.tasks.has(id)
      board.know(id, { title: text(args.subject), description: text(args.description), doing: text(args.activeForm) })
      if (args.status === 'in_progress') board.state(id, 'now')
      else if (args.status === 'completed') board.state(id, 'done')
      else if (!known) board.state(id, 'queued')
      return
    }
    case 'task_done':
      return finished(board, output)
    case 'task_stop': {
      const match = STOPPED.exec(output)
      if (match) board.state(match[1]!, 'queued')
      return
    }
    case 'task_wait': {
      const match = WAITING.exec(output)
      if (match) board.state(match[1]!, 'now')
      return
    }
  }
}

/**
 * The agent's tasks after every task tool call it finished, in the order they run. A call still running or one that
 * failed changes nothing, and neither does one that printed why it could not do what it was asked. Finished tasks stay
 * listed after the agent clears them, so the list still shows what was done. Empty when it used no task tool.
 */
export function tasksOf(entries: readonly ActivityEntry[]): AgentTask[] {
  const board = new Board()
  const seen = new Set<string>()
  for (const entry of entries) {
    if (entry.kind !== 'tool' || !isTaskTool(entry.name)) continue
    if (entry.state !== 'completed' || seen.has(entry.id)) continue
    seen.add(entry.id)
    read(board, entry)
  }
  return board.list()
}

export interface TaskProgress {
  done: number
  total: number
  /** The tasks being worked on now, in the order they run. */
  now: AgentTask[]
  /** The first one still waiting. */
  next?: AgentTask
}

/** Two lists that say the same, so what draws them can keep the one it has. */
export function sameTasks(left: readonly AgentTask[], right: readonly AgentTask[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((task, index) => {
    const other = right[index]!
    return (
      task.id === other.id &&
      task.title === other.title &&
      task.description === other.description &&
      task.doing === other.doing &&
      task.state === other.state &&
      task.order === other.order &&
      task.group === other.group
    )
  })
}

export function progressOf(tasks: readonly AgentTask[]): TaskProgress {
  const next = tasks.find((task) => task.state === 'queued')
  return {
    done: tasks.filter((task) => task.state === 'done').length,
    total: tasks.length,
    now: tasks.filter((task) => task.state === 'now'),
    ...(next ? { next } : {}),
  }
}

/** A task's title, or its number while only that is known. */
export const titleOf = (task: AgentTask): string => task.title || `Task ${task.id}`

/** The tasks in one line, in parts so each can be drawn in its own weight. */
export interface TaskLine {
  /** How many are done of how many: "2 of 5 tasks". */
  count: string
  lead: 'in progress' | 'next' | 'all done'
  /** The task the line names: the first in progress, or else the next one. */
  title?: string
  /** How many more are in progress beside the one named. */
  more: number
  /** The whole line: "2 of 5 tasks · in progress: Post-process the completed change and verify". */
  text: string
}

/** The tasks in one line: how many are done of how many, then the one in progress, or else the next one, or that all are done. */
export function taskLine(progress: TaskProgress): TaskLine {
  const count = `${progress.done} of ${progress.total} ${progress.total === 1 ? 'task' : 'tasks'}`
  const now = progress.now[0]
  const named = now ?? progress.next
  const lead = now ? 'in progress' : named ? 'next' : 'all done'
  const more = Math.max(0, progress.now.length - 1)
  const title = named ? titleOf(named) : undefined
  const text = `${count} · ${lead}${title ? `: ${title}${more ? ` +${more}` : ''}` : ''}`
  return { count, lead, ...(title ? { title } : {}), more, text }
}

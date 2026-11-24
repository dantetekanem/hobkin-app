import type { HobkinSnapshot } from 'hobkin/src/cli/application.mjs'
import { scheduleDefinition } from 'hobkin/src/cli/checks.mjs'
import { diffActivity, MAIN_ACTIVITY, resetActivity, type JobActivity } from '#shared/protocol/activity.ts'
import type { AppearanceRequest } from '#shared/protocol/appearance.ts'
import type { KeptThemes } from '#shared/protocol/theme-history.ts'
import { readMemoriesStamp, readMemoryNote } from '#shared/protocol/memory.ts'
import type { CanvasState } from '#shared/protocol/canvas.ts'
import type { IntegrationsState } from '#shared/integrations/wire.ts'
import type { GitHubState } from '#shared/protocol/github.ts'
import { diffMessages } from '#shared/protocol/message-ops.ts'
import { withoutNothingNew } from '#shared/reports/nothing-new.ts'
import type { OwnerState, StateMessage } from '#shared/protocol/messages.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
import type { Nudge } from '#shared/protocol/nudge.ts'
import type { ProofsState } from '#shared/protocol/proofs.ts'
import type { SignInState } from '#shared/protocol/signin.ts'
import { shellFields, type ChatMessage, type WireSnapshot } from '#shared/protocol/snapshot.ts'
import type { WorkState } from '#shared/protocol/work.ts'

/**
 * Keys of hobkin's snapshot that stay in the host. `config` holds settings such as the launcher, `history` is the
 * imported archive, `presentation` is applied here, `messages` and `jobActivity` travel as steps, and `savedAt`
 * changes on every refresh without anything else changing.
 */
const HOST_ONLY = new Set(['config', 'history', 'presentation', 'messages', 'jobActivity', 'mainActivity', 'savedAt', 'version'])

/** Every key is encoded again at least this often, so a value edited in place after it was sent still goes out. */
const FULL_ENCODING_MS = 1000

/** Every job's activity in a snapshot. hobkin rebuilds it on each refresh, so it travels as steps (`shared/protocol/activity.ts`). */
const activityOf = (snapshot: HobkinSnapshot | null): JobActivity => {
  const activity = snapshot?.jobActivity
  const jobs = activity && typeof activity === 'object' ? (activity as JobActivity) : {}
  // The main chat's own activity changes as often as a job's, so it travels the same way.
  return Array.isArray(snapshot?.mainActivity) ? { ...jobs, [MAIN_ACTIVITY]: snapshot.mainActivity } : jobs
}

/** The routines as the UI gets them, each with the fingerprint of its definition, which a deletion must name. */
export function wireSchedules(schedules: unknown[]): unknown[] {
  return schedules.map((row: unknown) => {
    if (!row || typeof row !== 'object') return row
    const { nextRun: _next, ...definition } = row as Record<string, unknown>
    return { ...row, expectedDefinition: scheduleDefinition(definition) }
  })
}

/** What the window reads of each project in hobkin's work status: the project lists and the new hobkin sheet's folders. */
const WINDOW_PROJECT_FIELDS = ['slug', 'name', 'path', 'state', 'priority', 'open', 'prs', 'branches', 'left']

/**
 * hobkin's work status as the window gets it in the snapshot: its projects, each with only what the window reads. The
 * Work screen gets the whole of work mode as its own slice (`work` in the host facts), so the plan, the running agents'
 * tokens and the rest stay here, and a token count that moves every second sends nothing.
 */
export function wireWork(work: unknown): unknown {
  if (!work || typeof work !== 'object') return work
  const projects = (work as { projects?: unknown }).projects
  return {
    projects: (Array.isArray(projects) ? projects : []).map((project: unknown) => {
      if (!project || typeof project !== 'object') return project
      const row = project as Record<string, unknown>
      return Object.fromEntries(WINDOW_PROJECT_FIELDS.filter((field) => row[field] !== undefined).map((field) => [field, row[field]]))
    }),
  }
}

/**
 * A message with its note about a memory read into the contract's shape (057-shared-memory), or without it when the
 * window could not offer Undo by it. A message with no note is the same object.
 */
function withMemoryNote(message: ChatMessage): ChatMessage {
  if (!('memory' in message)) return message
  const { memory, ...line } = message
  const note = readMemoryNote(memory)
  return note ? { ...line, memory: note } : line
}

/**
 * hobkin's snapshot as the UI gets it: its top-level keys, and the conversation as the terminal app shows it,
 * without what the user cleared and without messages that have nothing to read, such as a reply stopped
 * before its first word (`isVisible` in hobkin's `src/cli/ui.mjs`). `schedules` gives the routines' rows, and
 * `work` the work status's projects. A quiet line's note about a memory and the memories' stamp are read without trust.
 */
export function toWire(
  snapshot: HobkinSnapshot,
  cleared: ReadonlySet<string> = new Set(),
  schedules: (rows: unknown[]) => unknown[] = wireSchedules,
  work: (status: unknown) => unknown = wireWork,
): { values: WireSnapshot; messages: ChatMessage[] } {
  // hobkin reads what was cleared when it opens. What is cleared after that is known here.
  const hidden = new Set([...(snapshot.presentation?.hiddenMessageIds ?? []), ...cleared])
  const values = Object.fromEntries(Object.entries(snapshot).filter(([key, value]) => !HOST_ONLY.has(key) && value !== undefined))
  if (Array.isArray(values.schedules)) values.schedules = schedules(values.schedules)
  // A run that found nothing new is no report: it is not listed or counted, and a routine's last run still comes from its schedule.
  if (Array.isArray(values.reports)) values.reports = withoutNothingNew(values.reports)
  if ('work' in values) values.work = work(values.work)
  if ('memoriesStamp' in values) {
    const stamp = readMemoriesStamp(values.memoriesStamp)
    if (stamp === undefined) delete values.memoriesStamp
    else values.memoriesStamp = stamp
  }
  const messages = ((snapshot.messages ?? []) as ChatMessage[]).flatMap((message): ChatMessage[] => {
    if (hidden.has(message.id)) return []
    if (message.role === 'bashExecution') {
      const shell = shellFields(message)
      const at = message.at ?? (message as ChatMessage & { timestamp?: string | number }).timestamp
      return shell ? [{ id: message.id, role: 'bashExecution', content: shell.output, ...shell, ...(at === undefined ? {} : { at }) }] : []
    }
    return String(message.content ?? '').trim() ? [withMemoryNote(message)] : []
  })
  return { values, messages }
}

export interface HostFacts {
  owner: OwnerState
  signIn: SignInState
  /** The providers Pi knows and the models it can use now, or null until Pi has said. */
  models: ModelsState | null
  /** The user's GitHub as gh reads it. Left out by a host that does not read it. */
  github?: GitHubState
  /** The MCP servers in Pi's configuration, with their secrets hidden. Left out by a host that does not read them. */
  integrations?: IntegrationsState
  /** Work mode as the Work screen draws it, read from the snapshot. Null or left out while the snapshot has none, as in a view the terminal saved. */
  work?: WorkState | null
  /** TLA+ proof runs, from hobkin's home. Left out by a host that reads none. */
  proofs?: ProofsState
  /** The canvas panel. Left out by a host that has none. */
  canvas?: CanvasState
  /** Each durable hobkin's canvas by its id. Left out by a host that has none. */
  canvases?: Record<string, CanvasState>
  /** The latest one-shot window instruction (a move or a draft), or null while there has been none. */
  nudge?: Nudge | null
  appearance?: AppearanceRequest | null
  /** The kept custom themes. Left out by a host that keeps none. */
  themes?: KeptThemes
  /** hobkin's snapshot, or null while there is none to show. */
  snapshot: HobkinSnapshot | null
}

/**
 * Turns each new state into the smallest message that brings a UI up to date: the keys that changed, and the
 * conversation as steps. A long history is never sent again because one key moved, and a value that is still the
 * same object is not serialized again.
 */
export class StateSync {
  private rev = 0
  private sent = new Map<string, string>()
  private values: WireSnapshot = {}
  private messages: ChatMessage[] = []
  private activity: JobActivity = {}
  private owner: OwnerState
  private signIn: SignInState
  private models: ModelsState | null
  private github: GitHubState | null
  private integrations: IntegrationsState | null
  private work: WorkState | null = null
  private proofs: ProofsState | null = null
  private canvas: CanvasState | null = null
  private canvases: Record<string, CanvasState> | null = null
  /** The last one-shot window instruction sent. Kept only so a repeat of the same one is not sent twice. */
  private nudge: Nudge | null = null
  private appearance: AppearanceRequest | null = null
  private themes: KeptThemes | null = null
  private readonly cleared = new Set<string>()
  /** Each host fact's JSON as last compared, so the value held is never serialized again. */
  private readonly seen = new Map<keyof HostFacts, string>()
  /** The routines last given rows, with those rows. */
  private schedules: { list: unknown[]; rows: unknown[] } | null = null
  /** hobkin's work status last made the window's, with what the window got. */
  private wiredWork: { status: unknown; wired: unknown } | null = null
  /** When every key was last encoded. */
  private encodedAt = -Infinity
  private readonly now: () => number

  constructor(
    { owner, signIn, models, github, integrations, proofs, canvas, canvases, appearance, themes }: Omit<HostFacts, 'snapshot'>,
    { now = Date.now }: { now?: () => number } = {},
  ) {
    this.now = now
    this.canvas = canvas ?? null
    this.canvases = canvases ?? null
    this.appearance = appearance ?? null
    this.themes = themes ?? null
    this.owner = owner
    this.signIn = signIn
    this.models = models
    this.github = github ?? null
    this.integrations = integrations ?? null
    this.proofs = proofs ?? null
  }

  /** The ids of the messages a UI shows now. */
  shown(): string[] {
    return this.messages.map(({ id }) => id)
  }

  /** Takes messages out of the conversation, as `/clear` does. The next update sends them away. */
  hide(ids: readonly string[]): void {
    for (const id of ids) this.cleared.add(id)
  }

  /** Every job's whole activity as last sent. */
  activityNow(): JobActivity {
    return this.activity
  }

  /** The revision of the last state message. */
  revision(): number {
    return this.rev
  }

  /** Everything, for a connection that holds nothing yet. Without `activity`, the jobs' feeds are left for the caller to send. */
  full({ activity = true }: { activity?: boolean } = {}): StateMessage {
    return {
      type: 'state',
      rev: this.rev,
      reset: true,
      set: this.values,
      messages: [{ op: 'reset', messages: this.messages }],
      ...(activity && Object.keys(this.activity).length ? { activity: resetActivity(this.activity) } : {}),
      owner: this.owner,
      signIn: this.signIn,
      ...(this.models ? { models: this.models } : {}),
      ...(this.github ? { github: this.github } : {}),
      ...(this.integrations ? { integrations: this.integrations } : {}),
      ...(this.work ? { work: this.work } : {}),
      ...(this.proofs ? { proofs: this.proofs } : {}),
      ...(this.canvas ? { canvas: this.canvas } : {}),
      ...(this.canvases ? { canvases: this.canvases } : {}),
      appearance: this.appearance,
      ...(this.themes ? { themes: this.themes } : {}),
    }
  }

  /**
   * What changed, or null when nothing did. A new owner state starts over, because its snapshot is another source.
   * Without `activity`, the jobs' feeds are only kept, not compared: no window that connects reads them whole.
   */
  update({ owner, signIn, models, github, integrations, work = null, proofs, canvas, canvases, nudge, appearance, themes, snapshot }: HostFacts, { activity: whole = true }: { activity?: boolean } = {}): StateMessage | null {
    const ownerChanged = this.differs('owner', owner, this.owner)
    const signInChanged = this.differs('signIn', signIn, this.signIn)
    const modelsChanged = models !== null && this.differs('models', models, this.models)
    const githubChanged = github !== undefined && this.differs('github', github, this.github)
    const integrationsChanged = integrations !== undefined && this.differs('integrations', integrations, this.integrations)
    const workChanged = this.differs('work', work, this.work)
    const proofsChanged = proofs !== undefined && this.differs('proofs', proofs, this.proofs)
    const canvasChanged = canvas !== undefined && this.differs('canvas', canvas, this.canvas)
    const canvasesChanged = canvases !== undefined && this.differs('canvases', canvases, this.canvases)
    // A one-shot instruction is only ever sent when it is new, and never on a reset or in a full state, so the
    // window never replays a move or a draft on a reconnect.
    const nudgeChanged = nudge != null && this.differs('nudge', nudge, this.nudge)
    const appearanceChanged = appearance !== undefined && this.differs('appearance', appearance, this.appearance)
    const themesChanged = themes !== undefined && this.differs('themes', themes, this.themes)
    const startOver = owner.state !== this.owner.state
    this.owner = owner
    this.signIn = signIn
    if (models) this.models = models
    if (github) this.github = github
    if (integrations) this.integrations = integrations
    if (proofs) this.proofs = proofs
    if (canvas) this.canvas = canvas
    if (canvases) this.canvases = canvases
    if (nudge) this.nudge = nudge
    if (appearance !== undefined) this.appearance = appearance
    if (themes) this.themes = themes
    this.work = work

    // hobkin changes a value by replacing it, so a value that is still the same object keeps its encoding. In case one
    // was edited in place after it was sent, every key is encoded again, and the routines' rows worked out again, at
    // least once a second.
    const now = this.now()
    const encodeAll = now - this.encodedAt >= FULL_ENCODING_MS
    if (encodeAll) this.encodedAt = now
    const { values, messages } = snapshot
      ? toWire(snapshot, this.cleared, (list) => this.rowsOf(list, encodeAll), (status) => this.workOf(status, encodeAll))
      : { values: {}, messages: [] }
    const encoded = new Map(Object.entries(values).map(([key, value]) => {
      const kept = this.sent.get(key)
      const sameObject = kept !== undefined && value === this.values[key]
      return [key, sameObject && !encodeAll ? kept : JSON.stringify(value)]
    }))
    const changed = [...encoded].filter(([key, json]) => startOver || this.sent.get(key) !== json).map(([key]) => key)
    const unset = startOver ? [] : [...this.sent.keys()].filter((key) => !encoded.has(key))
    const steps = startOver ? [{ op: 'reset' as const, messages }] : diffMessages(this.messages, messages)
    const activity = activityOf(snapshot)
    const activitySteps = !whole ? [] : startOver ? resetActivity(activity) : diffActivity(this.activity, activity)
    this.sent = encoded
    this.values = values
    this.messages = messages
    this.activity = activity

    if (
      !startOver &&
      !ownerChanged &&
      !signInChanged &&
      !modelsChanged &&
      !githubChanged &&
      !integrationsChanged &&
      !workChanged &&
      !proofsChanged &&
      !canvasChanged &&
      !canvasesChanged &&
      !nudgeChanged &&
      !appearanceChanged &&
      !themesChanged &&
      !changed.length &&
      !unset.length &&
      !steps.length &&
      !activitySteps.length
    )
      return null

    this.rev += 1
    return {
      type: 'state',
      rev: this.rev,
      ...(startOver ? { reset: true as const } : {}),
      ...(changed.length ? { set: Object.fromEntries(changed.map((key) => [key, values[key]])) } : {}),
      ...(unset.length ? { unset } : {}),
      ...(steps.length ? { messages: steps } : {}),
      ...(activitySteps.length ? { activity: activitySteps } : {}),
      ...(ownerChanged ? { owner } : {}),
      ...(signInChanged ? { signIn } : {}),
      ...(modelsChanged ? { models: models! } : {}),
      // A UI that starts over forgets the slice, so a reset always carries it.
      ...(this.github && (githubChanged || startOver) ? { github: this.github } : {}),
      ...(this.integrations && (integrationsChanged || startOver) ? { integrations: this.integrations } : {}),
      // Work mode goes whole, and null once the snapshot has none, so a UI never keeps one that is gone.
      ...(workChanged || (startOver && this.work) ? { work: this.work } : {}),
      ...(this.proofs && (proofsChanged || startOver) ? { proofs: this.proofs } : {}),
      ...(this.canvas && (canvasChanged || startOver) ? { canvas: this.canvas } : {}),
      ...(this.canvases && (canvasesChanged || startOver) ? { canvases: this.canvases } : {}),
      // Only when new — never forced on a reset — so a reconnect never re-navigates the window or rewrites the draft.
      ...(nudgeChanged ? { nudge } : {}),
      ...(appearanceChanged || startOver ? { appearance: this.appearance } : {}),
      ...(this.themes && (themesChanged || startOver) ? { themes: this.themes } : {}),
    }
  }

  /**
   * Whether a host fact differs from the one held. The same object is the same fact, because each producer replaces
   * its object to change it. Another object is compared by its JSON with the JSON last seen, or, the first time, with
   * what the host opened with.
   */
  private differs(fact: keyof HostFacts, value: unknown, held: unknown): boolean {
    if (value === held) return false
    const json = JSON.stringify(value)
    const before = this.seen.has(fact) ? this.seen.get(fact) : JSON.stringify(held)
    this.seen.set(fact, json)
    return json !== before
  }

  /** The window's work status. The same status keeps what it gave, so its encoding is kept too, unless `rebuild` asks for it anew. */
  private workOf(status: unknown, rebuild: boolean): unknown {
    if (!rebuild && this.wiredWork && this.wiredWork.status === status) return this.wiredWork.wired
    const wired = wireWork(status)
    this.wiredWork = { status, wired }
    return wired
  }

  /** The routines' rows. Each row hashes its definition, so a list hobkin kept keeps its rows, unless `rebuild` asks for them anew. */
  private rowsOf(list: unknown[], rebuild: boolean): unknown[] {
    if (!rebuild && this.schedules?.list === list) return this.schedules.rows
    const rows = wireSchedules(list)
    this.schedules = { list, rows }
    return rows
  }
}

import type { HobkinSnapshot } from 'hobkin/src/cli/application.mjs'
import { scheduleDefinition } from 'hobkin/src/cli/checks.mjs'
import { diffActivity, MAIN_ACTIVITY, resetActivity, type JobActivity } from '#shared/protocol/activity.ts'
import type { AppearanceRequest } from '#shared/protocol/appearance.ts'
import type { CanvasState } from '#shared/protocol/canvas.ts'
import type { IntegrationsState } from '#shared/integrations/wire.ts'
import type { GitHubState } from '#shared/protocol/github.ts'
import { diffMessages } from '#shared/protocol/message-ops.ts'
import type { OwnerState, StateMessage } from '#shared/protocol/messages.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
import type { Nudge } from '#shared/protocol/nudge.ts'
import type { SignInState } from '#shared/protocol/signin.ts'
import { shellFields, type ChatMessage, type WireSnapshot } from '#shared/protocol/snapshot.ts'
import type { WorkState } from '#shared/protocol/work.ts'

/**
 * Keys of hobkin's snapshot that stay in the host. `config` holds settings such as the launcher, `history` is the
 * imported archive, `presentation` is applied here, `messages` and `jobActivity` travel as steps, and `savedAt`
 * changes on every refresh without anything else changing.
 */
const HOST_ONLY = new Set(['config', 'history', 'presentation', 'messages', 'jobActivity', 'mainActivity', 'savedAt', 'version'])

/** Every job's activity in a snapshot. hobkin rebuilds it on each refresh, so it travels as steps (`shared/protocol/activity.ts`). */
const activityOf = (snapshot: HobkinSnapshot | null): JobActivity => {
  const activity = snapshot?.jobActivity
  const jobs = activity && typeof activity === 'object' ? (activity as JobActivity) : {}
  // The main chat's own activity changes as often as a job's, so it travels the same way.
  return Array.isArray(snapshot?.mainActivity) ? { ...jobs, [MAIN_ACTIVITY]: snapshot.mainActivity } : jobs
}

/**
 * hobkin's snapshot as the UI gets it: its top-level keys, and the conversation as the terminal app shows it,
 * without what the user cleared and without messages that have nothing to read, such as a reply stopped
 * before its first word (`isVisible` in hobkin's `src/cli/ui.mjs`).
 */
export function toWire(snapshot: HobkinSnapshot, cleared: ReadonlySet<string> = new Set()): { values: WireSnapshot; messages: ChatMessage[] } {
  // hobkin reads what was cleared when it opens. What is cleared after that is known here.
  const hidden = new Set([...(snapshot.presentation?.hiddenMessageIds ?? []), ...cleared])
  const values = Object.fromEntries(Object.entries(snapshot).filter(([key, value]) => !HOST_ONLY.has(key) && value !== undefined))
  if (Array.isArray(values.schedules)) values.schedules = values.schedules.map((row: unknown) => {
    if (!row || typeof row !== 'object') return row
    const { nextRun: _next, ...definition } = row as Record<string, unknown>
    return { ...row, expectedDefinition: scheduleDefinition(definition) }
  })
  const messages = ((snapshot.messages ?? []) as ChatMessage[]).flatMap((message): ChatMessage[] => {
    if (hidden.has(message.id)) return []
    if (message.role === 'bashExecution') {
      const shell = shellFields(message)
      const at = message.at ?? (message as ChatMessage & { timestamp?: string | number }).timestamp
      return shell ? [{ id: message.id, role: 'bashExecution', content: shell.output, ...shell, ...(at === undefined ? {} : { at }) }] : []
    }
    return String(message.content ?? '').trim() ? [message] : []
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
  /** The canvas panel. Left out by a host that has none. */
  canvas?: CanvasState
  /** Each durable hobkin's canvas by its id. Left out by a host that has none. */
  canvases?: Record<string, CanvasState>
  /** The latest one-shot window instruction (a move or a draft), or null while there has been none. */
  nudge?: Nudge | null
  appearance?: AppearanceRequest | null
  /** hobkin's snapshot, or null while there is none to show. */
  snapshot: HobkinSnapshot | null
}

/**
 * Turns each new state into the smallest message that brings a UI up to date: the keys that changed, and the
 * conversation as steps. A long history is never sent again because one key moved.
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
  private canvas: CanvasState | null = null
  private canvases: Record<string, CanvasState> | null = null
  /** The last one-shot window instruction sent. Kept only so a repeat of the same one is not sent twice. */
  private nudge: Nudge | null = null
  private appearance: AppearanceRequest | null = null
  private readonly cleared = new Set<string>()

  constructor({ owner, signIn, models, github, integrations, canvas, canvases, appearance }: Omit<HostFacts, 'snapshot'>) {
    this.canvas = canvas ?? null
    this.canvases = canvases ?? null
    this.appearance = appearance ?? null
    this.owner = owner
    this.signIn = signIn
    this.models = models
    this.github = github ?? null
    this.integrations = integrations ?? null
  }

  /** The ids of the messages a UI shows now. */
  shown(): string[] {
    return this.messages.map(({ id }) => id)
  }

  /** Takes messages out of the conversation, as `/clear` does. The next update sends them away. */
  hide(ids: readonly string[]): void {
    for (const id of ids) this.cleared.add(id)
  }

  /** Everything, for a connection that holds nothing yet. */
  full(): StateMessage {
    return {
      type: 'state',
      rev: this.rev,
      reset: true,
      set: this.values,
      messages: [{ op: 'reset', messages: this.messages }],
      ...(Object.keys(this.activity).length ? { activity: resetActivity(this.activity) } : {}),
      owner: this.owner,
      signIn: this.signIn,
      ...(this.models ? { models: this.models } : {}),
      ...(this.github ? { github: this.github } : {}),
      ...(this.integrations ? { integrations: this.integrations } : {}),
      ...(this.work ? { work: this.work } : {}),
      ...(this.canvas ? { canvas: this.canvas } : {}),
      ...(this.canvases ? { canvases: this.canvases } : {}),
      appearance: this.appearance,
    }
  }

  /** What changed, or null when nothing did. A new owner state starts over, because its snapshot is another source. */
  update({ owner, signIn, models, github, integrations, work = null, canvas, canvases, nudge, appearance, snapshot }: HostFacts): StateMessage | null {
    const ownerChanged = JSON.stringify(owner) !== JSON.stringify(this.owner)
    const signInChanged = JSON.stringify(signIn) !== JSON.stringify(this.signIn)
    const modelsChanged = models !== null && JSON.stringify(models) !== JSON.stringify(this.models)
    const githubChanged = github !== undefined && JSON.stringify(github) !== JSON.stringify(this.github)
    const integrationsChanged = integrations !== undefined && JSON.stringify(integrations) !== JSON.stringify(this.integrations)
    const workChanged = JSON.stringify(work) !== JSON.stringify(this.work)
    const canvasChanged = canvas !== undefined && JSON.stringify(canvas) !== JSON.stringify(this.canvas)
    const canvasesChanged = canvases !== undefined && JSON.stringify(canvases) !== JSON.stringify(this.canvases)
    // A one-shot instruction is only ever sent when it is new, and never on a reset or in a full state, so the
    // window never replays a move or a draft on a reconnect.
    const nudgeChanged = nudge != null && JSON.stringify(nudge) !== JSON.stringify(this.nudge)
    const appearanceChanged = appearance !== undefined && JSON.stringify(appearance) !== JSON.stringify(this.appearance)
    const startOver = owner.state !== this.owner.state
    this.owner = owner
    this.signIn = signIn
    if (models) this.models = models
    if (github) this.github = github
    if (integrations) this.integrations = integrations
    if (canvas) this.canvas = canvas
    if (canvases) this.canvases = canvases
    if (nudge) this.nudge = nudge
    if (appearance !== undefined) this.appearance = appearance
    this.work = work

    const { values, messages } = snapshot ? toWire(snapshot, this.cleared) : { values: {}, messages: [] }
    const encoded = new Map(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]))
    const changed = [...encoded].filter(([key, json]) => startOver || this.sent.get(key) !== json).map(([key]) => key)
    const unset = startOver ? [] : [...this.sent.keys()].filter((key) => !encoded.has(key))
    const steps = startOver ? [{ op: 'reset' as const, messages }] : diffMessages(this.messages, messages)
    const activity = activityOf(snapshot)
    const activitySteps = startOver ? resetActivity(activity) : diffActivity(this.activity, activity)
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
      !canvasChanged &&
      !canvasesChanged &&
      !nudgeChanged &&
      !appearanceChanged &&
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
      ...(this.canvas && (canvasChanged || startOver) ? { canvas: this.canvas } : {}),
      ...(this.canvases && (canvasesChanged || startOver) ? { canvases: this.canvases } : {}),
      // Only when new — never forced on a reset — so a reconnect never re-navigates the window or rewrites the draft.
      ...(nudgeChanged ? { nudge } : {}),
      ...(appearanceChanged || startOver ? { appearance: this.appearance } : {}),
    }
  }
}

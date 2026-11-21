import { applyActivity, MAIN_ACTIVITY, type JobActivity } from '#shared/protocol/activity.ts'
import type { AppearanceRequest } from '#shared/protocol/appearance.ts'
import type { KeptThemes } from '#shared/protocol/theme-history.ts'
import type { CanvasState } from '#shared/protocol/canvas.ts'
import type { IntegrationsState } from '#shared/integrations/wire.ts'
import type { GitHubState } from '#shared/protocol/github.ts'
import { applyMessageOps } from '#shared/protocol/message-ops.ts'
import type { HostMessage, OwnerState, StateMessage } from '#shared/protocol/messages.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
import type { Nudge } from '#shared/protocol/nudge.ts'
import type { ProofsState } from '#shared/protocol/proofs.ts'
import type { PendingQuestion } from '#shared/protocol/question.ts'
import type { SignInState } from '#shared/protocol/signin.ts'
import type { ChatMessage, WireSnapshot } from '#shared/protocol/snapshot.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { applyTurnEvent, settleLive, type LiveTurn } from './live.ts'

/**
 * Where the connection to the host stands.
 * `none`: no host has been found. A browser tab then draws sample data; the Mac window says it is connecting.
 * `lost`: there was a host and it went away. What it last sent stays on screen until it is back.
 */
export type Link = 'none' | 'connecting' | 'open' | 'lost'

/** Everything the UI knows from the host. It is a function of the messages received, and of nothing else. */
export interface HostState {
  link: Link
  /** A full state from this host has replaced retained pre-hello facts. */
  snapshotReady: boolean
  /** The folder hobkin's data lives in. */
  home: string | null
  model: 'scripted' | 'live' | null
  owner: OwnerState | null
  signIn: SignInState
  /** The providers Pi knows and the models it can use now. Null until the host says, and always from a host too old to say. */
  models: ModelsState | null
  /** The user's GitHub as the host reads it through gh. Null until the host says, and always from a host that does not read it. */
  github: GitHubState | null
  /** The MCP servers in Pi's configuration, as the host reads them through Pi, secrets hidden. Null until the host says, and always from a host that does not read them. */
  integrations: IntegrationsState | null
  /** Work mode as the Work screen draws it. Null until the host says, and while hobkin's snapshot has none, as in a view the terminal saved. */
  work: WorkState | null
  /** The canvas panel hobkin opened. Null until the host says, and always from a host that has none. */
  canvas: CanvasState | null
  /** Each durable hobkin's canvas, by its id. Null until the host says, and always from a host that has none. */
  canvases: Record<string, CanvasState> | null
  /** The latest one-shot instruction hobkin gave the window (a move or a draft). The window carries out each id once. */
  nudge: Nudge | null
  appearance: AppearanceRequest | null
  /** The custom themes the host keeps, newest first. Null until the host says, and always from a host from before them. */
  themes?: KeptThemes | null
  /** TLA+ proof runs, running and recent, and the tools found. Null until the host says, and always from a host from before them. */
  proofs?: ProofsState | null
  /** hobkin's snapshot, by top-level key. */
  snapshot: WireSnapshot
  /** The stored conversation. */
  messages: readonly ChatMessage[]
  /** Replies being written that hobkin has not stored yet. */
  live: LiveTurn | null
  /** The question hobkin is asking now. */
  question: PendingQuestion | null
  /** Goes up each time the whole state was replaced, as after a reconnect or when another owner let go of the home. */
  epoch: number
  /** This host's hello said it takes the window's timings (`#shared/protocol/timings.ts`). Never from a host from before them, and forgotten when the connection goes. */
  timings?: boolean
  /** This host's hello said it takes `watch` (`WatchMessage`), so the window tells it which jobs it shows whole. Forgotten when the connection goes. */
  watching?: boolean
}

export const initialHostState: HostState = {
  link: 'connecting',
  snapshotReady: false,
  home: null,
  model: null,
  owner: null,
  signIn: { status: 'unknown' },
  models: null,
  github: null,
  integrations: null,
  work: null,
  canvas: null,
  canvases: null,
  nudge: null,
  appearance: null,
  themes: null,
  proofs: null,
  snapshot: {},
  messages: [],
  live: null,
  question: null,
  epoch: 0,
  timings: false,
  watching: false,
}

function applyState(state: HostState, message: StateMessage): HostState {
  // A reset replaces what was held in one step, so a reconnect never shows an empty conversation in between.
  const base = message.reset ? { snapshot: {}, messages: [] } : state
  const snapshot: WireSnapshot = { ...base.snapshot, ...message.set }
  for (const key of message.unset ?? []) delete snapshot[key]
  // Job activity comes as steps. A host from before them sends the whole key in `set`, applied just above. The main
  // chat's steps go to its own key, so the jobs are copied once, and not at all for a message of main steps alone.
  if (message.activity) {
    const steps = message.activity
    const forMain = (step: (typeof steps)[number]) => step.job === MAIN_ACTIVITY
    const hasMainSteps = steps.some(forMain)
    const mainSteps = hasMainSteps ? steps.filter(forMain) : []
    const jobSteps = hasMainSteps ? steps.filter((step) => !forMain(step)) : steps

    const jobs = snapshot.jobActivity as JobActivity | undefined
    if (jobSteps.length > 0 || !jobs) snapshot.jobActivity = applyActivity(jobs ?? {}, jobSteps)

    if (hasMainSteps) {
      const heldMain: JobActivity = snapshot.mainActivity ? { [MAIN_ACTIVITY]: snapshot.mainActivity } : {}
      const main = applyActivity(heldMain, mainSteps)[MAIN_ACTIVITY]
      if (main) snapshot.mainActivity = main
      else delete snapshot.mainActivity
    }
  }
  const messages = message.messages ? applyMessageOps(base.messages, message.messages) : base.messages

  return {
    ...state,
    snapshot,
    snapshotReady: message.reset ? true : state.snapshotReady,
    messages,
    owner: message.owner ?? state.owner,
    signIn: message.signIn ?? state.signIn,
    models: message.models ?? state.models,
    // A host that reads GitHub sends the slice with every reset, so one without it does not read GitHub.
    github: message.github ?? (message.reset ? null : state.github),
    // The same for Pi's MCP servers: a host that reads them sends the slice with every reset.
    integrations: message.integrations ?? (message.reset ? null : state.integrations),
    // Work mode comes whole with every reset that has it, and null once hobkin's snapshot has none.
    work: message.work !== undefined ? message.work : message.reset ? null : state.work,
    canvas: message.canvas ?? (message.reset ? null : state.canvas),
    canvases: message.canvases ?? (message.reset ? null : state.canvases),
    // A one-shot instruction arrives only when it is new. A reset clears it, so a reconnect never replays a move or draft.
    nudge: message.nudge ?? (message.reset ? null : state.nudge),
    appearance: message.appearance !== undefined ? message.appearance : message.reset ? null : state.appearance,
    // A host that keeps themes sends the list with every reset, so one without it keeps none.
    themes: message.themes ?? (message.reset ? null : (state.themes ?? null)),
    // Proof runs come whole with every reset from a host that reads them, so one without them has none.
    proofs: message.proofs ?? (message.reset ? null : (state.proofs ?? null)),
    live: settleLive(message.reset ? null : state.live, messages, snapshot.busy),
    epoch: message.reset ? state.epoch + 1 : state.epoch,
  }
}

/** The ids of the stored conversation, made once per list: a reply's every word reads them. */
const storedIds = new WeakMap<readonly ChatMessage[], readonly string[]>()

function idsOf(messages: readonly ChatMessage[]): readonly string[] {
  const held = storedIds.get(messages)
  if (held) return held

  const ids = messages.map(({ id }) => id)
  storedIds.set(messages, ids)
  return ids
}

export function applyHostMessage(state: HostState, message: HostMessage): HostState {
  switch (message.type) {
    case 'hello':
      // What is on screen stays until the state that follows replaces it. A reply half written and a question
      // asked by the last host are dropped: this host says what it is writing and asking.
      return {
        ...state,
        link: 'open',
        snapshotReady: false,
        home: message.home,
        model: message.model,
        owner: message.owner,
        signIn: message.signIn,
        models: message.models ?? null,
        live: null,
        question: null,
        timings: message.timings === true,
        watching: message.watch === true,
      }
    case 'state':
      return applyState(state, message)
    case 'turn':
      return { ...state, live: applyTurnEvent(state.live, message.event, idsOf(state.messages)) }
    case 'ask':
      return { ...state, question: message.question }
    default:
      return state
  }
}

/** The connection changed. A host that was never found is `none`, however often the UI looks for it. */
export function applyLink(state: HostState, link: Link): HostState {
  if (state.link === link) return state
  // Without the host nothing is being written and nobody waits for an answer.
  // The next host says again what it takes, in its own hello.
  return link === 'open' ? { ...state, link } : { ...state, link, live: null, question: null, timings: false, watching: false }
}

/** `sentAt` for a send, only to a host that said it takes it: a host from before refuses an argument it does not know. */
export const sentAtArg = (state: Pick<HostState, 'timings'>, sentAt: number): { sentAt?: number } => (state.timings === true ? { sentAt } : {})

/**
 * Whether Pi can use a model, so the conversation can go on. A host too old to send the models slice says it with
 * the sign-in state instead.
 */
export const canUseModel = (state: Pick<HostState, 'models' | 'signIn'>): boolean =>
  state.models ? state.models.models.length > 0 : state.signIn.status === 'signed-in'

/** Whether hobkin is running in this host and takes commands. */
export const isLive = (state: Pick<HostState, 'link' | 'owner'>): boolean => state.link === 'open' && state.owner?.state === 'live'

import { applyActivity, MAIN_ACTIVITY, type JobActivity } from '#shared/protocol/activity.ts'
import type { CanvasState } from '#shared/protocol/canvas.ts'
import type { IntegrationsState } from '#shared/integrations/wire.ts'
import type { GitHubState } from '#shared/protocol/github.ts'
import { applyMessageOps } from '#shared/protocol/message-ops.ts'
import type { HostMessage, OwnerState, StateMessage } from '#shared/protocol/messages.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
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
}

export const initialHostState: HostState = {
  link: 'connecting',
  home: null,
  model: null,
  owner: null,
  signIn: { status: 'unknown' },
  models: null,
  github: null,
  integrations: null,
  work: null,
  canvas: null,
  snapshot: {},
  messages: [],
  live: null,
  question: null,
  epoch: 0,
}

function applyState(state: HostState, message: StateMessage): HostState {
  // A reset replaces what was held in one step, so a reconnect never shows an empty conversation in between.
  const base = message.reset ? { snapshot: {}, messages: [] } : state
  const snapshot: WireSnapshot = { ...base.snapshot, ...message.set }
  for (const key of message.unset ?? []) delete snapshot[key]
  // Job activity comes as steps. A host from before them sends the whole key in `set`, applied just above.
  if (message.activity) {
    const held = { ...(snapshot.jobActivity as JobActivity | undefined), ...(snapshot.mainActivity ? { [MAIN_ACTIVITY]: snapshot.mainActivity } : {}) }
    const { [MAIN_ACTIVITY]: main, ...jobs } = applyActivity(held, message.activity)
    snapshot.jobActivity = jobs
    if (main) snapshot.mainActivity = main
    else delete snapshot.mainActivity
  }
  const messages = message.messages ? applyMessageOps(base.messages, message.messages) : base.messages

  return {
    ...state,
    snapshot,
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
    live: settleLive(message.reset ? null : state.live, messages, snapshot.busy),
    epoch: message.reset ? state.epoch + 1 : state.epoch,
  }
}

export function applyHostMessage(state: HostState, message: HostMessage): HostState {
  switch (message.type) {
    case 'hello':
      // What is on screen stays until the state that follows replaces it. A reply half written and a question
      // asked by the last host are dropped: this host says what it is writing and asking.
      return {
        ...state,
        link: 'open',
        home: message.home,
        model: message.model,
        owner: message.owner,
        signIn: message.signIn,
        models: message.models ?? null,
        live: null,
        question: null,
      }
    case 'state':
      return applyState(state, message)
    case 'turn':
      return { ...state, live: applyTurnEvent(state.live, message.event, state.messages.map(({ id }) => id)) }
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
  return link === 'open' ? { ...state, link } : { ...state, link, live: null, question: null }
}

/**
 * Whether Pi can use a model, so the conversation can go on. A host too old to send the models slice says it with
 * the sign-in state instead.
 */
export const canUseModel = (state: Pick<HostState, 'models' | 'signIn'>): boolean =>
  state.models ? state.models.models.length > 0 : state.signIn.status === 'signed-in'

/** Whether hobkin is running in this host and takes commands. */
export const isLive = (state: Pick<HostState, 'link' | 'owner'>): boolean => state.link === 'open' && state.owner?.state === 'live'

import type { StartupForceReceipt, StartupTarget } from '../commands/registry.ts'
import type { AppearanceRequest } from './appearance.ts'
import type { KeptThemes } from './theme-history.ts'
import type { ActivitySteps } from './activity.ts'
import type { IntegrationsState } from '../integrations/wire.ts'
import type { CanvasState } from './canvas.ts'
import type { GitHubState } from './github.ts'
import type { MessageOp } from './message-ops.ts'
import type { ModelsState } from './models.ts'
import type { Nudge } from './nudge.ts'
import type { PendingQuestion } from './question.ts'
import type { ProofsState } from './proofs.ts'
import type { SignInState } from './signin.ts'
import type { WireSnapshot } from './snapshot.ts'
import type { ShownMessage } from './timings.ts'
import type { TurnEvent } from './turn.ts'
import type { WorkState } from './work.ts'

/** JSON messages over one WebSocket. See _specs/000-product/architecture.md, "Protocol between UI and host". */
export const PROTOCOL_VERSION = 1

/** What hobkin takes as images in one message. */
export interface ImageLimits {
  /** How many images one message holds. */
  images: number
  /** The largest image, in bytes. */
  imageBytes: number
}

/** Who holds the home. One process owns a home at a time. */
export type OwnerState = { startup?: { target: StartupTarget | null; receipt: StartupForceReceipt | null } } & (
  /** hobkin is still opening. */
  | { state: 'opening' }
  /** This host owns the home and hobkin is running in it. `limits` are hobkin's own, so the UI can refuse a file before sending it. */
  | { state: 'live'; limits: ImageLimits }
  /** hobkin could not open, or another process holds the home's lock and the host looks again until it lets go. */
  | { state: 'failed'; message: string }
)

export interface HelloMessage {
  type: 'hello'
  protocol: typeof PROTOCOL_VERSION
  /** The folder hobkin's data lives in. */
  home: string
  /** `scripted` answers with canned replies and spends nothing. */
  model: 'scripted' | 'live'
  owner: OwnerState
  signIn: SignInState
  /** The providers Pi knows and the models it can use now. Null until Pi has said. */
  models: ModelsState | null
  /** Where the user left off. Filled by `014-continuity`. */
  viewState: unknown
  /** This host takes the window's timings (`timings.ts`): `sentAt` on a send, and `shown`. A host from before says nothing and is sent neither. */
  timings?: true
}

export interface StateMessage {
  type: 'state'
  /** Goes up by one with every state message of a connection's host. */
  rev: number
  /** Forget everything held so far before applying this message. */
  reset?: true
  /** Top-level keys of hobkin's snapshot that changed, with their new values. */
  set?: WireSnapshot
  /** Keys that left the snapshot. */
  unset?: string[]
  /** Changes to the conversation. */
  messages?: MessageOp[]
  /** Changes to the jobs' activity (`jobActivity`), a job and an entry at a time. A host from before this sends the whole key in `set`. */
  activity?: ActivitySteps
  owner?: OwnerState
  signIn?: SignInState
  /** The whole models slice, whenever any of it changed. */
  models?: ModelsState
  /** The user's GitHub as the host reads it through gh, whole, whenever any of it changed and with every reset. */
  github?: GitHubState
  /** The MCP servers in Pi's configuration with their state, secrets hidden, whole, whenever any of it changed and with every reset. */
  integrations?: IntegrationsState
  /** Work mode as the Work screen draws it, whole, whenever any of it changed and with every reset. Null once hobkin's snapshot has none. */
  work?: WorkState | null
  /** The canvas panel: open or closed and the page it shows, whole, whenever it changed and with every reset. */
  canvas?: CanvasState
  /** Each durable hobkin's canvas, by the hobkin's id, whole, whenever any changed and with every reset. `canvas` stays the main hobkin's. */
  canvases?: Record<string, CanvasState>
  /** A one-shot instruction for the window (navigate or draft), sent only when it is new, never on a reset. */
  nudge?: Nudge
  /** The latest validated theme request, sent on changes and resets. */
  appearance?: AppearanceRequest | null
  /** The kept custom themes, whole, whenever they changed and with every reset. Left out by a host from before them. */
  themes?: KeptThemes
  /** TLA+ proof runs: the ones running and the 20 most recent, whole, at most twice a second per run, and with every reset. Left out by a host from before them. */
  proofs?: ProofsState
}

export interface TurnMessage {
  type: 'turn'
  /** Goes up by one with every event, so a gap shows. */
  seq: number
  event: TurnEvent
}

/** The question hobkin is asking now, or null once it is answered, put off or timed out. Sent on every change and to each new connection. */
export interface AskMessage {
  type: 'ask'
  question: PendingQuestion | null
}

export interface CommandMessage {
  type: 'command'
  /** Chosen by the sender. The result carries it back. */
  id: string
  name: string
  args?: unknown
}

export type CommandFailure = 'unknown-command' | 'invalid-arguments' | 'unavailable' | 'failed'

export type ResultMessage =
  | { type: 'result'; id: string; ok: true; value: unknown }
  | { type: 'result'; id: string; ok: false; error: { code: CommandFailure; message: string } }

/** What the user is doing, for hobkin's presence rules. */
export interface PresenceMessage {
  type: 'presence'
  /** The window has focus. */
  focused: boolean
  /** The message input holds text. */
  typing: boolean
}

export type HostMessage = HelloMessage | StateMessage | TurnMessage | AskMessage | ResultMessage
export type ClientMessage = CommandMessage | PresenceMessage | ShownMessage

/** Close codes the host uses. 4000 to 4999 are free for applications. */
export const CLOSE = {
  /** The message was not valid JSON or not a known message. */
  badMessage: 4400,
  /** The host is shutting down. */
  hostClosing: 4410,
} as const

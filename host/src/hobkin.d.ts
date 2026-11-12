/**
 * The parts of hobkin the host calls, typed here because hobkin ships plain JavaScript.
 * Paths and signatures are those of `~/Poetry/hobkin` at commit a78669a. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/application.mjs' {
  import type { ExecutionTarget, StopExecutionArgs, StopExecutionReceipt } from '#shared/commands/registry.ts'
  import type { StopControlTarget } from '#shared/protocol/snapshot.ts'

  export interface HobkinSnapshot {
    messages?: unknown[]
    reports?: unknown[]
    presentation?: { hiddenMessageIds?: string[] }
    stopControls?: { targets: StopControlTarget[] }
    savedAt?: string
    [key: string]: unknown
  }

  /** What hobkin asks the user. `whenQuiet` questions wait for nobody and may be skipped. */
  export interface QuestionRequest {
    /** Trusted runtime-only identity of a pending filed decision; independent asks omit it. */
    requestId?: string
    question: string
    choices: { value: string; label: string }[]
    other?: boolean
    whenQuiet?: boolean
    waitMs?: number
    inChat?: boolean
  }

  /** A choice's value, the user's own words, null for none, or undefined when it could not be asked. */
  export type QuestionAnswer = string | { typed: string } | null | undefined

  export interface MainSessionOptions {
    root: string
    config: HobkinConfig
    saved: unknown
    fresh: boolean
    [key: string]: unknown
  }

  /** The surface of Pi's session that the host reads. Pi's own session has much more. */
  export interface MainSession {
    sessionId: string
    subscribe(listener: (event: PiSessionEvent) => void): () => void
    [key: string]: unknown
  }

  export interface PiSessionEvent {
    type: string
    [key: string]: unknown
  }

  export interface HobkinConfig {
    main: { cwd: string; model: string | null; effort: string }
    launcher?: unknown
    [key: string]: unknown
  }

  /** An image hobkin holds as a private file until its message goes. */
  export interface ImageHandle {
    file: string
    mimeType: string
  }

  /** What hobkin reads images from. The terminal app passes the system clipboard. */
  export interface ClipboardSource {
    getImage(): Promise<Uint8Array | null | undefined>
    getText(): Promise<string>
    getFilePaths?(): Promise<string[]>
  }

  export interface MainStartup {
    token: string
    fresh: boolean
    child: { closed: Promise<unknown>; force(): unknown } | null
    closed: boolean
    done: boolean
    installed: boolean
    error: unknown
    signal: AbortSignal
    cancel(): void
    settled: Promise<void>
    persistence: import('#shared/commands/registry.ts').StartupForceReceipt['persistence']
  }

  export interface OpenOptions {
    onMainStartup?: (startup: MainStartup) => void
    clipboard?: ClipboardSource
    createMain?: (options: MainSessionOptions) => Promise<MainSession>
    runHarness?: (request: HarnessRequest, options?: unknown) => Promise<unknown>
    sessionDependencies?: unknown
    askQuestion?: (request: QuestionRequest, signal?: AbortSignal) => Promise<QuestionAnswer>
    showDone?: (row?: unknown) => void
    showRow?: (target: { tab: string; report?: unknown }) => void
    presence?: () => { seenAt: number; away: boolean; occupied: boolean }
    onChange?: (snapshot: HobkinSnapshot) => void
    memoryIndex?: object | null
    fetch?: typeof globalThis.fetch
    signal?: AbortSignal
    intervalMs?: number
    now?: () => number | Date
  }

  export interface HarnessRequest {
    id: string
    model?: string
    effort?: string
    prompt?: string
    signal?: AbortSignal
    [key: string]: unknown
  }

  export class HobkinApplication {
    static open(root: string, options?: OpenOptions): Promise<HobkinApplication>
    snapshot: HobkinSnapshot
    /** The configuration hobkin opened with. Its runtime holds the same object, and reconnects with it. */
    config: HobkinConfig
    runtime: {
      /** The folder the home's data is in. */
      directory: string
      /** The main Pi session: in this process, or a child process behind a launcher. */
      main: unknown
      /** Read-only persisted run metadata, including native Pi job ownership. */
      state(): Promise<{ runs: Record<string, { kind?: string; harness?: string; harnessId?: string; legacy?: boolean; result?: { sessionId?: string | null } }> }>
      /** Resolves once no turn and no run is under way. */
      idle(): Promise<void>
      /** Gives the main session a message as it is, with none of hobkin's notes ahead of it. */
      send(text: string, id?: string, images?: unknown[]): Promise<{ id: string; queued?: boolean }>
    }
    moods: { react(moment: { event: string; [key: string]: unknown }): void }
    /** Resolves when the turn is accepted, not when it ends. During a turn the message steers it. */
    send(text: string, report?: unknown, images?: ImageHandle[]): Promise<{ id: string; queued?: boolean }>
    messageImage(args: { sessionId: string; messageId: string; ordinal: number }): { mimeType: string; data: string } | null
    /** Takes the image on the clipboard into the draft. With no `image`, `notice` says why not. */
    pasteImage(): Promise<{ image?: ImageHandle; notice?: string; tone?: string }>
    /** Deletes images taken into the draft and not sent. */
    dropImages(images: ImageHandle[]): void
    /** What the user sent that the agent never read, or null when no turn was running. */
    interrupt(): Promise<string[] | null>
    stopExecution(args: Omit<StopExecutionArgs, 'target'> & Omit<ExecutionTarget, 'home' | 'epoch'>): Promise<
      Omit<StopExecutionReceipt, 'target'> & { target: Omit<ExecutionTarget, 'home' | 'epoch'> }
    >
    /** Starts a fresh main conversation. The old transcript stays on disk. */
    reset(): Promise<{ sessionId: string; sessionFile: string }>
    /** Turns learning from outcomes on or off, and says which it is now. */
    toggleLearning(): Promise<{ enabled: boolean }>
    recordReportRead(read: { id: string; dwellMs: number }): void
    refresh(): Promise<HobkinSnapshot>
    close(options?: { letFinish?: boolean }): Promise<void>
  }

}

declare module 'hobkin/src/cli/pi-session.mjs' {
  import type { HobkinConfig, MainSession, MainSessionOptions } from 'hobkin/src/cli/application.mjs'

  export interface PiSessionDependencies {
    isolatedMain?: boolean; scriptedMain?: boolean; deferExtensionBinding?: boolean; recoverScriptedHistory?: boolean
    agentDir?: string; modelRuntime?: unknown
    createSession?: (options: Record<string, unknown>) => Promise<{ session: unknown }>
    clientBridge?: { tool: unknown; extensionPath: string }
    spawnProcess?: (command: string, args: readonly string[], options: import('node:child_process').SpawnOptions) => import('node:child_process').ChildProcess
  }
  export function openConversation(options: { root: string; config: HobkinConfig; file: string; expected: unknown }, dependencies: PiSessionDependencies): Promise<{ session: MainSession; services: Record<string, unknown> }>

  /**
   * `dependencies` is the seam hobkin's own tests use: a session factory, an agent folder and a model runtime of their own.
   * `isolatedMain` captures a child before SDK work; configured launchers retain precedence. Recovery stays child-only.
   * With `createSession` and no `modelRuntime`, hobkin opens no runtime and does not apply the configured model.
   */
  export function openPiSession(
    options: MainSessionOptions,
    dependencies?: PiSessionDependencies,
  ): Promise<MainSession>
}

declare module 'hobkin/src/cli/main-session-child.mjs' {
  import type { openConversation } from 'hobkin/src/cli/pi-session.mjs'
  export function runMainSessionChild(channel: NodeJS.Process, dependencies: { openSession: typeof openConversation }): Promise<void>
}

declare module 'hobkin/src/cli/bridge.mjs' {
  export interface BridgeContext {
    mode: string
    ui: { input(title: string, request: string, options: { signal?: AbortSignal }): Promise<string | undefined>; setStatus(key: string, value: string): void }
  }
  export const BRIDGE: string
  export function callBridge<T>(ctx: BridgeContext, request: unknown, signal?: AbortSignal): Promise<T>
  export function serveBridge(request: string, dependencies: { tools: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown>
}

declare module 'hobkin/src/cli/checks.mjs' {
  export function scheduleDefinition(schedule: Record<string, unknown>): string
}

declare module 'hobkin/src/cli/view.mjs' {
  /** Hides messages from the conversation for good, as `/clear` does. hobkin's own conversation keeps them. */
  export function savePresentationState(root: string, messageIds: string[]): { version: 1; hiddenMessageIds: string[] }
}

declare module 'hobkin/src/cli/paste-image.mjs' {
  /** How many images one message holds. */
  export const MAX_IMAGES: number
  /** The largest image hobkin takes, in bytes, before it shrinks it to send. */
  export const MAX_PASTE_BYTES: number
  /** What goes out when a message is only pictures, because a model turn needs words. */
  export const IMAGE_ONLY_TEXT: string
}

declare module 'hobkin/src/cli/decisions.mjs' {
  /** A question on file. `shown` turns true once it has had its moment on screen. */
  export interface Decision {
    id: string
    question: string
    choices: { value: string; label: string }[]
    from?: string
    tldr?: string
    recommended?: string | null
    why?: string | null
    shown?: boolean
  }

  /** What still waits for the user, oldest first. */
  export function openDecisions(root: string): Decision[]

  /** Files a question for the user, as `hobkin decide` does. Nothing waits for the answer. */
  export function fileDecision(
    root: string,
    decision: {
      from?: string
      question: string
      tldr?: string
      choices: { value: string; label: string }[]
      recommended?: string
      why?: string
      answerTo?: { kind: string; [key: string]: unknown }
    },
    now?: number,
  ): { id: string }
}

declare module 'hobkin/src/cli/migration/admission.mjs' {
  /** The folder a home's data is in: the home itself, or the data folder of a home that was upgraded in place. */
  export function resolveDataRoot(root: string): string
}

declare module 'hobkin/src/cli/config.mjs' {
  import type { HobkinConfig } from 'hobkin/src/cli/application.mjs'

  /** Creates the home when it has no `config.json`, and otherwise returns its configuration unchanged. */
  export function initialize(root: string, options?: { cwd?: string; now?: string; legacySources?: string[] }): HobkinConfig
  export function setTelemetryUpload(root: string, enabled: boolean): { enabled: boolean }
  /** On unless the home turned it off. While on, hobkin enrolls the home with its server and sends usage. */
  export function telemetryUploadEnabled(root: string): boolean
  /** Writes JSON whole under another name and moves it into place, private to the user. */
  export function atomicJson(file: string, value: unknown): void
  /** The home's configuration, checked. */
  export function loadConfig(root: string): HobkinConfig
}

declare module 'hobkin/src/cli/settings.mjs' {
  export interface Binding {
    model: string | null
    effort: string
  }

  export interface SettingsUpdate {
    scope: string
    /** Set when the targets refused the request before anything was written. */
    error?: string
    persisted: {
      status: 'complete' | 'partial' | 'failed' | 'unchanged'
      settings?: { main?: Binding; error?: string }
      failed?: { target: string; error: string }
    }
    activeRuntime: { status: 'verified' | 'unverified' | 'unchanged'; effective?: Binding; error?: string; reason?: string }
  }

  /**
   * What hobkin's `model_settings` tool runs: checks the model against Pi's catalog and credentials, saves the
   * choice in `config.json`, then hands it to `applyCurrent` for the open conversation and says what that observed.
   */
  export function updateSettings(
    root: string,
    request: { scope: 'main'; model?: string; effort?: string },
    options?: { modelRuntime?: unknown; applyCurrent?: (choice: { model?: unknown; effort?: string }) => Promise<Binding> },
  ): Promise<SettingsUpdate>
}

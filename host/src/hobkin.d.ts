/**
 * The parts of hobkin the host calls, typed here because hobkin ships plain JavaScript.
 * Paths and signatures are those of `~/Poetry/hobkin` at commit a78669a. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/application.mjs' {
  import type { ExecutionTarget, StopExecutionArgs, StopExecutionReceipt } from '#shared/commands/registry.ts'
  import type { HobkinConversation, HobkinEngine, HobkinReach, HobkinSummary } from '#shared/protocol/hobkins.ts'
  import type { StopControlTarget } from '#shared/protocol/snapshot.ts'

  /** The durable hobkins (034-durable-hobkins). A refusal is a thrown Error with a plain sentence. */
  export interface DurableHobkins {
    /** With no `text` it starts waiting, and `run` is null: its first turn is the first message sent to it. */
    start(args: { cwd: string; engine: HobkinEngine; text?: string; title?: string }): Promise<{ id: string; run: string | null }>
    /** `sentAt` is when the user sent the words, on the window's clock, for the timing of the turn. */
    say(id: string, args: { text: string; noteId?: string; sentAt?: number }): Promise<{ started: boolean; queued: boolean; run: string }>
    end(id: string): Promise<{ ok: true }>
    rename(id: string, title: string): Promise<HobkinSummary>
    /** The hobkins named only by their first message, each with the words a better title is made from. */
    toTitle(): Promise<{ id: string; words: string[] }[]>
    /** A title made for it, taken once and never over a name the user gave. Answers with the hobkin as it is now. */
    retitle(id: string, title: string): Promise<HobkinSummary>
    seen(id: string): Promise<{ ok: true }>
    /** The window says this hobkin's page is on screen. Absent in a runtime from before. */
    pageShown?(id: string): Promise<{ ok: true }>
    /** Absent in a runtime from before a hobkin's model could change from its message box. */
    changeEngine?(id: string, change: { model?: string; effort?: string }): Promise<{
      engine: { kind: 'pi'; model: string; effort: string }
      turn: null | { run: string; took: true; model: string | null; effort: string | null } | { run: string; took: false; reason: string }
    }>
    read(id: string): Promise<HobkinConversation>
    /**
     * The main hobkin's message to one, never the user's words. While it waits they start its next turn, recorded as
     * from the main hobkin; while it works they wait for that turn to end (`queued`, and no `run` yet). Absent in a
     * runtime from before messages between hobkins.
     */
    tell?(id: string, args: { text: string }): Promise<{ started: boolean; queued: boolean; run: string | null }>
    /** Every durable hobkin the main hobkin can message, newest first. */
    reach?(): Promise<{ hobkins: HobkinReach[] }>
  }

  export interface HobkinSnapshot {
    hobkins?: HobkinSummary[]
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
    /** Whether the harness given takes a request to start a durable hobkin's process ahead of its turn. hobkin's own does. */
    harnessWarms?: boolean
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

  export interface OwnedLifecycle {
    register(options: {
      id: string
      binding: {
        cwd: string
        prompt: string
        model: string
        effort: string
        role: 'theme'
        parentRole: 'theme'
      }
      allowHelpers: true
      beforeSpawn: () => boolean
      customStyle: (request: unknown, signal: AbortSignal) => Promise<unknown>
    }): {
      request(request: {
        action: 'spawn'
        name: string
        allowHelpers: false
      }): unknown
      join(): Promise<unknown>
      cancel(): Promise<{ confirmed: boolean }>
    }
    snapshot(id: string): { status: string }[] | null
  }

  export class HobkinApplication {
    static open(root: string, options?: OpenOptions): Promise<HobkinApplication>
    snapshot: HobkinSnapshot
    /** Absent in a runtime from before durable hobkins. */
    hobkins?: DurableHobkins
    /** The configuration hobkin opened with. Its runtime holds the same object, and reconnects with it. */
    config: HobkinConfig
    runtime: {
      ownedLifecycle: OwnedLifecycle
      /** The folder the home's data is in. */
      directory: string
      /** The main Pi session: in this process, or a child process behind a launcher. */
      main: unknown
      /** Read-only persisted run metadata, including native Pi job ownership. */
      state(): Promise<{ runs: Record<string, { kind?: string; harness?: string; harnessId?: string; scheduleId?: string; title?: string; status?: string; legacy?: boolean; result?: { sessionId?: string | null } }> }>
      /** Resolves once no turn and no run is under way. */
      idle(): Promise<void>
      /** Absent in a runtime from before an agent could change its model while it works. Answers with what Pi holds now. */
      changeRun?(runId: string, change: { model?: string; effort?: string }): Promise<{ model: string | null; effort: string | null }>
      /** Gives the main session a message as it is, with none of hobkin's notes ahead of it. */
      send(text: string, id?: string, images?: unknown[]): Promise<{ id: string; queued?: boolean }>
    }
    moods: { react(moment: { event: string; [key: string]: unknown }): void }
    /** Resolves when the turn is accepted, not when it ends. During a turn the message steers it. `sentAt` is when the user sent it, on the window's clock. */
    send(text: string, report?: unknown, images?: ImageHandle[], timing?: { sentAt: number }): Promise<{ id: string; queued?: boolean }>
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

declare module 'hobkin/src/cli/stay-awake.mjs' {
  /** Starts `caffeinate -i -s -w <pid>` on a Mac, which ends with that process. */
  export function stayAwake(options?: { platform?: NodeJS.Platform; pid?: number }): void
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

declare module 'hobkin/src/cli/profile.mjs' {
  /** What `profile.json` holds. A field is left out until the user says it. */
  export interface SavedProfile {
    name?: string
    callMe?: string
    email?: string
    computer?: 'personal' | 'work'
  }

  /** Who the user said they are. A broken file reads as empty. */
  export function readProfile(root: string): SavedProfile
  /** One field, by its word in `hobkin profile`. Throws with a plain sentence when the value is refused. */
  export function setProfile(root: string, field: 'name' | 'call' | 'email' | 'computer', value: string): SavedProfile
  /** Several fields in one write, or none when one is refused. */
  export function updateProfile(root: string, change: Partial<Record<'name' | 'call' | 'email' | 'computer', string>>): SavedProfile
}

declare module 'hobkin/src/cli/setup-facts.mjs' {
  /** What the user answered in the app's setup, as hobkin puts it in front of its directions. */
  export interface SetupFact {
    about: string
    said: string
  }
  export const SETUP_FACTS_MAX: number
  /** The most `about` or `said` may hold. Each is one line. */
  export const SETUP_TEXT_MAX: number
  /** What was saved. A broken file reads as none. */
  export function readSetupFacts(root: string): { facts: SetupFact[] }
  /** Replaces every fact in one write. Throws with a plain sentence, and writes nothing, for a fact it refuses or too many. */
  export function writeSetupFacts(root: string, facts: SetupFact[]): { facts: SetupFact[] }
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

declare module 'hobkin/src/cli/events.mjs' {
  /** Appends one facts-only event to the home's log under `runtime/events`. A write problem is swallowed. */
  export function recordEvent(root: string, type: string, facts?: Record<string, unknown>, now?: number): void
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
  /** Throws a plain sentence for a configuration hobkin would refuse. Returns the checked configuration. */
  export function validateConfig(config: unknown, options?: { allowLegacyHarness?: boolean }): HobkinConfig
}

declare module 'hobkin/src/cli/launcher.mjs' {
  /** Throws a plain sentence for a launcher hobkin would refuse. */
  export function validateLauncher(launcher: unknown): void
  /** The program and arguments that run Pi with `args`: through the launcher when there is one, else `pi`. Validates it first. */
  export function piCommand(launcher: unknown, args: readonly string[]): { command: string; args: string[] }
  /** The environment Pi runs in: the launcher's own additions, or hobkin's offline defaults without one. */
  export function piEnvironment(launcher: unknown): NodeJS.ProcessEnv
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

  /** A tier for delegated work, one of hobkin's four (`src/cli/tiers.mjs`). */
  type TierName = 'fast' | 'mid' | 'high' | 'max'
  type TierEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

  /** The chat's model, every tier as it runs now (its own model and effort, or whose it follows), and the tier of each review role. */
  export interface TierSettings {
    main: { model: string | null; effort: TierEffort }
    tiers: Record<TierName, { model: string | null; effort: TierEffort; follows: 'main' | 'background' | null }>
    review: { reviewer: TierName; quick: TierName }
  }

  export function readTiers(root: string): TierSettings

  /** Saves tiers and review tiers in one write, or throws and saves nothing. A tier given null follows again. */
  export function updateTiers(
    root: string,
    change: { tiers?: Partial<Record<TierName, { model: string; effort: TierEffort } | null>>; review?: Partial<TierSettings['review']> },
    options?: { modelRuntime?: unknown },
  ): Promise<TierSettings>
}

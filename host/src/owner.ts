import { existsSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HobkinApplication, HobkinSnapshot, MainSession, MainSessionOptions, OpenOptions, PiSessionEvent } from 'hobkin/src/cli/application.mjs'
import type { Decision } from 'hobkin/src/cli/decisions.mjs'
import type { OwnerState } from '#shared/protocol/messages.ts'
import type { WireSnapshot } from '#shared/protocol/snapshot.ts'
import { loadPiCodingAgent, loadPiModelPick, type PiModelSettings } from './pi.ts'
import { CLIENT_TOOL } from './client-tool.ts'
import { createScriptedModel, SCRIPTED_MODEL, type ScriptedOptions, type SessionTool } from './scripted.ts'

/** What hobkin says when another process holds the home's lock (`src/cli/runtime.mjs`). */
const LOCKED = 'Hobkin is already running for this home.'
/** What the owner says while that lasts. */
const HELD = 'Another process holds this home. hobkin opens it here once that process stops.'
/** hobkin's lock is this folder, and it goes stale when its owner stops refreshing it. */
const LOCK_STALE_MS = 300000
const RETRY_MS = 1500

export interface OwnerOptions {
  root: string
  /** Use the real model. Otherwise every model call and every job is scripted. */
  live: boolean
  /** The root is the home the terminal app uses. */
  real: boolean
  scripted?: ScriptedOptions
  retryMs?: number
  /** Called whenever the owner state or the snapshot changed. */
  onChange: () => void
  /** Each event of the main session, as Pi emitted it. */
  onSessionEvent: (event: PiSessionEvent) => void
  /** hobkin's other calls into its front end: questions, presence, what to show, and where images come from. */
  frontEnd?: Pick<OpenOptions, 'askQuestion' | 'presence' | 'showDone' | 'showRow' | 'clipboard'>
  /** Tools the app adds to hobkin's main session, such as `client`. */
  tools?: readonly SessionTool[]
  /** Live only: Pi's model runtime the app already holds, for the main session to share. */
  modelRuntime?: () => Promise<unknown>
}

/** hobkin's only use of `fetch` is its own server: enrolling a home, then sending usage and approved feedback. */
const refuseNetwork: typeof fetch = async () => {
  throw Error("This home sends nothing to hobkin's server.")
}

/**
 * Herdr is not used: every agent runs as a Pi job in the background. pi-extended-teams, which hobkin's Pi sessions
 * load, still has a legacy mode that starts agents in Herdr panes and closes them, and it picks that mode from the
 * `HERDR_*` variables a process inherits. So no home passes them on, the real one included.
 *
 * Every `hobkin` command an agent runs works on the home `HOBKIN_HOME` names, or on `~/.hobkin`. A run that is not
 * the real home, live, is kept to its own home. Both hold for hobkin in this process and for every process it starts.
 */
export function keepToSurroundings({ root, live, real }: { root: string; live: boolean; real: boolean }, env: Record<string, string | undefined> = process.env): void {
  for (const name of Object.keys(env)) {
    if (name.startsWith('HERDR_')) delete env[name]
  }
  if (!(live && real)) env.HOBKIN_HOME = root
}

/** The part of Pi's in-process session that a model choice changes, as hobkin's own `model_settings` tool changes it. */
interface PiMainSession extends MainSession {
  model?: { provider: string; id: string }
  thinkingLevel: string
  setModel?(model: unknown, options: { persist: boolean }): Promise<void>
  setThinkingLevel(level: string, options: { persist: boolean }): void
}

interface PiBranchEntry {
  type: string
  provider?: string
  message?: { role?: string; provider?: string }
}

/** The conversation's latest model, as Pi looks for it when it restores one: its last switch or its last answer. */
function answeredByScript(sessionManager: unknown): boolean {
  const branch = ((sessionManager as { getBranch?: () => PiBranchEntry[] } | undefined)?.getBranch?.() ?? []).toReversed()
  const latest = branch.find((entry) => entry.type === 'model_change' || (entry.type === 'message' && entry.message?.role === 'assistant'))
  return (latest?.type === 'model_change' ? latest.provider : latest?.message?.provider) === SCRIPTED_MODEL.provider
}

/**
 * Takes hobkin's lock on a home and keeps hobkin running in it. One process owns a home at a time: while another
 * holds the lock that is a fault, and this looks again until the lock is free and opens by itself. It never takes
 * a held lock: only hobkin takes one over, once its owner stopped refreshing it.
 */
export class HomeOwner {
  state: OwnerState = { state: 'opening' }
  snapshot: HobkinSnapshot | null = null
  app: HobkinApplication | null = null
  private execution: { app: HobkinApplication; home: string; epoch: string } | null = null
  /** Another process holds the home's lock, and this looks again until it lets go. */
  held = false

  private readonly options: OwnerOptions
  private timer: NodeJS.Timeout | undefined
  private opening: Promise<void> | null = null
  private closed = false
  private decisions: typeof import('hobkin/src/cli/decisions.mjs') | null = null
  /** The main conversation's newest Pi session, and the model runtime it shares with the window. */
  private main: PiMainSession | null = null
  private modelRuntime: unknown = null
  /** What hobkin sends as the words of a message that is only pictures. */
  imageOnlyText = ''

  constructor(options: OwnerOptions) {
    this.options = options
  }

  /** Execution authority belongs only to the currently installed application, not an on-disk owner ID. */
  captureExecution() {
    if (this.closed || !this.app) return this.execution = null
    if (this.execution?.app !== this.app) this.execution = { app: this.app, home: this.options.root, epoch: randomUUID() }
    return this.execution
  }

  wireSnapshot(): (HobkinSnapshot & Pick<WireSnapshot, 'stopControls'>) | null {
    if (!this.snapshot) return null
    const { stopControls, ...snapshot } = this.snapshot
    const captured = this.captureExecution()
    if (!captured || this.snapshot !== captured.app.snapshot || snapshot.connection !== 'connected' || !stopControls) return snapshot
    return { ...snapshot, stopControls: { home: captured.home, epoch: captured.epoch, targets: stopControls.targets } }
  }

  /**
   * A question on file that has not had its moment on screen, found by its words. hobkin asks such a question
   * with its words and choices only, in the same tick it finds it, so the snapshot does not have it yet.
   */
  filedQuestion(question: string): Decision | null {
    if (!this.app || !this.decisions) return null
    try {
      return this.decisions.openDecisions(this.app.runtime.directory).find((decision) => decision.question === question && !decision.shown) ?? null
    } catch {
      // The question is still asked, only without who filed it and why.
      return null
    }
  }

  /**
   * Starts opening, unless hobkin is already open, opening, or waiting for another process to let go.
   * It is safe to ask again whenever something changed that could let hobkin open. The owner state says how it went.
   */
  start(): void {
    if (this.closed || this.app || this.opening || this.held) return
    void this.attempt()
  }

  private attempt(): Promise<void> {
    this.opening ??= this.open().finally(() => {
      this.opening = null
    })
    return this.opening
  }

  private async open(): Promise<void> {
    const { root } = this.options
    try {
      const { HobkinApplication } = await import('hobkin/src/cli/application.mjs')
      const images = await import('hobkin/src/cli/paste-image.mjs')
      this.decisions = await import('hobkin/src/cli/decisions.mjs')
      await this.prepareHome()
      const app = await HobkinApplication.open(root, {
        ...(await this.model()),
        ...this.options.frontEnd,
        onChange: (snapshot) => this.publish(snapshot),
      })
      if (this.closed) return void (await app.close())

      this.app = app
      this.snapshot = app.snapshot
      this.imageOnlyText = images.IMAGE_ONLY_TEXT
      this.state = { state: 'live', limits: { images: images.MAX_IMAGES, imageBytes: images.MAX_PASTE_BYTES } }
    } catch (error) {
      if (this.closed) return
      const message = error instanceof Error ? error.message : String(error)
      this.state = { state: 'failed', message: message === LOCKED ? HELD : message }
      if (message === LOCKED) this.retryLater()
    }
    this.options.onChange()
  }

  /** Where hobkin keeps this home's data. A home upgraded in place keeps it in a folder of its own. */
  private async dataRoot(): Promise<string> {
    const { resolveDataRoot } = await import('hobkin/src/cli/migration/admission.mjs')
    return resolveDataRoot(this.options.root)
  }

  /** A home that does not exist yet is created, as `hobkin init` does. */
  private async prepareHome(): Promise<void> {
    const { root, real } = this.options
    const { initialize, setTelemetryUpload, telemetryUploadEnabled } = await import('hobkin/src/cli/config.mjs')
    // The main agent works in the home itself until the user points it somewhere.
    if (!existsSync(join(await this.dataRoot(), 'config.json'))) initialize(root, { cwd: root })
    // Upload is on unless a home turns it off. A home that is not the real one has no business enrolling with
    // hobkin's server or sending usage to it, whoever made it.
    if (!real && telemetryUploadEnabled(root)) setTelemetryUpload(root, false)
  }

  private async model(): Promise<OpenOptions> {
    const { root, live, real, scripted, tools = [] } = this.options
    // No home passes Herdr's variables on to pi-extended-teams, and only the real home, live, may act on the real home.
    keepToSurroundings({ root, live, real })
    // hobkin enrolls a home with its server on its first tick unless upload is off or the network is taken away.
    const offline = real ? {} : { fetch: refuseNetwork }

    if (live) {
      const [{ openPiSession }, pi, pickModel] = await Promise.all([import('hobkin/src/cli/pi-session.mjs'), loadPiCodingAgent(), loadPiModelPick()])
      // hobkin builds the session as always. The app only adds its tools, through the same seam hobkin's tests use,
      // and passes the model runtime it holds, so a sign-in in the window reaches the session at once.
      // Configured main uses the same captured client callback through the fixed RPC proxy.
      const client = tools.find(tool => tool.name === CLIENT_TOOL)
      const clientBridge = client ? { tool: client, extensionPath: fileURLToPath(new URL('./client-bridge-extension.ts', import.meta.url)) } : undefined
      const modelRuntime = (await this.options.modelRuntime?.()) ?? (await pi.ModelRuntime.create({ allowModelNetwork: false }))
      this.modelRuntime = modelRuntime
      const createSession = async (options: Record<string, unknown>) => {
        // A conversation the scripted model answered last names a model no real Pi has, and Pi would not go on with
        // it. It goes on with the model Pi picks for a new conversation. Any other model Pi cannot restore stays
        // hobkin's to refuse, as in the terminal, because the conversation would go to a provider it never went to.
        const picked = options.model === undefined && pickModel && answeredByScript(options.sessionManager)
        const model = picked ? await pickModel(options.modelRuntime, options.settingsManager as PiModelSettings) : options.model
        return pi.createAgentSession({ ...options, model, customTools: [...((options.customTools as unknown[] | undefined) ?? []), ...tools] })
      }
      return { createMain: this.tapped((options) => openPiSession(options, { modelRuntime, createSession, ...(options.config.launcher && clientBridge ? { clientBridge } : {}) })), memoryIndex: {}, ...offline }
    }
    const model = await createScriptedModel(root, { ...scripted, tools: [...(scripted?.tools ?? []), ...tools] })
    return {
      createMain: this.tapped(model.createMain),
      runHarness: model.runHarness,
      sessionDependencies: model.dependencies,
      // The script spends nothing and reports nothing, not even from the real home.
      fetch: refuseNetwork,
    }
  }

  /** hobkin reduces the main session's events to one word. The host listens to the session itself for the rest. */
  private tapped(createMain: (options: MainSessionOptions) => Promise<MainSession>) {
    return async (options: MainSessionOptions) => {
      const session = await createMain(options)
      this.main = session as PiMainSession
      session.subscribe((event) => {
        try {
          this.options.onSessionEvent(event)
        } catch {
          // A listener of the host can never fail the turn.
        }
      })
      return session
    }
  }

  private publish(snapshot: HobkinSnapshot) {
    if (this.closed || !this.app) return
    this.snapshot = snapshot
    this.options.onChange()
  }

  private async lockIsHeld(): Promise<boolean> {
    const lock = statSync(join(await this.dataRoot(), 'runtime.lock'), { throwIfNoEntry: false })
    return lock !== undefined && Date.now() - lock.mtimeMs < LOCK_STALE_MS
  }

  private retryLater() {
    this.held = true
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.closed) return
      // Looking at the lock is cheap. Opening is tried only once the lock looks free, and hobkin has the last word.
      const look = async () => {
        if (await this.lockIsHeld()) return this.retryLater()
        this.held = false
        await this.attempt()
      }
      void look().catch(() => this.retryLater())
    }, this.options.retryMs ?? RETRY_MS)
    this.timer.unref()
  }

  /**
   * The main conversation's model, chosen the way hobkin's own `model_settings` tool chooses it: hobkin checks it
   * against Pi's catalog and credentials and saves it in `config.json`, and the open conversation goes on with it.
   * Without an open conversation, the next one starts on it.
   */
  async selectModel(model: string, effort?: string): Promise<{ model: string; effort: string; applied: boolean }> {
    const { updateSettings } = await import('hobkin/src/cli/settings.mjs')
    const { app, main: session } = this
    const applyCurrent =
      app && session?.setModel
        ? async (choice: { model?: unknown; effort?: string }) => {
            if (choice.model) await session.setModel!(choice.model, { persist: false })
            if (choice.effort !== undefined) session.setThinkingLevel(choice.effort, { persist: false })
            return { model: session.model ? `${session.model.provider}/${session.model.id}` : null, effort: session.thinkingLevel }
          }
        : undefined
    const modelRuntime = this.modelRuntime ?? (await this.options.modelRuntime?.())
    const result = await updateSettings(this.options.root, { scope: 'main', model, effort }, { modelRuntime, applyCurrent })
    const saved = result.persisted.settings?.main
    if (result.persisted.status !== 'complete' || !saved?.model) {
      throw Error(`hobkin could not save the choice: ${result.error ?? result.persisted.failed?.error ?? result.persisted.status}`)
    }

    if (app) {
      // hobkin reconnects with the configuration it holds, so it learns the choice too, as after its own tool.
      Object.assign(app.config.main, saved)
      await app.refresh()
    } else {
      // A home that could not open on the model it had may open on this one.
      this.start()
    }
    return { model: saved.model, effort: saved.effort, applied: result.activeRuntime.effective?.model === saved.model }
  }

  /** Stops hobkin and releases the home. A turn that is running ends as interrupted. */
  async close(): Promise<void> {
    this.closed = true
    clearTimeout(this.timer)
    await this.opening?.catch(() => {})
    const app = this.app
    this.app = null
    await app?.close()
  }
}

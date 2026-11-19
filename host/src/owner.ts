import { existsSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HobkinApplication, HobkinSnapshot, MainSession, MainSessionOptions, MainStartup, OpenOptions, PiSessionEvent } from 'hobkin/src/cli/application.mjs'
import type { Decision } from 'hobkin/src/cli/decisions.mjs'
import type { StartupForceArgs, StartupForceReceipt, StartupTarget } from '#shared/commands/registry.ts'
import { checkArguments } from '#shared/commands/registry.ts'
import type { OwnerState } from '#shared/protocol/messages.ts'
import type { WireSnapshot } from '#shared/protocol/snapshot.ts'
import type { HostTiers, TiersChange } from '#shared/tiers/tiers.ts'
import { agentHarness, type ClaudeCodeHooks } from './claude-code/agents.ts'
import type { RunFacts } from './claude-code/route.ts'
import { CLIENT_TOOL } from './client-tool.ts'
import { applyHostTiers, readHostTiers } from './tiers.ts'
import { createScriptedModel, type ScriptedOptions, type SessionTool } from './scripted.ts'

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
  /** UI model access when no live main session can provide its own catalog. */
  modelRuntime?: () => Promise<unknown>
  /** Lets a live home run hobkin's other agents on Claude Code where its settings say so (033-claude-code-agents). */
  claudeCode?: ClaudeCodeHooks
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

/** Native RPC binding APIs, with the SDK setters retained for in-process sessions. */
interface PiMainSession extends MainSession {
  modelCatalog?(): Promise<unknown>
  apply?(choice: { model?: unknown; effort?: string }): Promise<import('hobkin/src/cli/settings.mjs').Binding>
  model?: { provider: string; id: string }
  thinkingLevel: string
  setModel?(model: unknown, options: { persist: boolean }): Promise<void>
  setThinkingLevel(level: string, options: { persist: boolean }): void
}

/**
 * Takes hobkin's lock on a home and keeps hobkin running in it. One process owns a home at a time: while another
 * holds the lock that is a fault, and this looks again until the lock is free and opens by itself. It never takes
 * a held lock: only hobkin takes one over, once its owner stopped refreshing it.
 */
interface StartupSlot {
  target: StartupTarget
  runtime?: MainStartup
  child?: MainStartup['child']
  fenced: boolean
  cleanupSettled: boolean
  receipt: StartupForceReceipt | null
  attempts: Map<string, { identity: string; result: Promise<StartupForceReceipt> }>
}

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
  private stopped = false
  private lifecycle = {}
  private startup: StartupSlot
  private decisions: typeof import('hobkin/src/cli/decisions.mjs') | null = null
  /** The main conversation's adopted Pi session. */
  private main: PiMainSession | null = null
  /** What hobkin sends as the words of a message that is only pictures. */
  imageOnlyText = ''

  constructor(options: OwnerOptions) {
    this.options = options
    this.startup = this.newStartup()
  }

  private newStartup(): StartupSlot {
    return { target: { home: this.options.root, epoch: randomUUID(), token: randomUUID(), sessionId: null },
      fenced: false, cleanupSettled: false, receipt: null, attempts: new Map() }
  }

  private startupReceipt(slot: StartupSlot, args: StartupForceArgs): StartupForceReceipt {
    return {
      ...args,
      fence: { status: 'confirmed' },
      closure: {
        status: !slot.child
          ? 'not-created'
          : slot.runtime?.closed
            ? 'confirmed'
            : 'unknown',
      },
      opening: {
        status: slot.runtime?.done || (!slot.runtime && slot.cleanupSettled)
          ? 'settled'
          : 'unknown',
      },
      cleanup: { status: slot.cleanupSettled ? 'settled' : 'unknown' },
      persistence: {
        ...(slot.runtime?.persistence ?? { status: 'unchanged' }),
      },
      detachedCleanup: 'unknown',
      queueRecovery: 'not-applicable',
    }
  }

  private startupInstalled(slot: StartupSlot): boolean {
    return Boolean(slot.cleanupSettled && slot.runtime?.installed && !slot.fenced && this.app && this.main === this.app.runtime.main
      && this.main?.sessionId === (slot.target.sessionId ?? slot.runtime.persistence.sessionId)
      && this.wireSnapshot()?.stopControls?.targets.some(target => target.kind === 'main' && target.canForce))
  }

  wireState(): OwnerState {
    const slot = this.startup
    const runtime = slot.runtime
    const installed = this.startupInstalled(slot)
    const removed =
      installed ||
      runtime?.closed ||
      (slot.fenced && slot.cleanupSettled && !slot.child)
    const target = {
      ...slot.target,
      sessionId: runtime?.persistence.sessionId ?? slot.target.sessionId,
    }

    return {
      ...this.state,
      startup: {
        target: removed || this.closed ? null : target,
        receipt: slot.receipt ? this.startupReceipt(slot, slot.receipt) : null,
      },
    }
  }

  reconnectStartup(): void {
    this.startup.target.epoch = randomUUID()
    this.startup.receipt = null
    this.options.onChange()
  }

  private retainStartup(runtime: MainStartup, lifecycle: object): void {
    const slot = this.startup
    if (
      this.closed ||
      this.lifecycle !== lifecycle ||
      (slot.runtime && slot.runtime !== runtime) ||
      runtime.done ||
      runtime.installed
    ) {
      throw Error('Stale main startup callback.')
    }

    if (!slot.runtime) {
      slot.runtime = runtime
      void runtime.settled.then(() => {
        if (this.startup === slot && !this.closed) this.options.onChange()
      })
    }

    if (runtime.child && slot.child !== runtime.child) {
      if (slot.child) throw Error('Main startup child changed.')
      slot.child = runtime.child
      void runtime.child.closed.then(() => {
        if (this.startup === slot && !this.closed) this.options.onChange()
      })
    }

    if (slot.fenced) {
      runtime.cancel()
      throw Error('Main startup was stopped.')
    }

    this.options.onChange()
  }

  async forceStartup(args: StartupForceArgs): Promise<StartupForceReceipt> {
    const checked = checkArguments('startup.force', args)
    if (!checked.ok) throw Error('Invalid startup Force arguments.')

    const slot = this.startup
    const runtime = slot.runtime
    const target = {
      ...slot.target,
      sessionId: runtime?.persistence.sessionId ?? slot.target.sessionId,
    }
    if (
      this.closed ||
      this.startupInstalled(slot) ||
      Object.keys(target).some(
        key =>
          target[key as keyof StartupTarget] !==
          args.target[key as keyof StartupTarget],
      )
    ) {
      throw Error('Stale main startup authority.')
    }

    const identity = JSON.stringify(target)
    const prior = slot.attempts.get(args.attemptId)
    if (prior) {
      if (prior.identity !== identity) throw Error('Startup attempt identity changed.')
      return prior.result
    }

    slot.fenced = this.stopped = true
    clearTimeout(this.timer)
    runtime?.cancel()
    // Never wait for cancellation, Application.open/close or durable acknowledgment before signaling.
    slot.child?.force()

    const result = (async () => {
      if (slot.child && !runtime?.closed) {
        let timer: NodeJS.Timeout | undefined
        try {
          await Promise.race([
            slot.child.closed,
            new Promise(resolve => {
              timer = setTimeout(resolve, 2000)
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
      }

      if (
        this.closed ||
        this.startup !== slot ||
        slot.target.epoch !== args.target.epoch
      ) {
        throw Error('Stale main startup receipt.')
      }

      slot.receipt = this.startupReceipt(slot, args)
      this.options.onChange()
      return slot.receipt
    })()
    slot.attempts.set(args.attemptId, { identity, result })
    return result
  }

  async resetMain<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.startup
    if (
      !previous.cleanupSettled ||
      (previous.runtime && !previous.runtime.done) ||
      (previous.child &&
        !previous.runtime?.closed &&
        !previous.runtime?.installed)
    ) {
      throw Error('Previous main startup cleanup is unconfirmed.')
    }
    if (this.closed || !this.app) {
      throw Error('Main startup application is unavailable.')
    }

    const slot = this.startup = this.newStartup()
    this.options.onChange()
    try {
      const result = await operation()
      if (!this.closed && !slot.fenced && this.startup === slot && this.app) {
        this.main = this.app.runtime.main as PiMainSession
      }
      return result
    } finally { slot.cleanupSettled = true; this.options.onChange() }
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
    if (this.closed || this.stopped || this.app || this.opening || this.held || (this.startup.child && !this.startup.runtime?.closed)) return
    if (this.startup.cleanupSettled) this.startup = this.newStartup()
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
    const slot = this.startup
    const lifecycle = this.lifecycle = {}
    const check = () => {
      if (this.closed || slot.fenced || this.startup !== slot) {
        throw Error('Main startup was stopped.')
      }
    }

    try {
      check()
      const { HobkinApplication } = await import('hobkin/src/cli/application.mjs')
      const images = await import('hobkin/src/cli/paste-image.mjs')
      this.decisions = await import('hobkin/src/cli/decisions.mjs')
      check()
      await this.prepareHome()
      check()
      const model = await this.model()
      check()
      const app = await HobkinApplication.open(root, {
        ...model,
        onMainStartup: (startup) => this.retainStartup(startup, lifecycle),
        ...this.options.frontEnd,
        onChange: (snapshot) => this.publish(snapshot),
      })
      if (this.closed || slot.fenced) return void (await app.close())

      this.app = app
      this.main = app.runtime.main as PiMainSession
      this.snapshot = app.snapshot
      this.imageOnlyText = images.IMAGE_ONLY_TEXT
      this.state = { state: 'live', limits: { images: images.MAX_IMAGES, imageBytes: images.MAX_PASTE_BYTES } }
    } catch (error) {
      if (this.closed) return
      const message = error instanceof Error ? error.message : String(error)
      this.state = { state: 'failed', message: message === LOCKED ? HELD : message }
      if (message === LOCKED && !this.stopped) this.retryLater()
    } finally {
      slot.cleanupSettled = true
      if (!this.closed) this.options.onChange()
    }
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
      const { openPiSession } = await import('hobkin/src/cli/pi-session.mjs')
      // Runtime owns history recovery and launcher precedence; no parent SDK work precedes child capture.
      const client = tools.find(tool => tool.name === CLIENT_TOOL)
      const clientBridge = client ? { tool: client, extensionPath: fileURLToPath(new URL('./client-bridge-extension.ts', import.meta.url)) } : undefined
      return { createMain: this.tapped(options => openPiSession(options, { isolatedMain: true, recoverScriptedHistory: true, clientBridge })), memoryIndex: {}, ...offline, ...(await this.agentHarness()) }
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

  /**
   * The harness hobkin starts its other agents with: its own, except where the Claude Code settings send them to
   * Claude Code. Should that fail to come together, hobkin builds its own as it always has, and every agent runs on Pi.
   */
  private async agentHarness(): Promise<Pick<OpenOptions, 'runHarness' | 'harnessWarms'>> {
    if (!this.options.claudeCode) return {}
    try {
      // A durable hobkin on Pi goes to hobkin's own harness untouched, so this one starts its process ahead as that one does.
      return { harnessWarms: true, runHarness: await agentHarness(this.options.claudeCode, (harnessId: string, signal?: AbortSignal) => this.runFor(harnessId, signal)) }
    } catch {
      return {}
    }
  }

  /**
   * hobkin's record of the run a harness id belongs to. One that starts while hobkin is still opening waits for it, for
   * up to a minute, and stops waiting once the run is stopped.
   */
  private async runFor(harnessId: string, signal?: AbortSignal): Promise<RunFacts | undefined> {
    for (let waited = 0; !this.app && !this.closed && !signal?.aborted && waited < 60_000; waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!this.app) return undefined
    return Object.values((await this.app.runtime.state()).runs).find((run) => run.harnessId === harnessId)
  }

  /** hobkin reduces the main session's events to one word. The host listens to the session itself for the rest. */
  private tapped(createMain: (options: MainSessionOptions) => Promise<MainSession>) {
    return async (options: MainSessionOptions) => {
      const slot = this.startup
      const session = await createMain(options)
      if (this.startup === slot && !slot.fenced) {
        slot.target.sessionId = session.sessionId
        this.options.onChange()
      }
      session.subscribe((event) => {
        if (this.main !== session || this.closed) return
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
    if (this.closed || this.stopped) return
    this.held = true
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.closed || this.stopped) return
      // Looking at the lock is cheap. Opening is tried only once the lock looks free, and hobkin has the last word.
      const look = async () => {
        if (await this.lockIsHeld()) return this.retryLater()
        if (this.closed || this.stopped) return
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
    if (app && app.runtime.main !== session) throw Error('Main session replacement is still settling.')
    const applyCurrent = app && session?.apply ? session.apply.bind(session) :
      app && session?.setModel
        ? async (choice: { model?: unknown; effort?: string }) => {
            if (choice.model) await session.setModel!(choice.model, { persist: false })
            if (choice.effort !== undefined) await session.setThinkingLevel(choice.effort, { persist: false })
            return { model: session.model ? `${session.model.provider}/${session.model.id}` : null, effort: session.thinkingLevel }
          }
        : undefined
    const modelRuntime = app && session?.modelCatalog ? await session.modelCatalog() : await this.options.modelRuntime?.()
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
    return { model: saved.model, effort: saved.effort, applied: result.activeRuntime.status === 'verified' }
  }

  /** hobkin's tiers for delegated work and the two a change review uses, as its `config.json` holds them now. */
  tiers(): Promise<HostTiers> {
    return readHostTiers(this.options.root)
  }

  /**
   * Saves tiers through hobkin's own code, in one write or not at all, checked against the model catalog the open
   * conversation has. Nothing running changes: the next delegated job and the next review read them.
   */
  async applyTiers(change: TiersChange): Promise<HostTiers> {
    const session = this.main
    const modelRuntime = this.app && session?.modelCatalog ? await session.modelCatalog() : await this.options.modelRuntime?.()
    return applyHostTiers(this.options.root, change, modelRuntime)
  }

  /**
   * Closes the open conversation and opens it again, so it starts from the configuration as it is now: a launcher that
   * was just named in `config.json`. Nothing happens for a home that is not open, which opens as it always does.
   */
  async restart(): Promise<void> {
    if (this.closed) return
    await this.opening?.catch(() => {})
    const app = this.app
    this.app = null
    this.main = null
    await app?.close()
    this.startup.cleanupSettled = true
    this.start()
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

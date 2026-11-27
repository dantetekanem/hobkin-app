import { join } from 'node:path'
import type { RawData, WebSocket } from 'ws'
import { CLOSE, PROTOCOL_VERSION, type ClientMessage, type HelloMessage, type HostMessage, type OwnerState } from '#shared/protocol/messages.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { shownFacts } from '#shared/protocol/timings.ts'
import type { StopExecutionArgs, StopExecutionReceipt } from '#shared/commands/registry.ts'
import type { HobkinApplication } from 'hobkin/src/cli/application.mjs'
import { APP_ORIGIN, createToken, DEV_UI_ORIGIN } from './access.ts'
import { systemMetrics } from './system-metrics.ts'
import { usageFacts } from './usage-facts.ts'
import { Backups, type Archiver } from './backup.ts'
import { agentImages, Attachments } from './attachments.ts'
import { appStateHandlers } from './app-state.ts'
import { createClientTool } from './client-tool.ts'
import { claudeStatus, findClaude } from './claude-code/install.ts'
import { ClaudeRuns } from './claude-code/runs.ts'
import { ClaudeCodeSettingsFile } from './claude-code/settings.ts'
import type { ClaudeCodeStatus } from '#shared/protocol/claude-code.ts'
import type { PiSetup } from '#shared/protocol/setup.ts'
import { piSetup, piSetupHandlers, refuseInstall } from './pi/install.ts'
import { configDeps, configLauncher, useLauncher } from './setup-launcher.ts'
import { nodeBin } from './pi/node.ts'
import { profileHandlers } from './profile.ts'
import { directionsHandlers } from './directions.ts'
import { projectsHandlers } from './projects-folder.ts'
import { setupAnswerHandlers } from './setup-answers.ts'
import { usageUploadHandlers } from './usage-upload.ts'
import { setupWorkHandlers } from './setup-work.ts'
import { setupWatcherHandlers } from './setup-watchers.ts'
import { runCommand, Unavailable, type HostHandlers } from './commands.ts'
import { IntegrationHost, type IntegrationModule } from './integration-host.ts'
import { ToolCallWatcher } from './tool-calls.ts'
import { startOf, workflowHandlers } from './workflows.ts'
import type { JobActivity } from '#shared/protocol/activity.ts'
import { openablePath, readForViewer } from './files.ts'
import { execFileSync } from 'node:child_process'
import { hostCode, keptByApp, shouldRestart } from './code-age.ts'
import { MergedPulls } from './merged-pulls.ts'
import { History } from './history.ts'
import { Titles, titleHobkins } from './titles.ts'
import { piModelRunner } from './review/agent.ts'
import { mainImage } from './message-images.ts'
import { readJobSession } from './job-session.ts'
import { olderStepsHandlers } from './older-steps.ts'
import { removeHostFile, runningHost, writeHostFile } from './host-file.ts'
import { Integrations, type McpSource } from './integrations.ts'
import { piMcpSourceFor } from './integrations-pi.ts'
import { PiExtensions } from './pi-extensions.ts'
import { piExtensionSourceFor, piSkillSourceFor } from './pi-resources.ts'
import { Skills } from './skills.ts'
import { setFirstModels } from './first-models.ts'
import { whyNotUsable } from './main-model.ts'
import { folderPickHandlers } from './folder-pick.ts'
import { openableUrl } from './open.ts'
import { LauncherModels, withLauncher, type Launcher } from './launcher-models.ts'
import { piModelAccess, type LiveModelAccess, type ModelAccess } from './model-access.ts'
import { HomeOwner } from './owner.ts'
import { Questions, filedDetails } from './questions.ts'
import { scriptedModelAccess } from './scripted-access.ts'
import type { ScriptedOptions } from './scripted.ts'
import { listen, socketUrl, type HostServer } from './server.ts'
import { SignIn } from './signin.ts'
import { SlashCommands, slashAgent } from './slash.ts'
import { StateSync } from './state-sync.ts'
import { readsOf, Windows } from './windows.ts'
import { TurnRelay } from './turn-relay.ts'
import { ActivityKeeper } from './activity.ts'
import { agentHandlers } from './agents.ts'
import { AgentScheduleReader, scheduleEnvironmentOf, scheduleHandlers, scheduleOperationsOf, scheduleRunsOf } from './schedules.ts'
import { memoryHandlers, memoryOperationsAt } from './memories.ts'
import { hobkinHandlers } from './hobkins.ts'
import { routineHandlers } from './routines.ts'
import { routineTemplateHandlers } from './routine-templates.ts'
import { appearanceRequest, loadHostAppearance } from './appearance-host.ts'
import { appearanceSession } from './appearance-session.ts'
import * as canvasStore from 'hobkin/src/cli/canvas.mjs'
import { recordEvent } from 'hobkin/src/cli/events.mjs'
import { Canvases, canvasHandlers } from './canvases.ts'
import { Nudges } from './nudge.ts'
import { decisionHandlers } from './decisions.ts'
import { actionDismissalHandlers } from './action-dismissals.ts'
import { reportHandlers } from './reports.ts'
import { ReminderReader, reminderHandlers } from './reminders.ts'
import { findTools, proofHandlers, ProofsKeeper } from './proofs.ts'
import { proofToolsHandlers } from './setup-proof.ts'
import { setupNeedsHandlers } from './setup-needs.ts'
import { ghBuild } from './setup/gh.ts'
import { programSetup, type ProgramInstallers } from './setup/programs.ts'
import type { ProgramSignIns } from './setup/sign-in.ts'
import { workHandlers } from './work.ts'
import { workQueueHandlers } from './work-queue.ts'
import { guideHandlers } from './work-guide.ts'
import { localTestOf } from './local-test.ts'
import { catchUpHandlers } from './report-catch-up.ts'
import { newProjectHandlers } from './work-new-project.ts'
import { metricsHandlers } from './metrics.ts'
import { workReader } from './work-items.ts'
import type { GhCall } from './review/gh.ts'
import { reviewBrief } from './review/guide.ts'
import { hostReviews, refreshFacts, reviewHandlers, stackFacts, toPrepare } from './review/seat.ts'
import { refreshHandlers } from './review/refresh-code.ts'
import { stackHandlers } from './review/stack.ts'
import { pullsOf } from './review/rules.ts'

export interface HostOptions {
  /** The hobkin home to serve. */
  root: string
  /** Use the real model. Otherwise the model and the job runner are scripted. */
  live?: boolean
  /** The root is the home the terminal app uses. */
  real?: boolean
  /** Serve the development UI in a plain browser. */
  dev?: boolean
  /** 0 picks a free port. */
  port?: number
  origins?: readonly string[]
  scripted?: ScriptedOptions
  /** How often to look whether another owner released the home. */
  lockRetryMs?: number
  /** Pi's model access. A live host uses Pi's own. A scripted host lists a scripted set of Pi's providers. */
  access?: () => Promise<ModelAccess>
  /** Opens the page to approve a sign-in on. */
  openUrl?: (url: string) => void
  /** The macOS Keychain route for API keys works here. */
  keychain?: boolean
  /** A cap on how long a question nobody waits on stays up. hobkin's own thirty seconds apply without it. */
  questionWaitMs?: number
  /** What the host finds of the `claude` CLI (033-claude-code-agents). The real lookup runs `claude` when not given. */
  claudeStatus?: () => Promise<ClaudeCodeStatus>
  /** What the host finds of Pi for the first-run setup (025-onboarding). The real lookup runs `pi` when not given. */
  piSetup?: () => Promise<PiSetup>
  /**
   * Install the pinned Pi, and one of hobkin's Pi packages by name. They change the Mac outside the app, so a host
   * refuses without them, and only the entry (`main.ts`) passes the real ones, for a live host.
   */
  installPi?: () => Promise<void>
  installPiPackage?: (name: string) => Promise<void>
  /** Install a Node of hobkin's own, for a Mac without npm. Only the entry passes it, for a live host, and without it none is offered. */
  installNode?: () => Promise<void>
  /** Ask the login shell for its PATH again when the setup finds no Pi or no npm. Only the entry passes it, so a test never asks a real shell. */
  refreshPath?: () => Promise<boolean>
  /**
   * Set up the TLA+ tools in hobkin's home, as the first-run setup does by default (050-tla-proofs). It downloads, so
   * only the entry passes the real one (`setupProofTools`), for a live host, and a host without it sets up nothing.
   */
  installProofTools?: (home: string) => Promise<unknown>
  /**
   * Install git, gh, Claude Code and qmd from the setup's review (025-onboarding). They change the Mac, so only the
   * entry passes them, for a live host, and a host without one offers the line to copy instead.
   */
  installPrograms?: ProgramInstallers
  /** Run gh's and Claude Code's own sign-ins from the setup's review. Only the entry passes them, for a live host. */
  programSignIns?: ProgramSignIns
  /**
   * The setup's reads and installs as a simulated new Mac answers them (`simulate-new-mac.ts`), in place of the host's
   * own. Only the entry passes them, for --simulate-new-mac on the scripted model.
   */
  simulation?: HostHandlers
  /**
   * gh for Change Review: it reads pull requests, and a live host posts a verdict the user confirmed. Without it a
   * pull request reads as the sample change and nothing is posted. The entry passes it for --live and --github.
   */
  reviewGh?: GhCall
  /** Opens a web or mail address in the system's default app (`system.open`). Nothing opens when not given; the entry passes the real one. */
  openSystem?: (url: string) => void
  /** Opens a file in the system's default app (`file.open`). Nothing opens when not given. */
  openFile?: (path: string, pdfInChrome?: boolean) => void
  /** Shows the Mac's folder chooser (`work.folder.pick`). No chooser shows when not given: the answer is no folder. The entry passes the real one. */
  pickFolder?: () => Promise<string | null>
  /**
   * Where Integrations reads and writes MCP servers (023-integrations). Pi's own code over Pi's configuration when not
   * given: for a live host Pi's own folder, and for a scripted one the folder in PI_CODING_AGENT_DIR or the agent
   * folder in its home, never ~/.pi/agent.
   */
  integrations?: () => Promise<McpSource>
  /** Where the integrations are found (spec 064): a folder holding one folder each, or their code ready made. The repository's `integrations/` when not given. */
  integrationFolder?: string | readonly IntegrationModule[]
  /** What a test hands each integration, by its id (`HostContext.options`). */
  integrationOptions?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  /** Where backups of the home and their settings are kept. Beside the home (`<home>-backups`) when not given. Never inside it. */
  backupsDir?: string
  /** The zip tool, for tests. */
  backupArchiver?: Archiver
  log?: (line: string) => void
}

export interface RunningHost {
  root: string
  port: number
  token: string
  url: string
  /** Stops hobkin, releases the home and closes every connection. */
  close(): Promise<void>
}

/** Capture before dispatch: a replacement app must never inherit an earlier request. */
export async function stopExecution(owner: Pick<HomeOwner, 'captureExecution'>, args: StopExecutionArgs): Promise<StopExecutionReceipt> {
  const captured = owner.captureExecution()
  const { home, epoch, kind, runId, agentId } = args.target
  const { mode, attemptId, how } = args
  if (!captured || home !== captured.home || epoch !== captured.epoch) throw new Unavailable('That execution belongs to a previous app or another home.')
  const target = { home: captured.home, epoch: captured.epoch, kind, runId, ...(agentId ? { agentId } : {}) }
  const receipt = await captured.app.stopExecution({ kind, runId, ...(agentId ? { agentId } : {}), mode, attemptId, ...(how ? { how } : {}) })
  if (receipt?.target?.kind !== kind || receipt.target.runId !== runId || receipt.target.agentId !== agentId || receipt.mode !== mode || receipt.attemptId !== attemptId) {
    throw Error('The execution receipt does not match the captured request.')
  }
  return { ...receipt, target }
}

/**
 * The user's stop of the main turn: what it never read, or null when no turn ran. A stop can wait up to thirty seconds, and one that
 * gets no answer is unconfirmed, so asking again is the way on.
 */
async function interruptMain(app: Pick<HobkinApplication, 'interrupt'>): Promise<string[] | null> {
  return app.interrupt().catch((error: unknown) => {
    if ((error as { code?: string } | null)?.code === 'STOP_UNCONFIRMED') throw Error('hobkin has not confirmed the stop yet. Press Esc twice to ask again.')
    throw error
  })
}

/** The most jobs one window may watch at once. */
const MAX_WATCHED = 1000

/** A watch message's jobs: a list of run ids, and not too many. */
const watchedJobs = (jobs: unknown): jobs is string[] =>
  Array.isArray(jobs) && jobs.length <= MAX_WATCHED && jobs.every((job) => typeof job === 'string' && job.length <= 200)

const whyNotLive = (owner: OwnerState): string => {
  if (owner.state === 'failed') return `hobkin could not start: ${owner.message}`
  return 'hobkin is still starting.'
}

/**
 * The host: hobkin's application for one home, behind a WebSocket on this machine.
 * It sends hobkin's state as it changes and runs the commands a UI sends back.
 */
/** Every run's activity in the snapshot, without the main chat's own, which comes from Pi's events. */
function jobActivityOf(snapshot: object | null): JobActivity | undefined {
  const activity = (snapshot as { jobActivity?: unknown } | null)?.jobActivity
  return activity && typeof activity === 'object' ? (activity as JobActivity) : undefined
}

/** The command line of the process that started this one, or nothing when it cannot be read. */
function parentCommand(): string {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(process.ppid)], { encoding: 'utf8', timeout: 2000 })
  } catch {
    return ''
  }
}

export async function startHost(options: HostOptions): Promise<RunningHost> {
  // When this host loaded its code, to tell when the code on disk is newer.
  const startedAt = Date.now()
  const { root, live = false, real = false, dev = false, port = 0, log = () => {} } = options
  const other = runningHost(root)
  if (other) throw Error(`A host is already serving ${root} (process ${other.pid}).`)

  const token = createToken()
  const turns = new TurnRelay()
  // Each tool call of the main conversation and of the runs, given to the integrations once as it starts and once as it ends.
  const toolCalls = new ToolCallWatcher((call) => integrationHost?.toolCall(call), { skipFirstLook: true })
  let server: HostServer | null = null

  const send = (socket: WebSocket, message: HostMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
  }
  // One encoding for every window connected.
  const broadcast = (message: HostMessage) => {
    const open = [...(server?.sockets() ?? [])].filter((socket) => socket.readyState === socket.OPEN)
    if (!open.length) return
    const text = JSON.stringify(message)
    for (const socket of open) socket.send(text)
  }
  // The integrations the host runs, loaded below once what they read is there. Until then there are none.
  let integrationHost: IntegrationHost | null = null
  const publish = () => {
    const now = facts()
    windows.publish(now)
    // The runs' tool calls are in their feeds, which move with the snapshot.
    if (integrationHost?.hearsToolCalls()) toolCalls.activity(jobActivityOf(owner.snapshot))
    // Finished changes and pull requests waiting for the user get their reviews ready in the background (005 S6).
    // What a run left for the user is reviewed only once the user asks.
    // The pull requests come from the integrations that know them.
    reviews.watch(toPrepare(now.work, integrationHost?.pulls() ?? null, { pulls: pullsOf(now.work?.yolo?.rules, now.work?.workload?.reviewPulls) }))
  }
  const connected = () => [...(server?.sockets() ?? [])].some((socket) => socket.readyState === socket.OPEN)

  const attachments = new Attachments()
  // What the UI last said about the user. hobkin asks only someone who is there (`isPresent` in its `src/cli/pending.mjs`).
  const user = { focused: false, typing: false, seenAt: 0 }
  const questions = new Questions({
    onChange: (question) => broadcast({ type: 'ask', question }),
    canShow: connected,
    typing: () => user.typing,
    maxWaitMs: options.questionWaitMs,
    // hobkin passes on only the words of a filed question. Who filed it, why, what they recommend and what its card says is on record.
    describe: ({ question }) => {
      const filed = owner.filedQuestion(question)
      return filed ? filedDetails(filed) : {}
    },
  })

  // Every way to reach a model is Pi's: its own runtime for a live host, a scripted set of its providers otherwise.
  let opened: Promise<ModelAccess> | null = null
  // A launcher the home's config names is another account, asked for its models (see `launcher-models.ts`). Only Pi's own access gets it.
  const launcherModels = new LauncherModels({ launcher: async () => (await import('hobkin/src/cli/config.mjs')).loadConfig(root).launcher as Launcher | undefined })
  const access = () =>
    (opened ??= options.access
      ? options.access()
      : live
        ? (async () => {
            const { loadConfig } = await import('hobkin/src/cli/config.mjs')
            let config
            try {
              config = loadConfig(root)
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            }
            const pi = await piModelAccess({}, config?.launcher ? undefined : config?.providerExtensions)
            return withLauncher(pi, launcherModels)
          })()
        : scriptedModelAccess())

  // hobkin reaches the app through one tool, which runs the same commands a click does (`013-hobkin-access`).
  // What hobkin's own agent asks of the reviews takes its turn in a repository's line and counts toward the day's
  // number, as the background does: only the window's ask is the user's (`058-review-turns-and-ratings`).
  const client = createClientTool({
    run: (name, args) => runCommand({ ...handlers, ...reviewHandlers(reviews, 'hobkin'), ...integrationHost?.handlers() }, name, args, integrationHost?.hooks('hobkin')),
  })

  // Load optional styling before any owner startup; canonical data comes from root admission.
  const appearance = await loadHostAppearance(root, publish, log)
  // How hobkin's other agents use Claude Code (033-claude-code-agents), kept beside the custom theme in the home's data root.
  const { resolveDataRoot } = await import('hobkin/src/cli/migration/admission.mjs')
  const claudeCode = new ClaudeCodeSettingsFile(resolveDataRoot(root))
  // The runs sent to Claude Code, which the window's snapshot marks so it draws the crab pal beside their faces.
  const claudeRuns = new ClaudeRuns()
  // The schedules agents keep for themselves (056-agent-schedules), read without trust on their way to the window.
  const agentSchedules = new AgentScheduleReader()
  const lookUpClaude = options.claudeStatus ?? (() => claudeStatus({ find: findClaude }))
  // What the setup's review installs and signs in on a press. GitHub builds gh for a Mac's chips, and Apple's installer is a Mac's.
  const programs = programSetup({
    live,
    installers: options.installPrograms ?? {},
    installable: (name) => (name === 'gh' ? ghBuild() !== null : name !== 'git' || process.platform === 'darwin'),
    signIns: options.programSignIns,
  })
  const owner = new HomeOwner({
    root,
    live,
    real,
    scripted: options.scripted,
    retryMs: options.lockRetryMs,
    onChange: publish,
    onSessionEvent: (event) => {
      const message = turns.accept(event)
      if (message) broadcast(message)
      if (integrationHost?.hearsToolCalls()) toolCalls.event(event)
    },
    frontEnd: {
      askQuestion: questions.ask,
      presence: () => ({ seenAt: user.seenAt, away: !user.focused || !connected(), occupied: user.typing || questions.current() !== null }),
      clipboard: attachments.clipboard,
    },
    tools: [client],
    // What the integrations give agents (tools, hooks on tool calls, workflows), read as hobkin opens.
    integrations: () => integrationHost?.runtimeOption() ?? null,
    modelRuntime: live ? async () => ((await access()) as Partial<LiveModelAccess>).runtime : undefined,
    claudeCode: {
      settings: () => claudeCode.read(),
      findClaude,
      ask: questions.ask,
      onClaude: claudeRuns.routed,
      // A run on Claude Code keeps its schedules through `hobkin schedule`, with a token hobkin gives it (056-agent-schedules).
      scheduling: (harnessId, options) => scheduleEnvironmentOf(owner.app, harnessId, options),
    },
  })
  const customTheme = appearanceSession(
    { captureExecution: () => live ? owner.captureExecution() : null },
    appearance,
  )
  const signIn = new SignIn({
    access,
    // Nothing opens the user's browser unless the caller hands an opener in: only a live host does (main.ts).
    // A test or a scripted host that forgets one opens nothing.
    openUrl: options.openUrl ?? (() => {}),
    log,
    keychain: options.keychain ?? process.platform === 'darwin',
    onChange: () => {
      publish()
      openWhenReady()
    },
  })
  // A real model needs an account before hobkin can open its conversation. The script answers anyone.
  const openWhenReady = () => {
    if (!live || signIn.state.status === 'signed-in') owner.start()
  }
  // Integrations reads Pi's MCP servers only when asked, through Pi's own code, and hides their secrets before anything is sent.
  // TLA+ proof runs, read from hobkin's home when its files change (050-tla-proofs).
  // The finished changes that still wait for the user keep their newest check in the slice, however many runs came after it.
  // `workOf` is made below and read only when the keeper scans.
  const waitingChanges = () => {
    const work = owner.snapshot ? workOf(owner.snapshot) : null
    const changes = work?.finished.flatMap((group) => group.changes) ?? []
    return changes.map((change) => ({ project: change.slug, item: change.item }))
  }
  const proofs = new ProofsKeeper({ home: () => owner.app?.runtime.directory ?? null, onChange: () => publish(), waiting: waitingChanges })
  const integrations = new Integrations({ source: options.integrations ?? (() => piMcpSourceFor({ live, root })), onChange: publish, log })
  // Skills and Pi extensions read Pi's resources only when a page asks, and change them only through `pi config`'s own code (039-skills-and-extensions).
  const skills = new Skills({ source: () => piSkillSourceFor({ live, root }), log })
  const piExtensions = new PiExtensions({ source: () => piExtensionSourceFor({ live, root }), log })
  // The canvases: the page or drawing each hobkin shows, kept by hobkin under the home, where the `hobkin canvas`
  // command writes them too. The window draws them, and each drawing is served here (030-canvas-panel, 035-canvas-drawings).
  const canvases = new Canvases({
    store: canvasStore,
    root: () => {
      if (!owner.app) throw new Unavailable(whyNotLive(owner.state))
      return owner.app.runtime.directory
    },
    port: () => server?.port ?? 0,
    onChange: publish,
  })
  // The window moves and the composer draft hobkin drives for the user (013-hobkin-access). The window carries each out.
  const nudge = new Nudges({ onChange: publish })
  // hobkin's application while it is open. Declared before the reviews, which read through it as they are made.
  const hobkin = () => {
    if (!owner.app) throw new Unavailable(whyNotLive(owner.state))
    return owner.app
  }
  // An agent's last steps stay readable after it has finished, though hobkin drops them (011-work A3).
  const activity = new ActivityKeeper()
  // Work mode for the Work screen and Change Review, from the snapshot with hobkin's own rules and hobkin's items (011-work).
  const workOf = workReader(() => hobkin().runtime.directory)
  // Change Review: reviews prepared in the background and kept in the home, and verdicts only on the user's word.
  const reviews = hostReviews({
    root,
    live,
    data: () => hobkin().runtime.directory,
    work: () => (owner.snapshot ? workOf(owner.snapshot) : null),
    app: () => hobkin(),
    runtime: async () => (live ? ((await access()) as Partial<LiveModelAccess>).runtime : undefined),
    gh: options.reviewGh,
    // A pull request that merged on the user's word is heard by the integrations, which drop it from their lists now.
    merged: (pull) => integrationHost?.merged(pull),
    log,
  })
  // A pull request merged or closed outside the app leaves Work and the Review list on the cadence of the integrations' lists, not at hobkin's half-hourly survey. Only a live host asks the code host.
  const mergedPulls = options.reviewGh
    ? new MergedPulls({
        data: () => hobkin().runtime.directory,
        gh: options.reviewGh,
        reviewed: () => reviews.openPulls(),
        retire: (pull) => reviews.settlePull({ kind: 'pull', ...pull }),
        closed: (pull) => integrationHost?.merged(pull),
        changed: () => hobkin().refresh(),
        wanted: connected,
        log,
      })
    : null
  const reminderReader = new ReminderReader()
  const reminders = () => {
    const home = owner.app?.runtime.directory ?? resolveDataRoot(root)
    try { return reminderReader.read(home) }
    catch (error) {
      log(`Could not read reminder metadata: ${error instanceof Error ? error.message : String(error)}`)
      return { home, entries: [] }
    }
  }
  // The integrations: each folder under `integrations/`, found now that what they read is there (spec 064).
  const loadedIntegrations = (integrationHost = await IntegrationHost.load({
    integrations: options.integrationFolder,
    live,
    ...(options.reviewGh ? { gh: options.reviewGh } : {}),
    integrationOptions: options.integrationOptions,
    log,
    changed: publish,
    connected,
    hobkin,
    dataRoot: () => hobkin().runtime.directory,
    snapshotWork: () => owner.snapshot?.work,
    workflows: {
      start: (id, input) => startOf(hobkin())(id, input),
      rows: () => (Array.isArray(owner.snapshot?.schedules) ? owner.snapshot.schedules : []),
    },
  }))
  const facts = () => ({
    owner: owner.wireState(),
    signIn: signIn.state,
    models: signIn.models,
    integrations: integrations.state,
    slices: loadedIntegrations.slices(),
    proofs: proofs.state,
    canvas: canvases.main,
    canvases: canvases.others(),
    nudge: nudge.state,
    appearance: appearanceRequest(appearance),
    themes: appearance.kept(),
    // Work mode for the Work screen, read from the snapshot with hobkin's own rules (011-work).
    work: owner.snapshot ? workOf(owner.snapshot) : null,
    snapshot: owner.snapshot && { ...activity.keep(claudeRuns.mark(agentSchedules.wire(owner.wireSnapshot()!))), reminderOccurrences: reminders() },
  })
  // hobkin's main conversations, only read, from the home (014-continuity A8). The one its session has open is current.
  // Titles: a small model on the quick tier names a conversation from its first messages, once, and the name is kept
  // in the home. History shows them, and a durable hobkin named only by its first message takes one. With the
  // scripted model nothing is asked, so first lines stay.
  const quick = piModelRunner({
    root,
    data: () => {
      if (!owner.app) throw new Unavailable(whyNotLive(owner.state))
      return owner.app.runtime.directory
    },
    runtime: async () => (live ? ((await access()) as Partial<LiveModelAccess>).runtime : undefined),
  })
  const titleHobkinsNow = () => {
    const hobkins = owner.app?.hobkins
    if (hobkins) void titleHobkins(hobkins, titles, (line, error) => log(`${line}${error ? ` ${error instanceof Error ? error.message : String(error)}` : ''}`))
  }
  const titles: Titles = new Titles({
    ask: ({ system, prompt, signal }) => quick({ pass: 'checker', system, prompt, signal }),
    file: () => join(resolveDataRoot(root), 'client', 'titles.json'),
    // A title made for a hobkin is given to it at once. One made for a conversation shows the next time History lists.
    onTitled: (key) => {
      if (key.startsWith('hobkin:')) titleHobkinsNow()
    },
    log: (line, error) => log(`${line}${error ? ` ${error instanceof Error ? error.message : String(error)}` : ''}`),
  })
  const history = new History(root, () => (owner.app?.runtime.main as { sessionFile?: string } | undefined)?.sessionFile, undefined, titles)
  const sync = new StateSync(facts())
  // Each window's state messages: whole feeds for a window from before, and for one that reads tails only the jobs it watches.
  const windows = new Windows({ sync })
  const lookAgain = () => void signIn.refresh().catch((error: unknown) => log(`Could not ask Pi about models: ${error instanceof Error ? error.message : String(error)}`))

  const limits = () => {
    if (owner.state.state !== 'live') throw new Unavailable(whyNotLive(owner.state))
    return owner.state.limits
  }
  const slash = new SlashCommands({
    root,
    clear: async () => {
      const { savePresentationState } = await import('hobkin/src/cli/view.mjs')
      const ids = sync.shown()
      // hobkin remembers them in the home, so they stay hidden after a restart and in the terminal app.
      if (ids.length) savePresentationState(root, ids)
      sync.hide(ids)
      publish()
    },
    runs: () => (owner.snapshot?.runs ?? []) as RunSummary[],
  })
  const done = { ok: true } as const
  // Local backup of the home: automatic while this host runs, and on the user's word (never agent restore).
  const backups = new Backups({
    source: root,
    directory: options.backupsDir ?? `${root}-backups`,
    archiver: options.backupArchiver,
    log,
    // A restore swaps the records under hobkin, so it waits while anything runs. A hobkin that never came up runs
    // nothing, and that is when a restore is needed most.
    busy: () => (owner.snapshot && busy() ? 'hobkin is answering or something is running. Restore once it is quiet.' : null),
  })
  // Pi on this Mac. A live host with a launcher in the config reads Pi through it; a scripted one never does.
  const readPi = options.piSetup ?? (() => piSetup({ ownNode: nodeBin(root), ...(live ? { launcher: () => configLauncher(root) } : {}) }))
  // The images attached to an agent's or a durable hobkin's message go with it as Pi takes them.
  const imagesForAgents = agentImages(attachments, hobkin, () => owner.imageOnlyText)
  const handlers: HostHandlers = {
    ...appStateHandlers({ root, owner, revision: () => sync.full().rev }),
    'conversation.send': async ({ text, images = [], report, review, item, during, sentAt }) => {
      const app = hobkin()
      const pictures = attachments.handles(images)
      // The report goes as hobkin's terminal app sends it: the whole report, from hobkin's own list, ahead of the words.
      // A message written during a review carries where the user is in it, and a reply to an action item that item, the same way.
      const about =
        report !== undefined ? ((owner.snapshot?.reports ?? []) as { id?: unknown }[]).find(({ id }) => id === report)
        : review ? reviewBrief(reviews, review)
        : item ? { id: `item:${item.id}`, title: `Action item: ${item.title}`, body: item.body }
        : undefined
      if (report !== undefined && !about) throw new Unavailable("That report is not in hobkin's list any more.")
      // A turn needs words, so a message of pictures alone gets hobkin's own.
      const words = text?.trim() ? text : pictures.length ? owner.imageOnlyText : null
      if (!words) throw Error('A message needs words or an image.')
      // Pi's force submit: the running turn stops first, as a stop stops it, and the message starts a turn of its own.
      const unsent = during === 'interrupt' ? await interruptMain(app) : null
      // When the user sent it goes to hobkin as it came, for its timing of the turn, and only when the window sent it. A
      // follow-up says so, and a message that says neither goes as it always has.
      const timing = {
        ...(sentAt === undefined ? {} : { sentAt }),
        ...(during === 'follow-up' ? { queue: 'follow-up' as const } : {}),
      }
      const timed = Object.keys(timing).length > 0
      const accepted = await (timed ? app.send(words, about, pictures, timing) : app.send(words, about, pictures))
      attachments.sent(images)
      return { id: accepted.id, queued: accepted.queued === true, ...(unsent?.length ? { unsent } : {}) }
    },
    'conversation.image': ({ messageId, ordinal }) => mainImage(hobkin, sync.shown(), messageId, ordinal),
    'history.image': async ({ id, messageId, ordinal }) => {
      const app = owner.app, main = app?.runtime.main
      const sessionId = (main as { sessionId?: string } | null)?.sessionId
      const image = await history.image(id, messageId, ordinal)
      return owner.app === app && app?.runtime.main === main && (main as { sessionId?: string } | null)?.sessionId === sessionId ? image : null
    },
    'conversation.attach': ({ name, data, agent }) => attachments.attach(hobkin(), limits(), { name, bytes: Buffer.from(data, 'base64'), ...(agent ? { agent } : {}) }),
    'conversation.detach': ({ id }) => {
      attachments.detach(hobkin(), id)
      return done
    },
    'execution.stop': (args) => stopExecution(owner, args),
    'startup.force': (args) => owner.forceStartup(args),
    'conversation.stop': async () => {
      const unsent = await interruptMain(hobkin())
      return { stopped: unsent !== null, unsent: unsent ?? [] }
    },
    'conversation.dequeue': async () => {
      const app = hobkin()
      if (!app.dequeue) throw new Unavailable('This hobkin cannot take its queue back.')
      return { unsent: await app.dequeue() }
    },
    'conversation.continue': async ({ sentAt }) => {
      const app = hobkin()
      if (!app.continueStopped) throw new Unavailable('This hobkin cannot continue a stopped turn.')
      const accepted = await app.continueStopped(sentAt === undefined ? {} : { sentAt })
      return { id: accepted.id, queued: accepted.queued === true }
    },
    'slash.list': async (asked) => ({ commands: await slash.list(owner.app, slashAgent(asked)) }),
    'slash.run': ({ name, args = '', ...asked }) => {
      const agent = slashAgent(asked)
      if (agent) return slash.run(hobkin(), name, args.trim(), agent)
      return name === '/reset' ? owner.resetMain(() => slash.run(hobkin(), name, args.trim())) : slash.run(hobkin(), name, args.trim())
    },
    'avatar.wake': () => {
      hobkin().moods.react({ event: 'woken' })
      return done
    },
    'question.answer': ({ id, value, typed }) => {
      questions.answer(id, { value, typed })
      return done
    },
    'question.defer': ({ id }) => {
      questions.defer(id)
      return done
    },
    'models.list': async () => {
      await signIn.refresh()
      return signIn.models!
    },
    'models.update': async () => {
      try {
        return await signIn.updateModels()
      } catch (error) {
        throw new Unavailable(error instanceof Error ? error.message : String(error))
      }
    },
    'models.key-help': ({ provider }) => signIn.keyHelp(provider),
    'models.keychain': ({ provider }) => signIn.useKeychain(provider),
    'models.select': async ({ model, effort }) => {
      // A process that holds the home owns its configuration while it runs, and the script answers whatever is chosen.
      if (owner.held) throw new Unavailable(whyNotLive(owner.state))
      if (!live) throw new Unavailable("The scripted model answers whatever is chosen, so nothing is saved. Start the host with --live to choose hobkin's model.")
      // Only a model Pi can use now: what the models slice lists, asked again.
      await signIn.refresh()
      const refusal = whyNotUsable(signIn.models!, model, effort)
      if (refusal) throw new Unavailable(refusal)
      try {
        return { ok: true, ...(await owner.selectModel(model, effort)) }
      } catch (error) {
        throw new Unavailable(error instanceof Error ? error.message : String(error))
      }
    },
    'tiers.read': async () => {
      try {
        return await owner.tiers()
      } catch (error) {
        throw new Unavailable(error instanceof Error ? error.message : String(error))
      }
    },
    'tiers.apply': async (change) => {
      // As for the main model: a process that holds the home owns its configuration, and the script saves nothing.
      if (owner.held) throw new Unavailable(whyNotLive(owner.state))
      if (!live) throw new Unavailable("The scripted model answers whatever is chosen, so nothing is saved. Start the host with --live to set hobkin's tiers.")
      // Only models Pi can use now, at a thinking level each one offers.
      await signIn.refresh()
      for (const setting of Object.values(change.tiers ?? {})) {
        const refusal = setting ? whyNotUsable(signIn.models!, setting.model, setting.effort) : null
        if (refusal) throw new Unavailable(refusal)
      }
      try {
        return await owner.applyTiers(change)
      } catch (error) {
        throw new Unavailable(error instanceof Error ? error.message : String(error))
      }
    },
    // Once, on a home that never chose a model: hobkin's models from the account the setup found, or Pi's default for the provider connected later.
    'tiers.first': async ({ provider }) => {
      if (owner.held) throw new Unavailable(whyNotLive(owner.state))
      if (!live) throw new Unavailable("The scripted model answers whatever is chosen, so nothing is saved. Start the host with --live to set hobkin's models.")
      try {
        return await setFirstModels({
          models: async () => {
            await signIn.refresh()
            return signIn.models!
          },
          tiers: () => owner.tiers(),
          selectModel: (model, effort) => owner.selectModel(model, effort),
          selectChecks: (model, effort) => owner.selectChecks(model, effort),
          applyTiers: (change) => owner.applyTiers(change),
        }, provider)
      } catch (error) {
        throw new Unavailable(error instanceof Error ? error.message : String(error))
      }
    },
    'signin.start': async ({ provider }) => {
      await signIn.start(provider)
      return done
    },
    'signin.answer': ({ prompt, value }) => {
      signIn.answer(prompt, value)
      return done
    },
    'signin.cancel': () => {
      signIn.cancel()
      return done
    },
    'signin.out': ({ provider }) => signIn.signOut(provider),
    'claude-code.read': async () => ({ status: await lookUpClaude(), settings: claudeCode.read() }),
    'claude-code.apply': async (change) => ({ settings: claudeCode.apply(change), status: await lookUpClaude() }),
    // Who the user is, for the first-run setup. hobkin's snapshot carries the name the window greets them by, so it is
    // read again once the profile is saved.
    ...profileHandlers({
      root: () => owner.app?.runtime.directory ?? resolveDataRoot(root),
      saved: async () => {
        await owner.app?.refresh()
      },
    }),
    // hobkin's directions, AGENTS.md in its data root, edited in Settings. hobkin reads it fresh each turn and run.
    ...directionsHandlers({ root: () => owner.app?.runtime.directory ?? resolveDataRoot(root) }),
    // Pi on this Mac. Nothing installs unless the caller hands the installers in: only the entry does (main.ts).
    ...piSetupHandlers({
      live,
      read: readPi,
      installPi: options.installPi ?? refuseInstall,
      installPackage: options.installPiPackage ?? refuseInstall,
      installNode: options.installNode,
      refreshPath: options.refreshPath,
    }),
    // The TLA+ tools, set up by the first-run setup by default, then looked for again so the YOLO page sees them.
    ...proofToolsHandlers({
      live,
      home: () => owner.app?.runtime.directory ?? resolveDataRoot(root),
      install: options.installProofTools,
      found: () => proofs.findTools(),
    }),
    // Everything hobkin needs on this Mac, for the setup's review. Pi and the models are read as their own commands read them.
    ...setupNeedsHandlers({
      pi: async () => handlers['setup.pi']!({}),
      models: async () => handlers['models.list']!({}),
      proofTools: () => findTools(owner.app?.runtime.directory ?? resolveDataRoot(root)),
      claude: async () => ({ settings: claudeCode.read(), status: await lookUpClaude() }),
      ownNode: nodeBin(root),
      presses: programs.offers,
    }),
    ...programs.handlers,
    // A work computer's launcher, asked for and kept in the config (025-onboarding), then the main conversation starts behind it.
    'setup.launcher': async ({ command }) => {
      if (!live) throw new Unavailable('This is the scripted development host, so no launcher is kept. Start the host with --live to use one.')
      await useLauncher(command, { ...(await configDeps(root)), restart: () => owner.restart() })
      return readPi()
    },
    ...projectsHandlers(),
    // The setup's answers, the first context: the app's own copy, and hobkin's facts in front of its directions.
    // The answer to its question about usage counts too, which only a live host on the real home makes hobkin's setting.
    ...setupAnswerHandlers({ root: () => owner.app?.runtime.directory ?? resolveDataRoot(root), live, real }),
    // Settings' Usage events switch, the same setting the setup asks about, kept only by a live host on the real home.
    ...usageUploadHandlers({ root: () => owner.app?.runtime.directory ?? resolveDataRoot(root), live, real }),
    // The routine cards for the goals picked in the setup, read from hobkin's templates and the user's own (044).
    ...setupWatcherHandlers({ root: () => owner.app?.runtime.directory ?? resolveDataRoot(root) }),
    // The folder and projects picked in the setup, handed to work mode as the Work screen's actions are: through
    // hobkin's own work functions while it is open here, then its state read again so Work shows them.
    ...setupWorkHandlers({ root: () => hobkin().runtime.directory, refresh: () => hobkin().refresh() }),
    // Whether this host runs older code than what is on disk, and the way to load it: the host closes as it does on
    // a signal, and the app that started it starts another. Answered first, so the window hears it went.
    'system.metrics': () => systemMetrics(root),
    'usage.facts': () => usageFacts(root, options.backupsDir ?? `${root}-backups`),
    'backup.list': () => backups.state(),
    'backup.config': (change) => backups.setConfig(change),
    'backup.now': () => backups.backupNow(),
    'backup.restore': async ({ name }) => ({ ok: true as const, ...(await backups.restore(name)) }),
    'host.code': () => hostCode(startedAt),
    'host.restart': () => {
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 150).unref()
      return { ok: true as const }
    },
    // Integrations changes Pi's configuration only on the user's word, through Pi's own code (023-integrations).
    'integrations.refresh': () => integrations.refresh(),
    'integrations.turn-off': ({ name }) => integrations.turnOff(name),
    'integrations.turn-on': ({ name }) => integrations.turnOn(name),
    'integrations.remove': ({ name }) => integrations.remove(name),
    // Skills and Pi extensions change Pi's settings only on the user's word, through the code `pi config` runs (039-skills-and-extensions).
    'skills.refresh': () => skills.refresh(),
    'skills.read': ({ path }) => skills.read(path),
    'skills.turn-off': ({ path }) => skills.turnOff(path),
    'skills.turn-on': ({ path }) => skills.turnOn(path),
    'extensions.refresh': () => piExtensions.refresh(),
    'extensions.check-updates': () => piExtensions.checkUpdates(),
    'extensions.turn-off': ({ path }) => piExtensions.turnOff(path),
    'extensions.turn-on': ({ path }) => piExtensions.turnOn(path),
    'system.open': ({ url }) => {
      // Checked again here, so no opener is ever handed an address the registry's pattern let through.
      ;(options.openSystem ?? (() => {}))(openableUrl(url).href)
      return done
    },
    ...canvasHandlers(canvases),
    // Driving the window for the user: the host records the move or draft and tells the window, which carries it out.
    'view.open': ({ screen }) => {
      nudge.open(screen)
      return done
    },
    'view.spotlight': () => {
      nudge.spotlight()
      return done
    },
    'view.back': () => {
      nudge.back()
      return done
    },
    'conversation.draft': ({ text }) => {
      nudge.draft(text)
      return done
    },
    'appearance.set': ({ palette, name, asked }) => appearance.set(palette, name, asked),
    'appearance.themes': () => appearance.kept(),
    'appearance.pick': ({ id }) => appearance.pick(id),
    'appearance.rename': ({ id, name }) => appearance.rename(id, name),
    'appearance.remove': ({ id }) => appearance.remove(id),
    'appearance.photo': ({ id }) => appearance.photo(id),
    'appearance.use': ({ theme }) => appearance.use(theme),
    'appearance.customize': ({ request }) => customTheme.start(request),
    'appearance.status': ({ id }) => customTheme.status(id),
    'file.read': ({ path }) => readForViewer(path),
    'file.open': async ({ path, pdfInChrome }) => {
      const real = await openablePath(path)
      await options.openFile?.(real, pdfInChrome)
      return done
    },
    // The Work screen's actions, each one of hobkin's own work actions. An integration hears how each ended (`afterCommand`).
    ...workHandlers({ app: hobkin, root: () => hobkin().runtime.directory }),
    ...workQueueHandlers({ app: hobkin, root: () => hobkin().runtime.directory }),
    // Work in numbers: hobkin's fold of its own records, with the AI reviews the host keeps, kept for a minute (053).
    ...metricsHandlers({ data: () => hobkin().runtime.directory, root, reviews }),
    // TLA+ proof runs: read, stopped and repeated through hobkin's own proof functions, when the runtime running has them.
    ...proofHandlers({ keeper: proofs, home: () => hobkin().runtime.directory }),
    // Its agents and routines, stopped or told something while they work, by run id (011-work).
    ...agentHandlers({ app: hobkin, runs: () => (owner.snapshot?.runs ?? []) as RunSummary[], models: async () => (await signIn.refresh(), signIn.models ?? null), images: imagesForAgents, schedules: () => agentSchedules.read(owner.snapshot) }),
    // An agent's schedules, cancelled, paused or run now from the window's list, through hobkin's own methods (056).
    ...newProjectHandlers({ root: () => hobkin().runtime.directory, refresh: () => hobkin().refresh() }),
    ...guideHandlers({ root: () => hobkin().runtime.directory, refresh: () => hobkin().refresh() }),
    'work.local-test': ({ slug }) => localTestOf(hobkin().runtime.directory, slug),
    ...catchUpHandlers({ app: hobkin }),
    ...folderPickHandlers({ pick: options.pickFolder ?? (async () => null) }),
    ...scheduleHandlers({ operations: () => scheduleOperationsOf(hobkin()), schedules: () => agentSchedules.read(owner.snapshot), runs: () => scheduleRunsOf(hobkin()) }),
    // What hobkin remembers for every agent, on the window's Memory page, through hobkin's own memory functions (057).
    ...memoryHandlers({ operations: () => memoryOperationsAt(owner.app?.runtime.directory ?? resolveDataRoot(root)) }),
    // Durable hobkins (034-durable-hobkins): hobkin's runtime keeps them, and the host checks only what it knows.
    ...hobkinHandlers({
      app: hobkin,
      images: imagesForAgents,
      models: async () => (await signIn.refresh(), signIn.models ?? null),
      claudeMissing: async () => (findClaude() ? null : 'Claude Code is not installed on this Mac, so a hobkin cannot run on it. Install it, or pick a tier.'),
      // Only a model Pi can use now: what the models slice lists, asked again.
      modelProblem: async (model, effort) => {
        await signIn.refresh()
        return signIn.models ? whyNotUsable(signIn.models, model, effort) : 'Pi has not listed its models yet. Try again in a moment.'
      },
    }),
    // Action Items answered from the window, each through hobkin's own decision or learning action (012).
    ...decisionHandlers({ app: hobkin }),
    // And dismissed from it with hobkin's own dismissal.
    ...actionDismissalHandlers({ root: () => hobkin().runtime.directory, refresh: () => hobkin().refresh() }),
    ...reportHandlers({ app: hobkin }),
    ...reminderHandlers({ root: () => hobkin().runtime.directory, changed: publish }),
    // A routine's switch, its times and Run now, each through hobkin's own runner (010-routines).
    ...routineHandlers({ app: hobkin }),
    // The templates the Routines screen offers, hobkin's and the user's own, read as setup reads them.
    ...routineTemplateHandlers({ root: () => owner.app?.runtime.directory ?? resolveDataRoot(root) }),
    // Change Review: prepared reviews, the reviewer's notes, and verdicts (005, 009).
    ...reviewHandlers(reviews),
    // Make it a stack: one max-tier agent splits the change, started the way hobkin.start starts one.
    ...stackHandlers({
      facts: (id) => stackFacts.get(reviews)!(id),
      start: async ({ cwd, title, text }) => handlers['hobkin.start']!({ cwd, title, text, engine: { kind: 'tier', tier: 'max' } }),
      exists: async (id) => {
        try {
          await handlers['hobkin.read']!({ id })
          return true
        } catch {
          return false
        }
      },
    }),
    // Code stale, refresh: one agent on the mid tier (ordinary coding work, spec 017) brings the branch up to date, started the same way.
    ...refreshHandlers({
      facts: (id) => refreshFacts.get(reviews)!(id),
      start: async ({ cwd, title, text }) => handlers['hobkin.start']!({ cwd, title, text, engine: { kind: 'tier', tier: 'mid' } }),
      exists: async (id) => {
        try {
          await handlers['hobkin.read']!({ id })
          return true
        } catch {
          return false
        }
      },
    }),
    'agent.session': ({ report }) => readJobSession({ data: () => hobkin().runtime.directory, snapshot: () => ({ reports: owner.snapshot?.reports, completedJobReports: owner.snapshot?.completedJobReports }), state: () => hobkin().runtime.state() }, report),
    // A run's steps its feed let go, and a tool's whole output, read back from its saved session (052 S18).
    ...olderStepsHandlers({ data: () => hobkin().runtime.directory, state: () => hobkin().runtime.state() }),
    // An integration's workflows: the user's press, and turning one on or off.
    ...workflowHandlers({ app: hobkin }),
    'history.list': () => history.list(),
    'history.open': ({ id }) => history.open(id),
    // Last, so a simulated new Mac answers the setup in place of this one.
    ...options.simulation,
  }

  const hello = (): HelloMessage => ({
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    home: root,
    model: live ? 'live' : 'scripted',
    owner: owner.wireState(),
    signIn: signIn.state,
    models: signIn.models,
    viewState: null,
    timings: true,
    watch: true,
  })

  const receive = async (socket: WebSocket, data: RawData) => {
    let message: ClientMessage
    try {
      message = JSON.parse(String(data)) as ClientMessage
    } catch {
      return socket.close(CLOSE.badMessage, 'Not JSON')
    }
    if (message?.type === 'command' && typeof message.id === 'string' && typeof message.name === 'string') {
      send(socket, { type: 'result', id: message.id, ...(await runCommand({ ...handlers, ...loadedIntegrations.handlers() }, message.name, message.args, loadedIntegrations.hooks('window'))) })
    } else if (message?.type === 'presence') {
      const back = message.focused === true && !user.focused
      Object.assign(user, { focused: message.focused === true, typing: message.typing === true })
      // A report from a focused window is the user being there.
      if (user.focused) user.seenAt = Date.now()
      // The user may have changed Pi's setup in a terminal while the window was away.
      if (back) lookAgain()
    } else if (message?.type === 'watch') {
      // The jobs whose whole steps this window shows. A list that is not one is no message this host knows.
      const { jobs } = message as { jobs?: unknown }
      if (!watchedJobs(jobs)) return socket.close(CLOSE.badMessage, 'Bad watch')
      windows.watch(socket, jobs)
    } else if (message?.type === 'shown') {
      // How soon a reply's first words showed in the window, kept as facts in hobkin's event log. One not kept is
      // dropped with the connection left open, and a write problem never reaches the window.
      const facts = shownFacts(message)
      try {
        if (facts) recordEvent(owner.app?.runtime.directory ?? resolveDataRoot(root), 'turn_shown', facts)
      } catch {
        // A timing that cannot be kept is lost, and nothing else.
      }
    } else {
      socket.close(CLOSE.badMessage, 'Unknown message')
    }
  }

  server = await listen({
    port,
    token,
    origins: options.origins ?? [APP_ORIGIN, ...(dev ? [DEV_UI_ORIGIN] : [])],
    dev,
    serve: (request, response) => canvases.serve(request, response),
    onConnection: (socket, request) => {
      owner.reconnectStartup()
      send(socket, hello())
      send(socket, windows.open(socket, readsOf(request.url)))
      for (const turn of turns.catchUp()) send(socket, turn)
      if (questions.current()) send(socket, { type: 'ask', question: questions.current() })
      socket.on('message', (data) => void receive(socket, data))
      // With nobody connected, nobody is there. hobkin then keeps its questions for later.
      socket.on('close', () => {
        windows.close(socket)
        if (!connected()) user.focused = false
      })
    },
  })
  writeHostFile(root, { pid: process.pid, port: server.port, token })
  openWhenReady()
  lookAgain()
  loadedIntegrations.start()
  mergedPulls?.start()
  backups.start()
  // The canvases are followed on disk. The folder is there only once hobkin's home is open, so every couple of
  // seconds they are read again while the watch does not follow the open home's folder, which picks them up after
  // hobkin opens and after a watch failed.
  canvases.watch()
  const canvasRead = setInterval(() => canvases.poll(), 2000)
  canvasRead.unref()
  // A durable hobkin named by its first message is given a title a little after that message, and again once it has answered.
  const hobkinTitles = setInterval(titleHobkinsNow, 5000)
  hobkinTitles.unref()

  // A host loads its code once. When the code on disk is newer, this one restarts itself to load it, so a fix never
  // waits unseen behind a host left running: only while nothing runs, only once the files have settled, and only when
  // the app keeps it, since the app then starts the next one. The window stays open and connects again.
  const kept = options.dev === true && keptByApp(parentCommand())
  const busy = () => {
    const snapshot = owner.snapshot
    if (!snapshot || snapshot.busy || user.typing) return true
    // Any run hobkin has going or waiting, whatever it is: an agent's work, a routine, a check.
    const runs: unknown = (snapshot as { runs?: unknown }).runs
    const going = (run: unknown) => ['running', 'queued', 'cancelling'].includes(String((run as { state?: unknown; status?: unknown })?.state ?? (run as { status?: unknown })?.status))
    if (Array.isArray(runs) && runs.some(going)) return true
    return reviews.list().reviews.some((item) => item.state === 'preparing' || item.assessment?.state === 'queued' || item.assessment?.state === 'running')
  }
  const reload = setInterval(() => {
    let quiet = false
    try {
      quiet = !busy()
    } catch {
      // Whether anything runs could not be told just now: it is asked again next time.
    }
    const code = hostCode(startedAt)
    if (!shouldRestart({ ...code, kept, busy: !quiet, now: Date.now() })) return
    log(`Restarting to load newer code: ${code.changed} of this host's files changed, and nothing is running.`)
    clearInterval(reload)
    process.kill(process.pid, 'SIGTERM')
  }, 20_000)
  reload.unref()

  let closing: Promise<void> | null = null
  return {
    root,
    port: server.port,
    token,
    url: socketUrl(server.port),
    close: () => {
      closing ??= (async () => {
        questions.close()
        signIn.cancel()
        options.programSignIns?.close()
        loadedIntegrations.close()
        mergedPulls?.close()
        backups.close()
        integrations.close()
        proofs.close()
        reviews.close()
        clearInterval(canvasRead)
        canvases.stop()
        clearInterval(hobkinTitles)
        titles.close()
        for (const socket of server.sockets()) socket.close(CLOSE.hostClosing, 'The host is closing')
        await customTheme.close()
        await owner.close()
        await server.close()
        removeHostFile(root)
      })()
      return closing
    },
  }
}

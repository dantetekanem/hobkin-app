import type { RawData, WebSocket } from 'ws'
import { CLOSE, PROTOCOL_VERSION, type ClientMessage, type HelloMessage, type HostMessage, type OwnerState } from '#shared/protocol/messages.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import type { StopExecutionArgs, StopExecutionReceipt } from '#shared/commands/registry.ts'
import { APP_ORIGIN, createToken, DEV_UI_ORIGIN } from './access.ts'
import { Attachments } from './attachments.ts'
import { appStateHandlers } from './app-state.ts'
import { createClientTool } from './client-tool.ts'
import { runCommand, Unavailable, type HostHandlers } from './commands.ts'
import { openablePath, readTextFile } from './files.ts'
import { execFileSync } from 'node:child_process'
import { hostCode, keptByApp, shouldRestart } from './code-age.ts'
import { sampleGitHubSource } from './github-sample.ts'
import { GitHub, type GitHubSource } from './github.ts'
import { History } from './history.ts'
import { mainImage } from './message-images.ts'
import { readJobSession } from './job-session.ts'
import { removeHostFile, runningHost, writeHostFile } from './host-file.ts'
import { Integrations, type McpSource } from './integrations.ts'
import { piMcpSourceFor } from './integrations-pi.ts'
import { whyNotUsable } from './main-model.ts'
import { openableUrl } from './open.ts'
import { piModelAccess, type LiveModelAccess, type ModelAccess } from './model-access.ts'
import { HomeOwner } from './owner.ts'
import { Questions } from './questions.ts'
import { scriptedModelAccess } from './scripted-access.ts'
import type { ScriptedOptions } from './scripted.ts'
import { listen, socketUrl, type HostServer } from './server.ts'
import { SignIn } from './signin.ts'
import { SlashCommands } from './slash.ts'
import { StateSync } from './state-sync.ts'
import { TurnRelay } from './turn-relay.ts'
import { ActivityKeeper } from './activity.ts'
import { agentHandlers } from './agents.ts'
import { routineHandlers } from './routines.ts'
import { appearanceRequest, loadHostAppearance } from './appearance-host.ts'
import { appearanceSession } from './appearance-session.ts'
import { Canvas } from './canvas.ts'
import { Nudges } from './nudge.ts'
import { decisionHandlers } from './decisions.ts'
import { reportHandlers } from './reports.ts'
import { workFrom, workHandlers } from './work.ts'
import { issueWorkReader, workIssueHandlers } from './work-issues.ts'
import type { GhCall } from './review/gh.ts'
import { reviewBrief } from './review/guide.ts'
import { hostReviews, reviewHandlers, toPrepare } from './review/seat.ts'

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
  /** Where the GitHub page reads from (024-github). Made-up data when not given, and gh never runs. The entry (`main.ts`) passes gh for --live and --github. */
  github?: GitHubSource
  /**
   * gh for Change Review: it reads pull requests, and a live host posts a verdict the user confirmed. Without it a
   * pull request reads as the sample change and nothing is posted. The entry passes it for --live and --github.
   */
  reviewGh?: GhCall
  /** Opens a page on github.com in the system browser. */
  openGitHub?: (url: string) => void
  /** Opens a web or mail address in the system's default app (`system.open`). Nothing opens when not given; the entry passes the real one. */
  openSystem?: (url: string) => void
  /** Opens a file in the system's default app (`file.open`). Nothing opens when not given. */
  openFile?: (path: string) => void
  /**
   * Where Integrations reads and writes MCP servers (023-integrations). Pi's own code over Pi's configuration when not
   * given: for a live host Pi's own folder, and for a scripted one the folder in PI_CODING_AGENT_DIR or the agent
   * folder in its home, never ~/.pi/agent.
   */
  integrations?: () => Promise<McpSource>
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

const whyNotLive = (owner: OwnerState): string => {
  if (owner.state === 'failed') return `hobkin could not start: ${owner.message}`
  return 'hobkin is still starting.'
}

/**
 * The host: hobkin's application for one home, behind a WebSocket on this machine.
 * It sends hobkin's state as it changes and runs the commands a UI sends back.
 */
/** The same handlers, with GitHub read again after each of `names` has done its work. What it answers is unchanged, and a refusal is passed on as it is. */
function thenReadGitHub<Handlers extends object>(handlers: Handlers, names: readonly (keyof Handlers)[], read: () => void): Handlers {
  const wrapped = { ...handlers }
  for (const name of names) {
    const run = handlers[name] as unknown as (...args: unknown[]) => unknown
    wrapped[name] = (async (...args: unknown[]) => {
      const said = await run(...args)
      read()
      return said
    }) as unknown as Handlers[typeof name]
  }
  return wrapped
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
  let server: HostServer | null = null

  const send = (socket: WebSocket, message: HostMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
  }
  const broadcast = (message: HostMessage) => {
    for (const socket of server?.sockets() ?? []) send(socket, message)
  }
  const publish = () => {
    const now = facts()
    const message = sync.update(now)
    if (message) broadcast(message)
    // Finished changes and pull requests waiting for the user get their reviews ready in the background (005 S6).
    reviews.watch(toPrepare(now.work, now.github))
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
    // hobkin passes on only the words of a filed question. Who filed it, why, and what they recommend is on record.
    describe: ({ question }) => {
      const filed = owner.filedQuestion(question)
      if (!filed) return {}
      const { from, tldr, recommended, why } = filed
      return { ...(from ? { from } : {}), ...(tldr ? { tldr } : {}), ...(recommended ? { recommended } : {}), ...(why ? { why } : {}) }
    },
  })

  // Every way to reach a model is Pi's: its own runtime for a live host, a scripted set of its providers otherwise.
  let opened: Promise<ModelAccess> | null = null
  const access = () => (opened ??= (options.access ?? (live ? piModelAccess : () => scriptedModelAccess()))())

  // hobkin reaches the app through one tool, which runs the same commands a click does (`013-hobkin-access`).
  const client = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })

  // Load optional styling before any owner startup; canonical data comes from root admission.
  const appearance = await loadHostAppearance(root, publish, log)
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
    },
    frontEnd: {
      askQuestion: questions.ask,
      presence: () => ({ seenAt: user.seenAt, away: !user.focused || !connected(), occupied: user.typing || questions.current() !== null }),
      clipboard: attachments.clipboard,
    },
    tools: [client],
    modelRuntime: live ? async () => ((await access()) as Partial<LiveModelAccess>).runtime : undefined,
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
  // The GitHub page reads through gh and only reads. It reads again every few minutes while a UI is connected.
  const github = new GitHub({ source: options.github ?? sampleGitHubSource(), onChange: publish, wanted: connected, log })
  // Integrations reads Pi's MCP servers only when asked, through Pi's own code, and hides their secrets before anything is sent.
  const integrations = new Integrations({ source: options.integrations ?? (() => piMcpSourceFor({ live, root })), onChange: publish, log })
  // The canvas panel: the page hobkin shows beside the screens. The window draws it (030-canvas-panel).
  const canvas = new Canvas({ onChange: publish })
  // The window moves and the composer draft hobkin drives for the user (013-hobkin-access). The window carries each out.
  const nudge = new Nudges({ onChange: publish })
  // An agent's last steps stay readable after it has finished, though hobkin drops them (011-work A3).
  const activity = new ActivityKeeper()
  // Change Review: reviews prepared in the background and kept in the home, and verdicts only on the user's word.
  const reviews = hostReviews({
    root,
    live,
    data: () => hobkin().runtime.directory,
    work: () => (owner.snapshot ? workFrom(owner.snapshot) : null),
    app: () => hobkin(),
    runtime: async () => (live ? ((await access()) as Partial<LiveModelAccess>).runtime : undefined),
    gh: options.reviewGh,
    // A pull request that merged is closed on GitHub, and so is the issue it fixes: both leave the lists now, not at the next five-minute read.
    merged: (pull) => (pull.url || pull.repo ? github.closed(pull) : github.readSoon()),
    log,
  })
  // Each issue on the GitHub page carries the hobkin work filed for it, read from hobkin's items when GitHub or hobkin's work changes.
  const issueWork = issueWorkReader(() => hobkin().runtime.directory)
  const facts = () => ({
    owner: owner.wireState(),
    signIn: signIn.state,
    models: signIn.models,
    github: issueWork(github.state, owner.snapshot?.work),
    integrations: integrations.state,
    canvas: canvas.state,
    nudge: nudge.state,
    appearance: appearanceRequest(appearance),
    // Work mode for the Work screen, read from the snapshot with hobkin's own rules (011-work).
    work: owner.snapshot ? workFrom(owner.snapshot) : null,
    snapshot: owner.snapshot && activity.keep(owner.wireSnapshot()!),
  })
  // hobkin's main conversations, only read, from the home (014-continuity A8). The one its session has open is current.
  const history = new History(root, () => (owner.app?.runtime.main as { sessionFile?: string } | undefined)?.sessionFile)
  const sync = new StateSync(facts())
  const lookAgain = () => void signIn.refresh().catch((error: unknown) => log(`Could not ask Pi about models: ${error instanceof Error ? error.message : String(error)}`))

  const hobkin = () => {
    if (!owner.app) throw new Unavailable(whyNotLive(owner.state))
    return owner.app
  }
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
  })
  const done = { ok: true } as const
  const handlers: HostHandlers = {
    ...appStateHandlers({ root, owner, revision: () => sync.full().rev }),
    'conversation.send': async ({ text, images = [], report, review, item }) => {
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
      const accepted = await app.send(words, about, pictures)
      attachments.sent(images)
      return { id: accepted.id, queued: accepted.queued === true }
    },
    'conversation.image': ({ messageId, ordinal }) => mainImage(hobkin, sync.shown(), messageId, ordinal),
    'history.image': async ({ id, messageId, ordinal }) => {
      const app = owner.app, main = app?.runtime.main
      const sessionId = (main as { sessionId?: string } | null)?.sessionId
      const image = await history.image(id, messageId, ordinal)
      return owner.app === app && app?.runtime.main === main && (main as { sessionId?: string } | null)?.sessionId === sessionId ? image : null
    },
    'conversation.attach': ({ name, data }) => attachments.attach(hobkin(), limits(), { name, bytes: Buffer.from(data, 'base64') }),
    'conversation.detach': ({ id }) => {
      attachments.detach(hobkin(), id)
      return done
    },
    'execution.stop': (args) => stopExecution(owner, args),
    'startup.force': (args) => owner.forceStartup(args),
    'conversation.stop': async () => {
      const unsent = await hobkin().interrupt()
      return { stopped: unsent !== null, unsent: unsent ?? [] }
    },
    'slash.list': async () => ({ commands: await slash.list(owner.app) }),
    'slash.run': ({ name, args = '' }) => name === '/reset' ? owner.resetMain(() => slash.run(hobkin(), name, args.trim())) : slash.run(hobkin(), name, args.trim()),
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
    'github.refresh': () => github.refresh(),
    // Whether this host runs older code than what is on disk, and the way to load it: the host closes as it does on
    // a signal, and the app that started it starts another. Answered first, so the window hears it went.
    'host.code': () => hostCode(startedAt),
    'host.restart': () => {
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 150).unref()
      return { ok: true as const }
    },
    // Integrations changes Pi's configuration only on the user's word, through Pi's own code (023-integrations).
    'integrations.refresh': () => integrations.refresh(),
    'integrations.turn-off': ({ name }) => integrations.turnOff(name),
    'integrations.turn-on': ({ name }) => integrations.turnOn(name),
    'integrations.add': ({ service, values }) => integrations.add(service, values),
    'integrations.remove': ({ name }) => integrations.remove(name),
    'github.open': ({ url }) => {
      // Nothing opens the user's browser unless the caller hands an opener in. The app does (main.ts); a test never does.
      ;(options.openGitHub ?? (() => {}))(url)
      return done
    },
    'system.open': ({ url }) => {
      // Checked again here, so no opener is ever handed an address the registry's pattern let through.
      ;(options.openSystem ?? (() => {}))(openableUrl(url).href)
      return done
    },
    'canvas.show': ({ url, title }) => canvas.show(url, title),
    'canvas.close': () => canvas.close(),
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
    'appearance.set': ({ palette, name }) => appearance.set(palette, name),
    'appearance.use': ({ theme }) => appearance.use(theme),
    'appearance.customize': ({ request }) => customTheme.start(request),
    'appearance.status': ({ id }) => customTheme.status(id),
    'file.read': ({ path }) => readTextFile(path),
    'file.open': async ({ path }) => {
      const real = await openablePath(path)
      ;(options.openFile ?? (() => {}))(real)
      return done
    },
    // The Work screen's actions, each one of hobkin's own work actions. A yes on a card can merge a pull request on
    // GitHub, and hobkin then closes the issue it fixed, so GitHub is read again once the action is done.
    ...thenReadGitHub(workHandlers({ app: hobkin, root: () => hobkin().runtime.directory }), ['work.change', 'work.group'], () => github.readSoon()),
    // Add to queue on the GitHub page: the issue is read through gh, only reading, and filed with hobkin's own issue action.
    // Close issue closes it through gh on the user's word, declines hobkin's unfinished item for it, and reads GitHub again.
    ...workIssueHandlers({ app: hobkin, root: () => hobkin().runtime.directory, gh: options.reviewGh, refreshGitHub: () => github.refresh() }),
    // Its agents and routines, stopped or told something while they work, by run id (011-work).
    ...agentHandlers({ app: hobkin, runs: () => (owner.snapshot?.runs ?? []) as RunSummary[] }),
    // Action Items answered from the window, each through hobkin's own decision or learning action (012).
    ...decisionHandlers({ app: hobkin }),
    ...reportHandlers({ app: hobkin }),
    // A routine's switch, its times and Run now, each through hobkin's own runner (010-routines).
    ...routineHandlers({ app: hobkin }),
    // Change Review: prepared reviews, the reviewer's notes, and verdicts (005, 009).
    ...reviewHandlers(reviews),
    'agent.session': ({ report }) => readJobSession({ data: () => hobkin().runtime.directory, snapshot: () => ({ reports: owner.snapshot?.reports, completedJobReports: owner.snapshot?.completedJobReports }), state: () => hobkin().runtime.state() }, report),
    'history.list': () => history.list(),
    'history.open': ({ id }) => history.open(id),
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
  })

  const receive = async (socket: WebSocket, data: RawData) => {
    let message: ClientMessage
    try {
      message = JSON.parse(String(data)) as ClientMessage
    } catch {
      return socket.close(CLOSE.badMessage, 'Not JSON')
    }
    if (message?.type === 'command' && typeof message.id === 'string' && typeof message.name === 'string') {
      send(socket, { type: 'result', id: message.id, ...(await runCommand(handlers, message.name, message.args)) })
    } else if (message?.type === 'presence') {
      const back = message.focused === true && !user.focused
      Object.assign(user, { focused: message.focused === true, typing: message.typing === true })
      // A report from a focused window is the user being there.
      if (user.focused) user.seenAt = Date.now()
      // The user may have changed Pi's setup in a terminal while the window was away.
      if (back) lookAgain()
    } else {
      socket.close(CLOSE.badMessage, 'Unknown message')
    }
  }

  server = await listen({
    port,
    token,
    origins: options.origins ?? [APP_ORIGIN, ...(dev ? [DEV_UI_ORIGIN] : [])],
    dev,
    onConnection: (socket) => {
      owner.reconnectStartup()
      send(socket, hello())
      send(socket, sync.full())
      for (const turn of turns.catchUp()) send(socket, turn)
      if (questions.current()) send(socket, { type: 'ask', question: questions.current() })
      socket.on('message', (data) => void receive(socket, data))
      // With nobody connected, nobody is there. hobkin then keeps its questions for later.
      socket.on('close', () => {
        if (!connected()) user.focused = false
      })
    },
  })
  writeHostFile(root, { pid: process.pid, port: server.port, token })
  openWhenReady()
  lookAgain()
  github.start()

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
        github.close()
        integrations.close()
        reviews.close()
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

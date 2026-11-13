import { Type, type Static, type TSchema } from 'typebox'
import { Check, Errors } from 'typebox/value'
import type { IntegrationsState } from '../integrations/wire.ts'
import { BUILT_IN_THEMES, paletteProblems } from '../protocol/appearance.ts'
import type { CanvasState } from '../protocol/canvas.ts'
import type { FileContent } from '../protocol/files.ts'
import type { GitHubState } from '../protocol/github.ts'
import type { KeyHelp, ModelsState } from '../protocol/models.ts'
import type { SlashCommand, SlashOutcome } from '../protocol/slash.ts'
import type { ShellFields } from '../protocol/snapshot.ts'
import { GRADES, ISSUE_PICKUPS, PR_MODES } from '../protocol/work.ts'
import type { OpenedReview, ReviewCode, ReviewCursor, ReviewList, ReviewMap, ReviewStatus, VerdictPreview } from '../review/status.ts'
import type { ReviewFileContents } from '../review/types.ts'
import { TIER_IDS, type HostTiers } from '../tiers/tiers.ts'

/**
 * Every action a person can take is a command here: a name, what it does, the shape of its arguments and where it runs.
 * The UI calls these for clicks and keys, and hobkin can call the same ones (`013-hobkin-access`).
 */
export interface CommandDefinition {
  description: string
  /** `host` runs in the Node host, next to hobkin. `view` acts on the window. */
  runs: 'host' | 'view'
  args: TSchema
  /** What the arguments must also satisfy that a schema cannot say. Returns what is wrong, as the end of "arguments ...", or null. */
  rule?: (args: Record<string, unknown>) => string | null
  /** hobkin may run it through its `client` tool. */
  hobkin?: true
  /** It changes something outside the app, such as Pi's setup, so it needs the user's yes in the window. */
  outside?: true
}

export interface ThemeOperation {
  id: string
  request: string
  status: 'running' | 'completed' | 'failed' | 'unknown'
  appearanceId: number | null
  error: string | null
  cleanup: 'pending' | 'confirmed' | 'unknown'
  child: string | null
}

export interface StartupTarget { home: string; epoch: string; token: string; sessionId: string | null }
export interface StartupForceArgs { target: StartupTarget; attemptId: string }
export interface StartupForceReceipt extends StartupForceArgs {
  fence: { status: 'confirmed' }
  closure: { status: 'confirmed' | 'unknown' | 'not-created' }
  opening: { status: 'settled' | 'unknown' }
  cleanup: { status: 'settled' | 'unknown' }
  persistence: { status: 'unchanged' | 'unknown' | 'committed'; sessionId?: string; sessionFile?: string }
  detachedCleanup: 'unknown'
  queueRecovery: 'not-applicable'
}

export interface ExecutionTarget {
  home: string
  epoch: string
  kind: 'main' | 'run' | 'agent'
  runId: string
  agentId?: string
}
export interface StopExecutionArgs {
  target: ExecutionTarget
  mode: 'stop' | 'force'
  attemptId: string
  how?: 'for-now' | 'not-approved'
}
export interface StopExecutionReceipt {
  target: ExecutionTarget
  mode: 'stop' | 'force'
  attemptId: string
  stop: { status: 'confirmed' | 'unknown' | 'not-attempted' }
  closure: { status: 'confirmed' | 'unknown' | 'not-attempted' | 'unsupported' }
  descendants: {
    status: 'confirmed' | 'unknown' | 'not-attempted'
    agents: { agentId: string; status: 'confirmed' | 'unknown' }[]
    cleanupScope: 'captured-rpc-children' | 'none'
    detachedCleanup: 'unknown'
  }
  queueRecovery: { status: 'confirmed'; unsent: string[]; alreadyReturned?: boolean } | { status: 'unknown' } | { status: 'not-attempted' }
  message?: string
}

const nothing = Type.Object({}, { additionalProperties: false })
const words = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: '\\S' })
/** Pi's id for a provider. Plain enough to name in a shell command. */
const provider = Type.Object({ provider: Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' }) }, { additionalProperties: false })
/** The thinking levels hobkin's main conversation takes: `efforts.pi` in hobkin's `src/cli/schedules.mjs`. */
export const MAIN_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
/** One of a few words. A union built with map checks the same at runtime, but its type collapses, so the type is named here. */
const oneOf = <const Word extends string>(choices: readonly Word[]) => Type.Unsafe<Word>(Type.Union(choices.map((choice) => Type.Literal(choice))))
/** One of hobkin's four tiers for delegated work, and the model and thinking level a tier holds (`017-model-tiers`). */
const tierName = oneOf(TIER_IDS)
const tierSetting = Type.Object({ model: Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{0,63}/\\S{1,256}$' }), effort: oneOf(MAIN_EFFORTS) }, { additionalProperties: false })
/** A work project by hobkin's slug for it, and one of its items by id. */
const projectSlug = Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,63}$' })
const workItem = words(64)
/** The commit a card showed. A merge pinned to it refuses a branch that moved since. */
const commit = Type.String({ pattern: '^[0-9a-f]{7,64}$' })
/** A routine by hobkin's id for it, and a time of day as its files write one (hobkin's `src/cli/schedules.mjs`). */
const routineId = Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{0,79}$' })
const clock = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })
/** An MCP server by its name in Pi's configuration, which Pi limits to letters, digits, `_` and `-`. */
const mcpServer = Type.Object({ name: Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$' }) }, { additionalProperties: false })
/** A review by what it reviews: a finished change, `change:<slug>:<item>`, or a pull request, `pr:<owner>/<repo>/<number>`. */
const reviewId = Type.String({ pattern: '^(change|pr):\\S{3,300}$' })
const verdict = oneOf(['comment', 'approve', 'approve-merge', 'request-changes'])
/** A reviewer's note as `shared/review/notes.ts` has it, so nothing else is kept in the home or sent with a verdict. */
const note = Type.Object(
  {
    id: words(64),
    step: words(256),
    target: Type.Union([
      Type.Object({ kind: Type.Literal('step') }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('node'), node: words(512) }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('wire'), wire: words(512) }, { additionalProperties: false }),
      Type.Object(
        { kind: Type.Literal('lines'), fileId: words(1024), side: oneOf(['added', 'deleted']), startLine: Type.Integer({ minimum: 1 }), endLine: Type.Integer({ minimum: 1 }), hash: words(128) },
        { additionalProperties: false },
      ),
    ]),
    intent: oneOf(['comment', 'question']),
    text: Type.String({ minLength: 1, maxLength: 20000 }),
    author: oneOf(['user', 'hobkin']),
    at: Type.Number(),
    sent: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
)
const noteEntry = Type.Union([
  Type.Object({ op: Type.Literal('put'), note }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('remove'), id: words(64) }, { additionalProperties: false }),
])
const noteDraft = Type.Union([
  Type.Null(),
  Type.Object({ intent: oneOf(['comment', 'question']), text: Type.String({ maxLength: 20000 }), editing: Type.Optional(words(64)) }, { additionalProperties: false }),
])

export const COMMANDS = {
  'app.state': {
    description: 'Read bounded current app owner, session, projection counts and activity. Does not reload. Loaded code revision may be unknown.',
    runs: 'host', args: nothing, hobkin: true,
  },
  'app.refresh': {
    description: 'Reproject current app information and return a completed read receipt. Does not reload, restart or reset. An unchanged state revision is a successful refresh.',
    runs: 'host', args: nothing, hobkin: true,
  },
  'host.code': {
    description: "Whether the host is running older code than the code on disk: when it started, and how many files of its own code changed since. A host loads its code once, so changes made afterwards wait for its next start.",
    runs: 'host', args: nothing, hobkin: true,
  },
  'host.restart': {
    description: "Restart the host alone, on the user's word, so it loads the code on disk: hobkin closes cleanly, and the app starts a new host. The window stays open and connects again. Agents and reviews that are running stop.",
    runs: 'host', args: nothing,
  },
  'conversation.send': {
    description: 'Send a message to hobkin, with the images attached to it and the report it is about, by id. While a turn is running it steers that turn.',
    runs: 'host',
    args: Type.Object(
      {
        text: Type.Optional(words(65536)),
        images: Type.Optional(Type.Array(words(64), { maxItems: 16 })),
        report: Type.Optional(words(256)),
        /** The review the user is in when they write, with the step and node they are on. hobkin gets where they are. */
        review: Type.Optional(Type.Object({ id: reviewId, step: Type.Optional(words(256)), node: Type.Optional(words(512)) }, { additionalProperties: false })),
        /** An action item the user replies to, as Action Items reads it. hobkin gets it ahead of the words, as it gets a report. */
        item: Type.Optional(Type.Object({ id: words(512), title: words(1000), body: Type.String({ maxLength: 24576 }) }, { additionalProperties: false })),
      },
      { additionalProperties: false },
    ),
    rule: ({ text, images, report, review, item }) => {
      if (text === undefined && !(Array.isArray(images) && images.length > 0)) return 'need words in "text" or at least one image'
      const about = [report, review, item].filter((entry) => entry !== undefined).length
      return about > 1 ? 'need one of "report", "review" and "item", not more' : null
    },
  },
  'conversation.attach': {
    description: 'Attach an image to the message being written. `data` is the file in base64. PNG, JPEG, GIF and WebP are taken.',
    runs: 'host',
    // The size is checked against hobkin's own limit once the bytes are here.
    args: Type.Object({ name: words(255), data: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  },
  'conversation.detach': {
    description: 'Take an attached image back out of the message being written.',
    runs: 'host',
    args: Type.Object({ id: words(64) }, { additionalProperties: false }),
  },
  'conversation.stop': {
    description: 'Stop the turn that is running. Returns the messages hobkin had not read yet.',
    runs: 'host',
    args: nothing,
  },
  'startup.force': {
    description: 'Fence this startup and force only its captured child. Closure, durable persistence and outer cleanup are separate facts.',
    runs: 'host',
    args: Type.Object({
      target: Type.Object({ home: words(4096), epoch: words(128), token: words(128), sessionId: Type.Union([words(512), Type.Null()]) }, { additionalProperties: false }),
      attemptId: Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' }),
    }, { additionalProperties: false }),
  },
  'execution.stop': {
    description: 'Stop or force the captured execution. Cancellation, transport closure and queue recovery are independent receipts.',
    runs: 'host',
    args: Type.Object({
      target: Type.Object({ home: words(4096), epoch: words(128), kind: oneOf(['main', 'run', 'agent']), runId: words(512), agentId: Type.Optional(words(128)) }, { additionalProperties: false }),
      mode: oneOf(['stop', 'force']),
      attemptId: Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' }),
      how: Type.Optional(oneOf(['for-now', 'not-approved'])),
    }, { additionalProperties: false }),
    rule: ({ target, how }) => {
      const { kind, agentId } = target as ExecutionTarget
      if ((kind === 'agent') !== (agentId !== undefined)) return 'require agentId only for an agent target'
      return how !== undefined && kind !== 'run' ? 'allow how only for a Work parent run' : null
    },
  },
  'slash.list': {
    description: 'List the slash commands of the message input: hobkin\'s own and the ones Pi offers, with how often each was run.',
    runs: 'host',
    args: nothing,
  },
  'slash.run': {
    description: 'Run a slash command, as typing it in the message input does. `args` is what follows the command.',
    runs: 'host',
    args: Type.Object({ name: Type.String({ pattern: '^/\\S+$', maxLength: 128 }), args: Type.Optional(Type.String({ maxLength: 65536 })) }, { additionalProperties: false }),
  },
  'avatar.wake': {
    description: 'Tell hobkin the user woke the sleeping avatar.',
    runs: 'host',
    args: nothing,
  },
  'question.answer': {
    description: "Answer the question hobkin is asking: `value` is one of its choices, `typed` is the user's own words.",
    runs: 'host',
    args: Type.Object({ id: words(64), value: Type.Optional(words(80)), typed: Type.Optional(words(1000)) }, { additionalProperties: false }),
    rule: ({ value, typed }) => ((value === undefined) !== (typed === undefined) ? null : 'need "value" or "typed", and only one of them'),
  },
  'question.defer': {
    description: 'Put the question off. It leaves the screen and waits under Action items.',
    runs: 'host',
    args: Type.Object({ id: words(64) }, { additionalProperties: false }),
  },
  'models.list': {
    description: 'List the model providers Pi knows: how each connects (a sign-in, an API key, cloud credentials) and whether it is connected now. Then the models Pi can use now, with their thinking levels and context size.',
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  'models.key-help': {
    description: "Say how to give Pi a provider's API key without typing it into the app: the environment variable Pi reads, or the macOS Keychain.",
    runs: 'host',
    args: provider,
    hobkin: true,
  },
  'models.keychain': {
    description: "Add one line to Pi's auth.json that reads the provider's key from the macOS Keychain, once the user has stored it there with the Terminal command from models.key-help.",
    runs: 'host',
    args: provider,
    outside: true,
  },
  'models.select': {
    description:
      "Choose the model and thinking level of hobkin's main conversation, from the models Pi can use now. hobkin saves them in its config.json, as its own model settings do, and the open conversation goes on with them at once.",
    runs: 'host',
    args: Type.Object(
      {
        model: Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{0,63}/\\S{1,256}$' }),
        // A union built with map checks the same at runtime, but its type collapses, so the type is named here.
        effort: Type.Optional(Type.Unsafe<(typeof MAIN_EFFORTS)[number]>(Type.Union(MAIN_EFFORTS.map((level) => Type.Literal(level))))),
      },
      { additionalProperties: false },
    ),
    outside: true,
  },
  'tiers.read': {
    description:
      "Read hobkin's tiers for delegated work from its config.json: the main chat's model, each of fast, mid, high and max as it runs now (its own model and effort, or the setting it follows until it has one), and the tier each of a change review's two roles uses, Reviewer and Quick.",
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  'tiers.apply': {
    description:
      "Save hobkin's tiers in its config.json, in one write or not at all. `tiers` gives a tier a model and thinking level of its own, from the models Pi can use now, or null to let it follow again. `review` names the tier of a change review's Reviewer or Quick. Whatever is left out stays as it is. The next delegated job and the next review use them.",
    runs: 'host',
    args: Type.Object(
      {
        tiers: Type.Optional(Type.Object(Object.fromEntries(TIER_IDS.map((tier) => [tier, Type.Optional(Type.Union([Type.Null(), tierSetting]))])), { additionalProperties: false })),
        review: Type.Optional(Type.Object({ reviewer: Type.Optional(tierName), quick: Type.Optional(tierName) }, { additionalProperties: false })),
      },
      { additionalProperties: false },
    ),
    rule: ({ tiers, review }) => (Object.keys(tiers ?? {}).length + Object.keys(review ?? {}).length > 0 ? null : 'need a tier or a review tier to save'),
    outside: true,
  },
  'signin.start': {
    description: 'Start signing in to a model provider through Pi, for a provider that offers a sign-in, such as a ChatGPT or Claude subscription. The user approves in the browser.',
    runs: 'host',
    args: provider,
    hobkin: true,
  },
  'signin.answer': {
    description: 'Answer what the sign-in asked, such as the redirect URL pasted from the browser.',
    runs: 'host',
    args: Type.Object({ prompt: words(64), value: words(8192) }, { additionalProperties: false }),
  },
  'signin.cancel': {
    description: 'Cancel the sign-in that is under way.',
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  'signin.out': {
    description: "Sign out of a model provider. Removes its credential from Pi's store.",
    runs: 'host',
    args: provider,
    outside: true,
  },
  'github.refresh': {
    description:
      "Read the user's GitHub again through gh, with the login gh already has: the pull requests waiting for their review, their own open pull requests, and their open issues. It only reads. A read already under way answers this one too.",
    runs: 'host',
    args: nothing,
  },
  'github.open': {
    description: 'Open a page on github.com in the system browser, such as a pull request from the GitHub page. Nothing but an https://github.com address is opened.',
    runs: 'host',
    args: Type.Object({ url: Type.String({ pattern: '^https://github\\.com/', maxLength: 2048 }) }, { additionalProperties: false }),
  },
  'github.issue.close': {
    description:
      "Close a GitHub issue through gh, as the user and only on their word from the GitHub page, by its repository `owner/name` and its number: `reason` is `completed` or `not-planned`. When hobkin has work filed for the issue that is not finished, hobkin's own work actions decline that item too, and a run going on it stops as not approved. GitHub's lists are read again after, so the issue leaves them.",
    runs: 'host',
    args: Type.Object(
      {
        repo: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+$', maxLength: 200 }),
        number: Type.Integer({ minimum: 1, maximum: 1000000000 }),
        reason: oneOf(['completed', 'not-planned']),
      },
      { additionalProperties: false },
    ),
  },
  'integrations.refresh': {
    description:
      "Read Pi's MCP configuration again and connect to each server that is on, the way `pi mcp list` does, to report its state, its tools and Pi's message when it fails. It only reads, and closes every connection it opened. A look already under way answers this one too.",
    runs: 'host',
    args: nothing,
  },
  'integrations.turn-off': {
    description: "Turn an MCP server off: Pi's configuration keeps its entry with enabled set to false, and Pi stops connecting to it. Nothing else in the file changes.",
    runs: 'host',
    args: mcpServer,
    outside: true,
  },
  'integrations.turn-on': {
    description: "Turn an MCP server back on: the enabled key leaves its entry in Pi's configuration, and Pi connects to it again. Nothing else in the file changes.",
    runs: 'host',
    args: mcpServer,
    outside: true,
  },
  'integrations.add': {
    description:
      "Add a service from the Integrations catalog to Pi's configuration, by its catalog id, with the values its entry asks for, such as the address of the user's own server. A key is never a value here: the entry reads it from an environment variable the user sets in their shell profile.",
    runs: 'host',
    args: Type.Object(
      {
        service: Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,63}$' }),
        values: Type.Optional(Type.Record(Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }), Type.String({ maxLength: 512 }))),
      },
      { additionalProperties: false },
    ),
    outside: true,
  },
  'integrations.remove': {
    description: "Remove an MCP server from Pi's configuration: its entry is deleted, and nothing else in the file changes.",
    runs: 'host',
    args: mcpServer,
    outside: true,
  },
  'system.open': {
    description: 'Open a web or mail address (http, https or mailto) in the Mac\'s default app for it, such as a link clicked in the chat.',
    runs: 'host',
    args: Type.Object({ url: Type.String({ pattern: '^(https?://|mailto:)\\S', maxLength: 4096 }) }, { additionalProperties: false }),
  },
  'canvas.show': {
    description:
      'Open the canvas, a panel beside the screens that shows a web page, so the user can see work happening for real, such as a local app under test. `url` is an http or https address. `title` names the page.',
    runs: 'host',
    args: Type.Object(
      { url: Type.String({ pattern: '^https?://\\S', maxLength: 4096 }), title: Type.Optional(words(120)) },
      { additionalProperties: false },
    ),
    hobkin: true,
  },
  'canvas.close': {
    description: 'Close the canvas panel.',
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  'appearance.customize': {
    description: 'Start one Settings-only custom theme operation.',
    runs: 'host',
    args: Type.Object(
      { request: words(4000) },
      { additionalProperties: false },
    ),
  },
  'appearance.status': {
    description: 'Read the latest retained theme operation, or an exact operation ID.',
    runs: 'host',
    args: Type.Object(
      { id: Type.Optional(words(64)) },
      { additionalProperties: false },
    ),
  },
  'appearance.set': {
    description:
      "Set the app's color theme from five colors, each #rrggbb: `background`, `surface` (cards), `text`, `muted` (secondary text), `accent`. Text and muted text must read on the background and on cards (4.5 to 1), or it is refused with the ratio so you can retry. `name` names the theme. Use it when the user asked for a theme, such as a Matrix one.",
    runs: 'host',
    args: Type.Object(
      {
        palette: Type.Object({
          background: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
          surface: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
          text: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
          muted: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
          accent: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
        }, { additionalProperties: false }),
        name: Type.Optional(words(60)),
      },
      { additionalProperties: false },
    ),
    rule: ({ palette }) => paletteProblems(palette).join(' ') || null,
    hobkin: true,
  },
  'appearance.use': {
    description:
      "Put the app on one of its own themes. `theme` is `system` (the default: follows the Mac, light by day and dark at night, and the way back from any custom theme), `light`, or `dark`. Use it when the user asks to go back to the default theme, to use dark mode or light mode, or to stop using a custom theme. It changes the window at once.",
    runs: 'host',
    args: Type.Object(
      { theme: Type.Union(BUILT_IN_THEMES.map((theme) => Type.Literal(theme))) },
      { additionalProperties: false },
    ),
    hobkin: true,
  },
  'file.read': {
    description: 'Read a file for the viewer: text only, up to 2 MB, a regular file only (links are followed). `path` is a full path or starts with ~/. Refused with a plain reason for anything else.',
    runs: 'host',
    args: Type.Object({ path: Type.String({ pattern: '^(/|~/)', maxLength: 4096 }) }, { additionalProperties: false }),
  },
  'file.open': {
    description: 'Open a file in the Mac\'s default app for it. `path` is a full path or starts with ~/. A program or an app bundle never opens this way.',
    runs: 'host',
    args: Type.Object({ path: Type.String({ pattern: '^(/|~/)', maxLength: 4096 }) }, { additionalProperties: false }),
  },
  'review.prepare': {
    description:
      "Start the AI review of a finished hobkin change or a GitHub pull request, by its review id, or review it again. It runs in the background and answers at once with how it stands: follow it with review.status or review.list. A review already prepared for the change's commit is used as it is. To review again, pass `refresh: true`: the review is built once more at the change's commit, with its tests and its model pass. A pull request is only read, through gh.",
    runs: 'host',
    args: Type.Object({ id: reviewId, refresh: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    hobkin: true,
  },
  'review.status': {
    description: 'How the preparation of a review stands: ready to open, being prepared and what it is doing, or failed and why. `stale` says the change has moved on to a commit the ready review was not built for.',
    runs: 'host',
    args: Type.Object({ id: reviewId }, { additionalProperties: false }),
    hobkin: true,
  },
  'review.list': {
    description: 'Every review the app knows, newest first: finished changes and pull requests, each with how its preparation stands, its change review when it has one (state, percent, what it is doing, its level once ready), and when it last changed.',
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  'review.stop': {
    description:
      "Stop a review that is waiting or running, by its review id: its tests are stopped where they are and nothing more of it runs. What was ready before stays. Several reviews can run at once, and each is stopped alone. Refused when that review is not running. review.prepare with `refresh: true` starts it again.",
    runs: 'host',
    args: Type.Object({ id: reviewId }, { additionalProperties: false }),
    hobkin: true,
  },
  'review.remove': {
    description:
      "Remove a review from the app, only ever on the user's word: every map built for it, its change review and the notes on it are deleted, and it leaves the list of AI reviews. This cannot be undone. It is refused while the review is being prepared. review.prepare builds it again from nothing.",
    runs: 'host',
    args: Type.Object({ id: reviewId }, { additionalProperties: false }),
    hobkin: true,
  },
  'review.map': {
    description:
      "A prepared review as a map: every node with what it does and what goes in and out, every wire with its kind, each test's path through the code, the story's steps by number, and the notes so far. No code. Read it first, then walk the review one node at a time.",
    runs: 'host',
    args: Type.Object({ id: reviewId }, { additionalProperties: false }),
    hobkin: true,
  },
  'review.code': {
    description: "The lines of one node of a prepared review, numbered, as the change left them and, where lines were removed, as they were.",
    runs: 'host',
    args: Type.Object({ id: reviewId, node: words(512) }, { additionalProperties: false }),
    hobkin: true,
  },
  'review.show': {
    description: "Moves the user's open review to a step, by its number from 1, or to a node, so they see what you are talking about. Name one.",
    runs: 'host',
    args: Type.Object({ id: reviewId, step: Type.Optional(Type.Integer({ minimum: 1, maximum: 999 })), node: Type.Optional(words(512)) }, { additionalProperties: false }),
    rule: ({ step, node }) => ((step === undefined) === (node === undefined) ? 'need "step" or "node", and only one' : null),
    hobkin: true,
  },
  'review.note': {
    description:
      "Leaves a note on a review, signed as hobkin: a comment, which goes with the fixes the user sends when the review is done, or a question for the user. It is about a node, a wire, or a step by its number. Nothing is sent anywhere.",
    runs: 'host',
    args: Type.Object(
      { id: reviewId, intent: oneOf(['comment', 'question']), text: words(4000), step: Type.Optional(Type.Integer({ minimum: 1, maximum: 999 })), node: Type.Optional(words(512)), wire: Type.Optional(words(512)) },
      { additionalProperties: false },
    ),
    rule: ({ node, wire }) => (node !== undefined && wire !== undefined ? 'need "node" or "wire", not both' : null),
    hobkin: true,
  },
  'review.get': {
    description: "A prepared review, with the reviewer's notes on it, sent and not. Refused while none is ready.",
    runs: 'host',
    args: Type.Object({ id: reviewId }, { additionalProperties: false }),
  },
  'review.file': {
    description: 'Both sides of one file of a prepared review: as it was, and as the change leaves it.',
    runs: 'host',
    args: Type.Object({ id: reviewId, fileId: words(1024) }, { additionalProperties: false }),
  },
  'review.notes': {
    description: "Keep the reviewer's notes on a review in the home, with the note being written, so they come back after a restart. Nothing is sent anywhere.",
    runs: 'host',
    args: Type.Object({ id: reviewId, entries: Type.Array(noteEntry, { maxItems: 2000 }), draft: noteDraft }, { additionalProperties: false }),
  },
  'review.preview': {
    description:
      "Show exactly what a verdict on a review would do, and do nothing: for a pull request the review GitHub would get, with its line comments. For a finished change, `approve` opens its pull request, `approve-merge` lands it as its card does, and `request-changes` sends the notes to hobkin's agent. `summary` is the user's words to go with it. `head` is the commit of the review on the user's screen: when the review the host holds is for another commit, the preview is refused. Answers with the `confirm` that review.verdict needs.",
    runs: 'host',
    args: Type.Object({ id: reviewId, verdict, summary: Type.String({ maxLength: 20000 }), head: Type.Optional(commit) }, { additionalProperties: false }),
  },
  'review.verdict': {
    description:
      "Give a verdict on a review, only ever on the user's word, once review.preview has shown them exactly what it does: a pull request gets one review on GitHub through gh, as the user. A finished change gets its pull request opened, or is merged or sent back through hobkin's own work actions. `confirm` is what the preview answered, and `head` the commit of the review on the user's screen. A verdict that would now do anything else, or act on another commit, is refused.",
    runs: 'host',
    args: Type.Object({ id: reviewId, verdict, summary: Type.String({ maxLength: 20000 }), confirm: Type.String({ pattern: '^[0-9a-f]{64}$' }), head: Type.Optional(commit) }, { additionalProperties: false }),
    outside: true,
  },
  'work.mode': {
    description:
      "Turn work mode on or off with hobkin's own switch. On starts nothing by itself: what runs is what the user starts, unless they chose auto-pick. The first time, `folder` says where to look for projects. Off lets running agents finish and starts nothing new.",
    runs: 'host',
    args: Type.Object({ on: Type.Boolean(), folder: Type.Optional(words(4096)) }, { additionalProperties: false }),
  },
  'work.queue': {
    description:
      "Act on a row of hobkin's queue, named by hobkin's own name for it in `row` (such as `item:storefront:3fa9c1`): `run` puts it first, as Enter does in the terminal, and it starts as soon as hobkin's limits allow. `now` starts it at once, as one extra worker when none is free and without waiting out the gap between starts, while a pause, the budget and any stop still hold it, and hobkin says which. `skip` sends it to the end of the queue, and `back` puts a skipped row back in its place.",
    runs: 'host',
    args: Type.Object({ row: words(256), action: oneOf(['run', 'now', 'skip', 'back']) }, { additionalProperties: false }),
  },
  'work.project': {
    description:
      'Change one setting of a project work mode works on: `priority`, P0 to P3, sets how often it runs and its place in the queue, `prs` sets where its finished work goes: `off` keeps it on a local branch, `draft` opens a draft PR, `published` opens a PR, and `issues` sets which of its open GitHub issues hobkin files as work by itself, every 15 minutes: `off`, `labeled` (only those labeled hobkin) or `all`.',
    runs: 'host',
    args: Type.Object(
      { slug: projectSlug, priority: Type.Optional(oneOf(GRADES)), prs: Type.Optional(oneOf(PR_MODES)), issues: Type.Optional(oneOf(ISSUE_PICKUPS)) },
      { additionalProperties: false },
    ),
    rule: ({ priority, prs, issues }) => ([priority, prs, issues].filter((setting) => setting !== undefined).length === 1 ? null : 'need "priority", "prs" or "issues", and only one of them'),
  },
  'work.proposal': {
    description:
      "Answer a project hobkin proposed, as y and n do in the terminal: `take` chooses it at the level hobkin proposed, so its work joins the queue, and `skip` leaves it alone. A project left alone is taken again with `take`.",
    runs: 'host',
    args: Type.Object({ slug: projectSlug, answer: oneOf(['take', 'skip']) }, { additionalProperties: false }),
  },
  'work.agents': {
    description: "Set how many work agents may run at once, from 1 to hobkin's most of 8, as `hobkin work agents` sets it. Running agents finish as they are.",
    runs: 'host',
    args: Type.Object({ agents: Type.Integer({ minimum: 1, maximum: 8 }) }, { additionalProperties: false }),
  },
  'work.change': {
    description:
      "Act on a finished change, only ever on the user's word: `merge` merges its branch on this machine and pushes nothing, `merge-pr` merges its PR on GitHub, `refresh-merge` has an agent bring it up to date and merges it once that run ends well, `review` has an agent review it, `ask` sends an agent back to it with the user's `note`, and `decline` says no. `head` is the commit the card showed, so a change that moved since is refused.",
    runs: 'host',
    args: Type.Object(
      {
        slug: projectSlug,
        item: workItem,
        action: oneOf(['merge', 'merge-pr', 'refresh-merge', 'review', 'ask', 'decline']),
        head: Type.Optional(commit),
        note: Type.Optional(Type.String({ maxLength: 4000 })),
      },
      { additionalProperties: false },
    ),
  },
  'work.group': {
    description:
      "The user's one yes on a group of finished changes: each row lands in turn, at the commit its card showed and the way its own card would, and one that cannot go says why while the rest still go. Answers with a line for each row and one that sums them up.",
    runs: 'host',
    args: Type.Object(
      {
        rows: Type.Array(Type.Object({ slug: projectSlug, item: workItem, how: oneOf(['merge', 'mergePr', 'refreshMerge']), head: Type.Optional(commit) }, { additionalProperties: false }), {
          minItems: 1,
          maxItems: 50,
        }),
      },
      { additionalProperties: false },
    ),
  },
  'work.issue': {
    description:
      "Add a GitHub issue to hobkin's work queue, by its repository `owner/name` and its number: the host finds the hobkin project whose repository is github.com/owner/name, reads the issue through gh, only reading, and files it with hobkin's own `issue` work action, first in the queue. A bug label makes it a fix, a security label security work. Adding it again changes nothing and says so. Refused with the reason when no hobkin project is that repository.",
    runs: 'host',
    args: Type.Object(
      { repo: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+$', maxLength: 200 }), number: Type.Integer({ minimum: 1, maximum: 1000000000 }) },
      { additionalProperties: false },
    ),
  },
  'agent.session': {
    description: 'Read the saved Pi job session belonging to a known report. Read-only; never resumes or sends its contents to a model. Returns the saved active branch; files over 2 MiB are refused without opening a partial branch.',
    runs: 'host',
    args: Type.Object({ report: words(256) }, { additionalProperties: false }),
  },
  'agent.stop': {
    description:
      "Stop an agent or routine that is running, by its run's id. A work agent stops the two ways hobkin's k stops one: `for-now` puts its item at the end of the queue, and `not-approved` records a no, so it does not run again. Its branch stays either way. Anything else is cancelled.",
    runs: 'host',
    args: Type.Object({ run: words(256), how: Type.Optional(oneOf(['for-now', 'not-approved'])) }, { additionalProperties: false }),
  },
  'agent.say': {
    description:
      "Queue the user's words for an agent's exact run. Acknowledgement is not a receipt; steeringReceipts reports notes admitted into a Pi turn. Refused once the run has finished.",
    runs: 'host',
    args: Type.Object({ run: words(256), text: words(4096), noteId: Type.Optional(Type.String({ maxLength: 36, pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })) }, { additionalProperties: false }),
  },
  'routine.run': {
    description:
      "Run a routine once now, by its id, as hobkin's run_routine does: even when it is off or not due, and no setting changes. hobkin refuses while it is already running or its background places are full. Answers once the run has started; its report comes later in Reports.",
    runs: 'host',
    args: Type.Object({ id: routineId }, { additionalProperties: false }),
  },
  'routine.enable': {
    description: "Turn a routine on or off: hobkin writes `enabled` in the routine's file, and nothing else in it changes. Off, it never runs by itself.",
    runs: 'host',
    args: Type.Object({ id: routineId, enabled: Type.Boolean() }, { additionalProperties: false }),
  },
  'routine.delete': {
    description: 'Delete the confirmed routine definition only; reports and run history stay.',
    runs: 'host',
    args: Type.Object({ id: routineId, expectedDefinition: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false }),
  },
  'routine.times': {
    description:
      "Change when a routine runs: `at` is one time or a list of times, HH:mm in the routine's timezone, and `window` a start, an end and the minutes between two checks. hobkin checks the change as it checks any routine file, writes it in the file and keeps the rest. A change ends a hold.",
    runs: 'host',
    args: Type.Object(
      {
        id: routineId,
        at: Type.Optional(Type.Union([clock, Type.Array(clock, { minItems: 1, maxItems: 48 })])),
        window: Type.Optional(Type.Object({ start: clock, end: clock, everyMinutes: Type.Integer({ minimum: 1, maximum: 1440 }) }, { additionalProperties: false })),
      },
      { additionalProperties: false },
    ),
    rule: ({ at, window }) => ((at === undefined) !== (window === undefined) ? null : 'need "at" or "window", and only one of them'),
  },
  'report.read': {
    description: 'Record a report read after at least three seconds in its reader. This never completes its action.',
    runs: 'host',
    args: Type.Object({ id: words(256), dwellMs: Type.Integer({ minimum: 3000, maximum: 86400000 }) }, { additionalProperties: false }),
  },
  'decision.answer': {
    description:
      "Answer something waiting in Action Items with hobkin's own decision action, as its Decisions tab does: `value` is one of its choices, `typed` the user's own words, which whoever asked hears. What the answer then does, such as a merge or a note to the routine that asked, is hobkin's.",
    runs: 'host',
    args: Type.Object({ id: words(64), value: Type.Optional(words(64)), typed: Type.Optional(words(4000)) }, { additionalProperties: false }),
    rule: ({ value, typed }) => ((value === undefined) !== (typed === undefined) ? null : 'need "value" or "typed", and only one of them'),
  },
  'learning.answer': {
    description:
      "Answer one of hobkin's learning proposals with its own learning action: `yes` plans it with the main agent in Chat, `later` asks again in a week, and `no` does not ask it again.",
    runs: 'host',
    args: Type.Object({ id: Type.String({ pattern: '^[0-9a-f]{6}$' }), value: oneOf(['yes', 'later', 'no']) }, { additionalProperties: false }),
  },
  'conversation.image': {
    description: 'Read one raster image from a currently displayed main message. Bytes are returned only to this request.',
    runs: 'host',
    args: Type.Object({ messageId: words(256), ordinal: Type.Integer({ minimum: 0, maximum: 99 }) }, { additionalProperties: false }),
  },
  'history.image': {
    description: 'Read one raster image by displayed entry identity on the selected saved main branch.',
    runs: 'host',
    args: Type.Object({ id: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.jsonl$' }), messageId: words(256), ordinal: Type.Integer({ minimum: 0, maximum: 99 }) }, { additionalProperties: false }),
  },
  'history.list': {
    description:
      "List hobkin's main conversations from its home, newest first: the one it is in now, and each earlier one a /reset left behind. Each has when it last spoke, a title and how many messages it holds. It only reads.",
    runs: 'host',
    args: nothing,
  },
  'history.open': {
    description:
      "Read one of hobkin's main conversations by the `id` history.list gave it: its user and assistant messages as Chat shows them, without thinking or tool calls, the newest few hundred. It only reads, and never resumes the conversation.",
    runs: 'host',
    args: Type.Object({ id: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.jsonl$' }) }, { additionalProperties: false }),
  },
} as const satisfies Record<string, CommandDefinition>

export type CommandName = keyof typeof COMMANDS
export type CommandArgs<Name extends CommandName> = Static<(typeof COMMANDS)[Name]['args']>

/** A completed read, not proof of deployed code or a restarted process. */
export interface AppStateRead {
  operation: { id: string; command: 'app.state' | 'app.refresh'; status: 'completed'; requestedAt: number; completedAt: number }
  home: string
  owner: { state: 'live'; id: string }
  sessionId: string
  loadedRevision: null
  stateRevision: number
  counts: { messages: number | null; reports: number | null; runs: number | null; activeRuns: number | null }
  activity: { busy: boolean | null; tooling: boolean | null; doing: string | null }
}

/** What each command answers with. */
export interface CommandResults {
  'app.state': AppStateRead
  'app.refresh': AppStateRead
  'host.code': { startedAt: string; changed: number; newestAt: string | null }
  'host.restart': { ok: true }
  'conversation.send': { id: string; queued: boolean }
  'conversation.attach': { id: string; name: string; mimeType: string; notice?: string }
  'conversation.detach': { ok: true }
  'conversation.stop': { stopped: boolean; unsent: string[] }
  'execution.stop': StopExecutionReceipt
  'startup.force': StartupForceReceipt
  'slash.list': { commands: SlashCommand[] }
  'slash.run': SlashOutcome
  'avatar.wake': { ok: true }
  'question.answer': { ok: true }
  'question.defer': { ok: true }
  'models.list': ModelsState
  'models.key-help': KeyHelp
  'models.keychain': { ok: true; connected: boolean }
  /** What hobkin saved. `applied`: the open conversation runs that model now. Without an open conversation, the next one starts on it. */
  'models.select': { ok: true; model: string; effort: string; applied: boolean }
  'tiers.read': HostTiers
  /** The tiers as hobkin holds them once saved. */
  'tiers.apply': HostTiers
  'signin.start': { ok: true }
  'signin.answer': { ok: true }
  'signin.cancel': { ok: true }
  /** `stillConnected`: Pi reaches the provider another way, such as an environment variable. `message` says so. */
  'signin.out': { ok: true; stillConnected: boolean; message: string }
  'github.refresh': GitHubState
  'github.open': { ok: true }
  /** What was done, in plain words: the issue closed on GitHub, and what hobkin said of its item, when it had one to decline. */
  'github.issue.close': { message: string }
  'system.open': { ok: true }
  'canvas.show': CanvasState
  'canvas.close': CanvasState
  'appearance.set': { ok: true }
  'appearance.use': { ok: true }
  'appearance.customize': ThemeOperation
  'appearance.status': ThemeOperation | null
  'file.read': FileContent
  'file.open': { ok: true }
  'review.prepare': ReviewStatus
  'review.status': ReviewStatus
  'review.list': ReviewList
  'review.remove': { id: string; removed: true }
  'review.stop': ReviewStatus
  'review.get': OpenedReview
  'review.file': ReviewFileContents
  'review.notes': { ok: true }
  'review.map': ReviewMap
  'review.code': ReviewCode
  'review.show': ReviewCursor
  /** The note's id. */
  'review.note': { id: string }
  'review.preview': VerdictPreview
  /** What was done, in plain words: where GitHub shows the review, or what hobkin said. */
  'review.verdict': { message: string }
  /** Each answers with the servers as they stand once the change is made and the server it touched was looked at. */
  'integrations.refresh': IntegrationsState
  'integrations.turn-off': IntegrationsState
  'integrations.turn-on': IntegrationsState
  'integrations.add': IntegrationsState
  'integrations.remove': IntegrationsState
  'work.mode': { enabled: boolean }
  /** What hobkin said, when it says something: `now` says whether the row started or what still holds it. */
  'work.queue': { ok: true; message?: string }
  'work.project': { ok: true }
  'work.proposal': { ok: true }
  /** How many work agents may run at once now. */
  'work.agents': { agents: number }
  /** What hobkin did, in its own words. */
  'work.change': { message: string }
  /** hobkin's line for each row, in the order they went, and the line that sums them up. */
  'work.group': { message: string; lines: string[] }
  /** What hobkin said: the issue was added, or it was already filed. */
  'work.issue': { message: string }
  /** What hobkin did, in its own words. */
  'agent.stop': { message: string }
  'agent.say': { queued: boolean }
  'agent.session': SavedJobSession
  /** The run hobkin started. */
  'routine.run': { run: string }
  'routine.enable': { ok: true }
  'routine.times': { ok: true }
  'routine.delete': { id: string; deleted: true }
  /** What hobkin said of the answer, and whether the item went to the main agent in Chat and stays open until done. */
  'report.read': { ok: true }
  'decision.answer': { message: string; handedOff: boolean }
  'learning.answer': { message: string }
  'conversation.image': StoredImage | null
  'history.image': StoredImage | null
  'history.list': { conversations: HistoryEntry[] }
  'history.open': HistoryConversation
}

/** Raw saved entries, in active-branch order. Unknown fields stay intact; this is not model input. */
export interface SavedJobSession {
  report: string
  run: string
  entries: Record<string, unknown>[]
  cut: boolean
  skipped: number
  limit: number
}

/** One of hobkin's main conversations, as History lists it. */
export interface HistoryEntry {
  /** Its file in the home's `sessions` folder. */
  id: string
  /** Its name in Pi, or the first line the user wrote. */
  title: string
  /** When it last spoke, in milliseconds. */
  at: number
  /** The user and assistant messages Chat would show of it. */
  messages: number
  /** hobkin is in this conversation now. */
  current: boolean
  /** The file is longer than History reads, so only its start counts. */
  cut: boolean
}

export interface StoredImage { mimeType: string; data: string }

export interface HistoryMessage extends Partial<ShellFields> {
  id?: string
  role: 'user' | 'assistant' | 'bashExecution'
  /** Markdown for normal messages; literal output for native shells. */
  text: string
  at: number | null
  /** The report the user's message was about. */
  about?: string
  images?: number
}

export interface HistoryConversation extends Omit<HistoryEntry, 'messages'> {
  /** The newest messages, oldest first. */
  messages: HistoryMessage[]
  /** How many messages came before the first one here. */
  earlier: number
}

export type ArgumentCheck = { ok: true } | { ok: false; code: 'unknown-command' | 'invalid-arguments'; message: string }

export const isCommand = (name: string): name is CommandName => Object.hasOwn(COMMANDS, name)

/** Whether `args` fit the command, with the first reason they do not. */
export function checkArguments(name: string, args: unknown): ArgumentCheck {
  if (!isCommand(name)) return { ok: false, code: 'unknown-command', message: `There is no command named "${name}".` }

  const { args: schema, rule } = COMMANDS[name] as CommandDefinition
  if (Check(schema, args)) {
    const broken = rule?.(args as Record<string, unknown>)
    return broken ? { ok: false, code: 'invalid-arguments', message: `${name}: arguments ${broken}.` } : { ok: true }
  }

  // The most specific error names the argument. An extra property is reported on the object that holds it.
  const errors = Errors(schema, args)
  const error = errors.find(({ keyword }) => keyword === 'additionalProperties') ?? errors.find(({ instancePath }) => instancePath) ?? errors[0]
  const extra = (error?.params as { additionalProperties?: string[] } | undefined)?.additionalProperties
  const where = error?.instancePath ? error.instancePath.slice(1).replaceAll('/', '.') : 'arguments'
  const reason = extra?.length ? `must not have "${extra.join('", "')}"` : (error?.message ?? 'do not fit the command')
  return { ok: false, code: 'invalid-arguments', message: `${name}: ${where} ${reason}.` }
}

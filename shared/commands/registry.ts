import { Type, type Static, type TSchema } from 'typebox'
import { Check, Errors } from 'typebox/value'
import { BACKUP_CADENCES, BACKUP_LIMIT_MAX, type BackupState } from '../backup/types.ts'
import type { IntegrationsState } from '../integrations/wire.ts'
import type { ExtensionsState, SkillFile, SkillsState } from '../pi-resources/wire.ts'
import { BUILT_IN_THEMES, paletteProblems } from '../protocol/appearance.ts'
import { KEPT_ASKED_MAX, KEPT_ID_PATTERN, KEPT_NAME_MAX, type KeptThemes } from '../protocol/theme-history.ts'
import { DRAWING_MAX_BYTES, type CanvasContent, type CanvasSaved, type CanvasState } from '../protocol/canvas.ts'
import { HOBKIN_CLAUDE_EFFORTS, HOBKIN_MESSAGE_MAX, HOBKIN_TELL_MAX, HOBKIN_TITLE_MAX, type HobkinConversation, type HobkinReach, type HobkinSummary } from '../protocol/hobkins.ts'
import { CLAUDE_AGENT_KINDS, CLAUDE_EFFORTS, CLAUDE_MODELS, CLAUDE_PERMISSIONS, type ClaudeCodeState } from '../protocol/claude-code.ts'
import { DIRECTIONS_MAX_BYTES, DIRECTIONS_MISSING, type DirectionsFile, type DirectionsSaved } from '../protocol/directions.ts'
import type { FileContent } from '../protocol/files.ts'
import type { GitHubState } from '../protocol/github.ts'
import type { KeyHelp, ModelsState, ModelsUpdate } from '../protocol/models.ts'
import { NUDGE_SCREENS } from '../protocol/nudge.ts'
import type { SystemMetrics, UsageFacts } from '../protocol/system.ts'
import type { SlashCommand, SlashOutcome } from '../protocol/slash.ts'
import type { ShellFields } from '../protocol/snapshot.ts'
import {
  COMPUTER_KINDS,
  PROFILE_TEXT_MAX,
  PROJECTS_MAX,
  SETUP_ANSWER_MAX,
  SETUP_ANSWERS_MAX,
  SETUP_ASK_MAX,
  type PiSetup,
  type ProjectsFound,
  type SetupSaved,
  type SetupWorkDone,
  type UserProfile,
} from '../protocol/setup.ts'
import { PI_PACKAGES } from '../setup/pi-packages.ts'
import type { ProofRun } from '../protocol/proofs.ts'
import { METRICS_DAYS_MAX, type WorkMetrics } from '../protocol/metrics.ts'
import type { ActivityEntry } from '../protocol/activity.ts'
import { GRADES, ISSUE_PICKUPS, PR_MODES } from '../protocol/work.ts'
import type { OpenedReview, ReviewCode, ReviewCursor, ReviewList, ReviewMap, ReviewStatus, VerdictPreview } from '../review/status.ts'
import type { ReviewFileContents } from '../review/types.ts'
import { EFFORTS, TIER_IDS, type HostTiers } from '../tiers/tiers.ts'

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
export const MAIN_EFFORTS = EFFORTS
/** One of a few words. A union built with map checks the same at runtime, but its type collapses, so the type is named here. */
const oneOf = <const Word extends string>(choices: readonly Word[]) => Type.Unsafe<Word>(Type.Union(choices.map((choice) => Type.Literal(choice))))
/** One of hobkin's four tiers for delegated work, and the model and thinking level a tier holds (`017-model-tiers`). */
const tierName = oneOf(TIER_IDS)
const tierSetting = Type.Object({ model: Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{0,63}/\\S{1,256}$' }), effort: oneOf(MAIN_EFFORTS) }, { additionalProperties: false })
/** A durable hobkin by its id (`034-durable-hobkins`). On a canvas command it names whose canvas; left out, the main hobkin's. */
const hobkinId = Type.String({ pattern: '^[0-9a-f]{8}$' })
/** What a durable hobkin runs on: a tier, Claude Code with nothing asked, or a model Pi can reach with a thinking level. */
const hobkinEngine = Type.Union([
  Type.Object({ kind: Type.Literal('tier'), tier: tierName }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('claude'), model: Type.Optional(oneOf(CLAUDE_MODELS)), effort: Type.Optional(oneOf(HOBKIN_CLAUDE_EFFORTS)) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('pi'), model: Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{0,63}/\\S{1,256}$' }), effort: oneOf(MAIN_EFFORTS) }, { additionalProperties: false }),
])
/** A work project by hobkin's slug for it, and one of its items by id. */
const projectSlug = Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,63}$' })
const workItem = words(64)
/** A proof run's id, the name of its folder in hobkin's home. */
const proofRunId = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$' })
/** The commit a card showed. A merge pinned to it refuses a branch that moved since. */
const commit = Type.String({ pattern: '^[0-9a-f]{7,64}$' })
/** A folder on this Mac, written out in full, as `setup.projects` lists them. */
const absolutePath = Type.String({ minLength: 2, maxLength: 1024, pattern: '^/' })
/** A routine by hobkin's id for it, and a time of day as its files write one (hobkin's `src/cli/schedules.mjs`). */
const routineId = Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{0,79}$' })
const clock = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })
/** An MCP server by its name in Pi's configuration, which Pi limits to letters, digits, `_` and `-`. */
const mcpServer = Type.Object({ name: Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$' }) }, { additionalProperties: false })
/** A skill or an extension by Pi's own path for it: its file, or `builtin:<name>` for an extension built into Pi (039-skills-and-extensions). */
const piResource = Type.Object({ path: Type.String({ minLength: 2, maxLength: 4096, pattern: '^(/|builtin:[a-z0-9.-]+$)' }) }, { additionalProperties: false })
/** A review by what it reviews: a finished change, `change:<slug>:<item>`, or a pull request, `pr:<owner>/<repo>/<number>`. */
const reviewId = Type.String({ pattern: '^(change|pr):\\S{3,300}$' })
const verdict = oneOf(['comment', 'approve', 'approve-merge', 'request-changes', 'discard', 'discard-branch'])
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
/** When the user sent a message, in milliseconds since the epoch on the window's clock, for hobkin's timing of the turn. Only to a host that takes it (`../protocol/timings.ts`). */
const sentAt = Type.Optional(Type.Integer({ minimum: 0 }))

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
  // Local backup of hobkin's records in its home into timestamped zips outside it. Restore replaces the records, so it is the user's alone.
  'backup.list': {
    description: 'Read the local backup settings, the backups kept (name, time, size), and when the next automatic one runs. It only reads.',
    runs: 'host', args: nothing, hobkin: true,
  },
  'backup.config': {
    description: `Turn automatic local backup of hobkin's records on or off, choose how often it runs (hourly or daily), and how many backups to keep (1 to ${BACKUP_LIMIT_MAX}, the oldest are deleted). Whatever is left out stays as it is.`,
    runs: 'host',
    args: Type.Object(
      { enabled: Type.Optional(Type.Boolean()), cadence: Type.Optional(oneOf(BACKUP_CADENCES)), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: BACKUP_LIMIT_MAX })) },
      { additionalProperties: false },
    ),
    rule: ({ enabled, cadence, limit }) => (enabled === undefined && cadence === undefined && limit === undefined ? 'need a setting to change' : null),
  },
  'backup.now': {
    description:
      "Zip hobkin's own records now (settings, memory, notes, routines, reports, decisions, conversations and each project's work records) into a timestamped file, and delete the oldest backups past the limit (the copies taken before a restore are kept apart). Working copies and clones of projects, any other git checkout, what runs leave beside their reports, run transcripts and the search index are left out. So is anything in the home that hobkin did not write itself, such as a folder an agent left there: it is listed with its size as left out. What hobkin's own could not be read is listed as a failure.",
    runs: 'host', args: nothing,
  },
  'backup.restore': {
    description:
      "Put hobkin's records back as a backup has them, after saving a copy of the records there now. Working copies and clones of projects, the rest a backup leaves out, and any file no backup could take stay as they are now. Destructive and only for the user to confirm in the window, once nothing runs: hobkin must be restarted afterwards to see it, and the window restarts the host at once.",
    runs: 'host',
    args: Type.Object(
      { name: Type.String({ pattern: '^hobkin-backup-\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\d(-before-restore)?\\.zip$' }), confirm: Type.Literal(true) },
      { additionalProperties: false },
    ),
  },
  'system.metrics': {
    description: 'Read how busy the machine the host runs on is now: CPU use, memory used and disk space occupied. It only reads.',
    runs: 'host', args: nothing,
  },
  'usage.facts': {
    description: "Read when hobkin was first set up and how many conversations it has had, from hobkin's own files. It only reads.",
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
        sentAt,
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
    description:
      "Attach an image to the message being written. `data` is the file in base64. PNG, JPEG, GIF and WebP are taken. `agent` names the agent the message is for, by its run id or `hobkin:<id>` for a durable hobkin: its images count against that message alone, and hobkin's own model need not see images. Without it the image is for hobkin's own conversation.",
    runs: 'host',
    // The size is checked against hobkin's own limit once the bytes are here.
    args: Type.Object({ name: words(255), data: Type.String({ minLength: 1 }), agent: Type.Optional(words(256)) }, { additionalProperties: false }),
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
    hobkin: true,
  },
  'question.defer': {
    description: 'Put the question off. It leaves the screen and waits under Action items.',
    runs: 'host',
    args: Type.Object({ id: words(64) }, { additionalProperties: false }),
    hobkin: true,
  },
  'models.list': {
    description: 'List the model providers Pi knows: how each connects (a sign-in, an API key, cloud credentials) and whether it is connected now. Then the models Pi can use now, with their thinking levels and context size.',
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  'models.update': {
    description: "Refresh Pi's model catalogs from the network, as `pi update` does, and list the models again with what is new and what a provider could not give.",
    runs: 'host',
    args: nothing,
    outside: true,
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
  'claude-code.read': {
    description:
      "Read whether Claude Code is installed on this Mac and signed in, and how hobkin's other agents use it: whether Work runs, delegated jobs and routines run on Claude Code instead of Pi, with which model and thinking effort, and what they may do without asking. The main chat always runs on Pi.",
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  'claude-code.apply': {
    description:
      "Change how hobkin's other agents use Claude Code. `enabled` runs them on Claude Code instead of Pi. `kinds` picks which of them: work, sessions (jobs hobkin delegates) and routines. `model` is a Claude Code alias, or default for the account's own. `effort` follows each agent's tier or fixes a level. `permissions` says what they may do without asking: auto (Claude Code's reviewer approves safe actions and asks the user when unsure), ask (every action that needs approval asks the user), edits (file edits go ahead, commands ask) or all (everything goes ahead). Whatever is left out stays as it is. Agents already running keep what they started with.",
    runs: 'host',
    args: Type.Object(
      {
        enabled: Type.Optional(Type.Boolean()),
        kinds: Type.Optional(Type.Object(Object.fromEntries(CLAUDE_AGENT_KINDS.map((kind) => [kind, Type.Optional(Type.Boolean())])), { additionalProperties: false })),
        model: Type.Optional(oneOf(CLAUDE_MODELS)),
        effort: Type.Optional(oneOf(CLAUDE_EFFORTS)),
        permissions: Type.Optional(oneOf(CLAUDE_PERMISSIONS)),
      },
      { additionalProperties: false },
    ),
    rule: (change) => (Object.keys(change).length > 0 ? null : 'need a setting to change'),
    // It spends the user's Claude subscription and sets what agents may do, so only the window changes it.
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
  // The first-run setup (025-onboarding). hobkin keeps its own `profile` command, so these are the window's alone.
  'profile.read': {
    description: "Read who the user told hobkin they are, from profile.json in its home: their name, their email, and whether this is their personal or their work computer. Null is not said yet.",
    runs: 'host',
    args: nothing,
  },
  'profile.set': {
    description:
      "Save who the user is in hobkin's profile.json: `name`, `email`, and `computer`, personal or work. Whatever is left out stays as it is. hobkin checks every value, and saves all of them or none.",
    runs: 'host',
    args: Type.Object(
      { name: Type.Optional(words(PROFILE_TEXT_MAX)), email: Type.Optional(words(PROFILE_TEXT_MAX)), computer: Type.Optional(oneOf(COMPUTER_KINDS)) },
      { additionalProperties: false },
    ),
    rule: (change) => (Object.keys(change).length > 0 ? null : 'need a name, an email or a computer to save'),
  },
  // hobkin's directions, edited in Settings (020-settings). hobkin's agents write the file themselves, so these are the window's alone.
  'directions.read': {
    description:
      "Read hobkin's directions, AGENTS.md in its home, whole: its text and a version of it to save against. With no file yet, hobkin's default, which hobkin writes there the first time it reads it.",
    runs: 'host',
    args: nothing,
  },
  'directions.save': {
    description:
      "Save hobkin's directions to AGENTS.md in its home, in one write. `version` is what directions.read gave: when the file changed since, nothing is saved and the answer says so. At most 65,536 bytes.",
    runs: 'host',
    // The cap is on UTF-8 bytes, which the host counts and refuses with the size. This only bounds the message.
    args: Type.Object(
      { text: Type.String({ maxLength: DIRECTIONS_MAX_BYTES * 4 }), version: Type.String({ pattern: `^(${DIRECTIONS_MISSING}|[0-9a-f]{64})$` }) },
      { additionalProperties: false },
    ),
  },
  'setup.pi': {
    description: "Read whether Pi is installed on this Mac at the version hobkin runs on, whether npm is there to install it, and which of the Pi packages hobkin's agents use Pi has. It only reads.",
    runs: 'host',
    args: nothing,
  },
  'setup.projects': {
    description: 'List the folders directly inside the folder the user says their projects live in, the ones changed most recently first, and whether each is a git repository. It reads names only, never a file.',
    runs: 'host',
    args: Type.Object({ folder: words(1024) }, { additionalProperties: false }),
  },
  'setup.save': {
    description:
      "Save the setup's answers so far: whose computer this is, each answered question with the words it was asked with, and the projects picked. The app keeps them in client/setup.json in hobkin's home, and hobkin keeps the answers, each cut to one short line, in front of its directions for the main chat, its checks and its work agents. Each save replaces the one before.",
    runs: 'host',
    args: Type.Object(
      {
        computer: Type.Optional(oneOf(COMPUTER_KINDS)),
        answers: Type.Array(
          Type.Object({ id: Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }), ask: words(SETUP_ASK_MAX), answer: words(SETUP_ANSWER_MAX) }, { additionalProperties: false }),
          { maxItems: SETUP_ANSWERS_MAX },
        ),
        projects: Type.Array(Type.Object({ name: words(255), path: absolutePath, git: Type.Boolean() }, { additionalProperties: false }), { maxItems: PROJECTS_MAX }),
      },
      { additionalProperties: false },
    ),
  },
  'setup.saved': {
    description: 'Read what the setup saved the last time it ran, from client/setup.json in hobkin\'s home, or null when it never saved anything. It only reads.',
    runs: 'host',
    args: nothing,
  },
  'setup.work': {
    description:
      "Hand work mode the projects folder the user named in the setup and the projects they picked there, by path. The folder is saved only while work mode is off, and work mode is never turned on. A project work mode already knows is left as it is, and one that is not a git repository is skipped. The rest are taken, which starts nothing, or, while work mode runs and picks by itself, only proposed for the user to take in Work.",
    runs: 'host',
    args: Type.Object({ folder: words(1024), projects: Type.Array(absolutePath, { maxItems: PROJECTS_MAX }) }, { additionalProperties: false }),
  },
  'setup.install-pi': {
    description: 'Install the Pi version hobkin runs on, globally on this Mac, with npm. Answers with Pi as it is after.',
    runs: 'host',
    args: nothing,
    outside: true,
  },
  'setup.install-package': {
    description: "Install one of the Pi packages hobkin's agents use, by its name, through `pi install`. Answers with Pi as it is after.",
    runs: 'host',
    args: Type.Object({ name: oneOf(PI_PACKAGES.map(({ name }) => name)) }, { additionalProperties: false }),
    outside: true,
  },
  'setup.launcher': {
    description:
      "On a work computer, take the command the company provides to start Pi, such as `work-pi`. hobkin asks it for its models, refuses it with what it printed when it lists none, and otherwise keeps it as the launcher in its config and starts the main conversation again behind it. Answers with Pi as it is after.",
    runs: 'host',
    args: Type.Object({ command: words(500) }, { additionalProperties: false }),
    outside: true,
  },
  'setup.install-node': {
    description:
      "Install a Node of hobkin's own, for a Mac without npm: the official build of the Node the host runs on, for this Mac's chip, checked against nodejs.org's checksums and unpacked into client/node in hobkin's home, then put on the host's PATH. It needs no admin password and changes nothing else on the Mac. Answers with Pi as it is after.",
    runs: 'host',
    args: nothing,
    outside: true,
  },
  // The first-run setup runs it by default (050-tla-proofs), so it is the window's alone.
  'setup.install-proof-tools': {
    description:
      "Set up the TLA+ tools proof checks run on, as `hobkin proof setup` does: on a Mac without Java 11 or newer, the pinned Java runtime into tools/java in hobkin's home, then the pinned TLC into tools/tla and, on an Apple-silicon Mac, the pinned TLAPS proof system into tools/tlaps, each kept only when its pinned checksum matches. What is there already is kept. Answers with whether the tools are ready and hobkin's one line. A failed setup is an answer, not an error.",
    runs: 'host',
    args: nothing,
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
  // Skills and Pi extensions change Pi's settings only on the user's word, through the code `pi config` runs (039-skills-and-extensions).
  'skills.refresh': {
    description: "Read every skill Pi has again, as `pi config` lists them: each with Pi's name and description for it, where Pi found it, and whether it is on. It only reads, and installs nothing.",
    runs: 'host',
    args: nothing,
  },
  'skills.read': {
    description: "Read one of Pi's skills in full, by its path: its description and the rest of its file. Only a file on Pi's list of skills is read.",
    runs: 'host',
    args: piResource,
  },
  'skills.turn-off': {
    description: "Turn a skill off in Pi's settings, as `pi config` does: Pi stops loading it from its next start or reload. The skill's file stays as it is.",
    runs: 'host',
    args: piResource,
    outside: true,
  },
  'skills.turn-on': {
    description: "Turn a skill back on in Pi's settings, as `pi config` does. Pi loads it again from its next start or reload.",
    runs: 'host',
    args: piResource,
    outside: true,
  },
  'extensions.refresh': {
    description: "Read Pi's packages and extensions again, as `pi config` lists them: each package with its version and its extensions, and the extensions in Pi's own folder, its settings and Pi itself, each with whether it is on. It only reads, and installs nothing.",
    runs: 'host',
    args: nothing,
  },
  'extensions.check-updates': {
    description: "Ask Pi whether its packages have updates, with the check behind Pi's startup notice: `npm view` for an npm package and `git ls-remote` for a git one. It only reads: nothing is installed or fetched.",
    runs: 'host',
    args: nothing,
  },
  'extensions.turn-off': {
    description: "Turn an extension off in Pi's settings, as `pi config` does, by its path: Pi stops loading it from its next start or reload. Its files stay as they are.",
    runs: 'host',
    args: piResource,
    outside: true,
  },
  'extensions.turn-on': {
    description: "Turn an extension back on in Pi's settings, as `pi config` does. Pi loads it again from its next start or reload.",
    runs: 'host',
    args: piResource,
    outside: true,
  },
  'system.open': {
    description: 'Open a web or mail address (http, https or mailto) in the Mac\'s default app for it, such as a link clicked in the chat.',
    runs: 'host',
    args: Type.Object({ url: Type.String({ pattern: '^(https?://|mailto:)\\S', maxLength: 4096 }) }, { additionalProperties: false }),
  },
  'canvas.show': {
    description:
      "Open the canvas, the right side of the user's window, on a web page, so the user can see work happening for real, such as a local app under test. Only when the user asks for it. `url` is an http or https address. `title` names the page.",
    runs: 'host',
    args: Type.Object(
      { url: Type.String({ pattern: '^https?://\\S', maxLength: 4096 }), title: Type.Optional(words(120)), hobkin: Type.Optional(hobkinId) },
      { additionalProperties: false },
    ),
    hobkin: true,
  },
  'canvas.close': {
    description: "Close the canvas. `hobkin` names a durable hobkin's canvas; left out, the main one.",
    runs: 'host',
    args: Type.Object({ hobkin: Type.Optional(hobkinId) }, { additionalProperties: false }),
    hobkin: true,
  },
  'canvas.draw': {
    description:
      "Draw on the canvas: `html` is one whole HTML document that stands by itself, such as a diagram, a whiteboard or a mock-up, and it replaces the drawing that was there. Only when the user asks for a drawing; never on your own. The user sees it change in place, so keep each element's `id` from one drawing to the next. The canvas opens on it. `title` names it. `hobkin` names a durable hobkin's canvas; left out, the main one.",
    runs: 'host',
    args: Type.Object(
      { html: Type.String({ minLength: 1, maxLength: DRAWING_MAX_BYTES }), title: Type.Optional(words(120)), hobkin: Type.Optional(hobkinId) },
      { additionalProperties: false },
    ),
    hobkin: true,
  },
  'canvas.read': {
    description:
      "What a canvas shows now: open or closed, a page or a drawing, its title, and the file that holds its drawing, to read before changing it. `hobkin` names a durable hobkin's canvas; left out, the main one.",
    runs: 'host',
    args: Type.Object({ hobkin: Type.Optional(hobkinId) }, { additionalProperties: false }),
    hobkin: true,
  },
  'canvas.save': {
    description:
      "Save the canvas's drawing as an HTML file: at `path` (absolute or under ~), or in Downloads under a name made from the title. It never replaces a file. Answers with where it went.",
    runs: 'host',
    args: Type.Object({ path: Type.Optional(words(1024)), hobkin: Type.Optional(hobkinId) }, { additionalProperties: false }),
    hobkin: true,
  },
  // Durable hobkins (`034-durable-hobkins`): the hobkins the user starts with Command+N and drives themselves. Starting,
  // talking and ending are the window's, since they spend the user's subscriptions. hobkin may read, list and message
  // them, and its message is always its own, never the user's.
  'hobkin.start': {
    description:
      'Start a durable hobkin: a hobkin the user talks to directly, which keeps its conversation until the user ends it. `cwd` is the folder it works in, and `engine` what it runs on: a tier, Claude Code with nothing asked (with a model and a thinking level of its own), or a model Pi can reach with a thinking level. `text` is its first message: with none it starts waiting, and its first turn is the first message sent to it.',
    runs: 'host',
    args: Type.Object(
      { cwd: words(1024), engine: hobkinEngine, text: Type.Optional(words(HOBKIN_MESSAGE_MAX)), title: Type.Optional(words(HOBKIN_TITLE_MAX)) },
      { additionalProperties: false },
    ),
  },
  'hobkin.say': {
    description:
      "Send the user's words to a durable hobkin, with the images attached for it (`conversation.attach` with `agent` as `hobkin:<id>`), by id. While it waits they start its next turn; while it works they reach the turn in flight.",
    runs: 'host',
    args: Type.Object(
      {
        id: hobkinId,
        text: Type.Optional(words(HOBKIN_MESSAGE_MAX)),
        images: Type.Optional(Type.Array(words(64), { maxItems: 16 })),
        noteId: Type.Optional(Type.String({ maxLength: 36, pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })),
        sentAt,
      },
      { additionalProperties: false },
    ),
    rule: ({ text, images }) => (text !== undefined || (Array.isArray(images) && images.length > 0) ? null : 'need words in "text" or at least one image'),
  },
  'hobkin.end': {
    description: 'End a durable hobkin: its turn in flight stops and it leaves the lists. Its conversation file stays on disk.',
    runs: 'host',
    args: Type.Object({ id: hobkinId }, { additionalProperties: false }),
  },
  'hobkin.rename': {
    description: 'Give a durable hobkin another name.',
    runs: 'host',
    args: Type.Object({ id: hobkinId, title: words(HOBKIN_TITLE_MAX) }, { additionalProperties: false }),
  },
  'hobkin.seen': {
    description: 'Say the user has looked at a durable hobkin that is waiting, so the main hobkin does not tell them about it.',
    runs: 'host',
    args: Type.Object({ id: hobkinId }, { additionalProperties: false }),
  },
  'hobkin.shown': {
    description: "Say a durable hobkin's page is on screen, so one that waits on Pi has its process ready before the user's next message. Only the window says it.",
    runs: 'host',
    args: Type.Object({ id: hobkinId }, { additionalProperties: false }),
  },
  'hobkin.change': {
    description:
      "Change the model or thinking level a durable hobkin works on, from the window's message box (/model, /effort). `model` is a full provider/model or a short name that only one model Pi can use matches. The turn in flight takes it from its next step, and every later turn keeps it. Refused for a hobkin on Claude Code or one that ended.",
    runs: 'host',
    args: Type.Object({ id: hobkinId, model: Type.Optional(words(200)), effort: Type.Optional(oneOf(MAIN_EFFORTS)) }, { additionalProperties: false }),
    rule: ({ model, effort }) => (model !== undefined || effort !== undefined ? null : 'need a model or a thinking level to change'),
  },
  'hobkin.read': {
    description: "Read a durable hobkin's conversation: what it is, and each turn with what was asked, who asked it (`from`) and what it answered, oldest first.",
    runs: 'host',
    args: Type.Object({ id: hobkinId }, { additionalProperties: false }),
    hobkin: true,
  },
  'hobkin.list': {
    description: 'List the durable hobkins you can message, newest first, each with its id, title and whether it works or waits.',
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  'hobkin.tell': {
    description:
      'Message a durable hobkin as the main hobkin, never as the user. While it waits the words start its next turn, shown there as from you; while it works they wait and start the turn after the one in flight. A message needs no answer, and its answer, if it sends one, comes to you as a message. Each thing the user says allows at most three messages between hobkins in all.',
    runs: 'host',
    args: Type.Object({ id: hobkinId, text: words(HOBKIN_TELL_MAX) }, { additionalProperties: false }),
    hobkin: true,
  },
  // Driving the window for the user: move it to a screen, open the spotlight, step back, or put words in the
  // composer. The host holds the latest as a one-shot instruction and tells the window, which does the move
  // (`shared/protocol/nudge.ts`). None of them send a message or take an action on the user's behalf.
  'view.open': {
    description:
      'Move the window to a screen, as clicking its place in the menu does: home, reports, routines, actions, work, github, settings or integrations. It only shows the screen; it takes no action on it.',
    runs: 'host',
    args: Type.Object({ screen: oneOf(NUDGE_SCREENS) }, { additionalProperties: false }),
    hobkin: true,
  },
  'view.spotlight': {
    description: 'Open the spotlight over the window, the Command+K search the user types into to jump anywhere. It opens it and nothing more.',
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  'view.back': {
    description: 'Step the window back to the place it was before this one, as Command+Left does. Does nothing when there is nowhere back.',
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  'conversation.draft': {
    description:
      'Put words in the message composer without sending them, so the user can read, edit and send. It replaces whatever is being written. It never sends: sending stays the user\'s.',
    runs: 'host',
    args: Type.Object({ text: words(65536) }, { additionalProperties: false }),
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
      "Set the app's color theme from five colors, each #rrggbb: `background`, `surface` (cards), `text`, `muted` (secondary text), `accent`. Text and muted text must read on the background and on cards (4.5 to 1), or it is refused with the ratio so you can retry. `name` names the theme, and `asked` carries the user's own words for it, such as what follows \"Build a theme:\". Every theme is kept, so the user can go back to it later (appearance.themes). Use it when the user asked for a theme, such as a Matrix one.",
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
        name: Type.Optional(words(KEPT_NAME_MAX)),
        asked: Type.Optional(words(KEPT_ASKED_MAX)),
      },
      { additionalProperties: false },
    ),
    rule: ({ palette }) => paletteProblems(palette).join(' ') || null,
    hobkin: true,
  },
  'appearance.photo': {
    description: 'Select the locally bundled Milky Way photo for the active custom theme (`id`: "milky-way"), or disable its photo (`id`: null). No URLs, files or downloads are accepted. Built-in themes never show this photo.',
    runs: 'host',
    args: Type.Object(
      { id: Type.Union([Type.Literal('milky-way'), Type.Null()]) },
      { additionalProperties: false },
    ),
    hobkin: true,
  },
  'appearance.use': {
    description:
      "Put the app on one of its own themes. `theme` is `system` (the default: follows the Mac, light by day and dark at night, and the way back from any custom theme), `light`, or `dark`. Use it when the user asks to go back to the default theme, to use dark mode or light mode, or to stop using a custom theme. It changes the window at once.",
    runs: 'host',
    args: Type.Object(
      { theme: oneOf(BUILT_IN_THEMES) },
      { additionalProperties: false },
    ),
    hobkin: true,
  },
  'appearance.themes': {
    description:
      "List the custom themes the app keeps, newest first, up to 12: each one's `id`, `name`, the user's own words (`asked`), its colors, and `at`, when it was made. `worn` is the one shown last, and `showing` says whether it is on now. Use it before appearance.pick when the user asks for an earlier theme, such as the one from yesterday or the one before this.",
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  'appearance.pick': {
    description:
      'Put a kept custom theme back on by its `id` from appearance.themes, with its name and photo. It changes the window at once and stays on after a restart, until another theme is chosen.',
    runs: 'host',
    args: Type.Object({ id: Type.String({ pattern: KEPT_ID_PATTERN }) }, { additionalProperties: false }),
    hobkin: true,
  },
  'appearance.rename': {
    description: 'Rename a kept custom theme by its `id`. Renaming the one on now changes the title Settings shows.',
    runs: 'host',
    args: Type.Object({ id: Type.String({ pattern: KEPT_ID_PATTERN }), name: words(KEPT_NAME_MAX) }, { additionalProperties: false }),
    hobkin: true,
  },
  'appearance.remove': {
    description: 'Remove a kept custom theme by its `id`. The theme on now cannot be removed: put another one on first.',
    runs: 'host',
    args: Type.Object({ id: Type.String({ pattern: KEPT_ID_PATTERN }) }, { additionalProperties: false }),
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
  'review.people': {
    description: 'Who a prepared review’s pull request is from: its author, and who it is for when an agent opened it because they asked, each with a link to their profile when one is known. Null for a finished change.',
    runs: 'host',
    args: Type.Object({ id: reviewId }, { additionalProperties: false }),
  },
  'review.codeHosts': {
    description: 'The code hosts the home names besides GitHub, each by its short name and web address, so a pull request page on one opens as its review.',
    runs: 'host',
    args: nothing,
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
      "Show exactly what a verdict on a review would do, and do nothing: for a pull request the review GitHub would get, with its line comments. For a finished change, `approve` opens its pull request, `approve-merge` lands it as its card does, and `request-changes` sends the notes to hobkin's agent. `discard` is the no, the user's Remove: a pull request is closed on GitHub without merging it, and a finished change gets hobkin's own no, with its pull request closed when one is open; that no also stops a merge the user asked for that waits on the change's refresh, and a change hobkin is done with only leaves the list. `discard-branch` (Remove and delete branch) is that no and then deletes the branch: a pull request's head branch on GitHub, only while it is at the commit shown, refused for a fork, a default or protected branch, or one other open pull requests use, or a finished change's own branch on this Mac and on GitHub with the worktree that holds it, refused while it runs or when the user's own folder has it checked out; the preview names the branch, where it goes and what is lost. `summary` is the user's words to go with it. `head` is the commit of the review on the user's screen: when the review the host holds is for another commit, the preview is refused. Answers with the `confirm` that review.verdict needs.",
    runs: 'host',
    args: Type.Object({ id: reviewId, verdict, summary: Type.String({ maxLength: 20000 }), head: Type.Optional(commit) }, { additionalProperties: false }),
  },
  'review.verdict': {
    description:
      "Give a verdict on a review, only ever on the user's word, once review.preview has shown them exactly what it does: a pull request gets one review on GitHub through gh, as the user. A finished change gets its pull request opened, or is merged or sent back through hobkin's own work actions. A discard closes the pull request without merging it, and says hobkin's own no to a finished change; `discard-branch` then deletes the branch the preview named, and a step that fails says what was already done. `confirm` is what the preview answered, and `head` the commit of the review on the user's screen. A verdict that would now do anything else, or act on another commit, is refused.",
    runs: 'host',
    args: Type.Object({ id: reviewId, verdict, summary: Type.String({ maxLength: 20000 }), confirm: Type.String({ pattern: '^[0-9a-f]{64}$' }), head: Type.Optional(commit) }, { additionalProperties: false }),
    outside: true,
  },
  'work.mode': {
    description:
      "Turn work mode on or off with hobkin's own switch. On starts nothing by itself: what runs is what the user starts, unless they chose auto-pick. The first time, `folder` says where to look for projects. Off lets running agents finish and starts nothing new.",
    runs: 'host',
    args: Type.Object({ on: Type.Boolean(), folder: Type.Optional(words(4096)) }, { additionalProperties: false }),
    hobkin: true,
  },
  'work.queue': {
    description:
      "Act on a row of hobkin's queue, named by hobkin's own name for it in `row` (such as `item:storefront:3fa9c1`): `run` puts it first, as Enter does in the terminal, and it starts as soon as hobkin's limits allow. `now` starts it at once, as one extra worker when none is free and without waiting out the gap between starts, while a pause, the budget and any stop still hold it, and hobkin says which. `skip` sends it to the end of the queue, and `back` puts a skipped row back in its place.",
    runs: 'host',
    args: Type.Object({ row: words(256), action: oneOf(['run', 'now', 'skip', 'back']) }, { additionalProperties: false }),
    hobkin: true,
  },
  'work.project': {
    description:
      'Change one setting of a project work mode works on: `priority`, P0 to P3, sets how often it runs and its place in the queue, `prs` sets where its finished work goes: `off` keeps it on a local branch, `draft` opens a draft PR, `published` opens a PR, `issues` sets which of its open GitHub issues hobkin files as work by itself, every 15 minutes: `off`, `labeled` (only those labeled hobkin) or `all`, and `paused` stops work mode on this project alone (`true`: its running agents finish and nothing new starts there) or starts it again (`false`).',
    runs: 'host',
    args: Type.Object(
      {
        slug: projectSlug,
        priority: Type.Optional(oneOf(GRADES)),
        prs: Type.Optional(oneOf(PR_MODES)),
        issues: Type.Optional(oneOf(ISSUE_PICKUPS)),
        paused: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
    rule: ({ priority, prs, issues, paused }) =>
      [priority, prs, issues, paused].filter((setting) => setting !== undefined).length === 1 ? null : 'need "priority", "prs", "issues" or "paused", and only one of them',
    hobkin: true,
  },
  'work.proposal': {
    description:
      "Answer a project hobkin proposed, as y and n do in the terminal: `take` chooses it at the level hobkin proposed, so its work joins the queue, and `skip` leaves it alone. A project left alone is taken again with `take`.",
    runs: 'host',
    args: Type.Object({ slug: projectSlug, answer: oneOf(['take', 'skip']) }, { additionalProperties: false }),
    hobkin: true,
  },
  'work.agents': {
    description: "Set how many work agents may run at once, from 1 to hobkin's most of 100, as `hobkin work agents` sets it. Running agents finish as they are.",
    runs: 'host',
    args: Type.Object({ agents: Type.Integer({ minimum: 1, maximum: 100 }) }, { additionalProperties: false }),
    hobkin: true,
  },
  'work.tokens': {
    description: "Set the fresh tokens work mode may spend in a day, as `hobkin work tokens` sets it. When the day is used up, work mode starts nothing new until tomorrow. Running agents finish as they are.",
    runs: 'host',
    args: Type.Object({ tokens: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
    hobkin: true,
  },
  // Work in numbers (053-work-control-room), folded from the records hobkin and the host already keep, so it has history from the first read.
  'work.metrics': {
    description:
      "Read what work mode did on each local day of the last `days`, 30 unless asked and 180 at most, for all projects and for each: runs started, changes finished, merged by hobkin by itself or on the user's yes, declined, sent back and approved the first time, AI review answers, proofs, questions, stops, tokens and regressions after a deploy, with how long changes waited for the user, how long they took from their first run to their merge and how long AI reviews took. What could not be read is named, and the rest still counts. It only reads.",
    runs: 'host',
    args: Type.Object({ days: Type.Optional(Type.Integer({ minimum: 1, maximum: METRICS_DAYS_MAX })) }, { additionalProperties: false }),
    hobkin: true,
  },
  // YOLO mode lets small, well-reviewed changes merge and deploy with no yes, so only the user's click in the window changes it (049-yolo-mode).
  'work.yolo': {
    description:
      "Turn YOLO mode on or off, or set the lowest general rate it accepts, from 6 to 10. Turning it on merges nothing: hobkin first files one feature on each project to get it ready, and only on a ready project does a small change its review rated at or above that rate merge and deploy by itself.",
    runs: 'host',
    args: Type.Object({ on: Type.Optional(Type.Boolean()), rate: Type.Optional(Type.Integer({ minimum: 6, maximum: 10 })) }, { additionalProperties: false }),
    rule: ({ on, rate }) => (on === undefined && rate === undefined ? 'need on or rate' : null),
    outside: true,
  },
  // It spends an agent's run, so only the user's click in the window starts it.
  'work.yolo.ready': {
    description:
      "Run one project's readiness for YOLO mode now, whether YOLO mode is on or off: hobkin files its readiness work when it has none, opens it again for a fresh check once it landed or closed, and starts it at once, as Start now starts a queue row. Work that waits for the user's yes on its branch is refused. It merges and deploys nothing.",
    runs: 'host',
    args: Type.Object({ slug: projectSlug }, { additionalProperties: false }),
  },
  // Proof runs of TLA+ models (050-tla-proofs). hobkin's own `hobkin proof` writes them, and these read, stop and repeat them.
  'proof.get': {
    description:
      "Read one TLA+ proof run by its id: its steps, TLC's counts, each rule and action, the counterexample when one broke, the state graph when TLC dumped one, the spec's definitions and the TLAPS proof when it ran. A run still going comes as far as its events say.",
    runs: 'host',
    args: Type.Object({ id: proofRunId }, { additionalProperties: false }),
    hobkin: true,
  },
  'proof.stop': {
    description: 'End a proof run that is still going: its process is asked to stop, and killed if it has not ended after 2 seconds, and the run is recorded as stopped.',
    runs: 'host',
    args: Type.Object({ id: proofRunId }, { additionalProperties: false }),
  },
  'proof.again': {
    description: 'Start the same proof check again: the same spec, config, project and item, at the project\'s current head. It runs as `hobkin proof check` does, one at a time.',
    runs: 'host',
    args: Type.Object({ id: proofRunId }, { additionalProperties: false }),
  },
  // It downloads the tools, so only the user's click in the window starts it.
  'proof.setup': {
    description: 'Download the pinned TLA+ tools (the TLC model checker and the TLAPS proof system) so model checks and proofs can run. Only on the user\'s click.',
    runs: 'host',
    args: Type.Object({}, { additionalProperties: false }),
    outside: true,
  },
  'work.change': {
    description:
      "Act on a finished change, only ever on the user's word: `merge` merges its branch on this machine and pushes nothing, `merge-pr` merges its PR on GitHub, `refresh-merge` has an agent bring it up to date and merges it once that run ends well, `review` has an agent review it, `ask` sends an agent back to it with the user's `note`, `decline` says no, and `done` marks the item done: what it left for the user is cleared and any branch or PR stays as it is. `head` is the commit the card showed, so a change that moved since is refused.",
    runs: 'host',
    args: Type.Object(
      {
        slug: projectSlug,
        item: workItem,
        action: oneOf(['merge', 'merge-pr', 'refresh-merge', 'review', 'ask', 'decline', 'done']),
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
  'activity.before': {
    description:
      "Read the steps a background run's feed let go, from the run's saved Pi session: up to 200 right before the step `before` (a feed entry's id), or the newest with no `before`. `at`, that step's time in milliseconds, places the page when the session numbers the step otherwise. Read-only.",
    runs: 'host',
    args: Type.Object({ job: words(256), before: Type.Optional(words(512)), at: Type.Optional(Type.Number({ minimum: 0 })) }, { additionalProperties: false }),
  },
  'activity.output': {
    description: "Read a tool step's whole output from its run's saved Pi session, for a step whose feed keeps only the output's first and last halves (`outputLength`). Read-only.",
    runs: 'host',
    args: Type.Object({ job: words(256), id: words(512) }, { additionalProperties: false }),
  },
  'agent.stop': {
    description:
      "Stop an agent or routine that is running, by its run's id. A work agent stops the two ways hobkin's k stops one: `for-now` puts its item at the end of the queue, and `not-approved` records a no, so it does not run again. Its branch stays either way. Anything else is cancelled.",
    runs: 'host',
    args: Type.Object({ run: words(256), how: Type.Optional(oneOf(['for-now', 'not-approved'])) }, { additionalProperties: false }),
  },
  'agent.say': {
    description:
      "Queue the user's words for an agent's exact run, with the images attached for it (`conversation.attach` with `agent`), by id. Acknowledgement is not a receipt; steeringReceipts reports notes admitted into a Pi turn. Refused once the run has finished.",
    runs: 'host',
    args: Type.Object({
      run: words(256),
      text: Type.Optional(words(4096)),
      images: Type.Optional(Type.Array(words(64), { maxItems: 16 })),
      noteId: Type.Optional(Type.String({ maxLength: 36, pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })),
    }, { additionalProperties: false }),
    rule: ({ text, images }) => (text !== undefined || (Array.isArray(images) && images.length > 0) ? null : 'need words in "text" or at least one image'),
  },
  'agent.change': {
    description:
      "Change the model or thinking level of an agent that is working, by its run's id, from the window's message box (/model, /effort). `model` is a full provider/model or a short name that only one model Pi can use matches. The agent takes it from its next step. Refused for a finished agent, hobkin's own conversation and an agent on Claude Code.",
    runs: 'host',
    args: Type.Object({ run: words(256), model: Type.Optional(words(200)), effort: Type.Optional(oneOf(MAIN_EFFORTS)) }, { additionalProperties: false }),
    rule: ({ model, effort }) => (model !== undefined || effort !== undefined ? null : 'need a model or a thinking level to change'),
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
    hobkin: true,
  },
  'routine.delete': {
    description: 'Delete the confirmed routine definition only; reports and run history stay.',
    runs: 'host',
    args: Type.Object({ id: routineId, expectedDefinition: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false }),
    hobkin: true,
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
    hobkin: true,
  },
  'report.delete': {
    description: "Delete a report with hobkin's own `reports delete`: it leaves every list and its saved text goes. This cannot be undone, so the window asks only once its own undo time has passed.",
    runs: 'host',
    args: Type.Object({ id: words(256) }, { additionalProperties: false }),
    hobkin: true,
  },
  'report.read': {
    description: 'Record a report read after at least three seconds in its reader. This never completes its action.',
    runs: 'host',
    args: Type.Object({ id: words(256), dwellMs: Type.Integer({ minimum: 3000, maximum: 86400000 }) }, { additionalProperties: false }),
    hobkin: true,
  },
  'short-reports.read': {
    description: "Read whether Short reports is on: while it is, hobkin writes a short version of each new report on its fast tier, and the reader shows it first with the full report under it.",
    runs: 'host',
    args: nothing,
    hobkin: true,
  },
  // Each short version spends a model call, so only the user's click in Settings turns it on or off (051-short-reports).
  'short-reports.set': {
    description: "Turn Short reports on or off. On, each report that finishes from now on gets a short version written on hobkin's fast tier. Old reports are left as they are.",
    runs: 'host',
    args: Type.Object({ on: Type.Boolean() }, { additionalProperties: false }),
  },
  // User-only, like a decision answer: agents may read a reminder but cannot claim the user completed it.
  'reminder.resolve': {
    description: 'Record the user’s explicit Done or Dismissed choice for an existing reminder occurrence. Never creates a reminder or sends anything.',
    runs: 'host',
    args: Type.Object({ home: words(4096), id: Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{0,79}:\\d{4}-\\d{2}-\\d{2}$' }), status: oneOf(['done', 'dismissed']) }, { additionalProperties: false }),
  },
  // Deliberately not `hobkin: true`: a decision answer may merge, so the user retains this authority.
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
    hobkin: true,
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
  'system.metrics': SystemMetrics
  'usage.facts': UsageFacts
  'backup.list': BackupState
  'backup.config': BackupState
  'backup.now': BackupState
  /** `safety`: the backup taken of the data it replaced. */
  'backup.restore': { ok: true; restored: string; safety: string | null }
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
  'models.update': ModelsUpdate
  'models.key-help': KeyHelp
  'models.keychain': { ok: true; connected: boolean }
  /** What hobkin saved. `applied`: the open conversation runs that model now. Without an open conversation, the next one starts on it. */
  'models.select': { ok: true; model: string; effort: string; applied: boolean }
  'tiers.read': HostTiers
  /** The tiers as hobkin holds them once saved. */
  'tiers.apply': HostTiers
  'claude-code.read': ClaudeCodeState
  /** The settings as saved, with what the host found of Claude Code. */
  'claude-code.apply': ClaudeCodeState
  'signin.start': { ok: true }
  'signin.answer': { ok: true }
  'signin.cancel': { ok: true }
  /** `stillConnected`: Pi reaches the provider another way, such as an environment variable. `message` says so. */
  'signin.out': { ok: true; stillConnected: boolean; message: string }
  'profile.read': UserProfile
  /** The profile as saved. */
  'profile.set': UserProfile
  'directions.read': DirectionsFile
  'directions.save': DirectionsSaved
  'setup.pi': PiSetup
  /** Pi as it is once the install is done. */
  'setup.install-pi': PiSetup
  'setup.install-package': PiSetup
  'setup.install-node': PiSetup
  /** Whether the TLA+ tools are ready, and what hobkin said, in a line. */
  'setup.install-proof-tools': { ok: boolean; message: string }
  'setup.launcher': PiSetup
  'setup.projects': ProjectsFound
  /** What the app saved. */
  'setup.save': SetupSaved
  'setup.saved': SetupSaved | null
  'setup.work': SetupWorkDone
  'github.refresh': GitHubState
  'github.open': { ok: true }
  /** What was done, in plain words: the issue closed on GitHub, and what hobkin said of its item, when it had one to decline. */
  'github.issue.close': { message: string }
  'system.open': { ok: true }
  'canvas.show': CanvasState
  'canvas.close': CanvasState
  'canvas.draw': CanvasState
  'canvas.read': CanvasContent
  'canvas.save': CanvasSaved
  /** The new hobkin's id, and the run of its first turn, or null when it was started with no first message. */
  'hobkin.start': { id: string; run: string | null }
  /** `started`: the words began a new turn. `queued`: they were handed to the turn in flight. `run` is that turn's run. */
  'hobkin.say': { started: boolean; queued: boolean; run: string }
  'hobkin.end': { ok: true }
  'hobkin.rename': HobkinSummary
  'hobkin.seen': { ok: true }
  'hobkin.shown': { ok: true }
  /** What it works on now, or from when, in words. */
  'hobkin.change': { message: string }
  'hobkin.read': HobkinConversation
  'hobkin.list': { hobkins: HobkinReach[] }
  /** `started`: the words began its next turn, which is `run`. `queued`: they wait for the turn in flight to end, so no run yet. */
  'hobkin.tell': { started: boolean; queued: boolean; run: string | null }
  'view.open': { ok: true }
  'view.spotlight': { ok: true }
  'view.back': { ok: true }
  'conversation.draft': { ok: true }
  'appearance.set': { ok: true }
  'appearance.photo': { ok: true }
  'appearance.use': { ok: true }
  'appearance.themes': KeptThemes
  'appearance.pick': { ok: true }
  'appearance.rename': { ok: true }
  'appearance.remove': { ok: true }
  'appearance.customize': ThemeOperation
  'appearance.status': ThemeOperation | null
  'file.read': FileContent
  'file.open': { ok: true }
  'review.prepare': ReviewStatus
  'review.status': ReviewStatus
  'review.list': ReviewList
  'review.codeHosts': { hosts: { name: string; web: string }[] }
  'review.people': { author: { name: string; url?: string } | null; for?: { name: string; url?: string } } | null
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
  /** Each answers with Pi's list as it stands once the change is made, read again through Pi. */
  'skills.refresh': SkillsState
  'skills.read': SkillFile
  'skills.turn-off': SkillsState
  'skills.turn-on': SkillsState
  'extensions.refresh': ExtensionsState
  'extensions.check-updates': ExtensionsState
  'extensions.turn-off': ExtensionsState
  'extensions.turn-on': ExtensionsState
  'work.mode': { enabled: boolean }
  /** What hobkin said, when it says something: `now` says whether the row started or what still holds it. */
  'work.queue': { ok: true; message?: string }
  'work.project': { ok: true }
  'work.proposal': { ok: true }
  /** How many work agents may run at once now. */
  'work.agents': { agents: number }
  /** The daily limit now. */
  'work.tokens': { tokens: number }
  'work.metrics': WorkMetrics
  /** YOLO mode as it stands now. */
  'work.yolo': { on: boolean; rate: number }
  /** What hobkin said: the readiness work starts now, or what still holds it. */
  'work.yolo.ready': { message: string }
  /** The whole run. */
  'proof.get': ProofRun
  /** What happened to the run, in a line. */
  'proof.stop': { message: string }
  /** What started, and the new run's id when the runtime said it. */
  'proof.again': { message: string; id?: string }
  'proof.setup': { message: string }
  /** What hobkin did, in its own words. */
  'work.change': { message: string }
  /** hobkin's line for each row, in the order they went, and the line that sums them up. */
  'work.group': { message: string; lines: string[] }
  /** What hobkin said: the issue was added, or it was already filed. */
  'work.issue': { message: string }
  /** What hobkin did, in its own words. */
  'agent.stop': { message: string }
  'agent.say': { queued: boolean }
  /** What the agent works on now, in words. */
  'agent.change': { message: string }
  'agent.session': SavedJobSession
  'activity.before': OlderSteps
  /** Null when the session saved no such tool result. */
  'activity.output': WholeOutput | null
  /** The run hobkin started. */
  'routine.run': { run: string }
  'routine.enable': { ok: true }
  'routine.times': { ok: true }
  'routine.delete': { id: string; deleted: true }
  /** What hobkin said of the answer, and whether the item went to the main agent in Chat and stays open until done. */
  'report.delete': { id: string; deleted: true }
  'report.read': { ok: true }
  'short-reports.read': { on: boolean }
  'short-reports.set': { on: boolean }
  'reminder.resolve': { ok: true }
  'decision.answer': { message: string; handedOff: boolean }
  'learning.answer': { message: string }
  'conversation.image': StoredImage | null
  'history.image': StoredImage | null
  /** `titling`: how many of the listed conversations are having a title made for them now, so the window looks again. None from a host that makes no titles. */
  'history.list': { conversations: HistoryEntry[]; titling?: number }
  'history.open': HistoryConversation
}

/** Steps a run's feed let go, read back from its saved Pi session in the feed's own shape. */
export interface OlderSteps {
  /** Up to 200 steps right before the one asked about, oldest first. */
  steps: ActivityEntry[]
  /** Older steps than these remain. */
  more: boolean
  /** The step asked about is in the saved session. When it is not, `at` placed the page. */
  found: boolean
}

/** A tool step's whole output, as its saved session has it, and how long it is. */
export interface WholeOutput {
  id: string
  output: string
  length: number
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

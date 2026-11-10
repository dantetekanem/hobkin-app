import { Type, type Static, type TSchema } from 'typebox'
import { Check, Errors } from 'typebox/value'
import type { IntegrationsState } from '../integrations/wire.ts'
import type { CanvasState } from '../protocol/canvas.ts'
import type { FileContent } from '../protocol/files.ts'
import type { GitHubState } from '../protocol/github.ts'
import type { KeyHelp, ModelsState } from '../protocol/models.ts'
import type { SlashCommand, SlashOutcome } from '../protocol/slash.ts'
import { GRADES, PR_MODES } from '../protocol/work.ts'
import type { OpenedReview, ReviewStatus, VerdictPreview } from '../review/status.ts'
import type { ReviewFileContents } from '../review/types.ts'

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

const nothing = Type.Object({}, { additionalProperties: false })
const words = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: '\\S' })
/** Pi's id for a provider. Plain enough to name in a shell command. */
const provider = Type.Object({ provider: Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' }) }, { additionalProperties: false })
/** The thinking levels hobkin's main conversation takes: `efforts.pi` in hobkin's `src/cli/schedules.mjs`. */
export const MAIN_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
/** One of a few words. A union built with map checks the same at runtime, but its type collapses, so the type is named here. */
const oneOf = <const Word extends string>(choices: readonly Word[]) => Type.Unsafe<Word>(Type.Union(choices.map((choice) => Type.Literal(choice))))
/** A work project by hobkin's slug for it, and one of its items by id. */
const projectSlug = Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,63}$' })
const workItem = words(64)
/** The commit a card showed. A merge pinned to it refuses a branch that moved since. */
const commit = Type.String({ pattern: '^[0-9a-f]{7,64}$' })
/** An MCP server by its name in Pi's configuration, which Pi limits to letters, digits, `_` and `-`. */
const mcpServer = Type.Object({ name: Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$' }) }, { additionalProperties: false })
/** A review by what it reviews: a finished change, `change:<slug>:<item>`, or a pull request, `pr:<owner>/<repo>/<number>`. */
const reviewId = Type.String({ pattern: '^(change|pr):\\S{3,300}$' })
const verdict = oneOf(['comment', 'approve', 'request-changes'])
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
  'conversation.send': {
    description: 'Send a message to hobkin, with the images attached to it and the report it is about, by id. While a turn is running it steers that turn.',
    runs: 'host',
    args: Type.Object(
      { text: Type.Optional(words(65536)), images: Type.Optional(Type.Array(words(64), { maxItems: 16 })), report: Type.Optional(words(256)) },
      { additionalProperties: false },
    ),
    rule: ({ text, images }) => (text !== undefined || (Array.isArray(images) && images.length > 0) ? null : 'need words in "text" or at least one image'),
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
      "Prepare the Change Review of a finished hobkin change or a GitHub pull request, by its review id. It runs in the background and answers at once with how it stands. A review already prepared for the change's commit is used as it is, and `refresh` prepares it again anyway. A pull request is only read, through gh.",
    runs: 'host',
    args: Type.Object({ id: reviewId, refresh: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  },
  'review.status': {
    description: 'How the preparation of a review stands: ready to open, being prepared and what it is doing, or failed and why.',
    runs: 'host',
    args: Type.Object({ id: reviewId }, { additionalProperties: false }),
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
      "Show exactly what a verdict on a review would do, and do nothing: for a pull request the review GitHub would get, with its line comments, and for a finished change the hobkin action it would take. `summary` is the user's words to go with it. Answers with the `confirm` that review.verdict needs.",
    runs: 'host',
    args: Type.Object({ id: reviewId, verdict, summary: Type.String({ maxLength: 20000 }) }, { additionalProperties: false }),
  },
  'review.verdict': {
    description:
      "Give a verdict on a review, only ever on the user's word, once review.preview has shown them exactly what it does: a pull request gets one review on GitHub through gh, as the user, and a finished change one of hobkin's own work actions, merge or ask for changes. `confirm` is what the preview answered. A verdict that would now do anything else is refused.",
    runs: 'host',
    args: Type.Object({ id: reviewId, verdict, summary: Type.String({ maxLength: 20000 }), confirm: Type.String({ pattern: '^[0-9a-f]{64}$' }) }, { additionalProperties: false }),
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
      "Act on a row of hobkin's queue, named by hobkin's own name for it in `row` (such as `item:storefront:3fa9c1`): `run` puts it first, as Enter does in the terminal, and it starts as soon as hobkin's limits allow. `skip` sends it to the end of the queue, and `back` puts a skipped row back in its place.",
    runs: 'host',
    args: Type.Object({ row: words(256), action: oneOf(['run', 'skip', 'back']) }, { additionalProperties: false }),
  },
  'work.project': {
    description:
      'Change one setting of a project work mode works on: `priority`, P0 to P3, sets how often it runs and its place in the queue, and `prs` sets where its finished work goes: `off` keeps it on a local branch, `draft` opens a draft PR, `published` opens a PR.',
    runs: 'host',
    args: Type.Object({ slug: projectSlug, priority: Type.Optional(oneOf(GRADES)), prs: Type.Optional(oneOf(PR_MODES)) }, { additionalProperties: false }),
    rule: ({ priority, prs }) => ((priority === undefined) !== (prs === undefined) ? null : 'need "priority" or "prs", and only one of them'),
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
  'agent.stop': {
    description:
      "Stop an agent or routine that is running, by its run's id. A work agent stops the two ways hobkin's k stops one: `for-now` puts its item at the end of the queue, and `not-approved` records a no, so it does not run again. Its branch stays either way. Anything else is cancelled.",
    runs: 'host',
    args: Type.Object({ run: words(256), how: Type.Optional(oneOf(['for-now', 'not-approved'])) }, { additionalProperties: false }),
  },
  'agent.say': {
    description:
      "Pass the user's words to an agent or routine while it runs, as hobkin's message_check does: it reads them at its next step and carries on. Refused once it has finished.",
    runs: 'host',
    args: Type.Object({ run: words(256), text: words(4096) }, { additionalProperties: false }),
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
} as const satisfies Record<string, CommandDefinition>

export type CommandName = keyof typeof COMMANDS
export type CommandArgs<Name extends CommandName> = Static<(typeof COMMANDS)[Name]['args']>

/** What each command answers with. */
export interface CommandResults {
  'conversation.send': { id: string; queued: boolean }
  'conversation.attach': { id: string; name: string; mimeType: string; notice?: string }
  'conversation.detach': { ok: true }
  'conversation.stop': { stopped: boolean; unsent: string[] }
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
  'signin.start': { ok: true }
  'signin.answer': { ok: true }
  'signin.cancel': { ok: true }
  /** `stillConnected`: Pi reaches the provider another way, such as an environment variable. `message` says so. */
  'signin.out': { ok: true; stillConnected: boolean; message: string }
  'github.refresh': GitHubState
  'github.open': { ok: true }
  'system.open': { ok: true }
  'canvas.show': CanvasState
  'canvas.close': CanvasState
  'file.read': FileContent
  'file.open': { ok: true }
  'review.prepare': ReviewStatus
  'review.status': ReviewStatus
  'review.get': OpenedReview
  'review.file': ReviewFileContents
  'review.notes': { ok: true }
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
  'work.queue': { ok: true }
  'work.project': { ok: true }
  'work.proposal': { ok: true }
  /** How many work agents may run at once now. */
  'work.agents': { agents: number }
  /** What hobkin did, in its own words. */
  'work.change': { message: string }
  /** hobkin's line for each row, in the order they went, and the line that sums them up. */
  'work.group': { message: string; lines: string[] }
  /** What hobkin did, in its own words. */
  'agent.stop': { message: string }
  'agent.say': { delivered: true }
  /** What hobkin said of the answer, and whether the item went to the main agent in Chat and stays open until done. */
  'decision.answer': { message: string; handedOff: boolean }
  'learning.answer': { message: string }
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

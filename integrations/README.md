# Writing an integration

An integration is one folder under `integrations/`. Two parts of the app load it: the
host, the Node process that runs hobkin (`host/src/`), and the window, the app's React interface (`ui/src/`). Both
look in `integrations/` when they start and load what each folder offers. The app's core never imports an
integration. Add a folder and the integration works. Remove it and the app runs without it, with nothing of it left
on any screen.

Two integrations ship with the app: `integrations/github/` and `integrations/browser/`. Read GitHub's alongside this
guide for real examples of commands, screens, a card, Home and the spotlight. For agent tools, hooks and workflows,
see the test integration named in [Giving agents more to work with](#giving-agents-more-to-work-with). The spec
behind all of this is `_specs/065-integration-drops/spec.md`.

## The folder

```
integrations/<id>/
  integration.ts   the manifest: id, name, commands, screens. Required.
  host.ts          the host part: state, command handlers, hooks. Optional.
  window.tsx       the window part: screens, card, Home, spotlight. Optional.
  host/ window/    your own modules, named as you like.
  test/            your tests. `pnpm test` runs integrations/*/test/**/*.test.ts.
```

`<id>` is the folder's name. It uses lowercase letters, digits and `-`, starts with a letter, and is at most 32
characters long. Everything the integration adds carries it: commands are named `<id>.<something>`, the host sends
the integration's state under the key `<id>`, and its log lines start with it.

A folder may import:

- `#shared/*` (the repository's `shared/`) from anywhere in the folder.
- `#host/*` (the host's `host/src/`) from host code only.
- `@/*` (the window's `ui/src/`) from window code only.
- Anything inside its own folder, and the packages the app already depends on.

A folder must not import another integration's folder, and nothing in `host/`, `shared/` or `ui/src/` imports it.

When a folder fails to load, the rest of the app still runs:

- In the host, a folder can fail because of a syntax error, a manifest whose id is not the folder's name, or a
  command name the app already has. The host logs why and leaves the whole folder out.
- In the window, a window part that fails to load is logged and left out. If the window's command registry refuses
  a part's names, the window logs it and still draws the part. The host has left that folder out, though, so its
  commands answer "no such command".

## The manifest: `integration.ts`

The manifest is plain data that both the host and the window read, so it must not use Node APIs, the DOM or React.

```ts
import { Type } from 'typebox'
import { defineIntegration } from '#shared/integration/manifest.ts'

export default defineIntegration({
  id: 'echo',
  name: 'Echo',
  line: 'Says back what it is told',
  screens: [{ id: 'echo', label: 'Echo', line: 'What echo said', keywords: ['say'] }],
  commands: {
    'echo.say': {
      description: 'Say a line back.',
      runs: 'host',
      args: Type.Object({ text: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      hobkin: true,
    },
  },
})

/** What each command answers. The window's runner is typed from this. */
export interface EchoResults {
  'echo.say': { said: string }
}
```

Commands work the same way as the app's own commands (`shared/commands/registry.ts`):

- `args` is a TypeBox schema. The host checks every call against it before your handler runs, so your handler only
  gets arguments that match. Close objects with `additionalProperties: false`.
- `description` is what hobkin reads about the command. Write it for an agent: say what the command does, what each
  argument means and what it refuses.
- `hobkin: true` lets hobkin run the command through its `client` tool. Leave it out for commands that only the
  window should run.
- `outside: true` marks a command that changes something outside the app, such as a file or a service. hobkin is
  then told not to run it and to send the user to the window instead.

Each screen in `screens` gets a place in the menu after Work, in the order of the folders. The spotlight (the search
that Command+K opens) finds it by `label`, `line` and `keywords`. The user can remove a screen from the menu. A
screen id must not repeat one of the core's (`home`, `work`, `settings` and the others in `ui/src/app/screens.ts`).

## The host part: `host.ts`

`host.ts` default-exports a function. The host calls it once when it starts and passes it a context, described
below. The function returns your host part: an object with only the fields you use. The types are in
`host/src/integration-contract.ts`.

```ts
import { Unavailable } from '#host/commands.ts'
import type { HostPartFactory } from '#host/integration-contract.ts'

const echo: HostPartFactory = (context) => {
  let said = 0
  return {
    state: () => ({ said }),
    handlers: {
      'echo.say': ({ text }: { text: string }) => {
        said += 1
        context.changed()
        return { said: text }
      },
    },
  }
}

export default echo
```

### What the context gives

| Field | What it is |
| --- | --- |
| `id` | The folder's name. |
| `live` | True on the user's own app. False on a scripted host for development and tests: show sample data there and never reach a real service unless asked. |
| `gh` | gh, GitHub's command line tool, when this host may run it (a live host, or a scripted one started with `--github`). |
| `options` | What a test handed this integration (`integrationOptions[id]` on the host). Empty otherwise. Take your fakes from it. |
| `log(line)` | One line in the host's log, prefixed with the id. Never log a secret. |
| `changed()` | Call it when your state changes. The host then calls `state()` again and sends the result if it differs. |
| `connected()` | True while a window is open. Use it to skip timed reads that nobody would see. |
| `hobkin()` | hobkin's application (`workAction`, `refresh`). Throws `Unavailable` while hobkin is not open. |
| `dataRoot()` | The folder that holds hobkin's home data. Throws `Unavailable` while hobkin is not open. |
| `snapshotWork()` | The `work` key of hobkin's current snapshot, or undefined. It is a new object each time it changes. |
| `startWorkflow(name, input?)` | Starts one run of your `workflows/<name>.md` now (see "Workflows" below). `name` is the file's name alone: `summarize` for `workflows/summarize.md`. Returns a promise of `{ run }`. The promise rejects with `Unavailable` when hobkin is not open, or when the workflow is unknown or turned off. A hook cannot return the promise, so when you call this from a hook, add a `.catch` that logs why the workflow did not start. |

### What the part may give

| Field | When the host calls it |
| --- | --- |
| `state()` | Each time the host publishes. What it returns is your slice of the app's state: JSON only, and nothing secret. The host sends the whole slice to every window when it changes, and again on every reconnect. |
| `handlers` | When one of your commands runs. Give one function per command in your manifest, keyed by its full name. Throw `Unavailable` (from `#host/commands.ts`) to refuse, with a reason that the user and hobkin read. Anything else a handler throws counts as a failure. (An agent tool refuses differently: see "Tools for agents".) |
| `start()` | Once, when the host is serving. Start timers here, and `unref()` them. |
| `close()` | Once, when the host stops. Clear what `start` started. |
| `beforeCommand(call)` | Before every command the host runs, yours and the app's, from the window (`call.from === 'window'`) or from hobkin (`'hobkin'`). Throw `Unavailable` to refuse it. |
| `afterCommand(call)` | After every command, with `call.outcome`: `{ ok: true, value }` or `{ ok: false, error: { code, message } }` (`CommandOutcome` in `#host/commands.ts`). |
| `onToolCall(call)` | For every tool call of every agent, once when the call starts and once when it ends. `call` holds `agent` (`#main` for hobkin's main conversation, or a run's id), the tool's `name`, its `args`, `state` and, once the call has ended, `output`. It can only watch, not change the call. |
| `onMerged(pull)` | When a pull request stops being open: merged through the app (by Change Review's verdict), or merged or closed elsewhere, as the host's watch on hobkin's own pull requests saw it. `pull` gives its `url`, or its `repo` and `number`. |
| `tools` | Tools hobkin's agents can call, run in the host. See "Tools for agents" below. |
| `toolHooks` | Hooks that may refuse or change an agent's tool call before it runs, and change what the agent reads after. See "Hooks on tool calls" below. |
| `pulls()` | Returns the open pull requests you know, as `{ mine, waiting, sample }` (the shape is `PullRequest` in `shared/protocol/pulls.ts`). Change Review prepares reviews of them in the background when the user's settings ask for it. `sample: true` marks made-up ones, which are never reviewed. |

When a hook throws, the host logs it and nothing changes. The one exception is a refusal from `beforeCommand`. Keep
hooks fast: they run on every command.

Examples from GitHub's part (`integrations/github/host.ts`):

```ts
// Read GitHub again once a change hobkin made may have closed a pull request or an issue.
afterCommand: ({ name, outcome }) => {
  if (['work.change', 'work.group'].includes(name) && outcome.ok) github.readSoon()
},
// A merge the app made: drop it from the lists now, not at the next read.
onMerged: (pull) => (pull.url || pull.repo ? github.closed(pull) : github.readSoon()),
```

## The window part: `window.tsx`

`window.tsx` default-exports a `WindowPart` (`ui/src/integration/contract.ts`). The window loads it when it starts.

```tsx
import { Megaphone } from 'lucide-react'
import type { WindowPart } from '@/integration/contract.ts'
import manifest from './integration.ts'
import { EchoScreen } from './window/EchoScreen.tsx'

interface EchoState { said: number }

const part: WindowPart<EchoState> = {
  manifest,
  unknown: { said: 0 },
  sample: () => ({ said: 3 }),
  screens: [{ id: 'echo', icon: Megaphone, component: EchoScreen }],
  mark: { symbol: 'Ec', hue: 40 },
}

export default part
```

| Field | What it does |
| --- | --- |
| `manifest` | The default export of `integration.ts`. |
| `unknown` | Your state before the host has sent any, and on a host that does not run your host part. |
| `sample(now)` | Made-up state for a window with no host, such as a browser tab on the dev server. Count times back from `now`. Never real data. |
| `screens` | One entry per manifest screen: the same `id`, a lucide `icon`, and the React `component` the canvas draws. |
| `card` | A component for your card on the Integrations screen, above the MCP servers. It gets `{ still }`, which is true when the user asked for no movement. |
| `mark` | Two letters and a hue (0 to 359), drawn in the app's palette on your tile and card. |
| `pulls(state)` | The pull requests in your state. Work's rows read their review and checks from here, and the trail (the line under the screen menu) reads their titles. |
| `home(state, now)` | What you add to Home. Every field is optional: `needs` (rows waiting on the user, each with its card on the stack), `cards` (cards for things that went wrong), a `tile` among Connections, `known` (true once the host has said something about your integration, so Connections has something to show), `lift` (how many of your things need the user) and `more` (true when your lists were cut short, so that count is a minimum). Type: `HomeContribution` in `ui/src/features/home/types.ts`. GitHub's is `integrations/github/window/home.ts`. |
| `spotlight(state)` | Entries the spotlight finds, each with where Enter takes the user. GitHub's is `integrations/github/window/spotlight.ts`. |
| `subscribe(onChange)` | Give this only when `home` or `spotlight` read something other than `state`, such as a choice the user made on this machine. Call `onChange` when that changes, and Home and the spotlight read your part again right away. Return a function that stops the subscription. A zustand store's own `subscribe` already fits, as in `subscribe: useIgnored.subscribe` for a store named `useIgnored`. |

Here is the smallest screen and card that fit the app's look (`NotesState` is your own state type):

```tsx
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { Button } from '@/components/ui/button.tsx'
import { useSlice } from '@/integration/use-slice.ts'
import { run } from './commands.ts'

export function NotesScreen() {
  const { notes } = useSlice<NotesState>('notes')
  return (
    <div className={`${SCREEN_SCROLLER} pb-16`}>
      <div className={`flex flex-col gap-4 ${SCREEN_COLUMN}`}>
        <header className="px-1">
          <h1 className="eyebrow">Notes</h1>
          <p className="mt-1 font-heading text-[26px] font-semibold">{notes.length} notes</p>
        </header>
        <ul aria-label="Notes" className="flex flex-col gap-2">
          {notes.map((note, index) => <li key={index} className="rounded-2xl bg-background px-4 py-3 text-[14px]">{note}</li>)}
        </ul>
        {notes.length ? <Button onClick={() => void run('notes.clear', {})}>Clear all</Button> : null}
      </div>
    </div>
  )
}

export function NotesCard({ still: _still }: { still: boolean }) {
  const { notes } = useSlice<NotesState>('notes')
  return (
    <section aria-label="Notes" className="flex flex-col gap-1 rounded-[28px] bg-background p-5">
      <h3 className="font-heading text-[22px] font-semibold">Notes</h3>
      <p className="text-[13px] text-muted-foreground">{notes.length} notes</p>
    </section>
  )
}
```

For the full look, read `integrations/github/window/GitHubScreen.tsx` and `GitHubCard.tsx`.

To add a tile to Home's Connections, return a `tile` from `home`. Set `known: true` as well, or Home treats the
integration as not heard from yet. Home draws your part's `mark` on the tile for you:

```ts
import type { HomeContribution } from '@/features/home/types.ts'

export const notesHome = (state: NotesState): HomeContribution => ({
  known: true,
  tile: {
    key: 'notes',
    name: 'Notes',
    status: `${state.notes.length} notes`,
    tone: 'quiet', // 'accent' | 'bad' | 'warn' | 'ok' | 'info' | 'quiet'
    note: null, // a second line: what went wrong, or who it is signed in as
    target: { to: 'screen', screen: 'notes' }, // where a press goes: your screen's id
  },
})
```

A need is something on Home that waits for the user. It is a row among Needs plus a card on the stack, and both carry
the same id. Things that went wrong but wait for nobody go in `cards`, as cards with no row. GitHub's are in
`integrations/github/window/home.ts`.

```ts
import type { HomeContribution, HomeRow } from '@/features/home/types.ts'

const screen = { to: 'screen', screen: 'standup' } as const

export const standupHome = (state: StandupState, now: number): HomeContribution => {
  if (writtenToday(state, now)) return { known: true }
  const row: HomeRow = { id: 'standup:missing', title: "Today's stand-up is not written", detail: null, tone: 'warn', aside: null, action: { label: 'Write it', target: screen } }
  return {
    known: true,
    needs: [{ row, card: { id: row.id, label: 'Stand-up', reason: 'Not written today', tone: row.tone, title: row.title, detail: null, primary: row.action } }],
  }
}
```

A row is `{ id, title, detail, tone, aside, action }`, where `aside` is a short note on the right and `action` is
`{ label, target }`. A card is `{ id, label, reason, tone, title, detail, primary }`, and may add `facts`
(`[{ label, value, tone }]`) and a `secondary` action. Types: `HomeRow` and `HomeCardFields` in
`ui/src/features/home/types.ts`. A target goes to a `screen` by id, a `url` (`{ to: 'url', url }`), a `report`, an
`action` or an `agent` by id.

A screen or card can use these from the core:

- `useSlice<State>(id)` from `@/integration/use-slice.ts`: your state as the host sent it, `unknown` before that, and
  `sample(now)` with no host.
- `runnerFor<Results>()(manifest)` from `@/integration/commands.ts`: a `run(name, args)` typed by your manifest and
  results. `Results` has one key per command, spelled exactly as in the manifest, each with what that command's
  handler returns (`EchoResults` above). GitHub keeps its runner in `window/commands.ts`:
  `export const run = runnerFor<GitHubResults>()(manifest)`.
- `openLink(event, url)` and `openAddress(url)` from `@/lib/open-link.ts`: links that open in the system browser when
  the app runs in the Mac window, and as normal links in a browser tab.
- `createTwoClicks` from `@/lib/two-clicks.ts`: the press-twice confirmation the app uses before anything it cannot
  undo.
- The app's own components (`@/components/ui/*`), its screen frame (`@/app/screen-layout.ts`) and its motion
  (`@/lib/motion.ts`). Tailwind picks up the classes used in this folder.

## Giving agents more to work with

The window and hobkin's `client` tool run commands. An integration can also give hobkin's agents more to work with
directly, in three ways: tools they call by name, hooks on the tool calls they make, and workflows, which are
directions written in Markdown. The test integration in `host/test/fixtures/integrations/echo/` uses all three. Read
it alongside this section.

### Tools for agents

```ts
import { Type } from 'typebox'
import { defineTool, type HostPartFactory } from '#host/integration-contract.ts'

const echo: HostPartFactory = (context) => ({
  tools: [
    defineTool({
      name: 'shout',
      description: 'Say a line back in capitals. Use it when the user asks echo to shout something.',
      parameters: Type.Object({ text: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      agents: ['main', 'runs'],
      execute: ({ text }, { agent }) => {
        context.log(`${agent} shouted`)
        return text.toUpperCase()
      },
    }),
  ],
})
```

- Agents know the tool by its full name: your id with each `-` turned into `_`, then `_`, then the tool's short name.
  Here that is `echo_shout`. The short name uses lowercase letters, digits and `_`, starts with a letter, and is at
  most 41 characters long. A tool whose name clashes with one of Pi's or hobkin's own tools (such as `bash`, or
  anything starting `hobkin_`) is dropped.
- `description` is all the agent knows about the tool: say what it does and when to use it.
- `agents` says which agents get the tool: `main` (hobkin's main conversation), `runs` (Work, routines and
  workflows) and `durable` (durable hobkins, the ones that stay and wait for the user, when they run on Pi). Leave
  it out to give the tool to all three. Helper agents and Claude Code agents never get integration tools.
- `execute(args, run)` runs in the host, and `args` has already been checked against `parameters`. Return text, or
  `{ text, failed: true }` to tell the agent the call did not work, in words it can act on. If `execute` throws, the
  agent gets the same thing: a failed call with the error's message. (A command handler refuses with `Unavailable`
  instead, because a person or hobkin's `client` tool reads that.) `run` is `{ agent, id, signal? }`: `agent` is
  `#main` or the run's id, `id` is the call's id, and `signal` is set when the agent stops waiting.
- The main conversation picks up tools when hobkin opens it, so it sees a new tool only after hobkin opens again.
  Runs pick up tools when they start.
- If a folder has an invalid or repeated tool name, the host leaves the whole folder out and logs why.

### Hooks on tool calls

```ts
toolHooks: {
  tools: ['bash'],
  before: (call) => {
    if (typeof call.args.command === 'string' && /\brm -rf \/(\s|$)/.test(call.args.command)) return { block: 'Echo does not let an agent remove the whole disk.' }
  },
  after: (call, result) => (result.text.length > 20_000 ? { text: result.text.slice(-20_000) } : undefined),
},
```

- `tools` lists the tools to hook by the names agents know them by (`bash`, `read`, `echo_shout`), or is `'all'`. A
  call to a tool that no hook names never leaves the agent's process, so hooks cost nothing for the calls they skip.
  `'all'` sends every call of every agent through the host, so use it only when you must.
- `before(call)` returns nothing (the call runs), `{ block: reason }` (the agent gets the reason instead of a
  result), or `{ args }` (the call runs with these arguments instead). `call` is `{ agent, id, name, args }`. `args`
  holds the call's arguments as an object (`{ command: 'git log -5' }` for `bash`), and `name` is the tool's name as
  agents know it.
- `after(call, result)` returns nothing, or `{ text?, failed? }`, which the agent gets in place of the result.
- When several integrations hook the same call, their hooks run in folder order. The first refusal wins, and each
  hook passes its changed arguments to the next.
- If a hook throws or takes longer than 10 seconds, the call goes through unchanged and the host logs why. Set
  `failClosed: true` if a failing hook must refuse the call instead (or, in `after`, hold back the result). If the
  host itself does not answer within 15 seconds, the call goes through.
- Hooks apply to the main conversation, runs and durable hobkins on Pi. Helper agents and Claude Code agents are not
  hooked.
- To watch calls without changing them, use `onToolCall`: it sees every call, hooked or not.

### Workflows

A workflow is a Markdown file in `workflows/` inside your integration's folder. Its body holds directions for
hobkin's agent, and its front matter says what starts it.

```md
---
{ "title": "Morning digest", "at": "09:00", "timezone": "America/Toronto", "on": ["press", "after:echo.say"] }
---
Read what echo said since yesterday and write a digest of three lines. Use echo_shout only for its first line.
```

- Its id is `<integration id>/<file name>`: `echo/morning-digest` for `workflows/morning-digest.md`.
- The front matter is JSON between `---` lines, as in a routine. It holds `title`; a schedule, if the workflow has
  one; `model`, `effort` and `cwd`, which default to the home's background settings; and `on`, the other things that
  start it. It never holds `enabled`: whether a workflow is on is the user's choice, kept in their home.
- A schedule takes the same fields as a routine's: `at` as `"HH:mm"` or a list of them, or a `window` (use `at` or
  `window`, not both); `timezone`; and `weekday` (0 to 6, from Sunday), `day` of the month, or `date` for a single
  run. For example:
  - Every Monday at 08:00 in Toronto: `"at": "08:00", "timezone": "America/Toronto", "weekday": 1`
  - Every weekday: `"weekday": [1, 2, 3, 4, 5]`
  - Several times a day: `"at": ["09:00", "17:00"]`
  - Every 30 minutes between 09:00 and 17:00: `"window": { "start": "09:00", "end": "17:00", "everyMinutes": 30 }`
  - Once: `"date": "2026-12-01"` with `at`
  - The first of each month: `"day": 1` with `at`
- A workflow starts on its schedule and on every start listed in `on`. These are the starts:
  - `press`: the user presses Run now on its row in Routines, "Run <title>" in the spotlight, or a button of your own.
  - `after:<command>`: that app command finished well. The run's input is `{ command, args, answer }`.
  - `start`: your host part calls `context.startWorkflow(name, input)`.
- hobkin refuses a file that has neither a schedule nor anything in `on`, or that has a setting hobkin does not
  know. It leaves that file out and lists why among the routines' errors.
- Each start makes one run. The run follows the body as its directions and finds its input in its context as
  `input`. It gets your integration's tools and no other integration's, and it reports in Reports like a routine. In
  the directions, name each tool by its full name: `standup_last`, not `last`. Several runs of one workflow can run
  at the same time.
- A newly added workflow never runs for a scheduled time that passed before it first appeared.
- The window lists workflows in Routines, under your integration's name. There the user can run them and turn them
  off and on. Your own card or screen can do the same with `@/integration/use-workflows.ts`:
  - `useWorkflows(id)` returns your workflows' rows (`{ id, title, starts, enabled, cadence, state, lastRun }`).
  - `runWorkflow(workflowId)` starts one and returns `{ run }`.
  - `setWorkflowEnabled(workflowId, on)` turns one off or on.

  `runWorkflow` and `setWorkflowEnabled` reject with the host's reason when the host refuses.
  `pressable(row)` from `@/integration/workflows.ts` says whether a row can be run now.

```tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { runWorkflow, useWorkflows } from '@/integration/use-workflows.ts'
import { pressable } from '@/integration/workflows.ts'

export function TidyButton() {
  const tidy = useWorkflows('notes').find((row) => row.id === 'notes/tidy')
  const [why, setWhy] = useState<string | null>(null)
  if (!tidy || !pressable(tidy)) return null
  return (
    <>
      <Button onClick={() => void runWorkflow(tidy.id).then(() => setWhy(null), (error: Error) => setWhy(error.message))}>Tidy now</Button>
      {why ? <p className="text-[13px] text-muted-foreground">{why}</p> : null}
    </>
  )
}
```

Any command you run from the window works the same way: when the host refuses, the call rejects with the host's
reason. Show that reason on the screen where the user pressed, not in the console.

## Testing

Run `pnpm -s typecheck` once before you start. Any error it shows at that point is not yours. Leave it alone, and
judge your work only by errors that name your folder.

To test the host part, build a fake context and call the part directly:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Unavailable } from '#host/commands.ts'
import type { HostContext } from '#host/integration-contract.ts'
import notesPart from '../host.ts'

const closed = () => { throw new Unavailable('hobkin is not open.') }
const context: HostContext = {
  id: 'notes', live: false, options: {}, log: () => {}, changed: () => {}, connected: () => true,
  hobkin: closed, dataRoot: closed, snapshotWork: () => undefined, startWorkflow: async () => closed(),
}

test('notes.add keeps the note, and an agent finds it with the tool', async () => {
  const part = await notesPart(context)
  await (part.handlers!['notes.add'] as (args: { text: string }) => unknown)({ text: 'buy milk' })
  const find = part.tools!.find((tool) => tool.name === 'find')!
  assert.equal(await find.execute({ word: 'milk' }, { agent: '#main', id: 'call-1' }), 'buy milk')
  assert.deepEqual(await part.toolHooks!.before!({ agent: '#main', id: 'call-2', name: 'bash', args: { command: 'rm -rf ~' } }), { block: 'Notes does not let an agent remove your home folder.' })
})
```

Pass fakes through `options`. GitHub's part takes a fake `source` (see `integrations/github/test/host-support.ts`).
If your commands run gh, give the fake context a fake `gh` too. When time matters, take the clock the same way: read
`options.now`, a function that defaults to `Date.now`, so a test can set the time.

To test through a real host, start one with `integrationFolder` (a folder, or the modules themselves) and
`integrationOptions: { <id>: {...} }`, as `integrations/github/test/host-wiring.test.ts` does.

To test the window part, hand it to the window with `setWindowParts([part])` from `@/integration/registry.ts`, then
test your pure functions (`home`, `spotlight`, `pulls` and your own models). The core's own tests use a made-up part
the same way (`ui/test/integration-fixture.ts`).

Run only your files while you work:

```sh
node --test integrations/<id>/test/*.test.ts
pnpm -s typecheck
```

Your tests must never open a browser, never reach a real service (fake it through `options`), and never touch the
user's own home (`~/.hobkin`) or Pi's folder (`~/.pi`). End every made-up address in `.invalid`.

## Before you call it done

- [ ] The folder's name is the manifest's `id`, and every command is named `<id>.<something>`.
- [ ] Nothing outside the folder changed. If you needed the core to change, that changes the contract between the
      core and integrations: say so, and do not patch the core from your folder.
- [ ] Every command has a description an agent can act on, a closed schema, and refuses with `Unavailable` and a
      reason the user can read.
- [ ] `state()` holds no secret: no token, key or password, and nothing a log line would hide.
- [ ] Each agent tool's description says when to use it, and its `execute` refuses bad input with words the agent can act on.
- [ ] Hooks name only the tools they need, and a hook that guards something says `failClosed: true`.
- [ ] A scripted host (`live: false`) shows sample data and reaches nothing real.
- [ ] Your tests pass, and `pnpm -s typecheck` is clean.
- [ ] With your folder moved out of `integrations/`, the app still typechecks and starts.

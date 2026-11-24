# Writing an integration

An integration is one folder under `integrations/`. The app's core never imports it: the host and the window look in
this folder when they start and load what each subfolder offers. Drop a folder in and it works. Take it out and the
app runs without it, with nothing of it left on any screen.

`integrations/github/` is the one that ships. Read it next to this guide: every piece below has a real example there.
The spec behind all of this is `_specs/065-integration-drops/spec.md`.

## The folder

```
integrations/<id>/
  integration.ts   the manifest: id, name, commands, screens. Required.
  host.ts          the host part: state, command handlers, hooks. Optional.
  window.tsx       the window part: screens, card, Home, spotlight. Optional.
  host/ window/    your own modules, named as you like.
  test/            your tests. `pnpm test` runs integrations/*/test/**/*.test.ts.
```

`<id>` is the folder's name: lowercase letters, digits and `-`, starting with a letter, at most 32 characters. It
names everything the integration adds: its commands are `<id>.<something>`, its state travels under `<id>`, and its
log lines start with it.

What a folder may import:

- `#shared/*` (the repository's `shared/`) from anywhere in the folder.
- `#host/*` (the host's `host/src/`) from host code only.
- `@/*` (the window's `ui/src/`) from window code only.
- Anything inside its own folder, and the packages the app already depends on.

It never imports another integration's folder, and nothing in `host/`, `shared/` or `ui/src/` ever imports it.

If a folder fails to load in the host (a syntax error, a manifest whose id is not the folder's name, a command name
the app already has), the host logs why and leaves that whole folder out. The window leaves out a window part that
fails to load; a part whose names the window's registry refuses is logged and still drawn, but the host has left its
commands out, so they answer "no such command". Either way the rest of the app runs.

## The manifest: `integration.ts`

Plain data that the host and the window both read. No Node APIs, no DOM, no React.

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

Commands work exactly like the app's own (`shared/commands/registry.ts`):

- `args` is a TypeBox schema. The host checks every call against it before your handler runs, so a handler only ever
  sees arguments that fit. Close objects with `additionalProperties: false`.
- `description` is what hobkin reads about the command. Write it for an agent: what it does, what each argument
  means, what it refuses.
- `hobkin: true` lets hobkin run it through its `client` tool. Leave it out for commands only the window should run.
- `outside: true` marks a command that changes something outside the app (a file, a service). hobkin is then told to
  send the user to the window instead of running it.

Screens: each one gets a place in the menu after Work, in folder order, and the spotlight finds it by `label`,
`line` and `keywords`. The user can take a screen out of the menu. A screen id must not be one of the core's
(`home`, `work`, `settings` and the others in `ui/src/app/screens.ts`).

## The host part: `host.ts`

Its default export is a function the host calls once at start, with a context. It returns the part: an object with
only the fields you use. Types: `host/src/integration-contract.ts`.

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
| `options` | What a test handed this integration (`integrationOptions[id]` on the host). Empty otherwise. Use it to take fakes. |
| `log(line)` | One line in the host's log, prefixed with the id. Never log a secret. |
| `changed()` | Say your state changed. The host asks `state()` again and sends it if it differs. |
| `connected()` | A window is open now. Use it to skip timed reads nobody would see. |
| `hobkin()` | hobkin's application (`workAction`, `refresh`). Throws `Unavailable` while hobkin is not open. |
| `dataRoot()` | The folder hobkin's home data is in. Throws `Unavailable` while hobkin is not open. |
| `snapshotWork()` | The `work` key of hobkin's snapshot now, or undefined. A new object each time it changes. |
| `startWorkflow(name, input?)` | Starts one run of your `workflows/<name>.md` now (see "Workflows" below). Answers `{ run }`. Throws `Unavailable` when hobkin is not open or the workflow is unknown or turned off. |

### What the part may give

| Field | When the host calls it |
| --- | --- |
| `state()` | On every publish. Its answer is your slice: JSON only, nothing secret. It reaches every window whole when it differs, and with every reconnect. |
| `handlers` | One function per command of your manifest, by full name. Throw `Unavailable` (from `#host/commands.ts`) to refuse with a reason the user and hobkin read. Anything else thrown reads as a failure. |
| `start()` | Once, when the host is serving. Start timers here, and `unref()` them. |
| `close()` | Once, when the host stops. Clear what `start` started. |
| `beforeCommand(call)` | Before every command the host runs, yours and the app's, from the window (`call.from === 'window'`) or from hobkin (`'hobkin'`). Throw `Unavailable` to refuse it. |
| `afterCommand(call)` | After every command, with `call.outcome` (`ok`, and `value` or `error`). |
| `onToolCall(call)` | Every tool call of every agent, once when it starts and once when it ends: `agent` is `#main` for hobkin's main conversation or a run's id, plus the tool's `name`, its `args`, `state` and, once ended, `output`. It only watches. |
| `onMerged(pull)` | A pull request left the open ones: merged through the app (Change Review's verdict), or merged or closed elsewhere as the host's watch of hobkin's own pull requests saw it. By `url`, or `repo` and `number`. |
| `tools` | Tools hobkin's agents can call, run in the host. See "Tools for agents" below. |
| `toolHooks` | Hooks that may refuse or change an agent's tool call before it runs, and change what the agent reads after. See "Hooks on tool calls" below. |
| `pulls()` | Open pull requests you know, as `{ mine, waiting, sample }` (the shape is `PullRequest` in `shared/protocol/pulls.ts`). Change Review prepares reviews of them in the background when the user's settings ask for it. `sample: true` means made up, and those are never reviewed. |

Except a refusal from `beforeCommand`, anything a hook throws is logged and changes nothing. Keep hooks fast: they run
on every command.

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

Its default export is a `WindowPart` (`ui/src/integration/contract.ts`). The window finds it at start.

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
| `card` | A component for your card on the Integrations screen, above the MCP servers. It gets `{ still }` (true when the user asked for no movement). |
| `mark` | Two letters and a hue (0 to 359), drawn in the app's palette on your tile and card. |
| `pulls(state)` | The pull requests in your state. Work's rows and the trail read their review and checks from here. |
| `home(state, now)` | What you add to Home: `needs` (rows waiting on the user, each with its stack card), `cards` (things that went wrong), a `tile` among Connections, `known`, `lift` (how many need the user), `more`. Type: `HomeContribution` in `ui/src/features/home/types.ts`. GitHub's is `integrations/github/window/home.ts`. |
| `spotlight(state)` | Entries the spotlight finds, each with where Enter goes. GitHub's is `integrations/github/window/spotlight.ts`. |

What a screen or card uses from the core:

- `useSlice<State>(id)` from `@/integration/use-slice.ts`: your state as the host sent it, `unknown` before that, and
  `sample(now)` with no host.
- `runnerFor<Results>()(manifest)` from `@/integration/commands.ts`: a `run(name, args)` typed by your manifest and
  results. GitHub keeps one in `window/commands.ts`.
- `openLink(event, url)` and `openAddress(url)` from `@/lib/open-link.ts`: links that open in the system browser from
  the Mac window and as a normal link in a browser tab.
- `createTwoClicks` from `@/lib/two-clicks.ts`: the press-twice confirm the app uses before anything it cannot undo.
- The app's own components (`@/components/ui/*`), its screen frame (`@/app/screen-layout.ts`) and its motion
  (`@/lib/motion.ts`). Tailwind sees classes used in this folder.

## Giving agents more to work with

Commands are what the window and hobkin's `client` tool run. An integration can also put intelligence into hobkin's
agents themselves: tools they call by name, hooks on every tool call they make, and workflows written as directions.
The test integration `host/test/fixtures/integrations/echo/` uses all three; read it next to this part.

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

- An agent knows the tool as your id with `_` for `-`, then `_`, then its name: `echo_shout`. The short name is
  lowercase letters, digits and `_`, starting with a letter, at most 41 characters. A name that clashes with one of
  Pi's or hobkin's own tools (`bash`, anything starting `hobkin_`) is dropped.
- `description` is all the agent knows about it: say what it does and when to use it.
- `agents`: `main` (hobkin's main conversation), `runs` (work, routines and workflows) and `durable` (durable hobkins
  on Pi). All three when left out. Helpers and Claude Code agents do not get integration tools.
- `execute` runs in the host, with arguments already checked against `parameters`. It answers text, or
  `{ text, failed: true }`. What it throws reaches the agent as a failed call with the error's words. `run.agent` is
  `#main` or the run's id; `run.signal` is set when the agent stops waiting.
- The main conversation reads the tools when hobkin opens it: a new tool reaches it once hobkin opens again. Runs read
  them as they start.
- A folder whose tool names are bad or repeated is left out whole, and the host logs why.

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

- `tools` names the tools as agents know them (`bash`, `read`, `echo_shout`), or is `'all'`. A call to a tool no hook
  names never leaves the agent's process, so hooks cost nothing for the calls they skip. `'all'` sends every call of
  every agent through the host: use it only when you must.
- `before(call)` answers nothing (the call runs), `{ block: reason }` (the agent reads the reason instead of a result),
  or `{ args }` (the call runs with these arguments). `call` is `{ agent, id, name, args }`.
- `after(call, result)` answers nothing, or `{ text?, failed? }`: what the agent reads in place of the result.
- Hooks of several integrations run in folder order. The first refusal wins, and changed arguments pass to the next.
- A hook that throws, or has not answered in 10 seconds, lets the call through as it was, and the host logs why. Set
  `failClosed: true` when a failing hook must refuse the call instead (and, after a call, withhold its result). If
  the host itself does not answer within 15 seconds, the call goes through.
- Hooks reach the main conversation, runs and durable hobkins on Pi. Helpers and Claude Code agents are not hooked.
- To only watch, use `onToolCall`: it hears every call, hooked or not, and changes nothing.

### Workflows

A workflow is a file in your folder's `workflows/`: directions hobkin's agent follows, and what starts it.

```md
---
{ "title": "Morning digest", "at": "09:00", "timezone": "America/Toronto", "on": ["press", "after:echo.say"] }
---
Read what echo said since yesterday and write a digest of three lines. Use echo_shout only for its first line.
```

- Its id is `<integration id>/<file name>`: `echo/morning-digest` for `workflows/morning-digest.md`.
- The front matter is JSON between `---` lines, as a routine's is: `title`; a schedule if it has one (`at` as
  `"HH:mm"` or a list of them, or a `window`, with `timezone`, and `weekday` 0 to 6 from Sunday, `day` of the month, or
  a `date` for once); `model`, `effort` and `cwd`, which default to the home's background ones; and `on`, what else
  starts it. It never says `enabled`: whether it is on is the user's, kept in their home.
- What starts it: its schedule; `press` (Run now on its row in Routines, "Run <title>" in the spotlight, or a button
  of your own); `after:<command>` (once that app command ended well, the run's input is `{ command, args, answer }`);
  and `start` (your host part's `context.startWorkflow(name, input)`).
- Each start is one run: the body is its directions, its input is in its context as `input`, it is offered your
  integration's tools and no other integration's, and it reports in Reports like a routine. Several runs of one workflow may run at once.
- A newly added workflow never runs a scheduled time that passed before it first appeared.
- The window lists workflows in Routines, under your integration's name, where the user runs them and turns them off
  and on. Your own card or screen can do the same with `useWorkflows(id)`, `runWorkflow(id)` and
  `setWorkflowEnabled(id, on)` from `@/integration/use-workflows.ts`.

## Testing

Host part: build a fake context and call the part directly. `integrations/github/test/host-support.ts` does it in 40
lines; copy it. Hand fakes through `options` (GitHub takes a fake `source`), and a fake `gh` when you run commands.
To test through a real host, start one with `integrationFolder` (a folder, or the modules themselves) and
`integrationOptions: { <id>: {...} }`, as `integrations/github/test/host-wiring.test.ts` does.

Window part: hand the window your part with `setWindowParts([part])` from `@/integration/registry.ts`, then test your
pure functions (`home`, `spotlight`, `pulls`, your models). The core's own tests use a made-up part the same way
(`ui/test/integration-fixture.ts`).

Run only your files while you work:

```sh
node --test integrations/<id>/test/*.test.ts
pnpm -s typecheck
```

Rules the tests must keep: never open a browser, never reach a real service (fake it through `options`), never touch
the user's own home (`~/.hobkin`) or Pi's folder (`~/.pi`). A made-up address ends in `.invalid`.

## Before you call it done

- [ ] The folder's name is the manifest's `id`, and every command is named `<id>.<something>`.
- [ ] Nothing outside the folder changed. If you needed the core to change, that is a change to the contract: say so
      instead of patching the core from your folder.
- [ ] Every command has a description an agent can act on, a closed schema, and refuses with `Unavailable` and a
      reason the user can read.
- [ ] `state()` holds no secret: no token, key or password, and nothing a log line would hide.
- [ ] Each agent tool's description says when to use it, and its `execute` refuses bad input with words the agent can act on.
- [ ] Hooks name only the tools they need, and a hook that guards something says `failClosed: true`.
- [ ] A scripted host (`live: false`) shows sample data and reaches nothing real.
- [ ] Your tests pass, and `pnpm -s typecheck` is clean.
- [ ] With your folder moved out of `integrations/`, the app still typechecks and starts.

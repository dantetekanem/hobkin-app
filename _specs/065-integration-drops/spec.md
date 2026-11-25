---
{
  "id": "065-integration-drops",
  "title": "An integration is a folder the core never imports",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "023-integrations", "024-github"],
  "updated": "2026-11-25"
}
---
# An integration is a folder the core never imports

## Outcome

An integration is a folder under `integrations/` at the repository's root. The app's core never imports one: the host and the window find each folder when they start. GitHub is `integrations/github/` and works as it did. Taking the folder out leaves an app with no GitHub anywhere and nothing broken. A new integration is a new folder, built from `integrations/README.md` alone, and it can attach to every command the app runs and every tool call an agent makes. The MCP catalog on the Integrations screen is gone.

The user's words, 2026-11-24: "integrations right now is patching the code, this is broken. i want an integration to be completely outside the main code, and be able to attach all tool calls. github must be a `integrations/github/` drop and it will work exactly as now, so when i build a new one, as well"; then, with a picture of the catalog ("10 more hobkin can reach"): "remove this too, they dont exist. and building new extensions should have clear documentation for an agent to read and build on top of it".

## Decisions

- A folder holds `integration.ts` (the manifest: id, name, line, commands, screens; `shared/integration/manifest.ts`), `host.ts` (default export: a `HostPartFactory`, `host/src/integration-contract.ts`), `window.tsx` (default export: a `WindowPart`, `ui/src/integration/contract.ts`), its own modules, and `test/`. Either part may be left out.
- The core never imports `integrations/**`. An integration imports the core through `#shared/*`, `#host/*` (host code) and `@/*` (window code).
- The host lists `integrations/` when it starts, in name order, and imports each folder's `integration.ts` and `host.ts`. The window finds `integrations/*/window.tsx` with `import.meta.glob` in `ui/src/integration/loaded.ts`, its only use of the folder. A folder that fails to load is logged and left out; the rest of the app runs. Tests hand the host and the window their own parts.
- Commands: a manifest's commands join the registry when the host starts and are checked, run, refused and listed to hobkin's `client` tool exactly as the core's. Each is named `<id>.<something>`; a name the app already has is refused. `github.open` is gone: every link opens through the core's `system.open`. `work.issue` is `github.issue.add`.
- State: the state message carries `slices`, each integration's state by its id, whole whenever it differs and with every reset. A reset without an integration's slice means the host does not run it, and the window shows the part's `unknown`. A window with no host shows the part's `sample(now)`.
- Attaching: a host part may refuse any command before it runs (`beforeCommand`), hear how every command ended (`afterCommand`), and hear every tool call of every agent when it starts and when it ends (`onToolCall`): the main conversation's from Pi's events, with arguments and result, and each run's from its activity feed. A hook that throws is logged and changes nothing, except a refusal. It also hears a merge the app made (`onMerged`), and may hand Change Review the open pull requests it knows (`pulls`). GitHub's three patches in the host (reading again after `work.change` and `work.group`, after a merge, and after closing an issue) become these hooks.
- gh stays a core tool, because Change Review reads and posts pull requests through it. A part gets `context.gh` on a live host and on a scripted host started with `--github`.
- Window: each manifest screen sits in the menu after Work and before the contextual screens, in folder order. The user can take any of them out of the menu; the setting that did this for GitHub alone becomes that, and a choice saved before carries over. A screen keeps its own remembered state (GitHub's tab and project carry over). The spotlight finds the screens and what a part adds; Home shows what a part adds; the Integrations screen shows each part's card above Pi's servers; Work's rows and the trail read pull requests through `pulls`.
- What stays in the core: Change Review's pull request transport (`host/src/review/gh.ts`, `client/code-hosts.json`), and Work's pull request and issue links, which hobkin's runtime makes. They are the core's own code-host plumbing, used with or without the GitHub folder.
- The catalog is removed (the user, 2026-11-24). Integrations lists the full integrations, then the MCP servers Pi's file has, as Pi reports them. `integrations.add` goes with it; turning a server on or off and removing one stay.
- `integrations/README.md` is written for an agent that has never seen the app: the folder, each field and hook with a small example, how to test one, and a checklist. It names only what the code does.

## Agents: tools, hooks on tool calls, workflows

The user, 2026-11-24 at 18:15: "i will want integrations to work not just by making apis, but even adding intelligence. tool calling is a critical thing on hobkin. for example I might want to build custom workflows (kind of work mode) by casting a few directions".

Today only hobkin's main conversation gets a tool from the host (`client`, through hobkin's bridge). Runs and durable hobkins get a fixed set (`namingExtensions` in hobkin's `src/cli/harnesses.mjs`), and nothing outside an agent's own process can stop or change a tool call. Pi can: its extension events `tool_call` (block a call, or change its input) and `tool_result` (change what the agent reads). hobkin uses them once, to keep helpers to their tools.

- Tools. A host part may give agents tools: each has a name, a description, TypeBox parameters, which agents get it (the main conversation, runs, durable hobkins; all three when it says nothing), and an `execute(args, { agent, signal })` that runs in the host. hobkin's runtime gives each of those Pi agents one proxy per tool through its bridge, so the call runs in the host and its answer goes back to the agent. A helper gets one only when its role lists it. A tool's name is the integration's id with `_` for `-`, then `_`, then its own name, so `github_find_pull`. With no integration tools, no agent loads anything new.
- Hooks on tool calls. A host part may hook calls to the tools it names, or to every tool: `before` may let a call through, refuse it with a reason the agent reads, or change its arguments; `after` may change what the agent reads back. hobkin's runtime loads one extension into every Pi agent that asks the host only for a call to a hooked tool, so a call nothing hooks never leaves the agent's process. Hooks run in folder order: the first refusal wins, and changed arguments pass to the next hook. A hook that throws or has not answered within 10 seconds lets the call through as it was, and the host logs why, unless the hook says it must refuse when it fails.
- Workflows. A folder's `workflows/<name>.md` is a workflow: a routine's file (JSON front matter with its title, model or tier, effort, folder, and a schedule as a routine has, or none), plus `on`, what else starts it: `press` (a button on the integration's card and an entry in the spotlight), `after:<command>` (once that app command ended well, its arguments and answer handed to the run), and `start` (the integration's own code, `context.startWorkflow(name, input)`). Its body is the directions. hobkin's runtime reads each integration's `workflows/` as a second source of routines, read only, each named `<id>/<name>`, and runs one as a routine runs: one run with those directions, its input and the integration's tools, which reports in Reports and may file work and start helpers as any run may. Nothing is written into the home but whether the user turned a workflow off.
- Claude Code agents (the `claude` engine) get none of these here: they would need an MCP server of the host's (open question).
- The host hands hobkin's application one `integrations` option: the tools offered (names, descriptions, JSON schemas, which agents), a call to run one, the hooked tool names, the before and after calls, and the workflow folders with each one's tools. The application gives back `startWorkflow(id, input)`. A runtime from before ignores the option, and the host runs on without these.

## Out of scope

- hobkin's runtime use of GitHub (opening and merging pull requests, picking up issues).
- Change Review's code hosts as integrations.
- Installing an integration from outside the repository.

## Acceptance

- A1. Nothing under `host/`, `shared/` or `ui/src/` imports from `integrations/`. A copy of the repository without `integrations/github/` typechecks, builds, passes its host and window tests, and its host starts; its window has no GitHub in the menu, the spotlight, Home or Integrations.
- A2. With the folder, GitHub works as before: every proof of 024 passes, from `integrations/github/test/`.
- A3. A new folder needs no edit to the core: a test integration gets its commands checked, run and listed to hobkin's `client` tool, its slice sent with a reset, its screen in the menu and its card on Integrations.
- A4. `beforeCommand` and `afterCommand` hear the window's and hobkin's commands, and a refusal refuses; `onToolCall` hears a main-conversation call and a run's call once as it starts and once as it ends; a hook that throws changes nothing else.
- A5. A window saved before this comes back the same: GitHub out of the menu stays out, and its tab and project stay chosen.
- A6. The Integrations screen has no catalog and no way to add a catalog service; Pi's configured servers show as before, with their states, tools and actions.
- A7. An agent given only `integrations/README.md` builds a working integration.
- A8. The packaged app stages each folder's host files.
- A9. An integration's tool is in the tool list of the main conversation, a run and a durable hobkin on Pi, and a call runs its `execute` in the host with the agent named, and the agent reads its answer. With no integration tools, agents load nothing new.
- A10. A `before` hook refuses a call to a hooked tool with its reason and changes another's arguments; an `after` hook changes what the agent reads; a call to a tool nothing hooks never reaches the host; a hook that throws or is slow lets the call through, unless it says to refuse.
- A11. A workflow file runs on its schedule, on a press, after its command, and when its integration starts it, with its directions, its input and the integration's tools, and its run is in Reports. Turned off, it does not run.

## Proof

- A1. check: a `git archive` copy with `integrations/github/` deleted: typecheck, `vite build`, the host and window tests, a scripted host started on a scratch home.
- A2. `integrations/github/test/*` (the 024 tests, moved).
- A3. `host/test/integration-host.test.ts`, `ui/test/integration-parts.test.ts`, on a test integration.
- A4. `host/test/integration-host.test.ts`.
- A5. `ui/test/integration-pages.test.ts`.
- A6. `host/test/integrations.test.ts`, `ui/test/integrations-*.test.ts`; check: the screen in light and dark.
- A7. check: a fresh agent builds a small integration in a scratch copy from the README alone.
- A8. `scripts/package` rules test.
- A9. hobkin's harness tests with a fake host (a run and a durable hobkin see the tool and call it), `host/test/integration-host.test.ts` (the host runs `execute` and answers); check: the main conversation calls a test integration's tool on a scratch home.
- A10. hobkin's extension test (block, change, after, an unhooked call never asks, a slow or throwing hook), `host/test/integration-host.test.ts` (hooks in folder order).
- A11. hobkin's schedules and runner tests on a workflow folder (schedule, press, start, turned off), `host/test/integration-host.test.ts` (`after:<command>`, `startWorkflow`).

## Steps

- [x] S1 (A1, A3). Contract: the manifest, the host part, the window part, the parts registry, GitHub's manifest (lead). ab3ba1f, 0e934b1.
- [x] S2 (A3, A4, A8). Host core: loading, commands, slices, hooks, pulls, `#host/*`, packaging (lane H1). f812bd6, 923e020, 96721dc, e26fc01, 1c6662a, 6637866. `stage.ts` itself was not run (it installs packages); its rules are tested.
- [x] S3 (A2). GitHub's host part (lane H2). fa1535f, dccec19, 96ac41c.
- [x] S4 (A2, A3, A5). Window core: loading, pages in the shell, the menu setting, remembered page state; GitHub's page and card into the folder (lane W1). 062e9d3 to 1085e60. Not seen in a browser.
- [x] S5 (A1, A2). Home, spotlight, Work and the trail through the parts (lane W2). 0fc3f53 to 0454b7d, a0baad4.
- [x] S6 (A6). The catalog gone (lane C). 1018f58, e0999ba, and on the user's word ("yes commit everything") 126f647, the host and shared removal the auto-mode check had refused. 38 integrations tests pass. Not seen in a window.
- [x] S7 (A1, A2). The switch: the host and window run GitHub from the folder only, the old files gone (lead with H1 and W1). c1b8fb3, 6dae90a, e43d414, acdb26f. A1 checked on a `git archive` of a0baad4 without `integrations/github/`: typecheck and `vite build` pass, 303 of 304 tests in the 42 files around integrations, Home, the shell and reviews pass (the one failure is S6's add test above), and a scripted host on a scratch home starts and logs nothing of integrations. Not done: the window drawn without the folder.
- [x] S8 (A1, A7). `integrations/README.md`, A1 and A7 (lead). fd8e0af, 22604d8, 23504f5, 2058ea8. A7: two fresh agents, each given only the guide in a scratch copy, built working integrations (notes: 7 tests; stand-up: 8 tests; typecheck clean in their folders). The first listed nine places it had to read code, all answered; the second listed smaller ones, all answered, and none of the first nine came back.
- [x] S9 (A9, A10, A11). hobkin's runtime: the `integrations` option, host tools bridged into every Pi agent, the tool-call hook extension, workflow folders as a read-only source of routines, `startWorkflow` (lane R, in `~/Poetry/hobkin`). hobkin main f41477b, d798acd, 84201be, 60dd4aa, 89f6f8a (a new workflow never runs a slot from before it appeared). Not in the live checkout yet, which is on another session's branch; inert without the host's option. Helpers and Claude Code agents get no tools or hooks.
- [x] S10 (A9, A10, A11). The host: `tools`, `toolHooks` and workflows in the contract, served to the runtime, `context.startWorkflow`, `after:<command>` starts, a command to press a workflow. 2b7c9ea, 268d95b. End to end on archives of client HEAD and hobkin main: the echo fixture's workflow listed and started by `workflow.run`. Not run end to end: an agent calling an integration's tool through the host.
- [x] S11 (A11). The window: workflows in Routines under each integration, Run now and a switch, `useWorkflows`, "Run <title>" in the spotlight. 43c81b1, e5c3e2d. Seen in still renders only.
- [x] S12 (A7). The README covers tools, hooks and workflows, with an example of each. 22604d8 and the A7 rounds.

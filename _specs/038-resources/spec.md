---
{
  "id": "038-resources",
  "title": "Starting blank: what each agent loads",
  "kind": "work",
  "status": "ready",
  "depends": ["011-work", "020-settings", "023-integrations", "033-claude-code-agents", "034-durable-hobkins"],
  "updated": "2026-11-13"
}
---
# Starting blank: what each agent loads

## Outcome

Every agent hobkin starts on Pi begins with hobkin's own instructions and tools and nothing of Pi's: no extension, skill or AGENTS.md the user did not choose for it. In Settings the user sees what Pi has installed (packages such as pi-agentic-search and the web search ones, extensions and skills of their own, Pi's AGENTS.md) and hobkin's own instructions, and chooses what each kind of agent loads: the main chat, background jobs and routines, Work runs, and durable hobkins. Every run is held to that choice. Settings also shows what each kind actually loaded and when each resource was last used.

## Decisions

### What a resource is

- A resource is something of Pi's that changes what an agent knows or can do. Four types are offered.
  - A package: a Pi package installed at user level, as Pi's settings list it under `packages`. It is chosen whole, with the extensions and skills it holds. Its id is `package:` and Pi's own source for it, such as `package:npm:@siddr/pi-web-search` or `package:../../Poetry/pi-agentic-search`.
  - An extension or a skill of its own, outside any package, as Pi resolves it at user level: Pi's `extensions/` and `skills/` folders and its `extensions` and `skills` settings. Its id is `extension:` or `skill:` and its path inside Pi's folder, or its absolute path when it is outside.
  - A built-in: `builtin:mcp`, which brings the MCP servers Integrations has on (`023-integrations`), and `builtin:llama.cpp`.
  - A context file: `context:pi` is the AGENTS.md (or CLAUDE.md, or AGENTS.override.md) in Pi's folder. `context:folder` is the AGENTS.md and CLAUDE.md files Pi finds in the folder a run works in and the folders above it.
- Prompt templates and themes are never loaded and not offered. They serve Pi's terminal, and no hobkin run uses them.
- Pi itself is not a resource. Its built-in tools, its base prompt, and its code mode and tool search load in every run that uses tools, as they do in the main chat today (`src/cli/pi-extensions.mjs:41`).
- hobkin's own instructions are not chosen. They always load, and Settings lists them. This keeps the decision already taken: blank means no inherited Pi resources, not the loss of hobkin's directions, memory or bridge tools (`work-in-progress.md:388`).
- Today `resource-policy.mjs` names six types and ten purposes, and its ids cannot hold `@` or `/` (`src/cli/resource-policy.mjs:1-5`). It becomes the four types and four kinds here. An id may hold any printable characters, up to 300.

### Where the list comes from, and why it is trusted

- The catalog is built by hobkin's runtime with Pi's own code: `DefaultPackageManager.resolve` with missing packages skipped, as `extensionPaths` does today, so nothing is installed or run to find out (`src/cli/pi-extensions.mjs:20-28`). Only what Pi marks as user scope and on is kept. Something the user switched off in Pi is not offered.
- Nothing from a folder's `.pi` is listed or loaded: not its settings, extensions, skills or MCP servers. Today a project's own extensions load into the routines that run in it (`test/cli-pi-extensions.test.mjs:52`), and every run with tools outside Work passes `--approve` (`src/cli/harnesses.mjs:69`). Both end. Every run passes `--no-approve`.
- A selection holds ids, never paths. When a run starts, hobkin builds the catalog again and loads the paths it finds now for the chosen ids, each an existing file or folder. A path in a selection, in a run request or in any file is refused. So a path the user did not choose is never loaded because a file named it.
- A skill's name and line come from its SKILL.md frontmatter, and a package's from its package.json, read through Pi's loaders. An extension's tools are not known until a run loads it. Settings shows them from the last run that did.
- hobkin's own exclusions stay. pi-emote is never offered, since hobkin has its own face. pi-cache-compact-preserved-messages, pi-memory and pi-scheduler are not offered to the main chat, for the reasons in `src/cli/pi-extensions.mjs:9-16`. The other kinds may choose them.
- A live host reads Pi's own folder. A host started in development or a test reads its own Pi folder, by the rule Integrations uses (`piAgentDirFor`, `host/src/integrations.ts:58-65`), and never `~/.pi/agent`.

### The kinds, and what each loads by default

- Four kinds can be chosen for. The main chat. Background: routines and the jobs hobkin delegates, which are the runs with no purpose. Work: its discover, look and do runs. Durable hobkins on Pi. A run's kind comes from its purpose, as `harnesses.mjs` reads it today.
- By default each kind loads nothing of Pi's, and these of hobkin's own:

  | Kind | hobkin's own |
  | --- | --- |
  | Main chat | `prompt.md`, `taste.md`, `learning-context.md`, `v2-runtime.md`, `memory.md` and `canvas.md` (`src/cli/pi-session.mjs:121-133`); the persona, hobkin's directions, its memory and the decided items (`src/cli/hobkin-extension.mjs:27-34`); hobkin's tools |
  | Background | `background.md`. A routine also gets hobkin's directions and memory, and its own memory and log (`src/cli/checks.mjs:79-87`) |
  | Work | `background.md` and the run's `work-discover.md`, `work-look.md` or `work-do.md` (`src/cli/harnesses.mjs:52,71`), with hobkin's directions and memory |
  | Durable hobkins | `durable.md` and `canvas.md` (`src/cli/hobkins.mjs:48-50`) |

- hobkin's directions are `AGENTS.md` in hobkin's home, first copied from `agents-default.md` (`src/cli/directions.mjs:8-17`). Settings calls them "hobkin's directions", so they are never taken for Pi's AGENTS.md. `context:folder` never adds them a second time when a run works in hobkin's home.
- Always nothing of Pi's, and not choosable: hobkin's helpers (`owned_agent`) and its fixed runs: reflection, the humanizer, migration repair, session patterns and compatibility checks. Today a read or write helper still reads AGENTS.md, since only the theme helper gets `--no-context-files` (`src/cli/pi-extensions.mjs:82-84`). Every helper gets it now. Change Review's agent already loads nothing (`host/src/review/agent.ts:117-127`).
- A run cannot reach a model that only an extension provides unless it loads that extension. Such a run fails before any prompt, as a run whose model Pi did not keep fails today (`src/cli/harnesses.mjs:191-194`).

### Where the choice is kept, and who changes it

- In hobkin's `config.json`, as `resourceSelection` version 2: for each kind, the chosen ids, at most 128. `readResourceSelection` and `setResourceSelection` already keep it there, written atomically within the file's 64 KB bound (`src/cli/config.mjs:100-113`). Only tests ever wrote version 1, and one that is found reads as nothing chosen.
- Only the window changes it, on the user's click, through `resources.apply`, marked `outside` like the Integrations and Claude Code changes (`shared/commands/registry.ts:34-35`). hobkin may read it with `resources.read`. Its `client` tool refuses the change (`host/src/client-tool.ts:40`).
- Turning an id on checks it against the catalog and the kinds it is offered to. Turning one off always works, also for one that is gone.
- A chosen resource that is no longer installed stays chosen. The run starts without it, and the run's facts say it was missing. Settings marks it "No longer installed" with Remove. If it comes back under the same id, it loads again.
- A chosen extension that fails to load does not stop the run. Its error shows in the facts and in Settings. Today a missing or failing choice keeps the main chat from opening (`src/cli/resource-policy.mjs:47`, `src/cli/pi-extensions.mjs:53-55`). Now the chat opens without it. A required tool of hobkin's that is missing still refuses, as now.
- A change reaches Background, Work and durable hobkins at their next run or turn. The main chat takes it when its session next opens, after a restart or with a new conversation. Settings says so until then.

### How each run is held to it

- The main chat on its own child, which a live home uses (`host/src/owner.ts:429`): Pi's loader with every discovery off, as now (`src/cli/pi-extensions.mjs:63-71`), plus the chosen paths. Today nothing passes candidates, so nothing can be chosen (`src/cli/pi-session.mjs:73`). The runtime now builds them from the catalog. The chosen extensions' tools join the chat's tool list (`src/cli/pi-session.mjs:341`), and the check that refuses any other tool stays (`src/cli/pi-session.mjs:357-359`). A chosen skill also shows as `/skill:<name>` in the chat's slash list, which reads the chat's loader (`host/src/slash.ts:62`).
- The main chat behind a launcher: today it starts with all of Pi's defaults, since its arguments name no `--no-` flag (`src/cli/rpc-session.mjs:395-403`). It gets the same flags as the runs below.
- Background, Work and durable runs on Pi: today a run with tools names every extension Pi would load, and leaves skills and context files to Pi (`src/cli/harnesses.mjs:67`, `78-81`). Now each run gets `--no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --no-approve`, then `-e builtin:codemode -e builtin:tool-search`, `--extension` for each chosen extension path, `--skill` for each chosen skill path, and `--append-system-prompt <file>` for each chosen context file. These are Pi's own flags (`docs/cli.md` in Pi 1.5.0). One runtime wrapper adds them. It takes the place of `namingExtensions` in hobkin (`src/cli/application.mjs:210`) and in the host's harness for a live home (`host/src/claude-code/agents.ts:23-26`), with a launcher or without.
- A launcher that manages its own extensions refuses `--no-extensions` (`src/cli/harnesses.mjs:61-62`). Under one, skills and context files still follow the choice, the extensions are the launcher's, and Settings says so.
- Runs on Claude Code do not change. They load none of Pi's resources, and the user's own Claude Code setup loads, as `033-claude-code-agents` decided. Settings says so for each kind the Claude Code tile sends there.
- This decides what loads. It is not a sandbox: a chosen extension runs its own code with the run's rights (`work-in-progress.md:388`, "not OS containment").

### What loaded, and what was used

- Chosen, loaded and used stay separate facts, as already decided (`work-in-progress.md:388`).
- Loaded is seen from inside Pi. hobkin adds one small extension of its own to every Pi run it starts. At each turn's `before_agent_start` it sends one status record under its own key, the way hobkin's bridge reports its tools (`src/cli/rpc-session.mjs:297-299`). The record holds the tools with the file each came from (`pi.getAllTools()` and its `sourceInfo`), the skills, and the context files Pi found by itself (`systemPromptOptions`). A chosen context file counts as loaded when it was readable as the run began.
- Anything loaded that was not chosen and is not hobkin's or Pi's own is marked "loaded without being chosen", with the reason when hobkin knows it, such as a launcher that manages extensions.
- A use is a call of a chosen extension's tool, whether the model made it or a code mode script did (Pi gives nested calls their own `tool_execution_*` events), and a `read` of a chosen skill's SKILL.md. Context files and hobkin's own instructions are part of every turn they load in, so they have no uses.
- hobkin appends what loaded and what was used, by kind and run, to `resources/use.jsonl` in its home, kept to the last 30 days. For the main chat it writes a line when the session opens and after each turn that used something. Use stays on this Mac. It is no telemetry event and is never uploaded (`work-in-progress.md:463`, "no telemetry57 expansion").

### In Settings

- A "What agents load" tile, beside Integrations: for each kind, how many resources are chosen, and that hobkin's own instructions load. One line says each kind starts with nothing of Pi's until something is chosen. Choose opens the list.
- The list is a lightbox, as Models opens the tiers lightbox. Its sections, in order: hobkin's own, by kind, always on; context files; packages; extensions; skills; built-ins. Each row has the name, one line, where it comes from (a package also names what it holds), and a switch for each kind it is offered to. A kind it is not offered to says why. A field at the top finds rows by name.
- Under each row: where it loaded last ("Loaded in the chat's last turn", "Loaded in the last Work run") and the tools it brought; "Used 4 times in 30 days, last on Tuesday", or "Not used in 30 days"; "No longer installed" with Remove. Pi's own warning shows beside something it left out, such as one of two skills with the same name.
- Each kind's column says what is true of it now: "Takes effect when the chat next starts" after a change to the main chat, "On Claude Code: your Claude setup loads instead", or "Your launcher loads its own extensions".
- A switch saves at once. Nothing asks "are you sure". One line says a chosen extension runs its own code in every run of that kind.
- With a host connected the list shows only what the host read. Sample data shows only in a window with no host, and says so.
- Everything works from the keyboard, by the rule of `019-keyboard`.

### Commands

- `resources.read` returns the catalog, the selection, hobkin's own instructions for each kind, the last loaded facts of each kind, the uses of each resource by kind over 30 days, whether a launcher manages extensions, and which kinds run on Claude Code. hobkin may run it.
- `resources.apply { kind, on?, off? }` turns ids on or off for one kind and returns the same state. It is the window's alone (`outside`).

## Out of scope

- Choosing one extension or skill out of a package.
- A folder's own `.pi` resources and settings, and choices for one project, routine or Work item.
- MCP in the main chat. It has none today, and its loader refuses an MCP choice (`src/cli/pi-extensions.mjs:33`). Which MCP servers are on stays with `023-integrations`, and so does signing in to them from the app (the ledger's tasks 41 to 43).
- Choices for helpers and for hobkin's fixed runs.
- Pi's `SYSTEM.md` in Pi's folder, which would replace Pi's base prompt in runs that keep it. Pi has no flag to leave it out without replacing the prompt, and this Pi folder has none. `APPEND_SYSTEM.md` is already left out, since every run passes an append of its own (Pi's `dist/core/resource-loader.js:494-498`).
- Pi's own settings, such as compaction and retry. They are not resources.
- Passing Pi's resources to Claude Code runs.
- Installing, updating or removing Pi packages from the app. `pi install` stays in the terminal.
- Editing or turning off hobkin's own instructions from Settings.
- Loaded and used facts on the agent canvas or in a run's report.

## Acceptance

- A1. With nothing chosen, the main chat, a routine, a delegated job, each Work run and a durable hobkin's turn start with no extension, skill, prompt template, theme, MCP server or context file of Pi's. Each still has hobkin's own instructions and tools, and Pi's built-in tools, code mode and tool search.
- A2. hobkin's helpers and its fixed runs (reflection, the humanizer, migration repair, session patterns, compatibility checks) load nothing of Pi's, AGENTS.md included, whatever is chosen for any kind.
- A3. The catalog lists each package, extension and skill Pi has on at user level, the two built-ins, Pi's AGENTS.md and the folder's own context files, each with its id, name, one line and where it comes from, and for a package what it holds. Building it installs nothing and runs no extension. pi-emote is not offered, and the three packages left out of the main chat are offered only to the other kinds.
- A4. Nothing in a folder's `.pi` (settings, extensions, skills, MCP servers) is listed or loaded in any run, and every run passes `--no-approve`. A selection or a run request that holds a path instead of a catalog id is refused.
- A5. A package chosen for one kind loads its extensions and skills in that kind's next run, and in no other kind's. An extension or skill of its own does the same.
- A6. Pi's AGENTS.md chosen for a kind reaches that kind's runs and no other. The folder's own files chosen for Work reach a Work run from the folder it works in and the folders above it, and hobkin's directions never come in twice.
- A7. The main chat takes the selection when its session opens, on its own child and behind a launcher alike. A chosen package's tools are active in it, and no tool of anything unchosen is.
- A8. A chosen resource that is no longer installed, or that fails to load, leaves the run and the main chat starting without it. The facts say which and why. Settings shows "No longer installed" with Remove, which takes it out of the selection.
- A9. Under a launcher that manages its own extensions, skills and context files still follow the selection, and the state says the extensions are the launcher's.
- A10. Every Pi run reports, from inside Pi, the tools it loaded with the file each came from, its skills, and the context files Pi found by itself. Anything loaded that was not chosen, and is not hobkin's or Pi's own, is marked as loaded without being chosen.
- A11. A call of a chosen extension's tool, by the model or by a code mode script, and a read of a chosen skill's SKILL.md count as a use for that kind. Uses are kept in hobkin's home for 30 days, and no telemetry event carries them.
- A12. Runs on Claude Code get none of Pi's resources and start as they did before, and the state names the kinds that run there.
- A13. `resources.read` returns the catalog, the selection, hobkin's own instructions by kind, and the loaded and used facts, and hobkin's `client` tool can run it. `resources.apply` changes the selection from the window, and the `client` tool refuses it. The selection holds after the host restarts. A host started in development builds the catalog from its own Pi folder and never reads `~/.pi/agent`.
- A14. Settings has a "What agents load" tile with each kind's count of chosen resources. Its list shows each resource with a switch for each kind it is offered to, why it is not offered to the others, what it loaded and when it was last used. A switch changes the selection at once, and the next run of that kind follows it. Every switch works from the keyboard. With a host connected, nothing on it is sample data.
- A15. Settings lists hobkin's own instructions for each kind by name, marked always on, with no switch. After a change to the main chat it says the change takes effect when the chat next starts.

## Proof

- A1. `hobkin/test/cli-resource-runs.test.mjs` › "with nothing chosen a routine, a delegated job, each Work run and a durable turn start with nothing of Pi's"; `hobkin/test/cli-sdk-resources.test.mjs` › "with nothing chosen the main chat loads nothing of Pi's and keeps hobkin's prompts, hooks and tools"; `host/test/resources.test.ts` › "a live home's Pi runs take the runtime's resource flags"
- A2. `hobkin/test/cli-pi-extensions.test.mjs` › "a helper of any role reads no context file"; `hobkin/test/cli-resource-runs.test.mjs` › "hobkin's fixed runs load nothing of Pi's whatever is chosen"
- A3. `hobkin/test/cli-resource-catalog.test.mjs` › "the catalog lists what Pi has on at user level and installs nothing" and › "pi-emote is never offered, and the three the main chat leaves out are offered to the other kinds only"
- A4. `hobkin/test/cli-resource-catalog.test.mjs` › "nothing in a folder's .pi is listed"; `hobkin/test/cli-resource-runs.test.mjs` › "a folder's .pi loads in no run, and every run passes --no-approve"; `hobkin/test/cli-resource-policy.test.mjs` › "a selection or run request holding a path instead of an id is refused"
- A5. `hobkin/test/cli-resource-runs.test.mjs` › "a package chosen for Work loads its extensions and skills in Work runs and in no other kind"; check: in the live runs (S7), choose pi-agentic-search for Work, and see `agentic_search` in a Work run's tools and not in a routine's.
- A6. `hobkin/test/cli-resource-runs.test.mjs` › "context files reach a run only when chosen for its kind, and hobkin's directions never twice"
- A7. `hobkin/test/cli-sdk-resources.test.mjs` › "a chosen package's tools are active in the main chat and no other tool is"; `hobkin/test/cli-rpc-session.test.mjs` › "a main chat behind a launcher starts blank and takes the selection"
- A8. `hobkin/test/cli-sdk-resources.test.mjs` › "a chosen resource that is gone or fails to load leaves the chat opening without it"; `hobkin/test/cli-resource-runs.test.mjs` › "a run starts without a chosen resource that is gone and its facts say so"; `ui/test/resources-rules.test.ts` › "a resource no longer installed shows as such and Remove takes it out"
- A9. `hobkin/test/cli-resource-runs.test.mjs` › "under a launcher that manages extensions, skills and context files still follow the selection"
- A10. `hobkin/test/cli-resource-facts.test.mjs` › "a run reports from inside Pi its tools with their files, its skills and the context files Pi found" and › "what loaded without being chosen is marked so"
- A11. `hobkin/test/cli-resource-facts.test.mjs` › "a chosen tool's call, from the model or a code mode script, and a read of a chosen skill count as uses" and › "uses stay in the home for 30 days and no telemetry event carries them"; check: after the live runs (S7), Settings shows the Work run's use of pi-agentic-search.
- A12. `host/test/resources.test.ts` › "a run sent to Claude Code gets none of Pi's resources, and the state names the kinds that go there"
- A13. `host/test/resources.test.ts` › "the window changes the selection, hobkin reads it and cannot change it, and it holds across a restart" and › "a host in development builds the catalog from its own Pi folder"
- A14. `ui/test/resources-rules.test.ts` › "each kind's switch follows the state, and each row says what loaded and when it was used"; check: Settings with a host on a test home and a test Pi folder, as a still render (server markup with the app's built CSS, no browser), dark and light: the tile, and the list with chosen, loaded, used, not offered and missing rows. Then walk the list with the keyboard.
- A15. `hobkin/test/cli-resource-catalog.test.mjs` › "hobkin's own instructions are named for each kind from the files its runs read"; `ui/test/resources-rules.test.ts` › "hobkin's own instructions have no switch, and a change to the main chat waits for its next start"

Note, 2026-11-13. S1 and S2 are built as runtime modules that no run loads yet (`resource-catalog.mjs`, `resource-facts-extension.mjs`, `resource-use.mjs`, and version 2 functions added beside version 1 in `resource-policy.mjs` and `config.mjs`). Their tests pass against Pi 1.5.0 as installed, with temporary Pi folders and fakes of Pi's extension surface.

- A3: proven by both catalog tests.
- A4: in part. "nothing in a folder's .pi is listed" passes. The policy test is "a selection holding a path instead of an id is refused": a run request has no ids to refuse until S4 builds one, and `--no-approve` in every run waits for S4.
- A6: in part. The catalog's `context:folder` leaves out Pi's AGENTS.md and hobkin's directions (`cli-resource-catalog.test.mjs` › "the folder's own context files leave out Pi's own and hobkin's directions"). Reaching a run waits for S4.
- A10: both facts tests pass, and a one-off check with Pi's own `loadExtensions` loaded the extension with its one `before_agent_start` handler and no error. No run loads it until S3 and S4.
- A11: both tests pass. The live check waits for S7, and nothing writes the record until S3 and S4.
- A13: in part. The selection holds in `config.json` across a reload (`cli-resource-policy.test.mjs` › "the selection is kept in config.json as version 2 and holds across a restart"), and the catalog refuses to build without a Pi folder named. The commands and the host wait for S5.
- A15: in part. The runtime test passes, for the main chat through its own prompt list as `openPiSession` hands it to Pi. The Settings half waits for S6.

Until S3 moves the main chat to version 2, a version 2 selection in `config.json` keeps the main chat from opening (`resolveResourcePolicy` refuses any version but 1), so nothing may write one before S3 lands.

## Steps

S1 and S2 can be built at once. S3 and S4 come after both, and can be built at once: they share no file. S5 comes after S1, S2 and S4. S6 can start on sample data at once, and connects once S5's `shared/protocol/resources.ts` is in.

- [ ] S1 (A3, A4, A13, A15). Runtime: the selection and the catalog. Version 2 of the selection, ids by kind, kept in `config.json`; the catalog from Pi's own resolution, user scope only, with hobkin's exclusions and hobkin's own instructions by kind; one pure function that turns a kind's chosen items into Pi's flags, for S3 and S4 to share. Files: `hobkin/src/cli/resource-policy.mjs`, `hobkin/src/cli/config.mjs`, new `hobkin/src/cli/resource-catalog.mjs`; tests `hobkin/test/cli-resource-policy.test.mjs` and new `hobkin/test/cli-resource-catalog.test.mjs`.
- [ ] S2 (A10, A11). Runtime: what loaded and what was used, as modules ready to wire in. hobkin's facts extension and its status record; the use log, its 30 days, and reading it back. Files: new `hobkin/src/cli/resource-facts-extension.mjs`, new `hobkin/src/cli/resource-use.mjs`; tests new `hobkin/test/cli-resource-facts.test.mjs`.
- [ ] S3 (A1, A2, A7, A8, A10, A11). Runtime: the main chat, on its child and behind a launcher, and the helpers. The catalog's candidates in the child's bootstrap; the chosen tools in the chat's tool list; a missing or failing choice reported, not refused; the launcher main's flags; the facts extension in both; the main chat's uses logged; `--no-context-files` for every helper. Files: `hobkin/src/cli/pi-extensions.mjs`, `hobkin/src/cli/pi-session.mjs`, `hobkin/src/cli/main-session-child.mjs`, `hobkin/src/cli/rpc-session.mjs`, `hobkin/src/cli/runtime.mjs`; tests `hobkin/test/cli-sdk-resources.test.mjs`, `hobkin/test/cli-rpc-session.test.mjs`, `hobkin/test/cli-pi-extensions.test.mjs`. It retires the refusals the new rule replaces: in `cli-sdk-resources.test.mjs` › "unsupported or stale resource selections refuse before SDK loading", and the failed-loader half of › "failed loader diagnostics and missing required tools refuse session readiness" (missing required tools still refuse). Once S4 no longer uses `extensionPaths`, S3 removes it from `pi-extensions.mjs` with its tests (`test/cli-pi-extensions.test.mjs:27`, `:52`).
- [ ] S4 (A1, A2, A4, A5, A6, A8, A9, A10, A11). Runtime: Background, Work and durable runs. The wrapper that replaces `namingExtensions`: a kind from the run's purpose, the catalog built again, the flags from S1, the facts extension, the uses logged from the run's events; `--no-approve` in place of `--approve`; hobkin's fixed runs left with nothing. Files: `hobkin/src/cli/harnesses.mjs`, new `hobkin/src/cli/run-resources.mjs`, `hobkin/src/cli/application.mjs`; tests `hobkin/test/cli-harnesses.test.mjs` and new `hobkin/test/cli-resource-runs.test.mjs`. It retires the main chat's leave-out case in `cli-harnesses.test.mjs` (› "the main chat leaves out the packages that would stop its compaction, keep a second memory or speak as the user, and other runs keep them"), which the catalog test in S1 takes over.
- [ ] S5 (A1, A12, A13). Host: the protocol, the two commands, and the live home's Pi harness. `resources.read` (hobkin may run it) and `resources.apply` (`outside`), the Pi folder by `piAgentDirFor`, the kinds the Claude Code settings send to Claude Code, and the runtime's wrapper in place of `namingExtensions` in the host's harness. Files: new `shared/protocol/resources.ts`, `shared/commands/registry.ts`, new `host/src/resources.ts`, `host/src/host.ts`, `host/src/claude-code/agents.ts`, `host/src/hobkin-claude.d.ts`, `host/src/hobkin.d.ts`; tests new `host/test/resources.test.ts`.
- [ ] S6 (A8, A14, A15). Settings: the tile and the list, on sample data with no host and on the host's state with one. Files: new `ui/src/features/resources/` (`ResourcesLightbox.tsx`, `store.ts`, `rules.ts`, `sample.ts`), new `ui/src/features/settings/ResourcesTile.tsx`, one line in `ui/src/features/settings/SettingsScreen.tsx` for the tile and one in `ui/src/app/Frame.tsx` for the lightbox, where the tiers lightbox is mounted; tests new `ui/test/resources-rules.test.ts`.
- [ ] S7 (A5, A7, A11). One live main chat and one live Work run on the real Pi folder, with the user's go-ahead, since they spend the subscription and use the real home: nothing chosen first, then pi-agentic-search for Work.

## Open questions

- When this ships, every background kind loses at once what it loads today: every extension, skill and AGENTS.md Pi has, and its MCP servers. That includes pi-extended-teams, whose agents Work's harness waits for (`src/cli/harnesses.mjs:27-34`), the web search packages, and the MCP tools a routine may call. (a) Blank at once, as asked: a routine or Work run that relied on one does less, or fails, until the user turns it on. (b) Fill Background, Work and Durable once with what they load today, so nothing changes until the user turns things off: the user did not choose that, and the request is that defaults never come back by themselves. (c) Blank, plus one Action Item that lists what each kind loaded before and opens the list: a little more work, and the user decides with the list in hand.
- A Work run in a project does not read the project's own AGENTS.md or CLAUDE.md unless the folder's own files are on for Work. (a) Off until chosen, like everything else: Work agents may miss how the project tests, builds and commits. (b) On for Work from the start: the files come from the folder the user picked for the work, but it is a default the user did not set.
- The main chat takes a change at its next start. (a) Keep that: a change made now does nothing until a restart or a new conversation. (b) Reload the chat in place through Pi's `reload`, which the main child already guards (`src/cli/main-session-child.mjs:201-209`): the change lands mid-conversation, and the prompt cache is missed once.
- Claude Code runs keep the user's own Claude setup (`033-claude-code-agents`), so starting blank holds for Pi runs only. (a) Keep it: it costs nothing. (b) Start them blank too: it needs Claude Code's own ways to leave out CLAUDE.md, skills, MCP servers and hooks, none of them checked against the installed `claude` here, and the runs lose the setup the user tuned for their own terminal.
- A tier whose model only an extension provides fails in every kind that does not load that extension. (a) Keep it: the run fails before any prompt, and the user turns the extension on for that kind. (b) Load the extension that provides a run's model by itself, marked "loaded for the model": the run works, but code the user did not choose runs in it.

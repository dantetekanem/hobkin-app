---
{
  "id": "064-integration-drops",
  "title": "An integration is a folder the core never imports",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "023-integrations", "024-github"],
  "updated": "2026-11-24"
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

## Proof

- A1. check: a `git archive` copy with `integrations/github/` deleted: typecheck, `vite build`, the host and window tests, a scripted host started on a scratch home.
- A2. `integrations/github/test/*` (the 024 tests, moved).
- A3. `host/test/integration-host.test.ts`, `ui/test/integration-parts.test.ts`, on a test integration.
- A4. `host/test/integration-host.test.ts`.
- A5. `ui/test/integration-pages.test.ts`.
- A6. `host/test/integrations.test.ts`, `ui/test/integrations-*.test.ts`; check: the screen in light and dark.
- A7. check: a fresh agent builds a small integration in a scratch copy from the README alone.
- A8. `scripts/package` rules test.

## Steps

- [ ] S1. Contract: the manifest, the host part, the window part, the parts registry, GitHub's manifest (lead).
- [ ] S2. Host core: loading, commands, slices, hooks, pulls, `#host/*`, packaging (lane H1).
- [ ] S3. GitHub's host part (lane H2).
- [ ] S4. Window core: loading, pages in the shell, the menu setting, remembered page state; GitHub's page and card into the folder (lane W1).
- [ ] S5. Home, spotlight, Work and the trail through the parts (lane W2).
- [ ] S6. The catalog gone (lane C).
- [ ] S7. The switch: the host and window run GitHub from the folder only, the old files gone (lead with H1 and W1).
- [ ] S8. `integrations/README.md`, A1 and A7 (lead).

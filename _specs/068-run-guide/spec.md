---
{
  "id": "068-run-guide",
  "title": "A run guide for every code project",
  "kind": "work",
  "status": "doing",
  "depends": ["011-work", "059-new-project", "066-work-one-list"],
  "updated": "2026-11-24"
}
---
# A run guide for every code project

## Outcome

Every code project in Work can have a run guide: the steps to run it end to end on the user's Mac so they can try a change. It says what is needed, how to set it up once, how to make its database, how to start it, where to open it, how to bring in a change, and how to stop it. hobkin keeps it in its own home, never in the project's folder. An agent writes it from the project's own docs and scripts, follows it in a worktree of its own to prove it, and records when it last ran and how far it got. The project page shows it, and every finished change has a Try it that opens it with that change as the first step.

The user, 2026-11-24: "we need to add to hobkin a guide (in the system) so new projects or existent projects in work mode will have a step by step on how to run (end-to-end) for users to test changes. get db setup, last run, what is needed, etc. this is hobkin only and will not be in the code, but will use any guides the code need, and also the last time it run. so is easier to start something".

The user's three choices the same day: the agent proves the guide in its own worktree and records the run; an existing project gets a guide only when the user presses for one; it shows on the project page and as Try it on each finished change.

## Decisions

### What was there before

- A project's study writes `work/<slug>/project.md` for agents, with "Set up a tree" and "Test" headings (`src/prompts/work-look.md`). It is rewritten by each study and its commands are for a disposable tree, not for the user.
- A finished change carries `proof`, how it was shown to work, which is about tests and the deploy. Nothing tells the user how to run the app locally, and no run starts the app for the user.

### Where it is kept

- `work/<slug>/run-guide.md` in hobkin's home holds the guide in Markdown. The agent writes it as it writes `project.md`.
- `work/<slug>/run-guide.jsonl` is an append-only log. A `written` line records when the guide was written, the project's commit then and the project files it was written from. A `ran` line records one run: when, by what (`guide`, `study` or `item` with the item's id), whether it worked, the last step that worked when it did not, and a one-line note.
- Nothing about the guide is written to the project's folder or its repository.

### Who writes it

- A code project's study writes the guide along with `project.md`. A project added with New project gets its guide that way.
- A project that has been studied gets a guide only on the user's press: Write the run guide on its page, or Check it again when it has one. The press files a `guide` look at the front of the project's queue. It runs when work mode and the workload let it, like any look.
- The `guide` look reads the project's own docs and scripts again, rewrites the guide, follows it, and records the run.
- A goal has no run guide. hobkin refuses one in its own words.

### How it is proven

- The press is the user's yes for that look to install what the guide needs and start its services inside its own worktree. It uses services of its own: its own database names, its own ports, its own env file made from the project's example. It never touches the user's checkout, databases, ports or `.env` files, and it stops everything it started before it ends.
- It worked when the app answered where the guide says to open it, for example a request to the address returning a page. Tests passing is not a run.
- When a step fails, the look writes how far it got, marks the steps after it as not tried, and records the run as not worked. The guide is still kept.
- A change's run that starts the app to show its change records a run of the guide too, with its item. It does not rewrite the guide. When it found a step wrong it says so in its note.

### What the guide says

- It is written for the user, in their own checkout, with the project's own names, ports and addresses, not the ones the agent used.
- Its headings: What you need (tools and versions, accounts, env names to fill in), Set up once, Database (create, migrate, seed, and any login the seeds make), Run it (each command, which ones need their own terminal, and the address to open), Try a change, Stop.
- Each step names where it came from in the project, such as `README.md` › Setup or `bin/setup`, and says where the project's own docs are wrong or miss a step.
- It names env variables and where to get them, and never copies a secret's value.
- It keeps under 8 KB.

### In the window

- The project page of a code project has a Run guide section: one line for the last run ("Last run 3 days ago: it worked", "Last run Nov 20: stopped at Database", "Not run yet"), one line naming its sources, the guide itself drawn with the report renderer, and one button, Write the run guide or Check it again. While a guide look waits or runs, the button's place says Queued or Writing. Nothing moves when these change.
- Each finished change has Try it in its ⋯ menu. It opens a sheet: the change's title, a first step that brings the change into the user's checkout (`git fetch` and `git switch <branch>`, or `gh pr checkout <number>` for a pull request), then the guide and its last run. With no guide the sheet says so and offers Write the run guide.
- A goal's page has no Run guide section and its changes have no Try it.
- With no host both work on sample data.

## Contract

The lanes build on these names. Changing one is the lead's call.

Runtime, `hobkin/src/cli/work/run-guide.mjs`:

- `readRunGuide(root, slug)` returns the `RunGuide` shape below. It only reads.
- `requestRunGuide(root, slug)` files the `guide` look (`guide:<slug>` at the front of the queue) and returns `{ message }` in hobkin's words. It throws an `Error` whose message is hobkin's refusal for an unknown project, a project not taken, or a goal.
- `hobkin work guide <slug>` takes JSON on stdin and records a run: `{ "worked": true, "reached": null, "note": "...", "sources": ["README.md"] }`. A run from a change adds `"item": "<id>"`. With `sources`, it also records the guide as written when `run-guide.md` changed since the last `written` line. Looks and runs get it as `work.commands.guide` and the file as `work.runGuideFile`.

Protocol, `shared/protocol/work.ts`: `RunGuideRun`, `RunGuide`, `RunGuideAsked`.

Commands, `shared/commands/registry.ts`, both `runs: 'host'` and `hobkin: true`:

- `work.guide.read { slug }` answers `RunGuide`.
- `work.guide.write { slug }` answers `RunGuideAsked`.
- A hobkin without the functions answers `unavailable`: "This hobkin cannot keep run guides yet. Update hobkin."

## Out of scope

- A button that runs the guide in a terminal for the user.
- Telling the user that the project's docs changed since the guide was written. The `written` line keeps the commit so this can come later.
- A guide for a goal.
- Editing the guide by hand in the window.
- A key of its own for Try it.

## Acceptance

- A1. `readRunGuide` gives the text, when it was written, the commit, the sources, the last run and whether a guide look waits or runs. A project with none gives no text and no run. A goal gives hobkin's refusal.
- A2. `requestRunGuide` files one `guide` look at the front of the project's queue, a second press files no second one, and an unknown project, a project not taken and a goal are refused in hobkin's words with nothing filed.
- A3. `hobkin work guide <slug>` records a run with what it was given, refuses a wrong field in plain words, and records the guide as written only when the file changed.
- A4. A code project's study and the `guide` look are given `runGuideFile` and the `guide` command. Their prompts ask for the guide's headings, the proof in the look's own worktree with its own services, the run recorded, and no secret values. A goal's study is given neither.
- A5. A change's run is given the `guide` command and its prompt asks it to record a run when it started the app, without rewriting the guide.
- A6. `work.guide.read` and `work.guide.write` pass hobkin's answer and refusal on, and answer `unavailable` for a hobkin without the functions.
- A7. The project page's Run guide section: the last-run line for each case, the sources line, the button for none, one, queued and writing, and no section on a goal.
- A8. Try it: the first step for a branch and for a pull request, the guide after it, the sheet with no guide, and no Try it on a goal's change.
- A9. No control moves when the last-run line, the button or the sheet's content changes.

## Proof

(Filled in as each step is checked.)

## Steps

- [x] S1. The spec and the protocol types (lead). 1525231, 6fd67fd.
- [x] S2 (A1 to A5). Runtime, in `~/Poetry/hobkin`: hobkin 0c98d45, b2780b8, 3e95898; 5983603 (the queued line names no terminal command). `test/cli-work-run-guide.test.mjs` 13 of 13 on an export of main. `reached` is the last step that worked; `commit` is the default branch's tip.
- [x] S3 (A6). Host commands. 1c0739a, 924a39c; `host/test/work-guide.test.ts` 6 of 6.
- [x] S4 (A7 to A9). Window: the section and Try it. 36e5386, 8feca13, e266386; `ui/test/run-guide*.test.ts` 17 of 17; eleven stills, not seen in the app's window.
- [ ] S5. The host against hobkin main's own functions: checked 2026-11-24 on a throwaway home (read gives the shape, the press queues one guide look, the next read says queued, an unknown project is refused in hobkin's words). Left: the guide on one real project once the user restarts the host and a guide look has run.

## Open questions

- Whether Check it again should also run on its own when the project's docs or setup scripts change.
- Whether the user wants to mark their own runs from the window later.

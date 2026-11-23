---
{
  "id": "050-tla-proofs",
  "title": "TLA+ proofs in work mode and YOLO mode",
  "kind": "work",
  "status": "doing",
  "depends": ["011-work", "032-change-review", "049-yolo-mode"],
  "updated": "2026-11-20"
}
---
# TLA+ proofs in work mode and YOLO mode

## Outcome

When an agent in work mode touches a state machine, explicit or hidden in the code, it writes a TLA+ model of it in the project, and hobkin checks that model with TLC, and proves it with TLAPS when a proof is written. The user watches the check live, and reads the result three ways: as math, in plain words, and as a state graph they can walk node by node, stepping through any counterexample with each variable's change marked. hobkin runs the tools itself and keeps the result, so a check is evidence the agent cannot write for itself. That evidence feeds the review's proof score, and in YOLO mode a model that breaks at a change's head stops that change from merging by itself.

## Decisions

### The user's words

- "I want Hobkin and (Work + YOLO) to support TLA+ natively, i mean the proof run, in the greatest UI/UX ever we have, and during the process. This will be massive preparing and designing systems, and also having a way to see the math proof and a visual proof (node navigation) as where possible. plan and design this now"
- On the first screens of the design: "yes that is good".
- On where models live, 2026-11-20: "I prefer `_specs` and not `specs` so is at the top of a folder ... for everything".
- On a finished change to a state machine that has no model yet, 2026-11-20: "we need to update the proof so it can move along. the score stays".
- On a review that said "not checked at this commit" of its change's own model, 2026-11-23: "one should never be ignored".

### The design

The screens are on the canvas https://claude.ai/artifact/CD5U7JA1zyonJsYYnyDTrk, and this spec follows them:

1. **Proof run, live**: the steps (Parse, Model check, Proof), four counters, new states over time, what must stay true, which actions ran, what hobkin is doing, and where each action lives in the code.
2. **Visual proof**: the state graph in three views (the counterexample, the states around it, and every state grouped by one variable), with a step bar and the selected state's variables.
3. **The math**: the spec typeset, in three modes (Math, In words, Side by side), with the TLAPS proof tree and a box that says what each result shows and what it does not.
4. **Where it shows up**: the finished card, the agent's steps, the review's five scores and the YOLO page.

Every view keeps its controls still when the content changes: fixed heights, clamped text and facts pinned in place.

### The tools

- **TLC and SANY** come from `tla2tools.jar` (MIT). hobkin pins v1.7.4, the last stable release (2024-08-05). v1.8.0 is a prerelease from 2026-11-19, so hobkin moves to it only once it is stable. TLC needs Java 11 or newer. Sources: https://github.com/tlaplus/tlaplus/releases and https://docs.tlapl.us/using:tlc:start
- **TLAPS** (`tlapm`, BSD-2) is optional. 1.6.0-pre ships an arm64 macOS tarball (https://github.com/tlaplus/tlapm/releases). hobkin always runs it with `--strict`, because without it `tlapm` can report every obligation proved while proofs are missing (https://groups.google.com/g/tlaplus/c/ynn-HTUSOW4/m/_bY2kSvBAgAJ). Check the licenses of its backends (Z3, Zenon, Isabelle, LS4) before hobkin downloads them.
- The tools come with hobkin. The first-run setup runs `hobkin proof setup` by default (A16), and the same button on the YOLO page runs it again. It installs everything into hobkin's home, needs no admin password and no Homebrew, and keeps each download only when its pinned checksum matches. On a Mac with no Java 11 or newer, that is a pinned Temurin Java 21 runtime in `<home>/tools/java`; then the pinned jar goes in `<home>/tools/tla/`, checked by its sha1 and sha256. Off a Mac without Java, it says so in one line and changes nothing. `hobkin/src/cli/setup.mjs` gains an optional `tlc` row.

### How a check runs

- Agents never call `java` directly. They run `hobkin proof check <spec.tla> [--cfg <file>]`:
  1. SANY parses the spec. A parse error reports its file, line and column, and TLC never starts.
  2. TLC runs with `-tool -workers <n> -coverage 1`, breadth first, so a counterexample is the shortest one. TLC 1.7.4 has no `-dumpTrace`, so hobkin writes `trace.json` itself from the trace states TLC prints (2217). Its trace steps name the action without arguments (`Fix`, not `Fix(i1)`). It reports progress (2200) once a minute, so a short run shows only its final counts.
  3. hobkin reads TLC's framed messages (`@!@!@STARTMSG <code>:<class> @!@!@`). The codes it reads (from https://github.com/tlaplus/tlaplus/blob/master/tlatools/org.lamport.tlatools/src/tlc2/output/EC.java):
     - progress 2200
     - final stats 2199
     - finished 2186
     - success 2193
     - invariant violated 2107 and 2110 (2146 is an invariant that is not a state predicate: the run ends in error)
     - temporal property violated 2116
     - deadlock 2114
     - trace 2121, with states 2216 to 2218
     - coverage 2201, 2202 and 2221, and 2772 on

     The text of 2200 is parsed from a real run captured as a fixture, not from the docs.
  4. Each event goes to `<home>/proofs/<run>/events.jsonl`, and the run ends with a `result.json`.
- A model lives in the project at `_specs/tla/<area>/<Machine>.tla` with its `.cfg` beside it, the area named for the part of the product the machine belongs to, so a project's models sort by topic instead of piling up in one folder. It is committed on the item's branch like code, so the review reads it and it moves with the code. A spec says which files it models in a comment, `\* models: src/cli/work/items.mjs, src/cli/work/yolo-pass.mjs`. Each action names its code in a comment, `\* code: src/cli/work/yolo-pass.mjs:165`. Each definition carries its plain-words gloss in a comment, `\* words: ...`.
- The run record holds:
  - who and where: `id`, `project`, `item`, `head`
  - the spec: `spec` with its sha256, and `cfg` with its sha256
  - the tool: `tool` with its version, and `workers`
  - when: `started` and `finished`
  - the result: `outcome` (holds, broken, error or stopped)
  - the stats: generated, distinct, queue and depth
  - each invariant's status and each action's count
  - the file paths of the trace and the graph
- Only the `hobkin proof` process writes a run record. `hobkin work item` cannot write or change one. An agent cites a run by its id, and the run counts for an item only when its `head` and spec hash match the item's.
- A run where an action never fired is still reported as it ended. It does not count as evidence that the model holds, because a model that never reaches an action checks nothing that action guards.
- Limits:
  - One TLC run at a time on the machine, using half the cores.
  - A heap cap, set with `-Xmx`.
  - 20 minutes unless the user sets another limit.
  - Stopping it ends the Java process within 2 seconds.

### Live progress

- There is no generic channel for a job with live progress, so the host adds a `proofs` slice to `StateMessage`. It carries each running run with its latest stats, pushed when they change, at most twice a second.
- The full events, trace and graph come from the `proof.get` command, and `proof.stop` stops a run.
- When an agent runs `hobkin proof check`, its step in the agent's activity draws as the proof widget from screen 4, not as raw tool text.
- TLC cannot know how long a check will take, so no view shows a time left. The views show how fast new states still come in.

### The state graph

- When a run found at most 50,000 distinct states, hobkin runs TLC a second time with `-dump dot,actionlabels,colorize` for the graph. A bigger model gets no dump, and its views say so.
- The graph uses the libraries the review graph already uses: `@dagrejs/dagre` for layout and `@xyflow/react` for drawing.
- **The counterexample** shows the shortest path, with the other moves from the same states faded.
- **Around it** shows the states within 2 steps of the path, at most 200, and says how many of how many it shows.
- **By a variable** groups every state by one variable the user picks. That draws the machine the code has without saying so, with each action's count on its arrow.
- Search filters the dumped states by `variable = value`. Evaluating any TLA+ expression is a later step: see the open questions.

### The math

- The spec is shown in Unicode TLA+ (≜ ∧ ∨ ⇒ ∀ ∃ □ ′ ⟨⟩), set in JetBrains Mono, using the symbol table of `tlauc` (MIT, https://github.com/tlaplus-community/tlauc). No KaTeX: no TLA+ to KaTeX tool exists, and the monospace layout keeps TLA+'s aligned conjunctions readable. A glyph JetBrains Mono lacks falls back to a math font.
- In words shows each definition's `\* words:` gloss. Side by side shows both.
- When a proof ran, the TLAPS tree shows each step with its status (proved, failed, omitted or missing), its backend and its time. A failed step shows its goal and what is known. A step counts as proved only when `tlapm --strict` exits 0.
- Every math view carries the box that says what each result shows:
  - a model check covers the small world it was given
  - a proof covers every size
  - both are about the model, not the code

### Work, the review and YOLO

- The finished card shows proof chips: the model holds, the model broke, or the proof is proved or fails. Each opens the run.
- The review's `proof` score: when a run at the item's head covers the changed files, hobkin writes that score's evidence line from the run, and marks it "hobkin ran this itself". A covering model that broke caps the proof score at 3.
- The client's change review (spec 032) is given the same runs as evidence, like a test that ran: the model, the result, the states and the rules. A model the change adds or edits is rated by its check, and a file a model names keeps the level its own rules give it, with the model's result in its reasons, since a model is not a test of those lines. The review panel lists each model with its result and states, each row opening its run, and `T` opens the first.
- YOLO: a covering model that breaks at the change's head is a floor, so the change never merges by itself. This works like a safety score under 8, in `brokenFloors` (`hobkin/src/cli/work/classified.mjs`) and `whyItAsks` (`hobkin/src/cli/work/yolo-pass.mjs`). When a change touches a modeled file and the spec did not change, hobkin reruns the model itself at the new head. That rerun is a hobkin job, not an agent run.
- Readiness gains a `models` part. It is ready when each spec on main holds. A machine with no model yet does not hold the project back, because a change to it gets its model first (A19). The part says not applicable only when a state-machines look ran with Java and TLC found and found no machine. Before a look like that, it is not ready (A17).
- The state-machines look writes the spec for each machine it finds, files the `machine:<name>` item with the spec's path, and hobkin rechecks every spec on main weekly. A model that breaks on main shows in Home's Problems.
- The look also pipes every machine it found, with the files it lives in, to `hobkin work machines <project>`. hobkin keeps that list in its own work state, `<home>/work/<project>/machines.json`, with the time and whether Java and TLC were found when it came in. It never reads the prose under "State machines" in the project file.
- A project whose state machines were never looked for with the tools in place has its look due now (A18). hobkin knows this from the time it starts a look with the pinned jar in its home. The jar goes in only after setup found Java or installed it, so the planner does not have to wait for Java to answer.
- A finished change that touches a machine's file when no spec at its head names that file goes back to its own branch for the model (A19). That happens once for each review, and only when nothing else would stop it merging by itself. The run writes `_specs/tla/<Machine>.tla` and its cfg and commits only those, so the review's scores stand: a review of any commit whose code the head still has, because every later commit changed only `_specs/tla/`, counts as a review of the head (A20).
- No model of a finished change is left unchecked (A23). After each survey hobkin checks, itself, each model a finished change adds, edits or touches a file of that no run speaks for at the change's head, with YOLO mode on or off. Until 2026-11-23 it did so only in YOLO mode, for a change heading to a merge by itself whose spec was untouched, and otherwise relied on the check the agent runs at the end of its own run. It is still one check at a time, and a check that was tried is not tried again for a week, so a model that cannot run costs one try. The run names the change's item, so the card and the review find it.
- The window keeps a run for as long as its change waits (A24). The `proofs` slice held the 20 newest runs that ended, so the review of a change whose check was older than those said "not checked at this commit" of a model that was checked. The slice now also holds the newest run of each model of each change that still waits, at any age.
- A model with no run at the reviewed head is work still owed. Its row in the panel and its line on a node say so in the warning tone, where they were a quiet line.

## Out of scope

- Apalache and Quint. Their ITF traces can come later.
- Checking real runs of the code against the model (trace validation, https://arxiv.org/abs/2404.16075). Until then, the `\* code:` mapping and the review's judgment are all that tie the model to the code, and the math view says so.
- Embedding Spectacle (https://github.com/will62794/spectacle) for exploring a model in the browser. It is a spike first.
- TLC across several machines, and a bundled Java runtime.
- A proof for every spec. TLAPS runs only when the agent writes a proof or the user asks for one.

## Acceptance

- A1. `hobkin proof setup` downloads the pinned `tla2tools.jar` into `<home>/tools/tla/` only when the user asks, and checks its sha256. Without Java it says so in one line and changes nothing.
- A2. `hobkin proof check` parses with SANY first. A parse error reports its file, line and column, and TLC never starts.
- A3. A TLC run writes its events to `events.jsonl` and to the `proofs` slice at most twice a second, and ends with an outcome of holds, broken, error or stopped, and its final stats.
- A4. A broken invariant, temporal property or deadlock leaves a trace of states with their action names in `trace.json`, the shortest one TLC found.
- A5. A run where an action never fired says which action, and cannot count as evidence that the model holds.
- A6. Only the `hobkin proof` process writes a run record. `hobkin work item` cannot write or change one, and a run counts for an item only when its head and spec hash match.
- A7. Stopping a run ends its Java process within 2 seconds and records the outcome as stopped.
- A8. The run view matches screen 1 and updates live. Its result area and buttons stay still as the run moves from checking to broken or holds.
- A9. The graph view matches screen 2. Its step bar shows each state's variables, with the changed ones marked and the ones that break the invariant shown in red. Around it states how many states it shows. By a variable groups the states by the variable the user picks.
- A10. The math view matches screen 3, in all three modes. When a proof ran, it shows the TLAPS tree with each step's status, and a failed step with its goal and what is known.
- A11. A TLAPS step counts as proved only when `tlapm --strict` exits 0.
- A12. The finished card, the agent's steps, the review's scores and the YOLO page show proof results as screen 4 does.
- A13. In YOLO mode, a covering model that breaks at a change's head stops it merging by itself. The review's proof evidence comes from the run, and a covering model that broke caps the proof score at 3.
- A14. The state-machines look writes a spec for each machine it finds, hobkin rechecks every spec on main weekly, and a model that breaks on main shows in Home's Problems.
- A15. Every new field on the wire is optional, so an older host or window still works.
- A16. The first-run setup sets up the TLA+ tools by default on a live host, as `hobkin proof setup` does, in the background while the story goes on. Its quiet line says hobkin's one line, a failure never holds the setup up, and Set up TLA+ tools on the YOLO page tries again. The tools are TLC and, on an Apple-silicon Mac, TLAPS for proofs. A scripted host sets up nothing, and hobkin's `client` tool cannot ask for it.
- A17. Readiness's `models` part says not applicable only when a state-machines look ran with Java and TLC found and recorded no machine. Until a look like that has recorded its machines, the part is not ready and says in one line that the project's state machines have not been looked for with TLC yet.
- A18. A chosen project whose state machines were never looked for with the TLA+ tools in place has its state-machines look due now, not a week after its last look. Run readiness on the YOLO page puts that look ahead of the project's readiness work when the look is due. Work mode's agent limit paces the looks on the other projects.
- A19. A finished change that touches a file of a machine the look recorded, where no spec at its head names that file in `\* models:`, does not merge by itself. hobkin sends it back to its own item and branch, once for each review, to write and commit that machine's model under `_specs/tla/`, and checks the model itself at the new head when the run did not.
- A20. A change's review scores still count after commits that change only `_specs/tla/`, so YOLO mode never calls them scores for an older commit and asks for no new review. A model that holds there lets the change merge by itself at its new head. One that breaks keeps it asking, with a proof score of 3 at most. The finished card's proof score line names the model and opens its run.
- A21. A change review is given hobkin's TLC run at the reviewed head of each model the change adds, edits or touches a file of, and never says no checker result is shown when one is. A model that holds lowers no break found in the code it models, and the review says so.
- A22. The review panel lists each of the change's models with its result and states, each opening its run on the proof screen, and `T` opens the first.
- A23. hobkin checks, itself, each model of a finished change that no run speaks for at the change's head, with YOLO mode on or off and whether or not the change edited the spec. One check runs at a time, and one that was tried in the last week is not started again.
- A24. The review's row and a node's line for a model say what its newest run at the reviewed head said, however many runs ended since, for as long as the change waits. A model with no run there reads as a warning.

## Proof

- A1. `hobkin/test/cli-proof.test.mjs`, against SANY and TLC output recorded in `hobkin/test/fixtures/tlc/`, so the tests need no Java.
- A2. `hobkin/test/cli-proof.test.mjs`, with a recorded parse error.
- A3. `hobkin/test/cli-proof.test.mjs` for the events and the outcome; `host/test/proofs.test.ts` for the slice and its rate.
- A4. `hobkin/test/cli-proof.test.mjs`, with recorded violations of each kind. One test runs real TLC, only when `HOBKIN_TLC=1` is set.
- A5. `hobkin/test/cli-proof.test.mjs`, with recorded coverage where one action never fired.
- A6. `hobkin/test/cli-proof-record.test.mjs`.
- A7. `hobkin/test/cli-proof.test.mjs`, with a stub process that ignores its first signal.
- A8. `ui/test/proof-run.test.ts` for the view model; check: a still render in light and dark, compared with screen 1.
- A9. `ui/test/proof-graph.test.ts` for the views and the step bar; check: a still render compared with screen 2.
- A10. `ui/test/proof-math.test.ts` for the tokens and the tree; check: a still render compared with screen 3.
- A11. `hobkin/test/cli-proof-tlaps.test.mjs`, with recorded `tlapm --toolbox` output.
- A12. `host/test/proofs.test.ts` for the fields; check: a still render of each surface compared with screen 4.
- A13. `hobkin/test/cli-work-yolo.test.mjs` and `hobkin/test/cli-work-classified.test.mjs`.
- A14. `hobkin/test/cli-work-look.test.mjs`; check: a look at the live home with the user's go-ahead.
- A15. `host/test/proofs.test.ts`, with a host that sends none of the new fields.
- A16. `host/test/setup-proof.test.ts` › "a failed setup is an answer with its one line, never an error, so the setup goes on"
- A17. `hobkin/test/cli-work-machines.test.mjs` › "the models part is not ready until a look with TLC recorded the machines, and not applicable only when it found none"
- A18. `hobkin/test/cli-work-machines.test.mjs` › "a project never looked at for its state machines with TLC has that look due now, and Run readiness puts it first"
- A19. `hobkin/test/cli-work-machines.test.mjs` › "a finished change to a machine no model covers goes back to its branch for the model, once a review"
- A20. `hobkin/test/cli-work-machines.test.mjs` › "a model written after the review keeps the scores, and the change merges by itself once the model holds"
- A21. `packages/change-review/test/pipeline.test.ts`, `packages/change-review/test/floor.test.ts`, `packages/change-review/test/answer.test.ts` and `host/test/review-model-checks.test.ts`, as spec 032's A35 lists them.
- A22. `ui/test/review-model-checks.test.ts` and `ui/test/review-panel.test.ts`, as spec 032's A36 lists them; check: a still render of the panel's rows.

## Steps

- [x] S1 (A1, A2). Runtime: the pinned toolchain, `hobkin proof setup`, the Java check and the setup row. Record real SANY and TLC output for a small spec as fixtures. Files: new `hobkin/src/cli/proof/setup.mjs`, `hobkin/src/cli/setup.mjs`.
- [x] S2 (A3, A4, A5, A7). Runtime: `hobkin proof check`. It covers the runner, the parser for TLC's framed messages, the events, the run record, the trace, coverage, the limits and stop. Files: new `hobkin/src/cli/proof/{check,tool-messages,record}.mjs`, `hobkin/src/cli/commands.mjs`.
- [x] S3 (A6, A13). Runtime: who writes a run, how a run is matched to an item, the proof score's evidence and cap, the YOLO floor and the rerun on a modeled file. Files: `hobkin/src/cli/work/{classified,yolo-pass,commands,yolo}.mjs`.
- [x] S4 (A3, A15). Host and protocol: the `proofs` slice, and the `proof.get` and `proof.stop` commands. Files: new `host/src/proofs.ts`, new `shared/protocol/proofs.ts`, `shared/protocol/messages.ts`, `host/src/state-sync.ts`, `shared/commands/registry.ts`, `host/src/host.ts`.
- [x] S5 (A8, A12). Window: the run view as a page of its own, opened from the item and the agent, and the proof widget in the agent's steps. Files: new `ui/src/features/proofs/`, `ui/src/app/screens.ts`, `ui/src/app/Canvas.tsx`, `ui/src/features/agent-activity/`.
- [x] S6 (A9). Window: the state graph. It reads the dot dump, lays it out with dagre and draws it with xyflow, in the three views with the step bar. Files: `ui/src/features/proofs/graph/`.
- [x] S7 (A10, A11). Runtime and window: TLAPS through `tlapm --toolbox` with `--strict`, the proof tree, the Unicode typesetting and the three modes. Files: new `hobkin/src/cli/proof/tlaps.mjs`, `ui/src/features/proofs/math/`.
- [x] S8 (A12, A14). The surfaces: the finished card, the review's scores, the YOLO page's `models` part, Home's Problems, and the state-machines look writing specs, with the weekly recheck. Files: `ui/src/features/work/{Finished,YoloScreen}.tsx`, `ui/src/features/home/model.ts`, `hobkin/src/prompts/work-look.md`, `hobkin/src/cli/work/plan.mjs`.
- [x] S9 (A5, A14). Prompts: when and how an agent models a machine, and the rules on what a result shows. A model is small enough to finish. Every action has to fire. The `\* code:` and `\* words:` comments are required. Files: `hobkin/src/prompts/work-do.md`, `hobkin/src/prompts/work-look.md`.

- [ ] S10 (A1, A2, A3, A4, A7, A11). What the recorded fixtures cannot show. The fixtures come from TLC 1.7.4 and tlapm 1.6.0-pre source, not real runs. With the user's yes to install Java and the pinned jar: run `HOBKIN_TLC=1 node --test test/cli-proof.test.mjs` in hobkin, check one real model end to end in the live window (live counts, stop, the graph, the math), and fill `TLA2TOOLS.sha256` in `hobkin/src/cli/proof/tools.mjs` from the verified download. Done 2026-11-20: Java and TLC installed in the user's home, the real TLC test passes, and the sha256 is pinned (hobkin b5748be). Left: one real model in the live window.
- [x] S11 (A16). Host and window: the first-run setup sets up the TLA+ tools by default, on the user's word of 2026-11-20 ("this should come with hobkin by default, while installing in setup"). `setup.install-proof-tools` runs hobkin's `setupProof` through `loadProofRuntime`, only on a live host, and the window asks for it once as the setup opens. Files: new `host/src/setup-proof.ts`, `shared/commands/registry.ts`, `host/src/host.ts`, `host/src/main.ts`, new `ui/src/features/onboarding/use-proof-tools.ts`, `ui/src/features/onboarding/Storyteller.tsx`; tests new `host/test/setup-proof.test.ts`, whose other tests cover the home, one run at a time and the live host. The quiet line is not seen in the window yet: open the setup on a scratch home with a live host.
- [x] S12 (A17). Runtime: `hobkin work machines <project>` keeps the look's machines in `machines.json` with whether Java and TLC were found, and readiness's `models` part reads it. The look's prompt pipes the list. Files: new `hobkin/src/cli/work/machines.mjs`, `hobkin/src/cli/work/{yolo,commands,director}.mjs`, `hobkin/src/prompts/work-look.md`. Done in hobkin bf6a4d5.
- [x] S13 (A18). Runtime: the look is due now on a project never looked at with the tools in place, a look started with them says so in the project's state, and Run readiness puts a due look first. Files: `hobkin/src/cli/work/{plan,yolo,director}.mjs`. Done in hobkin baec6b2.
- [x] S14 (A19, A20). Runtime: the survey records which files each covering spec names and the commits whose code the head still has, the YOLO pass sends a change back for its model, a review stands across model-only commits, and the proof score's evidence names its model. The do prompt says how a run writes a model it was sent back for. Files: `hobkin/src/cli/work/{yolo-pass,proofs,unmerged,reads,closing,classified,director,store,plan}.mjs`, `hobkin/src/prompts/work-do.md`. Done in hobkin 1b38ad4. Not seen live yet: a real look piping its machines, and a real run writing a model it was sent back for.
- [x] S15 (A21, A22). The change review weighs the runs, and its panel lists each model with a way to its run. Spec 032's S15. Not seen live yet.
- [ ] S16 (A23). Runtime: after each survey hobkin starts the check of each finished change's model that no run speaks for at its head, YOLO mode on or off. Files: `hobkin/src/cli/work/{proof-checks,director,yolo-pass}.mjs`.
- [ ] S17 (A24). Host and window: the `proofs` slice keeps the newest run of each model of each change that still waits, and a model with no run reads as a warning. Files: `host/src/proofs.ts`, `ui/src/features/review/story/node-models.ts`.

## Open questions

- Should hobkin pin v1.7.4 now and move to v1.8.0 once it is stable, or start on the rolling build?
- Should hobkin require Java, or offer to download a JRE into `<home>/tools/`?
- How strong must a model be for YOLO? Every action firing is the floor. A probe that each invariant can fail when a guard is removed would catch an invariant that is always true, but costs a run per invariant.
- Should search accept any TLA+ expression? That needs an evaluator, from TLC's REPL in v1.8.0 or from Spectacle's JavaScript interpreter.
- How long may a TLAPS run take before it counts as stopped?

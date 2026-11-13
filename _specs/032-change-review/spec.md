---
{
  "id": "032-change-review",
  "title": "Change review: levels, units and a story for every shipped change",
  "kind": "work",
  "status": "doing",
  "depends": ["005-review-model", "006-review-graph", "007-review-story", "009-review-notes"],
  "updated": "2026-11-12"
}
---
# Change review: levels, units and a story for every shipped change

## Outcome

When hobkin ships a change, the client reviews it in the background. It sorts the diff by metadata, maps every changed definition with four facts (what it does, whether a test proves it, who runs it, what undoes it), gives each unit a level (`safe`, `mid` or `high`) from a fixed table and one model pass, and writes the story a reviewer reads top to bottom. When the user opens the change, the story is ready: the Review screen opens on it, the Work card shows the level, and while a review is still running the client says what it is doing and how far along it is. pi-auto-review no longer reviews these changes.

## Decisions

- The design is `packages/change-review/skills/change-review/FOUNDATION.md`, written with Fable on 2026-11-12. Its rules are the rules here: four questions in order, the floor table of section 5.1, what a model may change (5.2), the buckets that are never read line by line (6), the units (7), the story (8), the blind check (9) and tracking (10).
- The engine lives in `packages/change-review` and stands alone. It imports only Node's modules and its own files, never `#shared`, `@/`, `hobkin` or anything else of this app, so it can be published by itself later. The host hands it a checkout, a range and a `ModelRunner`.
- pi-agentic-search, which is public, reports the search facts in `packages/change-review/notes/agentic-search-changes.md` and ships them there. It only searches. The engine reads its scan pack and still works, with weaker facts, on a pack without them.
- Proof is the repository's own tests, run where the change is checked out, with no clone and no sandbox. For a finished hobkin change that is a review worktree per project, owned by the client, kept between reviews and never the user's own folder. A test proves a definition when it passes at head and fails once that definition's changed lines go back to base, or, for a new definition, once its body is made to fail. No coverage tooling. Missing tests are a finding; the review never writes tests to fill the gap.
- ~~Levels: a change no test proves is `high`; the Reviewer may raise freely; the blind check may raise a level one step.~~ Replaced by the user on 2026-11-12: a level is the risk that the change breaks something, the code or what runs in production, and nothing else. That code changes what it does is what a change is, and is no reason for a level. That the tool could not check something is said in words and is never `high` on its own.
- Levels: first the floor table as a pure function of the four facts. `high` is a break that is shown (a dangling reference, a test that passes with the change undone and fails with it), an effect nothing undoes, or a changed contract nothing shows working. What no test showed, tests the tool could not run, and direct tests alone are `mid`, with a finding that says so. A change of behaviour that tests show through a request is `safe`. Then one model pass by the Reviewer, on the high tier with high thinking, which raises to `high` only by naming the input and the wrong result, lowers only with named evidence (5.2), marks critical, asks questions, says what to watch after launch, and writes the story's words. Then one blind check by Quick, on the fast tier, with an empty context and no tools. A review uses these two tiers and no other. The check changes no level: what it was not convinced by becomes a question for the reviewer. There is no second model loop.
- A test command that cannot start on this machine failed no test: the unit says its tests were not run, with the command's reason. A test that fails with the change in place is run once more with the definition put back, to learn whether the change is why.
- The model pass that narrated the graph walk is dropped. The graph keeps the host's own steps.
- A review writes `triage.json`, `graph.json`, `risk-events.jsonl`, `units.json`, `story.md`, `blind-check.json`, `progress.json` and `progress.jsonl` beside the review in the home. Every time in them is read from the clock.
- ~~The Review screen opens on the story. The node graph stays one key away.~~ Replaced by the user on 2026-11-12: the story is not a page or a tab. Reviewing happens in graph navigation: each step's explanation lives in its node, the sidebar keeps one stable description of the whole change with its overall risk badge, and Enter opens a split panel with the unit's explanation (with quick links to ask hobkin) beside its code.
- Navigation frames the node in focus at a reading size, never every connection it has; only the step's path stands out. A step pager sits at the bottom center. The request's life cycle (callers up to the entry point, the callees that matter) is drawn, with code the change did not touch dimmed.
- A verdict is confirmed in place: the button turns into "Click again to confirm" and goes back after ten seconds. A change that lands closes its review with a short celebration (five seconds at most).
- A pull request from GitHub is reviewed only after "Start AI review". A review being prepared says it can be closed and will be ready in the background, shows elapsed time, what it is doing and its steps, and hobkin says in the chat when it is ready. Work has an "AI Reviews" tab with every review, running or done.
- The Review page is reworked as the user described on 2026-11-12. The canvas has barely visible dots for depth. Nodes sit closer by default, at 1.2 times today's zoom. The panel is ordered: this step, then what matters for the reviewer, then the agent they can ask (in a colour of its own, saying plainly what to type), then the rest. The header says which project changes, the title and the lines changed, and an external pull request has a button for its description.
- On the Work card the level replaces the pi-auto-review grade, and "Get it reviewed" rebuilds this review instead of starting an agent run.

## Out of scope

- Pull requests from GitHub keep today's review: there is no local checkout to run their tests in.
- The parked skills in `packages/change-review/notes/parked`.
- Publishing a package, pushing a branch, or anything sent outside this machine.

## Acceptance

- A1. Triage puts every file of a diff in exactly one bucket, with the treatment FOUNDATION section 6 gives its kind: lockfiles and generated files are counted, pure renames are listed, locales are sampled, mass deletions are checked by reference, and code is scanned.
- A2. A locale missing a key, or a removal that something remaining still refers to, makes its unit `high` and critical. A complete locale batch, or a removal nothing refers to, is `safe`.
- A3. The floor of each of the twenty-two cases in FOUNDATION section 14 is the level and rule the table there gives.
- A4. A risk event can always raise a level. It lowers one only with a named evidence kind, never to `safe` when no test showed the change, and `critical` holds only on `high`. Applying the same events twice gives the same graph.
- A5. A test that passes at head and fails when a definition's changed lines go back to base proves that definition: `lifecycle` when it enters through an entry point, `isolated` otherwise, and `-observed` when the diff added or changed it. A test that still passes is no proof. A test that fails at head is a `high` finding.
- A6. Every node is in exactly one unit, also when the scan writes one call as two edges or two definitions call each other, a unit's level is the worst of its nodes, every unit has the same fields in the same order whatever its level, and more than nine units split into parts by entry point.
- A7. The story has an opening, a setting, the units (`high`, then `mid`, then `safe`) and a conclusion, and no level in it differs from `units.json`.
- A8. The blind check runs once, is saved unedited, changes no level, and leads to at most one action per unit.
- A9. While a review runs, `progress.json` names the current step and what it is doing, with status, measured seconds, done and total for every step.
- A10. A change hobkin finishes gets its review without the user asking, and the same commit is never reviewed twice.
- ~~A11. Opening a finished change shows its story first; the graph is one key away, and the Work card shows the change's level.~~ Retired 2026-11-12: the user replaced the story page with the story inside graph navigation. See A15.
- A12. Approve and Approve and merge in the Review panel do what they say, or say why they cannot.
- A13. The Review page shows the project, the title and the lines changed, keeps the panel in the order of the Decisions, and an external pull request's description opens from a button.
- A14. `agentic-search scan --diff <range>` finishes on a checkout whose working tree differs from the scanned head.
- A15. A finished change's review opens on its graph with a sidebar header that stays the same for the whole review and carries the overall risk badge; each step's explanation sits in its node; moving the focus frames that node at a reading size and never every node it is wired to; a pager at the bottom center counts and walks the steps; unchanged code on the life cycle is dimmed; Enter shows the unit's explanation beside its code; the Work card shows the change's level.
- A16. A verdict turns into "Click again to confirm" and goes back after ten seconds; only a second click sends it, for the commit on screen; a landed change closes its review with a celebration of five seconds at most.
- A17. A pull request opened from GitHub waits for "Start AI review"; while a review is prepared its page says it can be closed, shows the time, what it is doing and its steps, and keeps updating; hobkin says in the chat when it is ready; Work's AI Reviews tab lists every review, running or done.

## Proof

- A1. `packages/change-review/test/triage.test.ts` › "every file lands in exactly one bucket with its treatment"
- A2. `packages/change-review/test/triage.test.ts` › "a missing locale key or a dangling removal breaks; complete ones pass"
- A3. `packages/change-review/test/floor.test.ts` › "the twenty-two cases of FOUNDATION section 14"
- A4. `packages/change-review/test/risk.test.ts` › "raises freely, lowers only with evidence, never to safe where no test showed the change, and replays the same"
- A5. `packages/change-review/test/proof.test.ts` › "a test that fails on revert proves the definition, one that still passes does not"
- A6. `packages/change-review/test/curate.test.ts` › "every node in one unit, worst level, same shape, parts past nine"
- A7. `packages/change-review/test/story.test.ts` › "opening, setting, units by level, conclusion, and no level changed"
- A8. `packages/change-review/test/pipeline.test.ts` › "the blind check runs once and changes no level"
- A9. `packages/change-review/test/pipeline.test.ts` › "progress names the step and measures every one"
- A10. `host/test/change-review-host.test.ts` › "a finished change is reviewed once per commit, in the background"
- A11. Retired.
- A12. `ui/test/review-verdict-actions.test.ts` › "approve and approve-and-merge reach the host's verdict"
- A13. check: open a finished change and an external pull request in the dev window. Compare the header and the panel order with the Decisions.
- A14. check: in a checkout with uncommitted edits, `agentic-search scan --diff HEAD~1..HEAD --json` exits 0.
- A15. check: restart the app, open a finished change from its Work card: the header and its badge stay put while stepping, the step text sits in the node, a node with many wires stays framed close, the pager walks the steps, Enter shows the explanation beside the code, and the card shows the level.
- A16. `ui/test/review-verdict-actions.test.ts` (the in-place confirm, its ten-second return and the head it sends), then check: approve and merge a change in the dev home and watch the review close with the celebration.
- A17. `ui/test/review-load-pull.test.ts` and `ui/test/work-ai-reviews.test.ts`, then check: open a pull request from the GitHub page, start its review, close the window, and open it from hobkin's chat message.

## Steps

- [x] S1 (A1, A2). The package, its contract, and triage.
- [x] S2 (A3, A4). Facts from search, the floor table, and risk events.
- [x] S3 (A5). Git, the scan, and proof by running tests.
- [x] S4 (A6, A7). Units and the story.
- [x] S5 (A8, A9). The pipeline: the model pass and its prompt, the blind check, progress.
- [x] S6 (A10). The host: the review worktree, the model runner, the background run, the artifacts.
- [ ] S7 (A11, A12, A13). The Review screen on the story, the page rework, the card's level, and the verdict buttons.
- [x] S8 (A14). pi-agentic-search: the scan fix and the search facts, on a branch there.
- [ ] S9 (A15, A16, A17). The user's second round: the Review page reworked for navigation, verdicts in place, the background flow and the AI Reviews tab.

## Open questions

- In this repository most proof comes out `isolated` (tests call functions directly), so most units floor at `mid` by rule 6 and say what the direct tests leave unshown. A project could name its own life-cycle test paths and runbook in a config file at its root; that is not built yet.
- A repository gets one test command. A Rails app's JavaScript tests are not run, and a unit they cover says its tests were not run here. A second command per kind of test file is not built yet.

- A big monorepo's tests can be slow to boot. The budget in `reference/budget.md` assumes one to three minutes per test file. If proof runs long, it could run only for nodes whose floor is not already decided without it.

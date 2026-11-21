# Notes for spec 053

Findings from five read-only audits on 2026-11-21, the outside work the design borrows from, and sketches of each page. Paths are from the root of hobkin-client unless they start with `hobkin/`, which is the runtime at `~/Poetry/hobkin`. Line numbers were right on 2026-11-21 and move.

## What the pages show today

- Work (`ui/src/features/work/WorkScreen.tsx:144-200`): a header with counts, the YOLO button, "Open world" (only with 3 or more projects, `:51`), the mode switch and the `forecast` and `held` lines; two tabs, Work and AI Reviews (`tab.ts:7-10`); then At work, Queue, Finished changes and Projects.
- YOLO (`YoloScreen.tsx:88-117`): the switchboard, then one card for each project with readiness, Next to merge, Merged by itself by day, readiness parts and models.
- World (`WorldMap.tsx:462-596`): the globe, one island for each chosen project, a hover card for each island. Clicking an island goes to Work's project row (`store.ts:54-87`).
- There is no page for one project. `SCREENS` has no project id (`ui/src/app/screens.ts:4-29`). Project facts are spread over Work's project row (`Queue.tsx:334-401`), the YOLO card, the World hover card and Home's tile.
- Computed nowhere: approval rate, auto-merge rate, the share of risky reviews, merges over time.
- In the store and not shown on these pages: `tokensToday` and `dailyTokens` (`shared/protocol/work.ts`), `project.merged`, `YoloMerge.at`, `held` and `rate`, the AI review summary's `needsYou`, `worthALook`, `safe`, and `snapshot.telemetry`.
- Charts: no chart library. Home-made ones are Home's week bars (`ui/src/features/home/Sections.tsx:212-257`), the proof run's SVG line (`ui/src/features/proofs/run/run-view.ts:138-200`) and scaleX bars (`ui/src/features/work/parts.tsx:131-140`). Tokens `--chart-1` to `--chart-5` exist (`ui/src/styles/tokens.css:217-221`).

## Navigation today

- `useView` (`ui/src/app/view-store.ts:209-377`) keeps three single return slots: `reviewReturn` (`:239-242, 268-276`), `agentReturn` (`:301-310`), `proofReturn` (`:347-357`). World and YOLO keep none and always leave to Work (`ui/src/app/keys.ts:171`).
- `location.ts` keeps a 50-step back and forward trail in session storage (`:39-41, 146, 152-165`), walked with Command+Left and Command+Right. A saved place leaves out Work's tab, its scroll position and the focused item (`:15-35`).
- The `Crumb` component (`ui/src/app/ScreenMenu.tsx:462-486`) is used only for Settings, Review and GitHub (`:601-645`). World and YOLO show a static "Work / …" eyebrow that is not a link. The agent page has no back control; only Escape leaves it.
- Clicks that leave no way back except the menu: YOLO's Report, "Answer item", "Open Work"; an island; Home's project tiles and queue rows; AI Reviews' "Open GitHub".
- Coming back from a proof builds a new review session that starts at step 1 (`ui/src/features/review/ReviewScreen.tsx:227`, `story/story.ts:101`).

## Affordances today

- No rule gives buttons a pointer cursor (`ui/src/styles/globals.css`; Tailwind v4 dropped it). A global `:focus-visible` outline exists (`globals.css:200-203`).
- No hover, or a false one: the finished change card (no click, only Enter, `Finished.tsx:387-396`), `ProjectItem` (`Queue.tsx:342`), `QueueItem` and `MergingItem` (hover colour, no click), the map's node (`DelegationMap.tsx:449-457`), YOLO rows, island buttons (`WorldMap.tsx:272`), Home's Problems row (`Sections.tsx:193`), proof chips (3% brightness, `ProofChips.tsx:59`), the review's whole-graph and put-back buttons (`Chrome.tsx:18-24`), "Back to step" (`StoryLayer.tsx:373-381`), `.rv-matter` rows (`review.css:881-895`), wires (no hover feedback, `Graph.tsx:70-108`), "+N more" (looks like a chip, is not clickable, `NodeCard.tsx:302-311`).
- Primitives that already do it well: `Button` (`ui/src/components/ui/button.tsx`), the AI Reviews row (`AiReviews.tsx:183`), `PageTabs`, `Segmented` and `LINK_CHIP` (`parts.tsx`), `Crumb`.

## What limits work today

"Next 8h" is `FORECAST_HOURS = 8`, a look ahead for the header line and not a stop (`hobkin/src/cli/work/forecast.mjs:10, 191-212`). What stops or slows starts:

1. The daily token budget, 100M by default (`hobkin/src/cli/work/store.mjs:41`), resets at local midnight. At the cap the runtime asks to double today's limit (`director.mjs:471-489`); the window has no command to answer.
2. An hourly share of a twelfth of the day's budget (`budget.mjs:7, 89`).
3. Usage-limit failures back off from 30 minutes to 6 hours (`usage.mjs:15-16, 142-148`).
4. Agents at once. With no subscription reading the plan used 1 (`plan.mjs:598`); the reading comes only from Codex headers (`usage-extension.mjs:45-56`). Another session changed this area on 2026-11-21 (client 4f2bc10, e47e347): read the code as it is now.
5. Auto-pick is off unless `hobkin work auto on` was run (`store.mjs:227-236`); the window's switch does not pass it (`application.mjs:1181`).
6. Ship first: with 8 or more finished branches waiting, new work is held (`ship.mjs:4, 14-18`; `plan.mjs:575, 587`). The override is terminal-only and lasts a day (`pairs.mjs:186-197`).
7. Smaller ones: one P3 start a week (`budget.mjs:16-18`), the start gap, a retry backoff of 10 minutes times attempts, one run per project at a time.

The user can set agents (`work.agents`) and daily tokens (`work.tokens`; the Settings slider allows only 10M to 200M, `ui/src/features/settings/rules.ts:11`). Everything is kept in `<home>/work/mode.json`. Enforcement lives in `planOf` (`plan.mjs:562-617`) and `hardStop` (`:521-534`); the forecast repeats the rules (`forecast.mjs:80-89, 126-160, 195-204`).

## Why an AI review does not start

- Finished changes are prepared in the background on every publish: `reviews.watch(toPrepare(...))` (`host/src/host.ts:231-237`; `host/src/review/reviews.ts`, `watch`). Pull requests start only on "Start AI review" (`host/src/review/seat.ts`, `toPrepare`).
- A review cut short by a quit or crash has `progress.json` and no `summary.json`, reads as failed (`host/src/review/assessment.ts:484`), and `watch` only starts an idle one. It is never tried again until the branch moves.
- Each version is looked at once for each host process, and a failure is not tried again.
- At most 3 preparations wait at once; the rest wait for a later publish.
- Rows that never ran are hidden (`ui/src/features/work/ai-reviews.ts:51-58`).
- hobkin's own scored review, which YOLO needs, is off unless `reviewOnFinish` is on or YOLO is on and the project is ready (`hobkin/src/cli/work/yolo.mjs:208`, `commands.mjs:394-402`). The window cannot turn it on.
- Spec 045 S13 and S14 are open: the runtime does not read Change Review's answers.

## Records the numbers can be folded from

- `work/<slug>/items.jsonl`: each item's states, `mergedAt`, `landed{sha, at, route}`, `review`, `closedByUser` (`hobkin/src/cli/work/store.mjs:140-145, 594-604`). Merge routes: key, chat, offer, batch, group, refresh, pair, yolo, remote.
- `runtime/events/YYYY-MM.jsonl`, kept 6 months (`hobkin/src/cli/events.mjs:6, 21-33`): `run_started`, `run_finished{status, ms, usd, tokens}`, `done_merged`, `done_declined`, `done_sent_back`, `decision_filed`, `decision_answered`, `work_paused`, `work_resumed`. `eventRollup` already folds by day (`events.mjs:168-212`).
- `work/tokens.jsonl` (no item id), `work/yolo.jsonl`, `decisions.jsonl`, `proofs/<id>/result.json`.
- `client/reviews/<id>/`: each head's `summary.json{level, deploy, why, at}` and `progress.json{started_at, updated_at}` (`host/src/review/store.ts:103-188`, `assessment.ts:656-657`).
- Missing: a stop from the window writes no record (`director.mjs:161-165`); a verdict in the review is not recorded as a verdict.

## The review at 200 files today

- Detail covers the first 60 files or 4,000 changed lines; every other file is one bare file node (`shared/review/capture.ts:109-118`, `shared/review/types.ts:319-320`).
- Nothing is culled. React Flow has no `onlyRenderVisibleElements` (`ui/src/features/review/graph/Graph.tsx:70-108`); the proofs canvas sets it. A card is 30 to 40 elements with about 12 store selectors (`NodeCard.tsx:25-58, 94-247`); a wire is its own `<svg>` with about 13 selectors (`Wire.tsx:24-55, 74-134`).
- On first open every node springs in and every wire draws by `pathLength` (`entrance-plan.ts:16-46`).
- Every move runs `focusLevels` twice (`state/session.ts:199`, `story/story.ts:78`) and writes the whole review memory to localStorage (`session.ts:211`, `memory.ts:198, 237-242`).
- The engine knows much more than the graph shows. For each definition: facts (effect, proof, exposure, undo), the floor rule, critical, findings, questions, sensitive names, callers, confidence. For each unit: level, story order, reading minutes, grouping, why. Triage buckets name generated files, lockfiles and locale files (`packages/change-review/src/types.ts:92-124, 266-281, 326-333, 424-476, 539-574`). Only `level` and `unit` reach a graph node (`host/src/review/assessment.ts:93-119`).
- There are no seen marks and no "N of M". A clean approval is two presses and needs no node visited (`verdict.ts:67-104`). The finder shows 8 hits. There is no list of nodes.

## Proofs today

- A run has parse, check (TLC) and prove (TLAPS) steps (`shared/protocol/proofs.ts:11-14`). No one approves a proof: its result is evidence for the change, and it holds back a YOLO merge when a covering model breaks.
- The proof is a full screen with three tabs that show one at a time: Run, State graph, Math (`ui/src/features/proofs/ProofScreen.tsx:29-33, 58, 162-172`). The TLC trace and the TLAPS tree are never on screen together. The tab resets to Run on each open (`:45`), and a tab switch loses the picked state, view, search and math step.
- From a review, T opens only the first model (`ui/src/features/review/keys.ts:86-89`). There is no next or previous model, no position, no key for the tabs, the tree, the next failing step, the search, Stop or Run again.
- The graph canvas, the math blocks and the proof steps are not on the Up and Down walk (`ui/src/app/stops.ts:19`).
- `RunView`, `GraphView` and `MathView` take props only and can be placed in another screen. `ProofScreen`'s header and panel are tied to the full page.
- Each render rebuilds the run object (`use-proof-run.ts:90`), which defeats `MathView`'s memo.
- The "Proof fails" chip opens the Run tab, not the tree. `counts`, which says whether a run is evidence, is never shown.

## Performance rules to keep (spec 052)

Nothing is redone while its inputs are the same. Host messages draw once a frame. Endless motion moves only transform and opacity of HTML boxes, never parts of an SVG. What nobody can see is not mounted or holds still. No style sheet is added for each step. Budgets are tests that count. Protocol fields a newer side adds are optional. `scripts/perf/motion.ts` fails an endless animation that breaks the rule. `popLayout` stays off lists that change on each agent step.

## Outside work the design borrows from

- A queue where a verdict moves to the next item, and a side pane for the item: https://docs.devin.ai/work-with-devin/devin-review and https://engineering.fb.com/2022/11/16/culture/meta-code-review-time-improving/
- Evidence beside the verdict: https://openai.com/index/introducing-codex/ and https://cursor.com/docs/cloud-agents
- Groups ordered for a first read, one at a time above 50 files: https://docs.cubic.dev/code-review-platform/intelligent-diff-ordering and https://docs.coderabbit.ai/pr-reviews/change-stack
- Mechanical changes kept out of the count: https://semanticdiff.com/ and https://docs.github.com/en/repositories/working-with-files/managing-files/customizing-how-changed-files-appear-on-github
- Reviewed marks that expire when the code changes: https://docs.reviewable.io/files.html
- A funnel of gates for merging without a person, judged by its revert rate: https://arxiv.org/abs/2605.30208 and https://dora.dev/guides/dora-metrics/
- Explicit caps on automated work: https://docs.renovatebot.com/configuration-options/ and https://kanban.university/kanban-guide/
- A pause that names its cause and when it ends: https://learn.chatgpt.com/docs/pricing
- Charts that open what they count: https://linear.app/docs/insights
- Health as the worst part, and unknown shown as unknown: https://dagster.io/docs/guides/observe/asset-health-status
- A graph that opens as groups and expands around the focus: https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf , https://homes.cs.washington.edu/~jheer/files/2003-InterestEstimation-CHI.pdf and https://reactflow.dev/learn/advanced-use/performance
- A list of failed and slow proof obligations, with next and previous: https://nightly.tlapl.us/doc/prover/runningTlaps.html and https://isabelle.in.tum.de/library/Doc/JEdit/JEdit.html
- Trace rows with the changed values marked: https://ar5iv.labs.arxiv.org/html/1912.10633
- Escape climbs a trail whose last place is not a link: https://manual.raycast.com/keyboard-shortcuts and https://www.nngroup.com/articles/breadcrumbs/
- One hover and focus layer for everything clickable: https://www.nngroup.com/articles/flat-ui-less-attention-cause-uncertainty/ and https://developer.apple.com/design/human-interface-guidelines/pointing-devices

## Sketches

The trail, in the frame above every page. The last place is plain text; each earlier one is a button. Escape goes one place left.

    Work  ›  YOLO mode  ›  hobkin-api  ›  Review: Error tracking  ›  Proof: FinishedChangeReview

Work, top of the page. Six tiles in one row, each a button into Numbers. A tile is a label, the figure, a sentence of context and a 30-day sparkline.

    Work   3 working · 12 queued · 5 finished                         [YOLO on · 2 of 5 ready] [World] [Work mode ●]
    ┌ Waiting for you ┐ ┌ Merged today ───┐ ┌ First pass ─────┐ ┌ By itself ──────┐ ┌ AI reviews ─────┐ ┌ Tokens today ──┐
    │ 5               │ │ 7               │ │ 82%             │ │ 41%             │ │ 2 running       │ │ 38M of 100M    │
    │ oldest 3 h      │ │ 4 by itself     │ │ of 34 decided   │ │ of 29 merged    │ │ 4 ready · 1 failed│ │ resets 00:00  │
    │ ▁▂▂▃▅▃▂▁▂▃      │ │ ▂▃▁▅▆▃▂▄▆▇      │ │ ▅▅▆▆▅▇▇▆▇▇      │ │ ▁▁▂▂▃▃▄▄▅▅      │ │ ▂▂▃▂▄▃▂▃▃▄      │ │ ▃▄▅▅▆▃▄▅▆▄     │
    └─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘ └────────────────┘
    Starting now: 3 of 3 agents busy. Next start when one finishes.                                     [Workload…]
    [ Work ] [ AI Reviews 2·4 ] [ Numbers ]

The line under the tiles always says what work mode will do next, or the one thing that holds it and until when, with the control that changes it beside it. Examples: "Held: 8 finished changes wait for you. Review them, or turn ship first off. [Turn off for today]", "Paused until 00:00: today's 100M tokens are spent. [Add 100M today]", "Auto-pick is off: only what you start runs. [Turn on]".

Workload, a sheet over Work opened by the button or W. One row for each setting, each with what it means in a line and the forecast under all of them.

    Workload
      Agents at once            [ - ] 4 [ + ]
      Pick work by itself       ( on )          off: only what you start runs
      Changes a day             [ no cap | 5 | 10 | 20 | … ]
      Tokens a day              [ 100M ]        38M spent today
      Hours                     [ always | 09:00 to 18:00 ]
      Hold new work when        [ 8 ] finished changes wait for you   ( on )
      hobkin scores finished changes by itself   ( on )
      AI review starts by itself for   [x] finished changes  [ ] my pull requests  [ ] pull requests waiting for me
      ─────────────────────────────────────────────────────────────
      With this: about 9 changes start today. Next start at 14:20.

Numbers, the third tab. Period switch 7, 30 or 90 days. Each chart has its figure, a sentence that says what it counts, and opens the list of what it counts.

    Merged by day            stacked bars: by itself, by you; a line of declined
    First pass rate          line, weekly, with the count under each point
    Waiting for you          median and p90 hours from finished to your yes or no
    Start to merge           median and p90
    AI reviews               stacked bars: safe, risky, failed; median time to answer
    Proofs                   stacked bars: holds, broken
    Tokens                   bars by day, with tokens for each merged change
    Projects                 a table: project, merged, by itself %, first pass %, waiting, sparkline; a row opens the project

A project's page. The same tiles for this project, then what waits for the user first.

    Work  ›  hobkin-api
    hobkin-api   P1 · PRs on · YOLO ready                                   [Pause] [Priority ▾] [Open on GitHub]
    tiles: Waiting for you · Merged (30 d) · First pass · By itself · AI reviews · Tokens
    Flow     Queued 6 → Working 1 → Waiting for you 2 → Merged 23 (30 d)        (each number a button)
    Waiting for you      the finished change cards of this project
    At work              its agents
    Queue                its rows
    Merged lately        date · title · by itself or by you · rate · commit
    Models               its TLA+ models and their last result
    YOLO readiness       its parts

YOLO. The switchboard, then a row of trust figures, then the gate funnel, then the projects.

    By itself 41% of merges (30 d) · Regressed after deploy 0 of 12 · Held for you 9
    Gates (30 d):  34 finished → 28 rated 8 or more → 26 models hold → 12 merged by itself · 14 waited for you
    Merged by itself by day: bars for all projects

World. An island opens the project's page. Its hover card gains the project's tiles in small and a visible "Open project" button.

The review of a large change. The graph opens on what needs the reviewer; the rest is folded.

    ┌ Outline (L) ────────────┐ ┌ Graph ────────────────────────────────────────────┐ ┌ Panel ───────────────┐
    │ filter…                 │ │  [card][card][card]      ┌ Safe · 142 files ────┐ │ │ Safe to deploy       │
    │ Needs you  2 of 7 seen  │ │  [card][card]            │ generated 61         │ │ │ Evidence             │
    │  ● total()   +40 −12    │ │  [card][card]            │ lockfiles 3          │ │ │  Tests 212 pass      │
    │  ○ charge()  +88 −3     │ │                          │ moved, renamed 44    │ │ │  Models 3 of 3 hold  │
    │ Worth a look  0 of 11   │ │                          │ tests that pass 34   │ │ │  Proof proved        │
    │ Safe  186 in 5 groups   │ │                          └──────────────────────┘ │ │ Needs you 2 of 7 seen│
    └─────────────────────────┘ └───────────────────────────────────────────────────┘ │ [Approve] [Merge] …  │
                                                                                       └──────────────────────┘

The proof beside the review. T opens and closes it; the review stays as it was underneath.

    ┌ Graph (narrower) ───────────────┐ ┌ Proof · Model 2 of 5 · FinishedChangeReview · holds ──── [ ] J K  ⤢ ✕ ┐
    │                                 │ │ Check: trace or state graph        │ Proof: math and the proof tree     │
    │                                 │ │ State 4 of 12  ◀ ▶                 │ 3 of 9 steps fail  next: F         │
    └─────────────────────────────────┘ └──────────────────────────────────────────────────────────────────────────┘

# Notes for spec 055: what the two audits of 2026-11-23 found

Two read-only audits, of the review engine and host and of the review window, made on 2026-11-23 at commit 991828c. Line numbers are of that commit. The scan packs the first audit names (`pack-prepare`, `pack-seat`) were scratch files and are not kept.

## RA1 notes: origin, tests, zones, Reviewer (evidence)

Repo: ~/Poetry/hobkin-client at 991828c. Paths relative to it unless absolute.

### 1. Origin: data path, verified line by line

#### Scan pack -> engine (packages/change-review/src/scan.ts)
- 151-154: `entry` keeps only `{kind, exact}`. The pack's `entry.routes` (verbs, path, file, line), `entry.doors`
  (command/extension/export) and `entry.exceptionsApp` are dropped. (Host vicinity-scan.ts:182-198 reads them.)
- 160: `raw.callers.filter((item) => record(item)?.test !== true)`: test call sites are thrown away, so "only tests
  call it" cannot be said later.
- 425-437: runScan passes `--callers all` but never `--tests all` (NEWER_OPTIONS at 381 lists `--tests`, unused).
  So `anchor.tests` is the tool's default by-name list (notes/agentic-search-changes.md item 8: "At most 8 tests per
  anchor") and the pack's `testDefinitions` (with `changed` flag) is never produced for the engine.

#### Engine walk
- pipeline.ts:134 ENTRY_HOPS = 4; 326-347 `entriesOf`: walks `called_by` edges inside the diff pack (default
  max-depth of the scan), adds a caller only when `isEntryPath(caller.path)`; kind kept only for the anchor itself
  (`${symbol} (${kind})`). A caller the scan marks `entry` (CallSite.entry) is NOT added here.
- 363-369 `entrySymbolsOf` (scan-named entry callers) feeds only the test search at 589, not `node.entries`.
- 537 `provable` = kind function, not removed, effect not text. 561-566: the walk (entries.ts) runs only for provable
  nodes whose anchor is not an entry and has non-entry callSites, and only when no `scan` option was handed in.
  Constants, class-body statements, load-time code, removed definitions: never walked.
- entries.ts:12-17 EntryAbove = {symbol, path, hops}; 112-114 the definitions between the change and the entry are
  discarded; no kind (isEntry is a boolean path rule, pipeline.ts:569). Limits 46-52: 6 hops, 90 s, 12 places/scan.
  Notes about cuts go to `problems` (pipeline.ts:574), not to the node.
- 578-579: only `entry.symbol` is pushed into `node.entries: string[]` (types.ts:460).
- 493-505: graph.json edges are kept only when BOTH ends are changed nodes, and only calls/called_by/enqueues.
  No edge to any unchanged caller; the `tests` relationship in GraphEdge (types.ts:491) is never emitted.
- 707-711: unchanged scan nodes go to the Reviewer as `context` {symbol, path, lines}: no role, no edge, no hops;
  model.ts:66 max 40; model.ts:231-234 dropped first when the prompt is too long.
- config.ts:46-56 path rules: controllers/, graphql|resolvers|mutations/, jobs|workers|sidekiq/,
  consumers|subscribers|webhooks/, middleware|rack/, lib/tasks|tasks/maintenance/, routes?/, handlers?/,
  (server|host)/(src/)?(commands?|handlers?|routes?)/.
- curate.ts:285-293 `whereOf`: "Reached from A, B and C" (max 3), else "Other changed code calls it. No route, job or
  command was found that leads to it." or "No route, job or command was found that leads to it." or "Takes effect
  when the file loads." It says "not found" also for nodes that were never looked up (general/removed/not-mapped).

#### Engine -> host
- host/src/review/assessment.ts:94-122 `GraphNode` (what the host reads of graph.json) has no `entries`.
  893-910 RatedNode drops every `kind === 'test'` node; shared/review/assessment.ts:176-206 RatedNode has no origin,
  no tests. 923-933 UnitPlace: no entries. So the engine's origins reach the window only as words: `unit.where`
  (fallback in ui StepBody.tsx:222-223) and the Reviewer's `words.setting` (not shown by unit-story.ts:245-261).

#### Host's own origin walk (a second, independent one)
- sources.ts:139-146 / seat.ts:279,290: `scanVicinity` runs before the change review, only on a live host.
- vicinity-scan.ts:736 first scan `--max-depth 1 --max-anchors 60 --max-nodes 120 --tests all`; 762-800 out a call
  at a time, 6 hops (shared/review/vicinity.ts:122), 120 s budget, 20 starts/scan.
- vicinity-scan.ts:334-354 callersOf: JS/TS callers the type checker did not prove are dropped (`byName`); Ruby
  name matches kept only when total <= 3; 3 callers per definition; 237 test call sites dropped.
- 630-656 chooseWays: 3 ways per changed definition; shared/review/vicinity.ts:116 VICINITY_LIMIT = 24 context nodes.
- Recognised: route (verbs+path), exceptions-app, controller, job, command (bin, shebang script), extension (Pi),
  export (package.json), load (top statement). vicinity.ts:373-389.
- vicinity.ts:459-464: the way (door -> entry -> ... -> change) is computed as nodes, then flattened to ONE string
  `lifecycle.path` (<= 200 chars, cut in the middle). The chain of node ids is not kept.
- vicinity.ts:430: only `kind === 'code'` changed nodes with an added anchor get a lifecycle.
- vicinity.ts:475-481 no-way words: "No route reaches it: the scan found nothing that calls it." /
  "... within 6 calls: the way out stops at X." / "... within the N calls the scans could follow ..." /
  "... nothing the scan could find calls X." (route for .rb/.erb..., "entry point" otherwise).
- host-tree.ts:69-73: a code host's own review tree is sparse-checked-out to the changed folders only, so callers
  and tests in other folders are not on disk for the scans or the proof (`existsSync` filters, pipeline.ts:594).
- vicinity-scan.ts header: for a hobkin change, unchanged files are read in the project's own folder (working copy),
  not at head.

#### Real run: this repository, agentic-search 1 call deep (packs in this folder: pack-prepare, pack-seat)
`agentic-search scan --anchor host/src/review/reviews.ts:867 --max-depth 1 --callers all`
  anchor Reviews.prepare  entry: none  callerCount {"total":5,"shown":5,"complete":true}
    caller copyStore            host/src/backup.ts:389              static_candidate (name only, wrong)
    caller Reviews.watchOne     host/src/review/reviews.ts:1908     exact
    caller startAiReview        ui/src/features/github/pull-reviews.ts:102 (x2)  static_candidate (a `prepare` param)
    caller AiReview             ui/src/features/github/rows.tsx:234  static_candidate
  MISSING: host/src/review/seat.ts:374  `'review.prepare': ({ id, refresh }) => reviews.prepare(id, ...)`,
  the real way in (the window's `review.prepare` command, dispatched by host/src/commands.ts runCommand).
`agentic-search scan --anchor host/src/review/seat.ts:374`
  anchor reviewHandlers (function, 371-399), entry none, one caller: startHost host/src/host.ts:211 (exact), no entry.
=> For this monorepo no origin kind exists (registry handlers, UI handlers), and "complete: true" is false.

### 2. Tests, verified
- proof.ts:131-139 TestCandidate {path, why, lifecycle, changed}; 204-248 candidateTests = scan by name (JS kept
  only if the test imports the file), changed test files naming it, convention names. pipeline.ts:577-610 adds
  life-cycle tests of up to 4 entries (MOST_ENTRIES), at most 6 life-cycle files per definition.
- `candidates` is a local of reviewChange: never saved. pipeline.ts:644-648 keeps only proof value/evidence,
  `testChangedWithIt`, and `node.runs` (own runs + baseline runs that hold any candidate). NodeProof.observedBy,
  stillPass, reachedBy, doubles (proof.ts:620-633) are dropped: the only per-test trace is the evidence sentence.
- `changed` separates "this diff added or changed it" from not (proof.ts:701-714 -> lifecycle-observed vs
  lifecycle). Nothing separates added from edited, and nothing finds removed or weakened tests except triage.ts:643-650
  (a deleted test file in a removal bucket whose convention subject remains).
- curate.ts:873 tests are in no unit; assessment.ts:896 tests are not rated; unit-story.ts header: tests never in focus.
- Host draft: draft.ts:374 only changed tests are wired by imports; 400-404 `vicinity.tests` (which hold changed
  AND unchanged tests, `--tests all`) are wired only when a test node already exists -> unchanged covering tests are
  silently dropped. 306-329 an unchanged test node is made only when a spec Proof line names it. 571 describeTests:
  changed tests only. unit-story.ts:85-110 testsTold gives status from the engine's runs to existing test nodes.
- pi-agentic-search src/sparsity-scan.ts:63-76 `TestDefinitionRecord {id, symbol, path, startLine, endLine,
  anchors:[{id, lines}], changed, setup}` emitted under `testDefinitions` with `--tests all` (970-1000). `rg
  testDefinitions` in hobkin-client: no reader.

### 3. Zones: none. Grouping that exists
triage buckets key `kind:treatment:dirOf(path)` (triage.ts:359) with `folder`; units (grouping single /
definition-with-helpers / mechanical / bucket / new-file-setup / regrouped); parts by entry only past 9 units
(curate.ts:1000, 1039-1060); NodeBucket code/test/generated/lockfile/locale/moved/format/docs (shared types.ts:67);
fileRole test/code/file (paths.ts); attention tiers; graph bands spec/tests/code/context (layout.ts).
`rg -i 'zone|layer'` over the review code: nothing.

### 4. Fixture evidence (ran: node --test --test-name-pattern ... test/pipeline.test.ts, 3 pass)
"a helper its direct tests prove ..." (pipeline.test.ts:604-643), scan mentionsScan (588-598), walk mentionsEntries
returns [{symbol:'showTopic', path:'src/handlers/topics.js', hops:2}] (601):
  graph.json n1.entries            = ['showTopic']            (renderPost, the hop between, is gone)
  n1.facts.proof.value             = 'lifecycle'
  n1.facts.proof.evidence          = 'test/helpers/posts.test.js fails when linkUserTags is put back to base;
                                      test/e2e/topics.test.js runs through linkUserTags and passes with the change
                                      (it fails when linkUserTags is made to throw): a life-cycle test this diff did not change.'
  n1.runs kinds                    = baseline, revert, revert, revert, baseline, reach
  graph.edges                      = [] (no caller is a changed node)
  units[1].where                   = 'Reached from showTopic.'
The unchanged request test test/e2e/topics.test.js, which covered linkUserTags before the change, exists only inside
that evidence sentence and the run's file list. No field says "before", none wires it to n1.
"with no request test above it" (645-655): where says nothing of why; problems hold "Entry points: The search for
entry points stopped: agentic-search is not installed."

### 5. Window samples (ui/src/features/review/sample)
review.json: nodes criterion 6, test 5 (all change 'added'), code 8, file 2, context 2; edges exercises 6, calls 6,
proves 5, uses 1, implements 8; no node has lifecycle or entry. stress-review.json: test 20 (all 'added'), context 8,
no lifecycle, no entry. pull.ts (hand-built): lifecycle {role, hops, path:'GET /posts/:id → PostsController#show →
render_body → link_user_tags'}, entry route/controller/exceptions-app, called-by wires; tests all added/modified.
No sample has an unchanged covering test.

### 6. Proposal shapes (all new fields optional)

#### Engine, packages/change-review/src/types.ts
```ts
export type OriginKind = 'route' | 'controller' | 'job' | 'task' | 'schedule' | 'listener' | 'mailer' | 'channel'
  | 'command' | 'export' | 'extension' | 'ui-handler' | 'host-command' | 'load' | 'path' | (string & {})
export interface OriginStep { symbol: string; path: string; line: number; node?: string; call_line?: number; enqueues?: boolean; guard?: string }
export interface Origin {
  kind: OriginKind; label: string; exact: boolean
  by: 'scan' | 'path' | 'door'          // the tool said so, a path rule, a configured door pattern
  route?: { verbs: string[]; path: string }
  chain: OriginStep[]                   // origin first, the part's direct caller last
  hops: number
}
export type RunsFrom =
  | { found: 'origins'; origins: Origin[]; cut?: string }            // nearest first, at most 3
  | { found: 'only-tests'; tests: number }                            // callers exist and every one is a test
  | { found: 'none'; hops: number; stopped?: 'limit' | 'time' | 'failed'; top?: string; why: string }
  | { found: 'not-looked'; why: string }                              // general, removed, read from diff, no walk
export interface NodeTest {
  path: string; symbol?: string; line?: number
  relation: 'before' | 'added' | 'edited' | 'removed'
  found: 'scan' | 'import' | 'convention' | 'entry' | 'diff'
  lifecycle: boolean
  at_head?: 'passed' | 'failed' | 'timed-out' | 'not-run'
  shows?: 'proves' | 'reaches' | 'still-passes' | 'mocks'
  why?: string
  weakened?: { assertions_removed: number; lines: number[] }   // base lines of removed assert/expect lines
}
export interface Zone { id: string; layer: string; subject: string; component?: string; label: string; told?: string }
// ReviewNode += runs_from?: RunsFrom; tests?: NodeTest[]; zone?: string
// Graph     += zones?: Zone[]; removed_tests?: { path: string; symbol: string; base_line: number; names: string[] }[]
// MapOp     += { op: 'zone'; zone: string; name: string }   (words only, no membership change)
```

#### Host and shared, shared/review/types.ts
```ts
// ReviewLifecycle += origin?: { kind: string; label: string; exact: boolean; chain: string[] /* node ids, origin first */ }
//                    none?: 'no-callers' | 'only-tests' | 'limit' | 'time' | 'not-looked'
// ReviewNode      += zone?: string      (every node: code, test, context, file)
//                    covers?: string[]  (for an unchanged test: the code node ids it covered before the change)
// Review          += zones?: { id: string; layer: string; subject: string; label: string }[]
// Test relation: reuse ReviewNode.change: unchanged = before, added, modified = edited, deleted = removed.
// Vicinity        += reach[].testCallers?: number; tests[].changed?: boolean (from pack testDefinitions)
```

### zoneOf (packages/change-review/src/zones.ts), pure: (path, kind?, symbol?) -> Zone
Rules in order, each table-tested:
1. component: `packages/<x>/`, `apps/<x>/`, `engines/<x>/`, `components/<x>/`, `gems/<x>/`, else the first folder
   when it is a known top (host, ui, shared, server, client, web, api, src-tauri), else none.
2. strip source roots: `src/`, `lib/` (not lib/tasks), `app/`, `app/javascript/`.
3. layer from the next folder: controllers->controller, models->model, jobs|workers|sidekiq->job, mailers->mailer,
   views->view, helpers->helper, services|operations|interactors|commands->service, serializers|presenters|
   decorators->presenter, policies->policy, channels->channel, graphql|resolvers|mutations->graphql,
   lib/tasks->task, db/migrate->migration, db->schema, config/routes.rb->route, config->config,
   components->component, hooks->hook, pages|routes|app router->page, stores|state->state, features/<f>->(feature f).
   Test paths (fileRole test): layer `test:<mirrored layer>` (spec/requests -> test:request, spec/models -> test:model).
4. subject: Rails: file stem minus `_controller|_job|_mailer|_helper|_serializer|_policy|_channel|_spec|_test`,
   singular (`orders_controller` -> order), with namespace folders kept as prefix (admin/order).
   features/<f>/<sub>/... -> subject f, sub-layer <sub> (ui/src/features/review/graph/NodeCard.tsx ->
   component ui, layer graph, subject review). Flat src (packages/change-review/src/proof.ts) -> layer `src`,
   subject = stem (proof). host/src/review/vicinity-scan.ts -> component host, subject review, layer review? -> use
   folder as subject when no layer word matched: subject review, layer `host`.
5. fallback: layer = first remaining folder or `root`, subject = next folder or stem.
id = `${component ?? '-'}/${layer}/${subject}`; label = `${Subject} ${layer}` ("Order model", "Review · ui/graph").

#### Tests to write first (one per behaviour)
Engine: zones.test.ts (table: 12 Rails paths, 10 paths of this repo, 5 generic, tests mirror their subject, same
input same output); scan.test.ts (pack with entry.routes/doors, a `test: true` caller, testDefinitions -> kept);
entries.test.ts (helper -> render -> controller: chain [controller, render], kind 'controller', hops 2; limit and
time stop reasons per root); pipeline.test.ts (mentions fixture: n1.runs_from.origins[0].chain symbols
['showTopic','renderPost'], n1.tests has test/e2e/topics.test.js relation before, lifecycle, shows reaches, and
test/helpers/posts.test.js relation added, shows proves; a constant node gets found 'not-looked'; a removed `test(...)`
block naming the node gives relation removed and a weakened count); curate.test.ts (where says "not looked for" vs
"none within N calls" vs "only tests call it"); model.test.ts (prompt carries runs_from/tests/zone and fit() trims them
before code); reshape.test.ts (zone op renames, refuses unknown zone, changes no unit).
Host: shared vicinity test (way chain ids on lifecycle.origin; none reason); draft test (an unchanged test from
vicinity.tests becomes a test node change 'unchanged', wired exercises, capped); assessment present test (graph.json
tests/runs_from/zones laid over: unchanged test status from runs, zone on every node, Reviewer zone name wins).

## RA2 notes: what the window does with origins, tests and grouping

All paths are under ~/Poetry/hobkin-client. V = verified (read or ran), I = inferred.

## Runs (node --input-type=module -e, no files written)

R1. Pull sample (`ui/src/features/review/sample/pull.ts`) rated the way the host rates every review
(`withAttention`, host/src/review/assessment.ts:193-217, called at :946), then arrange -> planFocus -> foldArranged:
- every context node gets tier `safe`, bucket `code` (attention.ts:167 gives context no reason, so tier safe;
  assessment.ts:182 buckets context by path). Tests that pass, `proves-change` included, are `safe` too.
- groups made: "Safe code in app/controllers" = c2 PostsController#show, c3 FeedsController#index, c7 ErrorsController#show;
  "Safe code in config" = c5 GET /posts/:id, c6 GET /feed, c8 config.exceptions_app.
- drawn wires: `calls:fold:code:config>fold:code:app/controllers`, `calls:fold:code:app/controllers>c1`. The origin
  trail on screen reads "Safe code in config -> Safe code in app/controllers -> render_body -> link_user_tags".
- focusLevels for step unit-u1: neighbors are only tests:u1, c1, c4. The onward walk (levels.ts:183-203) follows only
  unchanged nodes, and a group card is `change: 'modified'` (focus.ts:318), so the life cycle stops at render_body.
- Group cards drop `entry`, so layoutRequest finds no entered way (layout.ts:301) and lays everything out as loose.
- frameStep, area 1100x760 at x=340, card 400x420: zoom 1.2; in view u1 100%, render_body 55%,
  User.find_by_handles 71%, tests:u1 3%. No entry in view.
R2. Same sample as shipped (no attention, so nothing folds, focus.ts:190-202): routes at x=0, controllers x=420,
render_body x=840, u1 x=1260 y=140, tests:u1 x=916 y=1248 (the lane, layout.ts:320-343). Levels: c2 c3 c5 c6
neighbor, c7 c8 background (render_body has three callers, ONWARD.ways=2, levels.ts:57). Framing: same three
in view, tests card 0%. The sample therefore shows origins only because it lacks the attention every host review has.
R3. Large sample (`sample/large.ts`): 272 nodes, 163 edges; drawn 38 cards, 82 wires. One "Tests that pass" group holds
17 cards of tests; 14 `exercises` wires leave `fold:test`. Step s2 (u31) neighbors: u30, fold:code:app/models,
fold:code:lib/pricing, fold:test, fold:generated. Its two routes c1, c2 never get `attention` (large.ts:396-417; rate()
is not called on them), so they stay cards here; a host review would fold them into "Safe code in config".
R4. `node --test ui/test/review-groups.test.ts`: 10 of 10 pass.
Old samples `review.json` (23 nodes) and `stress-review.json` (80): 2 and 8 context nodes, 0 with entry, lifecycle or
attention; 6 and 56 exercises wires.

## Q1 origins
- Drawn: arrange keeps context nodes (arrange.ts:260-265); NodeCard draws an entry as a route pill (NodeCard.tsx:74-145),
  "Unchanged" tag (217-223), and changed code shows lifecycle.path as plain text `rv-way` (92, 147-151). V
- Dimmed: unchanged cards opacity .94/.84 background, wires to them muted .4 (graph.css:32-72). V
- Folded: in Focus, context folds by top folder with safe code (focus.ts:177-213, topFolder 113-115). V (R1)
- Outline: excludes unchanged context entirely (outline.ts:43). Finder includes hidden nodes (Finder.tsx:32). V
- Steps: host steps are units only; context is a step only when the Reviewer put it in a unit
  (host/src/review/unit-story.ts:187-189; pull.ts storyOf comment). V
- Levels per focus: 2 callers, 2 callees, 6 changed, onward 3 deep x 2 ways (levels.ts:55-57). V
- Placement: one column (420 graph px) per hop to the left; entries in column 0 (layout.ts:286-318). V
- Camera: frameStep frames only the focus at 0.9-1.2, card right first (camera.ts:54-73, 258-341), `others` are only
  avoided by the card (StoryLayer.tsx:143-166). Free Roam click = reveal, moves only if out of view (camera.ts:125-128). V
- Panel: StepBody "Read more" holds the way as one line of text, behind a fold (StepBody.tsx:220-235, 293-299). V
- Host knows the chain as ids (vicinity.ts:432-466 BFS `before` map) but stores only words in lifecycle.path. V

## Q2 tests
- arrange folds tests into one card per subject when 2+ cover it, by file past 4 singles (arrange.ts:108-140); covers =
  first changed node the test exercises (85-88). Card counts ran/failed/notRun/proves (16-23, 90-99). V
- Focus: a card of tests whose tests are all safe folds into "Tests that pass" (focus.ts:187, KIND_LABEL test). V (R3)
- Lane: tests sit under every way, each just left of its subject (layout.ts:246-343): far below at reading zoom. V (R2)
- TestList: list under a card, floats over the graph in ViewportPortal (TestList.tsx:15-115). V
- StepBody always lists the focus's tests by name and result, failed first, from raw review edges
  (StepBody.tsx:84, 124-169; node-tests.ts:23-40; StoryLayer.tsx:112-115). No split by before/after. V
- Model gives per test: status passed|failed|not-run|proves-change, change added|modified|unchanged|deleted, summary
  (host writes "It proves the change: it fails when X is put back", unit-story.ts:159-170). Unchanged tests exist only
  when a Proof line names one (shared/review/draft.ts:291-320); tests that covered the code before are not in the model. V
- Engine knows test runs per node by file (packages/change-review/src/types.ts:297-330, ReviewNode.runs :467). V

## Q3 grouping
- arrange: by subject, else file. focus: by bucket, safe code by first two folders, 12 groups max, overflow "More ...".
  outline: tier headings, safe groups = focus groups. levels: per focus only. V
- No region or frame is drawn anywhere; group cards are cards (GroupCard.tsx). V
- layoutRequest: way depth columns (bandDepths), connected ways (waysOf), entered ways on top, loose below, test lane at
  the bottom; openBlocks opens a group in place. Window re-lays every review (arrange.ts:267), ignoring host positions. V
- ViewportPortal renders after NodeRenderer (xyflow index.mjs:3273), so a region must be a node with low zIndex, not a
  portal. Stacking under wires: I, check in a still render.

## Q5 limits
- 60 cards / 120 wires (focus.ts:15), OPEN_ROOM 16; quiet entrance above 40 (entrance-plan.ts:19);
  onlyRenderVisibleElements above 40 (Graph.tsx:65, 123); far below zoom 0.6 set on root (ReviewScreen.tsx:59, 313-316).
- VICINITY_LIMIT 24 context nodes (vicinity.ts:116).
- Keys taken: arrows, Shift+arrows, Space, 0-9, Home, End, B, G, O, P, /, L, U, Z, Enter, W, Y, R, comma, period, S, N,
  C, D, H, A, M, X, T, Esc, Cmd+?; code panel V E F [ ] + -. J K are the proof's only while it holds the keyboard
  (keys.ts:72-82, proof-keys.ts:42-43). Free in the review: J, K, I, Q.
- Saved positions keyed by drawn id, applied after folding (memory.ts:485-494). A new layout leaves old saves wrong.

## Sketches

Step card with the trail (fixed rows, same place every move):

  Step 2 of 5 · Helpers · Posts                          HIGH
  link_user_tags links handles with dots and dashes
  From  [GET /posts/:id] > [PostsController#show] > [render_body] > link_user_tags   (+2 ways in)
  ...TLDR...
  Tests
    There before (1)     v links a tag to the user's profile     Passed
    Added or edited (4)  v links a handle with dots and dashes   Proves the change   (edited marked)
    Removed (0)          None

No origin: "From  No route reaches it within 4 calls: a script someone runs by hand" (lifecycle.path), same row.

Zones (regions behind nodes, request order left to right, tests docked under their subject):

  +- Routes (unchanged) -+  +- Controllers · Posts --+  +- Helpers · Posts --------------------+  +- Models · User -+
  | GET /posts/:id  ----+->| PostsController#show --+->| render_body ---> link_user_tags  ----+->| find_by_handles  |
  | GET /feed       ----+->| FeedsController#index -+  |                  [5 tests: 2 before]  |  +-----------------+
  +---------------------+  +------------------------+  +---------------------------------------+
                                                       +- Scripts · production errors ---------+
                                                       | fetch_errors        report            |
                                                       | [6 tests, 1 fails]  [7 tests, 1 skip] |
                                                       +---------------------------------------+

Far zoom (< 0.6): cards keep names only (exists); region headings scale up and add counts:
"Helpers · Posts  1 needs you · 5 tests".

---
{
  "id": "055-review-origins-tests-zones",
  "title": "Change review: where a change is run from, what tested it before, and zones",
  "kind": "work",
  "status": "doing",
  "depends": ["005-review-model", "006-review-graph", "032-change-review", "053-work-control-room"],
  "updated": "2026-11-23"
}
---
# Change review: where a change is run from, what tested it before, and zones

## Outcome

A reviewer who opens a change sees, for each changed part, where it is run from: the request, job, command, task or listener that starts it, and every call between that and the change. They see the tests that cover the part, told apart as there before the change, added or edited by it, or removed by it. The graph is split into named zones, a layer and a subject each, so the part of the code a change touches can be seen at a glance. The Reviewer model is given the same facts.

The user, 2026-11-23: "the review is not connecting dots, i dont see what is the origin call (a request, a job, whatever), only shows the change. tests doesnt connect, i dont see what was covering before. i need that. visibility for me and the agent understand is critical. i also want the graph to be componetized, so I can see the zone of the change. think 'controllers', 'models' but more granular than that, in a subject."

## Decisions

- Two read-only audits on 2026-11-23 found why a review showed only the change. Their evidence, by file and line, is in `notes.md` beside this spec.
- The way in was drawn and then folded away. The host rates unchanged code on the way in as safe, and Focus folds safe code by folder, so a route and its controller became "Safe code in config" and "Safe code in app/controllers". The camera frames only the node in focus, and the way in was one line of words behind "Read more".
- The engine walked up to the entry point and kept only its name. The definitions between, the kind of entry and the reason a walk stopped were dropped. It never looked for constants, code that runs at load or removed code, and still said "No route, job or command was found" for them.
- The engine found and ran the tests that covered a definition before the change, and then kept only one sentence of evidence. The host made a node for an unchanged test only when a spec's Proof line named it, so the tests that were covering the code before never reached the graph.
- Test callers were dropped by both walks, so neither could say that only tests call a definition.
- Where a part is run from is an origin: its kind (a request's route, a controller action, a job, a command, a task, a schedule, a listener, a handler named in a map, an exported function, code that runs as its file loads), its words, and the chain of definitions from it down to the part's own caller. A part has up to three, the nearest first.
- A part with no origin says which case it is: only tests call it; the scan found no caller within the calls it followed, with where it stopped; the walk ran out of calls or time; or nothing was looked for. The words say "the scan found no caller", never that none exists, because the search tool's caller lists can be wrong while they say they are complete.
- On the graph the way in is a trail on the step card, a "From" row under the title, with each hop a button that moves the focus there. The chain's nodes stay where the layout put them. Moving them on every focus would break saved positions, and the entry would still fall outside the frame. The nodes and wires of the trail are lit, and the frame also takes in the direct caller and the test card when they fit at reading size.
- Unchanged code on the way in never folds with safe code. Past the card budget it folds into "More of the way in", which keeps what the layout and the walk need.
- A test's relation to the change is its node's `change`: `unchanged` was there before, `added` and `modified` came with the change, `deleted` is gone. A test node lists the code it covers. The step card lists a part's tests under three headings that are always there, "There before", "Added or edited" and "Removed", and an empty one says "None".
- An unchanged test that covers changed code is a node of the graph, at most three for a definition and twelve for a review, life-cycle tests first. A test the change removes is a node too, and a changed part whose only covering test was removed asks for the reviewer.
- A card of tests folds only with its subject. There is no one card for every passing test of a review.
- The tests are run as before (spec 032): at the change's commit, and with the definition put back. Nothing is run at the base commit, and no coverage tool is used.
- A zone is a layer and a subject, finer than "controllers" or "models": `app/controllers/admin/orders_controller.rb` is the controller layer of `admin/order`, `ui/src/features/review/graph/NodeCard.tsx` is the graph part of the window's review. A test takes the subject of the code it mirrors. A zone comes from a node's path by fixed rules, the same every time, in the engine (`packages/change-review/src/zones.ts`), which stays free of this app's code.
- The Reviewer may rename a zone in its one answer. It moves nothing between zones, and a zone changes no level and no unit.
- The graph draws each zone as a region behind its nodes with its name, places nodes by zone in the order a request passes them, folds safe code by zone, and lists the zones in the outline. Wires keep spec 006's rule, out of a right pin and into a left one: a test sits in its subject's zone.
- Every new field is optional. A review built before, a `graph.json` from before and a window on an older host read as they did.
- The search tool (pi-agentic-search) gains what the origins need: a call inside a function that is a value of a handler map gets its caller, and a handler map's entry, a listener, a Node route registration and a rake task are named as entries.

## Out of scope

- Coverage tooling, and running tests at the base commit.
- A pull request from GitHub with no local checkout gets what the host's own walk finds, and none of the engine's facts.
- Patterns a project configures for its own ways in.
- Editing the graph's structure by hand.

## Acceptance

- A1. Every node of a review has a zone, a layer and a subject worked out from its path alone: a Rails controller, model, job, mailer and view each get their layer with the subject their file names; a file of this app gets its package, its feature and its part; a test takes the subject of the code it mirrors; and the same path always gives the same zone.
- A2. A changed definition says where it is run from: up to three origins, the nearest first, each with its kind, its words and every definition between it and the change.
- A3. A definition with no origin says which case it is: only tests call it; the scan found no caller within the calls it followed, with where it stopped; or nothing was looked for.
- A4. Each changed definition lists the tests that cover it, each marked as there before the change, added by it or edited by it, with its result at the change's commit and what it showed.
- A5. A test the change removes that named a changed definition is listed as removed, and an edited test that lost assertions says how many.
- A6. The Reviewer is given each part's origins, tests and zone. A unit's words say the same case as A3. The Reviewer may rename a zone and change nothing else of one. A review built before these facts keeps its units, its story and its levels.
- A7. The review the window reads carries, for changed code, the way in as nodes it can go to, or the reason none was found.
- A8. An unchanged test that covers changed code is a test node wired to it, at most three for a definition and twelve for a review. A removed test is a node too, and every test node says what it covers.
- A9. Every node of the review the window reads has a zone, the review lists its zones in the order a request passes them, and a name the Reviewer gave a zone is the one shown.
- A10. Code on the way in is never folded with safe code. The step card of changed code has a "From" row in a fixed place: the origin first, each hop a press that moves the focus, the count of other ways in, or the reason none was found. The trail's nodes and wires are lit, and the frame takes in the direct caller and the test card when they fit at reading size.
- A11. A card of tests folds only with its subject. The step card lists a part's tests as There before, Added or edited and Removed, each with its result, and an empty group says None.
- A12. The graph draws each zone as a named region with every one of its nodes inside it and no two regions overlapping, in the order a request passes them. A zone folds as a whole, the outline lists the zones, and the keyboard moves from zone to zone.
- A13. The search tool gives a call inside a handler map's function its caller, and names a handler map's entry, a listener, a Node route registration and a rake task as entries.

## Proof

- A1. `packages/change-review/test/zones.test.ts` › "a Rails path is a layer and the subject its file names, singular, with its namespace", › "a path of this repository is its part of the app and the folder it is about", › "a test takes the subject of the code it mirrors, in a test layer" and › "the same path gives the same zone, and a label is never a path"
- A2. `packages/change-review/test/pipeline.test.ts` › "every part says where it runs from, or why nothing was looked for, and names its zone"; `packages/change-review/test/origins.test.ts` › "each way in a real pack names at a call site is an origin: a handler by its key, a route by its verbs and path, a listener, a task"
- A3. `packages/change-review/test/pipeline.test.ts` › "every part says where it runs from, or why nothing was looked for, and names its zone"; `shared/test/review-lifecycle.test.ts` › "changed code only tests call says so, in its reason and its words"
- A4. `packages/change-review/test/pipeline.test.ts` › "a test the change removes, and one it edits to assert less, are on the part they covered" and the mentions fixture in the same file, whose unchanged request test is marked as there before
- A5. `packages/change-review/test/pipeline.test.ts` › "a test the change removes, and one it edits to assert less, are on the part they covered"
- A6. `packages/change-review/test/curate.test.ts` › "runs_from, tests and zone change a unit only in where it is reached from: a graph without them reads as it did"; `packages/change-review/test/pipeline.test.ts` › "where a part runs from, its tests and its zone set no level: the same parts without them rate the same"
- A7. `shared/test/review-lifecycle.test.ts` › "changed code counts the other ways in beside the nearest, each a door or an entry with no door"; `host/test/review-engine-facts.test.ts` › "the change review's way in stands where the host found none, its words whole and its steps where the host shows them"
- A8. `shared/test/review-covering.test.ts` › "an unchanged test that covered changed code before the change joins the review, wired to that code, and says so" and › "at most 3 unchanged tests join for a changed definition and 12 for a review, the life-cycle tests first"; `host/test/review-engine-facts.test.ts` › "a test the change removed is wired to what it covered, and code it alone covered says so"
- A9. `shared/test/review-zones.test.ts` › "every node names its zone, and the review lists its zones in the order a request passes them, a test after the code it mirrors"; `host/test/review-engine-facts.test.ts` › "a review prepared before zones, covers and ways in, with an older graph.json, reads as it did"
- A10. `ui/test/review-groups.test.ts` › "unchanged code on the way in never folds with safe code: it keeps a standing of its own, and the routes stay where requests enter" and › "past the budget the way in folds into "More of the way in", which keeps where a request enters and its life cycle"; `ui/test/review-trail.test.ts` › "found by itself, the way in to link_user_tags runs from GET /posts/:id, the nearest, and counts the other two", › "the host's chain wins: its origin, its words and its count" and › "with no way in it says why: in the review's words, in an older review's, or in what the graph shows"; `ui/test/review-focus.test.ts` › "the whole of the focus's way in is lit, however far from it the way in starts"; `ui/test/review-camera.test.ts` › "the frame takes in the focus's caller and its card of tests only when they fit at a reading size"; check: a still render of the step card with its From row, light and dark (2026-11-23), then the live window.
- A11. `ui/test/review-groups.test.ts` › "a card of tests folds only with its subject: drawn while its subject is, and in its subject's group when it folds"; `ui/test/review-node-tests.test.ts` › "the tests of changed code are told apart: there before, added or edited, and removed, each a failure first" and › "a test that says what it covers is listed by that, and one that does not by its wires"; check: the same still render, then the live window.
- A13. In pi-agentic-search, `test/life-cycle.test.ts` › "a call inside a function that is the value of an object's property, or an argument, is a caller: the definition that holds it", › "a map of handlers by name is a way in: each key a handler, exact only where the code reads the map by a key it is given", › "a listener is a way in, named by its event, and exact where the receiver is a known event source", › "a route a Node app registers is a way in, with its verbs and path as Rails routes have them" and › "a rake task is a way in, named with its namespace, and what it calls has it as a caller"; check: `agentic-search scan --anchor host/src/review/reviews.ts:867 --max-depth 1 --callers all` in this repository lists `reviewHandlers` in "review.prepare" as a handler, not exact (2026-11-23).

## Steps

- [x] S1 (A1). Engine: zones from paths. 6800752, 490be20. Two changes from the notes: a top folder named `components` is no package, and a file right under a source root is in that root's zone.
- [x] S2 (A2, A3). Engine: origins with their chain, their kind and why a walk stopped. 175c7c1, c755934, 02770d1, and 087776f for the search tool's new kinds. An origin the scan is not sure of says "(not certain)".
- [x] S3 (A4, A5). Engine: the tests of each definition, their relation to the change and their result. fb8c6bd. Added and edited are told apart by the file's and the test's status in the diff, and removed tests are found by their text in the diff's test hunks.
- [x] S4 (A6). Engine: the Reviewer's data and prompt, the units' words, renaming a zone. b45c188, d92e9db. Run against fixtures only: no model call, and no real review of a repository against the updated search tool.
- [x] S5 (A7, A8, A9). Host and shared: the way in as nodes, the tests that were there before, zones on the model. c2062cb, 8c13166, 727bc13, b884f6d, 026d077. Tested from hand-written engine output: not against a real `graph.json` or a live host.
- [x] S6 (A10). Window: the way in stays in view. 97a40d8, f99521e, e6796f7, 586b99b, db83a06. Seen only as still renders: not in the live window.
- [x] S7 (A11). Window: tests connected. 5385a4f, b1d0fca. Seen only as still renders. The list of tests under a card on the graph is not split in three yet, and a removed test counts as not run in a card's counts.
- [ ] S8 (A12). Window: zones on the graph.
- [x] S9 (A13). Search tool: handler maps, listeners, routes and tasks, with mailers, channels and JSX event props. pi-agentic-search 9a4d5f9 to 07935e8, its `dist/` rebuilt. A handler read by key in another file stays not exact, which is this repository's own case.

## Open questions

- What `--tests all` costs in the engine's scan of a large Rails repository is not measured.
- The engine and the host each walk to the way in, and they can disagree. The host's nodes are what is drawn and the engine's words are what is said.

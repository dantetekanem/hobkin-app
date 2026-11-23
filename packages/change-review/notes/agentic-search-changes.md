# Search facts for pi-agentic-search

Read against `a5174ad` (0.7.1). Agentic-search only searches: every item below is a fact about the code that the scanner already has in hand, or nearly, and does not yet report. None of them grades, classifies risk, knows what a feature flag is, or builds the map. That stays in the skills.

Each item names what the scanner reports today, what the review needs, and where the change goes. Ordered by how much review accuracy it buys.

The design works on today's `pack.json`. Where the pack is silent an implementation has to guess (the script in `prototype/` shows how); items 1 to 5 replace those guesses with reported facts. In the terms of `FOUNDATION.md`: item 1 and 2 make the exposure fact provable, item 3 and 5 make the effect and undo facts exact, and item 10 finds the tests that proof needs to run.

"Replaces" notes below name functions in `prototype/review-graph.mjs`.

## 1. Guards on call sites and changed lines

**Today.** `CallVisitor.visit` in `src/adapters/ruby.ts:644` already stops at `IfNode`, `UnlessNode`, `CaseNode` and friends, but only to fork local-variable types. The condition is dropped, so a `CallSite` does not know which branch it is in.

**Needed.** The conditions that dominate each call site and each changed line. This is what turns the pack from "what changed" into "what changed outside the gate".

**Change.**
- `src/adapters/types.ts:66`: add `guards?: Array<{ line: number; text: string; branch: "then" | "else" | "after-return" }>` to `CallSite`.
- In the visitor, keep a guard stack. Push on entering the `statements` of an `IfNode` or `UnlessNode` (and the `subsequent` for else), and on passing a `ReturnNode`, `NextNode` or `raise` call whose parent is a modifier `if`/`unless` (branch `after-return`, applies to the rest of the body). Copy the stack onto each pushed site.
- Add `guardsAt(facts, def, line)` to `LanguageAdapter` so the scanner can ask for any changed line, not only call lines.
- Same in `src/adapters/ts.ts` for `IfStatement`, `ConditionalExpression` and early `return`.
- Do not interpret the condition. Emit its text; the consumer matches it against configured flag patterns. The scanner stays flag-agnostic.

**Replaces.** `gateRegions` in `review-graph.mjs`, which infers branches from indentation and gives up (`form: expression`) on ternaries, `&&` chains and stored flag values.

## 2. Complete callers, with a count

**Today.** `scanSparsity` asks for 6 callers per anchor (`src/sparsity-scan.ts:616`). `references` keeps one hit per file. `tooCommon` (`src/sparsity.ts:1606`) skips caller search for `call`, `perform`, `execute`, `run`, `create`, `update` and any name under 4 characters. Caller edges are always `static_candidate`.

**Needed.** "Every production call site is behind the flag" is only as true as the caller list is complete. In a Rails monorepo `call` and `perform` are exactly the entry points that matter.

**Change.**
- Add `callers: { total: number; shown: number; complete: boolean }` to `AnchorRecord`. `complete` is false when a limit, the per-file rule or `tooCommon` cut the list.
- Add `--callers all` to `scan`. With the Ruby index present, `indexedReferences` already has every site with `receiverType` and `inDef`: return all that pass the `compatible` check, several per file.
- For `tooCommon` names with an index, filter by receiver type instead of skipping. Skip only when there is no index.
- Mark a caller edge `exact` when the index receiver type resolves to the anchor's owner or an ancestor.

**Replaces.** The `incomplete()` text match on frontier notes, and the rule that sends every pre-existing definition with gated callers to `open`. With `complete: true` and exact edges, those become `gated` without a model call.

## 3. Added or modified, per anchor; whitespace-only lines

**Today.** Diffs are read with `--unified=0` (`src/sparsity-scan.ts:269`), and `removedFor` attaches any old hunk that overlaps the definition's new range. In the fixture, `round_money`'s `removed` block contains `def legacy_discount`, and `round_line_tax` (new) is not fully marked changed because git matched its `end` to an old one. A re-indented `else` branch shows as three changed lines.

**Needed.** Whether a definition existed at base, and which changed lines differ only by whitespace. The second is the cheapest equivalence evidence there is: an off branch that is the old code re-indented.

**Change.**
- `AnchorRecord.status: "added" | "modified"` from a base-side lookup: does `git show base:path` define this symbol? The parser is already loaded.
- `AnchorRecord.whitespaceOnly: number[]`: changed lines that disappear under `git diff -w`. One extra git call per scan.
- `AnchorRecord.signatureChanged: boolean`: parameter list at base differs from head.

**Replaces.** `existedBefore` (a regex over removed lines) and the trimmed-line comparison behind `off_path: identical`.

## 4. Reasons on unresolved edges

**Today.** `coverage.unresolved` counts every unresolved edge together. In the fixture that is 11 of 45 edges: 6 operator calls (`subtotal.+`) and 5 attribute reads on an untyped receiver (`@cart.region`). None is dynamic dispatch.

**Needed.** Only dynamic dispatch should make a contract `partial` or a node `open`. A single mixed count cannot drive that.

**Change.** Add `reason?: "operator" | "unknown-receiver" | "dynamic" | "no-definition"` to `SparsityEdge`. The notes already distinguish them in prose (`src/sparsity.ts:1325-1336`); make it a field. Report `coverage.unresolvedByReason`.

**Replaces.** The regex over `edge.note` in `review-graph.mjs`.

## 5. Async boundaries and writes

**Today.** `perform_later`, `enqueue`, `update!`, `create` and `call` are in `RUBY_COMMON_METHODS` (`src/sparsity.ts:182-201`) and produce no edge. `ReceiptJob.perform_later(id)` yields only `references ReceiptJob`.

**Needed.** The request cycle ends at an enqueue and a new one starts in `#perform`. Writes are what make "off after on" different from "never on".

**Change.**
- New edge relationship `enqueues`: `X.perform_later|perform_async|perform_in` and `X.set(...).perform_later` resolve to `X#perform`; `Mailer.action(...).deliver_later` to the mailer action.
- `SparsityNode.effects: Array<{ kind: "write" | "enqueue" | "cache"; line: number; text: string }>` for calls that stay unfollowed. Collect them in the visitor before the common-method filter drops them.

**Replaces.** The `signals` regexes and the `perform_later` regex in `review-graph.mjs`.

## 6. File classes

**Today.** `classifyFile` (`src/sparsity-scan.ts:189`) returns `code`, `test`, `generated` or `other`. A migration is `code`; `Gemfile` is `other`; lockfiles are `generated`.

**Change.** Add `migration`, `config`, `dependency` and `schema` to `FileKind`. Add `loadTime: true` to anchors of kind `statement`, `declaration`, `constant`, and to class-body calls. These are facts about where code runs (at load, at deploy), reported the same way `test` and `generated` are today. What they mean for risk is the skill's business.

## 7. A cache that outlives the command

**Today.** The CLI builds the Ruby index in a temp directory and removes it (`src/cli.ts:131`, `:178`). `fingerprintOf` (`src/sparsity.ts:309`) hashes raw lines, so a comment edit changes the fingerprint.

**Change.**
- `--cache-dir <path>` on `collect` and `scan` to keep the index between runs. On a large monorepo this is most of the scan time.
- `semanticFingerprint`: hash the definition with comments and whitespace removed (from the syntax tree). Use it for contract keys. Keep the raw fingerprint for "did the text change".

## 8. Tests as first-class facts

**Today.** At most 8 tests per anchor, found by name. Changed tests beyond the second per file are grouped (`MAX_TEST_ANCHORS_PER_FILE`, `src/sparsity-scan.ts:157`) and lose their edges.

**Change.** With `--tests all`, emit every test definition that references an anchor, each with its outgoing call edges. Emit the test's enclosing `setup`/`before` block lines too: flags are often set there, and the consumer cannot see them today.

## 9. Entry points from the framework, not the path

**Today.** `boundarySignal` (`src/rank.ts`) tags `controller`, `job`, `webhook` by path regex. It is a ranking hint.

**Change.** An entry registry built from facts already in the index: classes whose ancestors include `ApplicationJob`/`ActiveJob::Base` (`ancestorsOf`), public methods of classes under `ApplicationController`, and routes if `config/routes.rb` parses. Emit `entry: { kind, exact: boolean }` per node.

## 10. Life cycle tests of an entry point

**Today.** Tests are linked to code by name reference. A request test (`post checkout_url`) names a route helper, not a method. In a fixture, the scan gave such a test edges to `post` and `checkout_url` and none to `CheckoutController#create`.

**Needed.** Proof is established by running the tests that drive the entry points above a change, with coverage. Something has to say which test files those are.

**Change.** `agentic-search search --intent tests` for an entry point should also return tests found by convention and by route: the controller's request, integration and system tests (path and class naming), tests whose URL helpers resolve to the action when `config/routes.rb` parses, and for a job, tests that enqueue or perform it. Label each hit with how it was found. Whether a test executes the changed lines is not a search fact; coverage decides that.

## 11. What the review reads of origins and tests (spec 055)

Read against pi-agentic-search `4a0f239`. The review now keeps, and sends on in `graph.json` as `runs_from` and `tests`:

- `entry.kind` and `entry.exact` on anchors, on the pack's nodes and on call sites, with `entry.routes` (verbs, path, file, line) and `entry.doors` (kind, title, file, line). A kind it does not know is kept as named, with a plain label.
- `entry.label`, or `entry.key`, as the origin's words when there is no route: the key of a string-keyed handler (`'review.prepare': ...`). Neither is emitted today; whichever the tool chooses, say so here.
- Call sites with `test: true`: counted as `testCallers` on the anchor. In packs written by `4a0f239` the `callers` list holds production sites only (46 anchors over two scans of this repository had none with `test: true`), so "only tests call it" is said when `callerCount.total` is 0 and `testDefinitions` lists tests that use the definition.
- `--tests all` on the diff scan, and `testDefinitions` (id, symbol, path, lines, `anchors[].lines`, `changed`). With it `anchor.tests` is no longer cut at 8, so the review takes at most 8 linked test files per definition as proof candidates, as before; the rest are listed, not run. Measured on two commits of this repository (22 and 24 anchors, 42 test definitions each): 1.15 s to 1.50 s, and 1.07 s to 1.10 s.

**Missing.**
- No origin for this monorepo's own way in: a registry of string-keyed handlers (`host/src/review/seat.ts:374`, `'review.prepare': ({ id }) => reviews.prepare(id)`, dispatched by `runCommand`) is no caller of `Reviews.prepare` to the scan, so its walk finds a wrong name match (`copyStore`) and stops with `callerCount.complete: true`. The review never says "no route exists" because of this: it says the scan found none within so many calls. Kinds wanted: `handler` (label: the key), `listener`, `route` (a Node route registration), `task`, `mailer`, `channel`, `ui-handler`.
- `testDefinitions` does not say whether a test definition existed at base, so "added" and "edited" are told apart by the file's status and the test anchor's `status`, and a modified file's test with no anchor reads as edited.
- Removed tests are not in the pack: the review reads them from the diff's test hunks (a removed `test(`, `it(` or `def test_` block), by text.

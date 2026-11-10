---
{
  "id": "005-review-model",
  "title": "Change Review: the review model and how it is prepared",
  "kind": "work",
  "status": "doing",
  "depends": [],
  "updated": "2026-11-09"
}
---
# Change Review: the review model and how it is prepared

## Outcome

For a finished change, the client has one file that describes it as a graph and a story: nodes for the spec's acceptance lines, the tests and the code, wires for how they connect, and ordered steps that teach the change. The file is checked against the exact bytes of the change, so every line a reviewer sees is real and no changed line is left out.

## Decisions

- This builds on pi-coder's diff story (`~/Poetry/pi-coder/src/diff-story`). Its rule stays: the host extracts and owns every code range, and the model only arranges prepared ids and writes prose. The unit extraction and test pairing are ported, because the review model extends them from a list of steps to a graph.
- Input: a project, an item, the branch `hobkin/<id>-<slug>`, its base (the merge base with the default branch) and its head commit.
- Preparation runs in five passes:
  1. Capture. Read both sides of every changed text file at base and head and fingerprint them.
  2. Units. Split changed lines into units: a function, a method, a test case, or the nearest declaration for loose lines. Pair tests with the code they exercise by file and symbol name. Find references between units by identifier.
  3. Spec. Parse `_specs/<id>-<slug>/spec.md` at head, following `_specs/README.md`. Acceptance lines become nodes, and Proof lines link them to tests.
  4. Model. One Pi run gets the prepared ids, the candidate wires and the spec. It returns the story order, a short teaching text per step, a one-line summary per node, extra wires with a kind and a label, links from acceptance lines to code, and unchanged context nodes it found.
  5. Check and complete. Reject unknown ids and impossible wires, verify every context node against the files at head, add any changed line the model left out, lay the graph out in columns, and save.
- Node kinds: `criterion`, `test`, `code`, `file`, `context`. Wire kinds: `proves`, `exercises`, `implements`, `calls`, `uses`, `renders`, `imports`, `configures`, `replaces`. Each wire records whether the host derived it or the model proposed it.
- Model prose is display text. Control characters are stripped and lengths are capped: 80 characters for a title, 600 for a step's text, 200 for a node summary.
- The file is `work/<slug>/reviews/<item>/<head, 12 characters>.json` under the home, with `version: 1`. File contents are not stored in it. The UI asks the host for a file's two sides, and each anchor carries a hash of its lines.
- The model pass runs through hobkin's `runtime.dispatch`, so it has a receipt and is never run twice for one head.
- Types and the pure passes (units, spec parsing, checking, layout) live in `shared/review`, with no dependency on hobkin, so they can be tested alone and used to build sample data.
- Size limits: 60 changed files and 4,000 changed lines. Beyond that, the remaining files become `file` nodes without units, and the review says so.

## Out of scope

- Changes hobkin did not make.
- Parsing languages with a real parser. Units come from line patterns, as in pi-coder, and loose lines join the nearest unit.
- Running tests. Test status comes from the item's proof when it names results, and is otherwise "not run".

## Acceptance

- A1. For a base and a head, the capture lists every changed text file with both sides. Its fingerprint differs when any byte of any side differs.
- A2. Every changed line of every captured file is covered by the anchors of at least one node, including lines outside any function.
- A3. Every changed test case is a `test` node. It is wired to the code it exercises when the file name or a referenced symbol matches exactly one candidate, and left unpaired when the match is ambiguous.
- A4. Every acceptance line of the change's spec is a `criterion` node. A Proof line that names an existing test wires the two. A Proof line naming a test that does not exist, or a missing Proof line, marks the node unproven and says which.
- A5. Model output that names an unknown id, wires a test to a test, or proposes a context node whose file or symbol is not at head is corrected or dropped, and the saved review passes the validator.
- A6. Every node is the focus of at least one story step. The first step presents the outcome. The last step presents what is out of scope, the risk and the open questions, when the spec or the item has them.
- A7. Preparing the same head twice makes one model run. A new head makes a new review and leaves the old file in place.
- A8. A change without a spec produces a review with no `criterion` nodes and a statement that the change has no spec.
- A9. A change over the size limits produces a review that names how many files were summarized as `file` nodes.
- A10. A saved review whose anchors no longer match the bytes at its head (a hash differs) is refused on load with the reason.

## Proof

- A1. `shared/test/review-capture.test.ts` › "captures both sides and fingerprints every byte"
- A2. `shared/test/review-units.test.ts` › "covers every changed line, including loose lines"
- A3. `shared/test/review-units.test.ts` › "pairs a test by file and symbol and leaves ambiguous tests unpaired"
- A4. `shared/test/review-spec.test.ts` › "turns acceptance lines into nodes and flags missing proof"
- A5. `shared/test/review-validate.test.ts` › "drops unknown ids, impossible wires and unverified context"
- A6. `shared/test/review-validate.test.ts` › "gives every node a story step and frames the story"
- A7. `host/test/review-prepare.test.ts` › "prepares one head once"
- A8. `shared/test/review-spec.test.ts` › "a change without a spec says so"
- A9. `shared/test/review-capture.test.ts` › "summarizes files beyond the limits"
- A10. `shared/test/review-validate.test.ts` › "refuses anchors that no longer match"

## Steps

- [ ] S1 (A1, A9). Types for the review file, the capture pass and its limits.
- [ ] S2 (A2, A3). Unit extraction, test pairing and reference matching, ported from pi-coder with its tests.
- [ ] S3 (A4, A8). The spec parser for `_specs/README.md` and the spec pass.
- [ ] S4 (A5, A6, A10). The validator, completion of left-out lines, story framing and the column layout.
- [ ] S5 (A6). A script that builds a sample review from a commit range, with the model pass supplied as a file. Use it to produce the sample review for `006` to `009` from one real hobkin change.
- [ ] S6 (A7). Host: the model pass through `runtime.dispatch`, the prompt, and the commands `review.prepare`, `review.get` and `review.file`.

## Open questions

- The base of a finished change is not stored by hobkin. It is computed from the default branch each time (`src/cli/work/tree.mjs:164`). If the default branch moves, the merge base can move too. The review stores the base it used, and a moved base counts as a new review.

---
{
  "id": "015-specs-in-projects",
  "title": "Specs in every project hobkin changes",
  "kind": "work",
  "status": "draft",
  "depends": ["005-review-model"],
  "updated": "2026-11-09"
}
---
# Specs in every project hobkin changes

## Outcome

When a hobkin agent takes an item, it writes the spec first: what will be true, how it will be proven, and the steps. The spec travels on the branch with the code. Change Review then has a real spec to read, with acceptance lines wired to the tests that prove them.

## Decisions

- This is a change to hobkin's work prompts (`src/prompts/work-do.md`), made on the `client-host` branch.
- The agent writes `_specs/<item id>-<slug>/spec.md` in the project, in the format of `_specs/README.md`, before it changes code. The folder name is the branch name after `hobkin/`.
- If the project has no `_specs/README.md`, the agent adds it in the same change, so the convention is explained where it is used.
- The agent checks a step's box when its proof passes and starts the commit subject with the step id.
- The item's `proof` text stays. It now names the Proof lines it ran.
- A project can turn specs off with one line in its `directions.md`. hobkin then works as it does today, and Change Review says the change has no spec.
- hobkin does not make a missing or weak spec block a merge. Change Review shows unproven acceptance lines, and the user decides.

## Out of scope

- Specs for looks and surveys, which change no code.
- Rewriting specs for work already finished.

## Acceptance

- A1. A work run on an item produces a branch whose first commit adds `_specs/<item id>-<slug>/spec.md`, and the file passes the spec parser.
- A2. Every acceptance line in that spec has a Proof line, and each named test exists on the branch.
- A3. Steps checked in the spec match commits whose subjects start with those step ids.
- A4. In a project whose `directions.md` turns specs off, a run adds no `_specs/` files.
- A5. Opening that change in Change Review shows its acceptance lines as nodes wired to their tests.
- A6. A run that cannot prove an acceptance line leaves its step unchecked and says so in the item's `left` text.

## Proof

- A1. `test/cli-work-spec.test.mjs` (in hobkin) › "a do run writes a spec that parses"
- A2. `test/cli-work-spec.test.mjs` (in hobkin) › "every acceptance line names an existing test"
- A3. `test/cli-work-spec.test.mjs` (in hobkin) › "checked steps match commit subjects"
- A4. `test/cli-work-spec.test.mjs` (in hobkin) › "directions can turn specs off"
- A5. check: run work mode on a sample project in the development home and open the finished change.
- A6. `test/cli-work-spec.test.mjs` (in hobkin) › "an unproven line stays unchecked and is reported"

## Steps

- [ ] S1 (A1, A2, A3, A6). hobkin: the work prompt, with a scripted-model test for the contract.
- [ ] S2 (A4). hobkin: the opt-out read from `directions.md`.
- [ ] S3 (A5). Client: a full run in the development home through to Change Review.

## Open questions

- Should a finished item's spec folder stay in the project after merge, or move to an archive folder? Keeping it is the default here, because it documents why the code is the way it is.

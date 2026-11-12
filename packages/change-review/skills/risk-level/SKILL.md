---
name: risk-level
description: Set the risk level (safe, mid, high) of every node of a review map. First the floor, from the four facts and a fixed table, with no model. Then a model pass over mid and high nodes that may raise a level, lower it only on named evidence, mark critical work, note what can be watched after launch, and raise questions for the reviewer. Use after node-map.
compatibility: Requires graph.json with facts from node-map and the scan pack. Uses agentic-search collect for callers. Writes levels, findings and questions onto graph.json through .review/risk-events.jsonl.
---

# Risk level

Rules and the full table: `../change-review/FOUNDATION.md` section 5.

`safe`: no human attention needed. `mid`: not critical, worth a look, can be patched in a fast follow. `high`: needs human attention or a fix.

## 1. Floor

Apply the table in section 5.1 to each node's four facts, first match wins. This is a lookup. Record the rule number in `level.why`.

Remember what the order of the table means: a broken reference comes first, then missing proof. A flag is consulted only after both. A flagged change with no life cycle test that reaches it with the flag on is `high`.

Rule 4 has three parts. Tests that call a definition directly, and fail without the change, show the change does what it says; they do not show how callers use it. Where that is new or changed (a new definition, a write, a changed signature, a condition in front of it, an undo that is not a rollback) the node is `high` (4a). Where the definition was only changed in place it is `mid` (4b). Code that runs outside a request is entered by calling it, so the rows below decide (4c).

The floor alone is a usable result. Everything below improves it.

## 2. Model pass

For `mid` and `high` nodes, and any node that hosts a new condition check. Worst first. One node at a time: read its facts, then its pack section by line range. Neighbours through one `agentic-search collect`, not by opening files.

Ask the questions in `../change-review/reference/checklist.md` for the node's exposure. Write each finding as one line of `.review/risk-events.jsonl` (`../change-review/schemas/risk-event.schema.json`).

- **Raise** whenever the code supports it. State what the code does, with symbols and lines. No "may", "might", "consider".
- **Lower** only with `evidence_kind`: `equivalent`, `off-path-identical`, `unreferenced`, `additive-schema`, `dominance-proven`. Each must point at something checkable.
- **Never lower a node below a floor that rule 3 or 4 set.** `high` for missing proof stays `high`, and the `mid` of rule 4b never becomes `safe`. Only a test that runs changes that; say which test would.
- **Critical** means "needs a fix, not only a look", only on `high`: a definite break, an effect nothing undoes, or a changed behaviour on a money, auth or tenant path that no changed test observes.
- **Suggest** what would move the level, with the level it would produce: a life cycle test, a flag, a restructure. Never a flag for something that takes effect at load.

Events are the whole history. Applying the same file twice must give the same graph.

## 3. After launch

For each `mid` and `high` node, search its path for what already reports from production, and record each as written in the code with `file:line`: metrics, logs, traces, error reports.

Then record the gaps:
- Nothing on the new path is tagged with the condition's state, so on and off cannot be compared.
- A new `raise`, timeout or fallback is rescued with no count and no log.
- The diff removes or renames a metric or log line. Whether a dashboard or alert reads it cannot be seen from code: ask.
- Data written behind a condition has no count, so cleanup cannot be sized.

And what undoes the change, from the undo fact. Never invent a metric name, a dashboard or a threshold. "No signal on this path" is a result.

## 4. Questions

When something that would change the level cannot be known from the code or the tests (who reads a cache key, what an alert watches, why a rule existed), add it to `questions` with why it cannot be answered here and what an answer changes.

A question is an aid for the reviewer. Decide with what is known, then ask. Do not ask what the facts or one `collect` would answer.

## 5. Claims

When a finding confirms or contradicts a claim in `triage.json`, set its `status` and `evidence`.

## Budget

One pass per node. At most one `collect`. No whole-file reads: if the section is not enough, keep the floor, set `confidence: low`, and put what would settle it in `questions`.

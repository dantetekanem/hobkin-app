---
name: risk-level
description: Set the risk level (safe, mid, high) of every node of a review map. First the floor, from the four facts and a fixed table, with no model. Then a model pass over mid and high nodes that may raise a level, lower it only on named evidence, mark critical work, note what can be watched after launch, and raise questions for the reviewer. Use after node-map.
compatibility: Requires graph.json with facts from node-map and the scan pack. Uses agentic-search collect for callers. Writes levels, findings and questions onto graph.json through .review/risk-events.jsonl.
---

# Risk level

Rules and the full table: `../change-review/FOUNDATION.md` section 5.

A level is the risk that the change breaks something: the code, or what runs in production. Nothing else. `safe`: shown to work, or unable to break anything. `mid`: nothing shows it breaks, and nothing shows it works through a request; worth a look. `high`: a break is shown or named.

That code changes what it does is what a change is, and is never a reason for a level. That something could not be checked is said in words, and is never `high` on its own.

## 1. Floor

Apply the table in section 5.1 to each node's four facts, first match wins. This is a lookup. Record the rule number in `level.why`.

Remember what the order of the table means: a break comes first, then what cannot break, then an effect nothing undoes and a changed contract. Only then what the tests did or did not show, and that is `mid`, never `high`. A flag is consulted after all of these: a flagged change with no life cycle test that reaches it with the flag on is `mid`, and never `safe`.

Rule 5 is a change no test that ran shows. Rule 6 is a change shown only by tests that call the definition directly: they show the change does what it says, and not how callers use it. Both are `mid`, with a finding that says what is missing. Code that runs outside a request is entered by calling it, so the rows below decide. Rule 9 is a change of behaviour that tests show through a request: `safe`.

A test that fails with the change in place is run once more with the definition put back. Passing then, it is a break the change causes: rule 1. Still failing, it says nothing about the change.

The floor alone is a usable result. Everything below improves it.

## 2. Model pass

For `mid` and `high` nodes, and any node that hosts a new condition check. Worst first. One node at a time: read its facts, then its pack section by line range. Neighbours through one `agentic-search collect`, not by opening files.

Ask the questions in `../change-review/reference/checklist.md` for the node's exposure. Write each finding as one line of `.review/risk-events.jsonl` (`../change-review/schemas/risk-event.schema.json`).

- **Raise to `high`** only by naming what breaks: the input or state, what the code does with it (symbols and lines), and the wrong result. A description of the change is not a break. Neither is "no test shows it". No "may", "might", "consider".
- **Raise to `mid`** when something concrete could go wrong and nothing shows either way.
- **Lower** only with `evidence_kind`: `equivalent`, `off-path-identical`, `unreferenced`, `additive-schema`, `dominance-proven`. Each must point at something checkable.
- **Never lower a node to `safe` when rule 5 or 6 set its floor**, and never lower a rule 1 break. Only a test that runs changes that; say which test would.
- **Critical** means "needs a fix, not only a look", only on `high`: a definite break, an effect nothing undoes, or a named wrong result on a money, auth or tenant path.
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

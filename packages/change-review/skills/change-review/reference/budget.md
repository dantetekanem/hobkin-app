# Time budget

Napkin math. These numbers are guesses to plan with, not measurements, except where marked. Every review writes measured seconds to `progress.jsonl`; `rule-promote` corrects this page from them.

## Per step

| Step | Time | Scales with | Does not scale with |
|---|---|---|---|
| Triage | 5 to 20 s | number of files (metadata only) | lines changed |
| Map: search | 10 s to 2 min | changed definitions (up to 200), size of the component root on a cold index | deleted, skipped and sampled files |
| Map: proof | test boot plus test time per entry point, twice when a condition is involved | number of entry points above the change, and how slow their life cycle tests are; often 1 to 3 min per test file in a large app | lines changed, model speed |
| Risk: floor | under 1 s | nodes | |
| Risk: model pass | 30 to 60 s per node | `mid` and `high` nodes | `safe` nodes |
| Shape | 10 to 30 s | nodes | |
| Story | 60 to 120 s | units | |
| Blind check | about 20 s, once; up to 30 s per unit rewritten | | |
| History lookup (`git log -S`) | 5 s to 2 min per symbol | repository history length | Capped at 20 symbols |

Model passes are independent per node and can run side by side. Proof is machine time: start it first and let search and triage finish beside it.

## By scope

| Scope | Shape of the change | Read line by line | Units | Model time | Test time | Reviewer reads |
|---|---|---|---|---|---|---|
| Small fix | 30 lines, 1 to 3 definitions | all | 1 to 3 | 2 to 4 min | 2 to 6 min | 2 min |
| Flagged change | 1,000 lines, about 25 definitions, about 8 queued | queued nodes only | 6 to 8 | 10 to 15 min in sequence, 6 to 8 side by side | 5 to 15 min | 8 to 10 min |
| Large feature | 5,000 lines, 100 to 150 definitions, 15 to 25 queued | queued nodes only | 9 per part, 2 to 3 parts | 25 to 40 min in sequence, 10 to 15 side by side | 15 to 30 min | 20 to 25 min |
| Mass deletion | 500,000 lines deleted | none | 3 to 6 | 5 to 15 min | none, or the suite once | 5 min |
| Translation batch | 90 locale files | one locale | 1 to 2 | 1 to 3 min | none | 1 min |
| Port to another language | whole app | entry points only | parity table plus 5 to 9 | 30 to 60 min | both suites, at CI speed | 15 to 20 min |
| Mixed | flagged change plus 90 locales plus a deletion | the flagged change's queue | 8 to 9 | flagged change plus 5 to 10 min | as flagged change | 10 to 12 min |

## What the table says

- Cost follows **queued nodes**, not lines. A 500,000-line deletion is cheaper than a 1,000-line flagged change, because nothing in it is read: it is checked by references, history of at most 20 removed rules, and leftover data.
- 90 translations cost one locale plus a key comparison. The other 89 are trusted.
- A change that is proven and behind a condition is cheap: most of its nodes have a `safe` floor and get no model pass. They are still shown in full.
- Proof is usually the longest wall-clock item and the only one a cheaper model cannot speed up. It is also the one the levels rest on.
- Reviewer time is capped by units, not by diff size: about 2 min per `high`, about 1 min per `mid`, under 1 min per `safe`. Every unit is shown in the same shape; the level says how fast to move.

## When the estimate is too large

In this order: split the review by entry point; skip the model pass for `mid` nodes and present them at their floor, marked "floor only". Never skip proof: without it every unit is `high`.

---
name: node-curate
description: Turn a map into the reviewable units a human can hold in mind, whatever the size of the diff. Handles the three ways a map fails a reviewer (no nodes, too many nodes, inconsistent nodes) and gives every unit the same shape whatever its level. Use after risk-level, or whenever a map is too large, too thin or inconsistent to review.
compatibility: Requires graph.json with levels and triage.json. Writes .review/units.json.
---

# Node curate

A unit is one thing the reviewer decides on. Aim for 5 to 9 per review part. Rules: `../change-review/FOUNDATION.md` section 7. Write `.review/units.json` (`../change-review/schemas/units.schema.json`).

## Check the map first

Counts and lookups, not judgment:

- Every edge endpoint exists. Every node has all four facts, each a listed value or `unknown`.
- Every file in the diff is in exactly one bucket; every file triage marked `scan` has a node.
- No node is `safe` with proof `none`, `mocked`, `isolated` or `unknown`. No node is `critical` without being `high`.
- Scan coverage was not truncated.

One failure: rebuild once. Still failing: the unit carries `unverified` with the reason and is at least `mid`. Never drop a node to make the map tidy.

## No nodes

- A code change with zero nodes is a scan failure. Report it.
- A change with no code has no nodes by design. Units come from triage buckets; set `map: "file-level"`.

## Too many nodes

Group by structure, never by level:

1. A definition together with the private helpers changed with it and reached only through it.
2. A mechanical bucket: one unit, three sites shown, the rest counted.
3. A translation, removal, rename or generated bucket: one unit with its checks and counts.
4. Tests are never units. They appear as proof inside the unit they exercise.

Always a unit of its own: anything `critical`, a broken reference, a schema change, the definition that hosts a new condition check, anything `unverified`.

A unit's level is the worst level of its nodes. A group that mixes levels is split until each unit has one.

Still more than 9: split the review into parts by entry point and set `attention.parts`. Do not drop or merge units to fit the number.

## Same shape for every unit

`safe` does not change what is shown. It tells the reviewer where they can move faster. Every unit, whatever its level, carries:

- `title`: a claim the reviewer can agree or disagree with.
- `level`, and `critical` if set.
- `where`: its place on the path, entry first (`story_order`).
- `what`: what changed, in two or three sentences.
- `code`: the changed lines as a diff, plus the one caller or callee the level rests on. About 40 lines. Never a bare sentence, never a whole file.
- `facts`: effect, proof, exposure, undo, each with its evidence in a few words.
- `why_level`: the floor rule and any finding that moved it.
- `would_change`: suggestions, each with the level it would produce.
- `watch`: what reports from production on this path, and the gaps. `mid` and `high` only; `safe` says "not assessed".
- `questions`.
- `members`: for a grouped unit, every member with one line.

`attention.reading_minutes` is the sum over units, shown first in the story.

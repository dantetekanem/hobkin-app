# Notes: what Work assumes about a project

A read of hobkin's runtime on 2026-11-24, before any change. Paths are under `hobkin/src/cli/work/` unless they say otherwise. Everything here was read in the code. Nothing was run.

## The project record

- Fields a proposal gives: `slug`, `name`, `path`, `remote`, `level`, `summary`, `rank`, `reason`, `found`, `first` (`prompts/work-discover.md:78-90`, `watcher.mjs:96-108`). `state` and `at` come from propose, choose, skip and drop (`store.mjs:679`, `695`, `702`). The user sets `paused`, `priority`, `prMode` and `issues` (`store.mjs:601-626`).
- YOLO's switch for a project is in `mode.json` under `yoloProjects` (`yolo.mjs:54`, `166`), not on the record. A project chosen after the switches were first written starts off.
- The `propose` command strips only `priority`, `prMode` and `issues` (`commands.mjs:417-419`). Any other field an agent sends is kept, and `chooseProject` writes the whole record again. So `kind` has to join that list.
- The user's own words already have a home: `work/<slug>/directions.md` (`store.mjs:70`). `describe` gives it to every look and every run as `directions` (`director.mjs:568-586`), and both prompts treat it as the only project text that counts as instructions (`work-look.md:10`, `work-do.md:28`). No code writes the file. Tests write it by hand (`test/cli-work-director.test.mjs:2000-2010`), and a reset keeps it (`commands.mjs:306`).
- `reason` and `found` never reach a run. `summary` does (`director.mjs:574`). `first` items are filed when the project is chosen (`store.mjs:696`).

## A chosen project's life

- The plan (`plan.mjs:308-342`) runs the study first, until `project.md` exists. Then a weekly state machines look on the max tier, one of seven code lenses in turn (`store.mjs:24`), ideas, a signals look retried daily until a record of a known type is saved (`signals.mjs:54-57`, `68`), and a watch look once signals reach 2.
- A run's folder comes from `place()` (`director.mjs:603-622`): a look uses `trees/look` or the folder, a do uses the item's worktree or the folder. `startDo` names the branch (`director.mjs:834-836`).
- `work-look.md` assumes code throughout: commits over 90 days, tests, how it ships, `gh api`, `pnpm audit`, TLA+ models. `work-do.md` puts the run on its own branch, asks for a failing test first, and allows `done` "only when the assigned outcome … needed no code change" (line 95).

## What breaks with no repository

| Function | Where | Reached for every chosen project? | For a goal |
| --- | --- | --- | --- |
| `addProject` | `controls.mjs:197-205` | by hand | take it on its kind |
| `place`, `enterFolder`, `prepareTree`, `baseRef` | `director.mjs:603-622`, `tree.mjs:24-37`, `87`, `213-260` | every look and do | must: every run would fail at its start |
| `startDo` naming a branch | `director.mjs:834-836` | every do | must: no branch |
| plan rows for machines, lenses, signals, ideas | `plan.mjs:193`, `224`, `289`, `308-342` | every chosen | must: they are code looks, one on the max tier |
| `surveyUnmerged`, `surveyProject` | `unmerged.mjs:637-663`, `393-396` | every chosen, every 30 minutes | skip: a try/catch hides the failure today |
| `yoloPass`, `prepareProjects` | `yolo-pass.mjs:265-270`, `yolo.mjs:95-102` | every chosen with YOLO on | must: it files a code item |
| `setYoloProject`, `runReadiness` | `yolo.mjs:146`, `163` | from the window | refuse |
| `fileOpenIssues`, `repoOfProject` | `issues.mjs:36`, `138-156` | skipped while issues are off, the default | refuse the setting |
| `trueOutcome` | `controls.mjs:658-669` | each `done` with a branch | not reached once no branch is named |
| merge, publish, diff, branch deletion, refresh, adoption | `controls.mjs:430`, `492`, `620`, `723`, `refresh.mjs:18`, `adopt.mjs:50` | card actions or an agent's pipe | refuse at the `item` command |
| launches, proofs, closing, after merge, deploys | `launches.mjs:272-299`, `proof-checks.mjs:50-63`, `closing.mjs:69-87`, `after-merge.mjs:141-161` | only for items with a branch | never reached |

`git -C` looks upward. A goal's folder inside another repository would pass a "has a repository" check and be read as the parent, which is why the kind is the guard.

## What already fits a goal

- `done` with `summary` and `proof` is a supported end that leaves no branch. A `done` item is not in `itemCounts` (`reads.mjs:68-74`), so the window had no count of finished steps.
- Steps only the user can take (`yours`) and decisions (`decide`) exist, and what a run leaves for the user reaches Attention.
- `paths(root, slug)` only joins folders under `work/<slug>` (`store.mjs:64-97`), so storage does not care about git.
- `workStatus` (`commands.mjs:212-293`) sends the whole project record, so a `kind` on it reaches the host with no new field.

## Tests to copy

- `addProject`: `test/cli-work-control.test.mjs:606-631` (it asserts "Not a git repository" at line 627).
- Propose and choose: `test/cli-work-commands.test.mjs:137`.
- The study and a run's start: `test/cli-work-director.test.mjs:792` and `809`, with `fixture(t)` (line 125) and `study(root)` (183). Directions reaching runs: line 2000.
- Helpers: `test/helpers/work-director.mjs`, `test/helpers/work-fixture.mjs`. A goal's fixture is a plain folder, not `repository()`.
- The plan's study rules: `test/cli-work-plan.test.mjs:377-465`.

# Notes for 060: the audit behind "Make it a stack"

Read on 2026-11-24 by the design lane. Nothing was run, built or written outside this folder. "Read" means the line was opened and checked. "Reported" means a read-only helper agent of this lane found it and the lane checked the line it names. "Inferred" means it follows from what was read but no code shows it.

The hobkin checkout is on another session's branch, `local/action-item-dismissal`, with uncommitted changes. Its work files match `main` except two: `src/cli/work/yolo-pulls.mjs`, which is only on `main`, and `reads.mjs`, which differs only below line 579 (`git diff main -- src/cli/work` read). Every hobkin line below is the same on `main`, except `yolo-pulls.mjs`, which was not opened.

## The request

The user, 2026-11-24, with a picture of Change Review on `rpsleague #183`: "this PR looks good, but is too big, we need to have stacking in mind. this can be easily several PRs which a much easier progression. and hobkin needs to understand and support stacking as well. design this, and I want a button in there 'Make it a stack'".

The picture: another author's pull request, 32 files, +1273 −313, "Risky to deploy" and "Critical", "Step 15 of 22", a group "More worth a look: 19 files, 52 parts". 1,586 changed lines, five times the 300-line line below.

## What hobkin knows about stacks today (read)

- No item has a parent, a base or a stack. `store.mjs` has no `parent`, `base` or `baseAt` (searched). No plan has `layers` and there is no `assertPlan`: `045-dev-system` S3 and S13 are unchecked, and that spec is a draft.
- A stack is guessed after the fact. `placesOf` marks a branch `stackedUnder` the first finished branch that holds it and lists every holder in `heldBy` (`src/cli/work/unmerged.mjs:288-301`).
- The gap is `stacked` (`src/cli/work/reads.mjs:221`), said as "it lands with the branch above it" (`reads.mjs:381`). A row counts what it would bring as `holds` (`reads.mjs:229`, `:308`), and the landing list leaves a row out when what it brings has a grade against it (`reads.mjs:393`, `:403-404`).
- Land offers: "sits under a newer branch" (`src/cli/work/patterns.mjs:22`), a veto over 300 changed lines (`MOST_LINES_OFFERED`, `patterns.mjs:12`, `:193`, counted as additions plus deletions at `:188`), and "brings earlier work below safe A with it" (`patterns.mjs:217`).
- A merge of the top lands the stack. `closeWhatLanded` closes every finished branch the default branch now holds (`src/cli/work/controls.mjs:468-482`), and `mergeItem` says "It brought N earlier branches with it" (`controls.mjs:513`).
- One yes on a list carries no row that brings another branch (`!entry.holds`, `src/cli/work/groups.mjs:16-22`). YOLO mode says "it brings earlier branches with it" for any row that holds one (`src/cli/work/yolo-pass.mjs:81`), which is spec 049's "brings no earlier branch with it" (`_specs/049-yolo-mode/spec.md:67`). `merge-group.mjs` lands rows in turn and skips a row "already gone from the list, often brought along by a merge before it" (`merge-group.mjs:7-8`, `:27-31`).
- A PR merges with `--merge` and keeps its branch (`controls.mjs:567`). `publishItem` opens every PR into the default branch (`controls.mjs:643-644`).
- Every tree starts from the latest default branch: `prepareTree` reads `baseRef(repo)` (`src/cli/work/tree.mjs:87-90`), `readyTree` switches with `-C branch base` (`tree.mjs:75`). `prepareTree` refuses the project's own folder (`tree.mjs:88`). `enterFolder` works in the project's folder (`tree.mjs:244-261`).
- A run can register a branch it made: `hobkin work item` with a `branch` and no `id` goes to `adoptBranch` (`src/cli/work/commands.mjs:425`, `src/cli/work/adopt.mjs:51-74`). It needs a title, summary and proof, keeps the branch's name and moves nothing on it. `hobkin work item` drops every field that is hobkin's or the user's word (`commands.mjs:422-423`).
- Work from a card goes to the main agent while work mode is off or paused (`requestReview`, `controls.mjs:451-454`; `askAgent`, `controls.mjs:808-811`). `fixRisk` sends nothing while work mode starts nothing on the project (`controls.mjs:841-842`).
- Large work is split by filing its first step (`src/prompts/work-look.md:150`, `:161`), and a do run that finds its item larger finishes the first step (`src/prompts/work-do.md:42`). A run asks the user with `decide`, the harmless choice first (`work-do.md:13`).
- hobkin runs some checks itself, with no agent: TLA+ checks as its own job in a tree of its own (`src/cli/work/proof-checks.mjs:9-13`). There is no runner for a project's own tests in code (searched `proof-checks.mjs`, `proofs.mjs`): a project's tests run inside an agent's run.

## 042's line references, checked

`042-stacked-work` was written on 2026-11-14 and the code moved since. Where each reference is now:

| 042 says | Now |
| --- | --- |
| `director.mjs:766-768` (`startDo` names the branch) | `director.mjs:831-834` |
| `tree.mjs:75`, `:87-90` | still `:75` and `:87-90` |
| `tree.mjs:214-225` (`enterFolder`) | `tree.mjs:244-261` |
| `store.mjs:546-557` (no parent, no base) | still true; no line holds either field |
| `unmerged.mjs:202-204` (`stackedUnder`) | `unmerged.mjs:288-301` |
| `reads.mjs:197`, `:334` (`stacked`) | `reads.mjs:221`, `:381` |
| `patterns.mjs:22` | still `:22` |
| `controls.mjs:460-478` (merge closes lower branches) | `controls.mjs:468-482` |
| `patterns.mjs:208` (earlier work veto) | `patterns.mjs:217`, words "below safe A"; 045 S13's new words are not built |
| `work-look.md:128`, `:139` | `work-look.md:150`, `:161` |
| `work-do.md:38` (first step) | `work-do.md:42` |
| `patterns.mjs:12`, `:193`, `:188` | still true |
| `commands.mjs:337` (fields stripped) | `commands.mjs:422-423` |
| `plan.mjs:407` (`ownWait`) | `plan.mjs:449` |
| `tree.mjs:87-90`, `:214-225` (S2) | `:87-90`, `:244-261` |
| `work-do.md:56-60` (PR, `--base`) | `work-do.md:80-90` |
| `controls.mjs:593` (`publishItem`) | `controls.mjs:620`, the base at `:643-644` |
| `host/src/review/publish.ts:57` | still `:57` |
| `controls.mjs:550-556` (`Fixes` line) | `bodyOf`, `controls.mjs:597-607` |
| `host/src/review/sources.ts:99-104` (start of a change) | `startOfChange`, `sources.ts:63-72`; a merged change's start `:77-90`; `start()` `:119-124` |
| `controls.mjs:483` (`mergeItem`) | `controls.mjs:492` |
| `controls.mjs:527` (no `--delete-branch`) | `controls.mjs:567` |
| `after-merge.mjs:45-57` (issues closed on GitHub) | `after-merge.mjs:64-68` |
| `work-do.md:82-85` (rebase) | `work-do.md:159` |
| `commands.mjs:319-326` (`reviews on`) | `commands.mjs:405-413` |
| `work-do.md:13` | still `:13` |
| `controls.mjs:769` (offered merges) | `mergeOffered`, `controls.mjs:883` |
| `unmerged.mjs:171-181` (`safetyOf`) | `unmerged.mjs:259-268` |

## What a review knows that can find seams (reported, lines checked)

There are two models. The engine (`packages/change-review/src/`) builds the graph, units and story from a diff; the window's `Review` (`shared/review/types.ts`) is what the panel shows; the host lays the engine's facts over it (`host/src/review/engine-facts.ts`, `withEngineFacts`).

- Zones: `zoneOf(path, kind?)` is pure (`packages/change-review/src/zones.ts:309`), a zone is `component/layer/subject` (`types.ts:690`), on every node as `zone` and on the graph as `zones`. The window orders zones in the order a request passes them, from its wires: `withZones` (`shared/review/zones.ts:83`). That is the only order by depth anywhere. Inferred: read backwards, it is a bottom-first order (what is called before what calls it).
- What a file is: `classify` (`triage.ts:44`), `isLockfile` (`triage.ts:32`), `isPureRename` (`triage.ts:83`), and `mechanicalGroups`, the same hunk in three or more files (`triage.ts:227`). The window's buckets are `code`, `test`, `generated`, `lockfile`, `locale`, `moved`, `format`, `docs` (`shared/review/types.ts:67`). Nothing labels a change "refactor".
- Tests wired to code: `NodeTest` on each node with its relation (before, added, edited, removed) (`packages/change-review/src/types.ts:563`); the window's `covers` on a test node.
- Ways in: `packOrigins` and `walkOrigin` (`origins.ts:139`, `:150`).
- Sizes: additions and deletions on every file and node, and on a fold group.
- Effects: the engine's `Effect` is text, behaviour, interface, data or load (`types.ts:303`, reported, not opened). Inferred: it is what a check of a layer's kind can read.
- The story: the window's steps (`StoryStep`, built by `buildStory`, `shared/review/complete.ts:176`) and "Step N of M" (`ui/src/features/review/story/StepBody.tsx:84`). "More worth a look" is the group of cards past the card budget (`ui/src/features/review/graph/focus.ts:154`, `:371`). Neither is a seam: steps follow paths through tests and code, not dependency.
- The answer: "Risky to deploy" or "Safe to deploy" (`packages/change-review/src/answer.ts:19`), risky when any unit is high.
- Entry point: `reviewChange({ cwd, base, head, ... })` (`pipeline.ts:432`). The engine reads the diff itself from two refs.

So the facts for a first cut are all in the window's `Review` already: files, buckets, zones in request order, sizes, tests and what they cover, and which parts need the reviewer. No import graph of files exists, so the cut cannot promise that a lower layer builds without the one above. That is the agent's work.

## The panel and its keys (read)

- The header (`ui/src/features/review/panel/Header.tsx`): the place line with Hide (S) and Close (esc) at `:66-83`; the title `:84`; the by-line `:85`; the answer `:87`; the size row, files, +/−, `base..head` and Description, `:88-110`; the carried line `:112`; the description box that opens under the size row in place `:113-123`; the Outdated notice with Rebuild `:124`, `:317-332`.
- The row wraps (`flex-wrap`), so a control at its end moves nothing before it. The description box is the precedent for something that opens under the row on a press.
- The verdict (`panel/Actions.tsx`): every choice previews first, and a second press within ten seconds does it (`Actions.tsx:46-60`, `CONFIRM_MS` at `verdict.ts:151`). Someone else's pull request gets only Approve and Comment, with "merging or closing it is left to them" (`verdict.ts:182-195`). Choices and keys: `verdict.ts:162-180`.
- Review keys (`ui/src/features/review/keys.ts`): S, N, C, D, H, A, M, X, L, Z (`:96-137`); U, J, K, T (`:156-164`); arrows, O and P, digits, Home, End, Enter, G, `/`, `,`, `.`, B, W (`:166-224`); Y and R only with a wire open (`:146-149`). The code panel takes V, E, F, `[`, `]`, `+`, `−` while code is open (`Shortcuts.tsx:36-46`). A shifted key other than arrows, U and T is not the review's (`keys.ts:178`), and the app's key map takes no bare shifted letter (`ui/src/app/key-map.ts:157-160`). So ⇧S, `{` and `}` are free.

## Pull requests by other authors (reported, lines checked)

- A review's target is a finished change or a pull request (`shared/review/ids.ts:7`). There is no kind for "the user's own pull request".
- Whose a pull request is: `PullOwner { author, mine }` (`shared/review/status.ts:95-98`), from `whosePull` (`host/src/review/owner.ts:26-31`): the viewer, one of the user's emails, or an agent whose "requested by" names the user. Anything else is someone else's.
- The code of a pull request is fetched into refs of hobkin's own, `refs/hobkin/review/pull/<n>/head` and `…/base` (`host/src/review/pull-checkout.ts:8`, `:54`), from `refs/pull/<n>/head` (`:237`), with the start as `merge-base` (`:249`). The user's branches, remote refs and working tree do not move.
- What goes to GitHub today, all through gh as the user, and only after a preview and its confirm token (`host/src/review/reviews.ts:532-536`; `review.verdict` carries `confirm` and `outside: true`, `shared/commands/registry.ts:992-997`): a review, a merge or a merge ask, a close, a branch deleted, and for a finished change a push and a new PR. The host's publisher opens every PR into the default branch (`host/src/review/publish.ts:57`, `:63`).
- `work.change` (`registry.ts:1138-1152`) carries merge, merge-pr, refresh-merge, review, ask, decline and done. Nothing splits or stacks.
- The host already knows a stacked pull request's base is the one below it (comment at `reviews.ts:1688`).

## Reviews cost and their line (read in 058)

`058-review-turns-and-ratings` keeps three reviews current for a repository and builds twenty background reviews a day; what the user asks for is still built (`058/spec.md:42`). A stack of four makes four reviews, so the layers go through that line.

## The other agent's paused work, 3f44 (read in `goal.md`, never touched)

`goal.md:19-25`: "after `Review again`, show `Request agent to work on`", delivered as "a separate, tested local branch registered in Hobkin Work; no push, PR, merge or deploy", through `hobkin work item`. Paused, filed as item `216e19`, holding `ui/src/features/work/AiReviews.tsx` and `shared/commands/registry.ts`. Nothing of it is in code yet (searched).

Where the two meet: both start a run from a review, both are handed the review's facts, both deliver local branches through `hobkin work item`, and both claim `registry.ts`. Where they part: 3f44 is a row action in the AI Reviews list; 060's button is in the panel's header (`Header.tsx`, not claimed by 3f44). The spec keeps them apart by file and by order (see its Decisions).

## What the spec recommends changing in 042 (not edited)

1. A1, A2 and "At most 5 layers are filed for one stack": make five layers and 300 lines defaults a plan aims for, not refusals. A plan past them says why, layer by layer. This follows the user's rule of 2026-11-24, quoted in `056-agent-schedules`: "as long as the agent defines, we dont constraint, we give tools". 300 stays where it already is: the line where land offers and YOLO mode stop.
2. "The rest of the plan stays in the top layer's brief" cannot apply to a stack made from an existing change: every line of the change is in a layer.
3. S1 files a layer with a parent; add the same `parent` to `adoptBranch`, since a stack run registers branches it already made.
4. The header's "Layer 2 of 3, on <parent's title>" gains "of <the original>" when the stack was made from one.
5. Refresh every line reference with the table above, and say that 045 S13's veto words are not built.
6. Its Out of scope "Stacks the user built by hand, on branches that are not hobkin's" still holds: a stack made from a pull request is on hobkin's own branches.

## Not verified

- That `withZones`'s order read backwards puts what is called before what calls it in a real repository. Read from its doc and the helper's report, not run.
- That the engine's `Effect` is on the facts the host lays over the window's review. A kind check needs it there.
- Whether `rpsleague` is a Work project in the user's home, and whether the user can push to its repository. The home was not read.
- How a pull request's review behaves once its base is a branch other than the default (stacked PRs on GitHub). The host comment at `reviews.ts:1688` says it is expected; no test was read.
- The cost of a stack run on 1,586 lines. No such run exists.

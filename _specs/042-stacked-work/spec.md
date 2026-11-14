---
{
  "id": "042-stacked-work",
  "title": "Stacked work: small layers that land in order",
  "kind": "work",
  "status": "draft",
  "depends": ["011-work", "024-github", "032-change-review", "045-dev-system"],
  "updated": "2026-11-14"
}
---
# Stacked work: small layers that land in order

## Outcome

When planned work is too big for one easy review, hobkin splits it into a stack before it writes any code: a few small layers, refactors and mechanical steps first, each one a self-contained change on its own branch built on the layer below, and each its own PR into that layer's branch. A layer can start as soon as the one below is finished, without waiting for its review. The Work screen and Change Review show the stack in order, and each layer is reviewed on its own. Layers land bottom first. When one lands, the next moves onto the default branch, and a fix in a lower layer flows up through the layers above. A declined layer stops the layers above it until the user says what becomes of them.

## Decisions

### What hobkin does today

- One item is one branch, made from the default branch: `startDo` names it (`src/cli/work/director.mjs:766-768`), a worktree switches to it from the latest default branch (`src/cli/work/tree.mjs:75`, `:87-90`), and the project's folder does the same (`src/cli/work/tree.mjs:214-225`).
- Items have no parent and no base (`src/cli/work/store.mjs:546-557`).
- Stacks are only noticed after they exist. The survey marks a branch `stackedUnder` a newer finished branch that holds it (`src/cli/work/unmerged.mjs:202-204`). That branch's gap is `stacked`, "it lands with the branch above it" (`src/cli/work/reads.mjs:197`, `:334`), and land offers name it as "sits under a newer branch" (`src/cli/work/patterns.mjs:22`). Merging the top branch closes the ones under it as landed (`src/cli/work/controls.mjs:460-478`), and an offer is vetoed when it "brings earlier work below safe A with it" (`src/cli/work/patterns.mjs:208`). So today a stack lands from the top.
- Large work is split by filing its first step, with the rest of the plan in the brief (`src/prompts/work-look.md:128`, `:139`), and a do run that finds its item larger finishes the first step and puts the rest in the description (`src/prompts/work-do.md:38`).
- A land offer is vetoed over 300 changed lines (`src/cli/work/patterns.mjs:12`, `:193`). That limit only stops an offer. Nothing splits work by size.

### When to split

- The plan `045-dev-system` has a run record on its item before any edit names the split. This adds one field to it: `layers`, in order, each with a title, what it changes, its proof and its rough size in changed lines.
- These defaults come from published practice, not from experiments here:
  - A layer is one self-contained change of about 100 changed lines. Google's guide: "100 lines is usually a reasonable size for a CL, and 1000 lines is usually too large", and the ideal is "one self-contained change" (https://google.github.io/eng-practices/review/developer/small-cls.html).
  - Planned work over 400 changed lines is always split. SmartBear's study of Cisco's reviews: "developers should review no more than 200 to 400 lines of code (LOC) at a time", and "beyond 400 LOC, the ability to find defects diminishes" (https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/).
  - A refactor never shares a layer with a change of behavior, as Google's guide asks. A layer carries the tests for its own behavior, as that guide also asks.
  - Each layer is "a single, coherent change" on a branch "based on the branch of the previous diff" (https://graphite.com/guides/stacked-diffs).
- Changed lines are counted as the land offer counts them, additions plus deletions (`src/cli/work/patterns.mjs:188`), so the plan and the offer agree. A mechanical layer that cannot be split, such as a lockfile or generated code, is one layer whatever its size, and the plan marks it `mechanical`.
- Order: refactors and mechanical steps first (renames, moves, extractions, formatting, generated code, dependency bumps), then the change of behavior with its tests, then removing what the change left unused.
- Each layer leaves the project working: its tests pass on top of the layer below.
- The plan check `045-dev-system` adds refuses a plan that estimates more than 400 changed lines and has no layers, and a layer over 400 that is not marked `mechanical`.
- At most 5 layers are filed for one stack. The rest of the plan stays in the top layer's brief, as large work does now.
- A do run that finds its item growing past 400 lines stops at a seam, commits that layer, and files the rest as layers above it. This replaces the first-step rule in `src/prompts/work-do.md:38`. A look still files a large idea's first step (`src/prompts/work-look.md:128`), and that step's run makes the layers.

### Items in a stack

- An item gains `parent`, the item it builds on, set when it is filed. The run passes the parent's id or its key, since a run knows keys before ids, and files the layers bottom first. hobkin refuses a parent in another project, a parent that is declined or dropped, a cycle, and a sixth layer.
- A stack is a chain: a layer has one parent and at most one child. Its id is its bottom layer's id.
- hobkin sets two more fields, which no run may set. `base` is the branch a layer's run starts from: its parent's branch while the parent has not merged, and the default branch after. `baseAt` is the parent's commit the layer was built on, written at each start and each restack.
- A layer can start once its parent is finished on a branch (`branch` or `pr`) or has merged. Until then its queue row says "Waits for <parent's title>" (`ownWait`, `src/cli/work/plan.mjs:407`). It does not wait for its parent's review or merge, since not waiting idle is what stacking is for (Google's guide, "stacking").

### Branches and PRs

- A layer's run starts its branch from its parent's tip. `prepareTree` and `enterFolder` take the base they are given, and keep the default branch when none is (`src/cli/work/tree.mjs:87-90`, `:214-225`). A parent branch that is only on origin is fetched first.
- The request carries `work.item.base`. A run that opens a PR passes `--base` with it (`src/prompts/work-do.md:56-60`).
- Approve on a layer, through hobkin's `publishItem`, opens its PR into its parent's branch, not the default branch (`src/cli/work/controls.mjs:593`). It refuses while the parent has no open PR and has not merged, and names the parent to open first.
- Change Review's Approve reaches `publishItem` only once `041-review-feedback` S6 lands. Its own publisher opens every PR into the default branch (`host/src/review/publish.ts:57`), so until then Change Review refuses Approve on a layer and points to the card.
- A layer's description starts by naming its parent's PR: "Builds on #12, which merges first." `publishItem` adds the line when the run left it out, as it adds `Fixes` now (`src/cli/work/controls.mjs:550-556`).
- Change Review reviews a layer against its parent's branch, so it shows that layer alone. Today a finished change starts at its merge base with the default branch (`host/src/review/sources.ts:99-104`).

### Landing bottom first

- Only the bottom layer can land: the one whose parent has merged, or that has none. A layer above has gap `stacked`, now read as "Lands after <parent's title>". Merge on its card, in Change Review, through a land offer and as a PR is refused, and the refusal names the layer to merge first.
- For an item with a parent link, the link decides what sits under what. The survey's `stackedUnder` guess still reads branches that have no link, as it does now.
- Land offers treat each layer on its own, once it is the bottom. The 300-line veto counts that layer's own lines. The veto "brings earlier work below safe A with it" never fires for a layer, because a layer never brings its parent. Each layer is graded on its own commit.
- A local merge lands the bottom layer as now (`mergeItem`, `src/cli/work/controls.mjs:483`). Its child then has the default branch as its base. The child's branch already holds the parent's commits, which the default branch now holds too, so nothing is rebased.
- hobkin merges a PR with a merge commit and keeps its branch (`src/cli/work/controls.mjs:527`). GitHub moves a child PR onto the merged PR's base only when the merged branch is deleted (https://github.blog/changelog/2020-05-19-pull-request-retargeting). So after a parent's PR merges, the pass after a merge (`src/cli/work/after-merge.mjs`) sets the child PR's base to the default branch with `gh pr edit --base`, as the user, as that pass already closes issues on GitHub (`src/cli/work/after-merge.mjs:45-57`). A child GitHub already moved is left alone.
- When the default branch does not hold the parent's commits, because the parent was squashed or rebased on GitHub, the child gets a `pr-fix` item with `need: 'restack'`: `git rebase --onto <default branch> <baseAt>`, then a push with `--force-with-lease`, as a rebase item does now (`src/prompts/work-do.md:82-85`).

### A fix in a lower layer flows up

- When a parent's tip moves and its child's branch no longer holds it (after an ask, a review round from `041-review-feedback`, or a rebase), the survey files a `restack` for the child: `git rebase --onto <parent's tip> <baseAt>`. Key: `ship:restack:<branch>:<parent's tip, 7 characters>`.
- Restacks go bottom first, one layer at a time: a layer's restack waits while anything runs on its parent.
- A restack that conflicts is solved as a rebase is, or aborted with the reason (`src/prompts/work-do.md:82`).
- A restack that changed nothing in the layer keeps the layer's grade, since a grade follows the change and not the commit (`src/cli/work/unmerged.mjs:171-176`).

### A layer declined or dropped

- The layers above it stay as they are and stop. Their gap says "<title> below it was declined".
- hobkin files one decision for the user, with the harmless choice first, as runs do (`src/prompts/work-do.md:13`): keep them waiting; move them onto the layer below, without the declined one, with a restack `--onto <that layer's branch, or the default branch> <declined layer's tip>`; or drop them. After a move, a layer's run may find it no longer makes sense and drop itself with the reason.
- The declined layer's own PR is closed as a discard closes one now (`032-change-review`).

### On screen

- `FinishedChange` and `QueueRow` gain `stack`: the stack's id, the layer's number, how many layers, and the parent's item (`shared/protocol/work.ts`).
- The Work screen keeps a stack's finished layers together, bottom first, each marked "1 of 3". Only the bottom offers Merge. Layers not started show in the queue under their parent, with what they wait for.
- Change Review's header says "Layer 2 of 3, on <parent's title>", with the layers below and above, each opening its own review. The AI Reviews list keeps a stack's layers together, bottom first.

## Out of scope

- A layer with two children, or a stack that branches.
- Stacks the user built by hand, on branches that are not hobkin's.
- Merging several layers with one yes.
- Stacking tools such as Graphite's CLI or gh-stack.
- Stacked PRs across forks.
- Changing the 300-line limit on land offers.

## Acceptance

- A1. hobkin refuses a plan that estimates more than 400 changed lines with no layers, and a layer over 400 lines not marked mechanical. A plan that splits the same work into layers is kept, in its order.
- A2. A layer filed with a parent records it, and hobkin sets its base. A parent in another project, a declined or dropped parent, a cycle, and a sixth layer are refused, each with the reason.
- A3. A layer waits in the queue, saying for what, until its parent is finished on a branch or has merged. Then its run starts on a branch made from the parent's tip, in a worktree and in the project's folder alike, and records the commit it started from.
- A4. A layer's PR goes into its parent's branch, whether its run or Approve opens it, and its description first names the parent's PR. Approve refuses while the parent has no open PR and has not merged.
- A5. Change Review of a layer shows only that layer's change against its parent's branch, and says which layer of how many, with links to the layers below and above.
- A6. Only the bottom layer can be merged: on its card, in Change Review, through a land offer and as a PR. Merging a layer above is refused and names the layer to merge first. A layer's land offer counts its own lines against the 300-line limit and is never vetoed for what lies below it.
- A7. After a parent lands, its child's base is the default branch, and its PR targets the default branch on GitHub. When the default branch lacks the parent's commits, a restack moves the child onto it, so the child's PR shows only its own commits.
- A8. When a lower layer gets new commits, each layer above is moved onto it, bottom first, one layer at a time. A restack that conflicts is solved or aborted with the reason, and one that changed nothing in the layer keeps its grade.
- A9. When a layer is declined or dropped, the layers above stop and say why, and one decision asks the user to keep them waiting, move them onto the layer below, or drop them. Each answer does what it says.
- A10. The Work screen shows a stack's layers together, bottom first, each with its number and the count. Only the bottom offers Merge, and layers not started sit under their parent in the queue with what they wait for.
- A11. A branch with no parent link is read as today: the survey's guess of what sits under what, and the offer's veto for what it brings along.

## Proof

- A1. `hobkin/test/cli-work-stacks.test.mjs` › "a plan over 400 lines with no layers, or a layer over 400 not marked mechanical, is refused"
- A2. `hobkin/test/cli-work-stacks.test.mjs` › "a layer records its parent and base, and a parent elsewhere, closed, in a cycle or a sixth deep is refused"
- A3. `hobkin/test/cli-work-stacks.test.mjs` › "a layer waits for its parent, then starts from the parent's tip and records it"; `hobkin/test/cli-work-tree.test.mjs` › "a tree and the project's folder start a branch from the base they are given"
- A4. `hobkin/test/cli-work-publish.test.mjs` › "a layer's PR goes into its parent's branch, names the parent's PR, and waits for the parent's PR"
- A5. `host/test/review-stack.test.ts` › "a layer is reviewed against its parent's branch and knows its place in the stack"
- A6. `hobkin/test/cli-work-stacks.test.mjs` › "only the bottom layer merges, by card, offer or PR, and a layer above names the one to merge first"; `hobkin/test/cli-work-patterns.test.mjs` › "a layer's offer counts its own lines and is never vetoed for what lies below it"
- A7. `hobkin/test/cli-work-after-merge.test.mjs` › "after a parent lands its child's PR targets the default branch, and a squashed parent files a restack"
- A8. `hobkin/test/cli-work-ship.test.mjs` › "a lower layer's new commits restack the layers above, bottom first, one at a time"; `hobkin/test/cli-work-stacks.test.mjs` › "a restack that changed nothing keeps the layer's grade"
- A9. `hobkin/test/cli-work-stacks.test.mjs` › "a declined layer stops the layers above, and its decision keeps, moves or drops them"
- A10. `ui/test/work-stack.test.ts` › "a stack's layers sit together bottom first, and only the bottom offers merge"; check: a still render (server markup with the app's built CSS, no browser) of the Work screen with a three-layer stack, one layer still queued, dark and light.
- A11. `hobkin/test/cli-work-stacks.test.mjs` › "a branch with no parent link keeps the survey's reading and the offer's veto"

## Steps

S1 and S2 can be built at once. S3 needs `045-dev-system`'s plan check. S4 and S5 come after S1. S6 comes after S1 to S5. S7 can start after S1, and S8 after S7. S9 is last.

- [ ] S1 (A2). Runtime: `parent` on filing, `base` and `baseAt` set by hobkin, and the stack's reads (the chain, a layer's number, its bottom), as a module nothing calls yet. Files: `hobkin/src/cli/work/store.mjs`, new `hobkin/src/cli/work/stacks.mjs`; tests new `hobkin/test/cli-work-stacks.test.mjs`, `hobkin/test/cli-work-store.test.mjs`.
- [ ] S2 (A3). Runtime: `prepareTree` and `enterFolder` take a base, and keep the default branch when given none. Files: `hobkin/src/cli/work/tree.mjs`; tests `hobkin/test/cli-work-tree.test.mjs`, `hobkin/test/cli-work-folder.test.mjs`.
- [ ] S3 (A1). Runtime: `layers` in the plan and their size rules, in the plan check `045-dev-system` adds. Files: that check's module and its test, as `045-dev-system` names them, with the cases in `hobkin/test/cli-work-stacks.test.mjs`.
- [ ] S4 (A6, A11). Runtime: landing bottom first. The `stacked` gap from the parent link, the refusals in `mergeItem`, `mergePullRequest` and offered merges, and the offer vetoes for a layer, with branches that have no link read as now. Files: `hobkin/src/cli/work/reads.mjs`, `hobkin/src/cli/work/patterns.mjs`, `hobkin/src/cli/work/controls.mjs`; tests `hobkin/test/cli-work-stacks.test.mjs`, `hobkin/test/cli-work-patterns.test.mjs`.
- [ ] S5 (A7, A8, A9). Runtime: moving layers. `need: 'restack'` in `shipWork`, bottom first; retargeting after a merge; the decision for a declined or dropped layer and its three answers; the restack section of `work-do.md`. Files: `hobkin/src/cli/work/unmerged.mjs`, `hobkin/src/cli/work/after-merge.mjs`, `hobkin/src/cli/work/controls.mjs`, `hobkin/src/prompts/work-do.md`; tests `hobkin/test/cli-work-ship.test.mjs`, `hobkin/test/cli-work-after-merge.test.mjs`, `hobkin/test/cli-work-stacks.test.mjs`.
- [ ] S6 (A1, A3, A4). Runtime: the live path. A layer waits for its parent in the plan, `startDo` passes its base and records `baseAt`, the request carries `work.item.base`, `publishItem` targets the parent's branch and names its PR, and the prompts take the split rules (`work-do.md:38`, `:56-60`, `work-look.md:128`). Files: `hobkin/src/cli/work/plan.mjs`, `hobkin/src/cli/work/director.mjs`, `hobkin/src/cli/work/controls.mjs`, `hobkin/src/prompts/work-do.md`, `hobkin/src/prompts/work-look.md`; tests `hobkin/test/cli-work-queue.test.mjs`, `hobkin/test/cli-work-director.test.mjs`, `hobkin/test/cli-work-publish.test.mjs`.
- [ ] S7 (A5, A6). Host: a layer reviewed against its parent's branch, `stack` on finished changes and queue rows, and the refusals carried to Change Review's verdicts. Files: `shared/protocol/work.ts`, `host/src/review/sources.ts`, `host/src/work-items.ts`; tests new `host/test/review-stack.test.ts`, `host/test/work-items.test.ts`.
- [ ] S8 (A5, A10). UI: the stack on the Work screen and in the queue, and the layer's place in Change Review's header and the AI Reviews list. Files: `ui/src/features/work/finished-cards.ts`, `ui/src/features/work/Finished.tsx`, `ui/src/features/work/queue-rows.ts`, `ui/src/features/work/ai-reviews.ts`, `ui/src/features/review/panel/Header.tsx`; tests new `ui/test/work-stack.test.ts`.
- [ ] S9 (A3, A4, A6, A7, A8). One live stack of three layers in a project the user names, with the user's go-ahead, since it spends the subscription and pushes to GitHub as the user: a refactor, then a change of behavior, then a cleanup. Ask for a change on the bottom layer, see it flow up, then land the stack bottom first.

## Open questions

- Merging a stack. (a) One layer at a time, each with its own yes: more clicks, and each yes is about one small change. (b) "Merge up to here" lands every layer below first, in order, each pinned to the commit shown, and stops at the first that fails, as offered rows merge now (`src/cli/work/controls.mjs:769`): fewer clicks, and one preview path more to build and test.
- How a restack runs. (a) Every restack is a `pr-fix` run: tests run again on each layer, and a lower fix in a stack of four costs three runs. (b) hobkin rebases in code and starts a run only on a conflict: no tokens for a clean restack, but the layer's tests do not run again until CI or its next review.
- A declined layer. (a) Ask the user each time, as decided: nothing moves without them, and the stack waits until they answer. (b) Move the layers above onto the layer below by themselves and tell the user: no wait, and a layer that needed the declined one may fail its restack or its tests.
- PRs above the bottom. (a) Each layer opens its PR as the project's PR mode says. (b) Layers above the bottom open as drafts until they are the bottom: reviewers start at the bottom, at the cost of one `gh pr ready` when a layer reaches it.

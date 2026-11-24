---
{
  "id": "060-make-it-a-stack",
  "title": "Make it a stack: a change too big to review becomes small layers",
  "kind": "work",
  "status": "draft",
  "depends": ["011-work", "024-github", "032-change-review", "042-stacked-work", "055-review-origins-tests-zones", "058-review-turns-and-ratings"],
  "updated": "2026-11-24"
}
---
# Make it a stack: a change too big to review becomes small layers

## Outcome

A change that already exists and is too big to review at a sitting can become a stack from its review. "Make it a stack" in Change Review's panel shows a plan made from the review's own facts: a few layers, bottom first, each with its title, kind and size. On the user's press an agent builds the layers in a tree of hobkin's own, each branch built on the one below, and hobkin checks in code that the top layer is the original change byte for byte. Each layer then has its own review, in order, with the layers below and above a key away. hobkin's own change and the user's own pull request become layers that open as pull requests into the layer below, one Approve each. Another author's pull request is never rewritten: its layers are for reading, the verdict still goes on the original, and the plan can be posted for its author. Nothing is pushed, opened or posted without a press that first shows what it sends.

The user, 2026-11-24, with a picture of Change Review on `rpsleague #183` (another author's pull request, 32 files, +1273 −313, "Risky to deploy", "Critical"): "this PR looks good, but is too big, we need to have stacking in mind. this can be easily several PRs which a much easier progression. and hobkin needs to understand and support stacking as well. design this, and I want a button in there 'Make it a stack'".

## Decisions

### How this fits 042

- `042-stacked-work` splits planned work before any code is written. This spec goes the other way: a change that exists, too big, becomes a stack. The two meet in what a stack is once it exists. The audit behind this spec, line by line, is in `notes.md` beside it.
- Taken from 042 as it is: a layer's `parent`, `base` and `baseAt`, and a stack as a chain whose id is its bottom layer's; a layer reviewed against its parent's branch; landing bottom first, with a layer above refused and naming the one to merge first; a child PR moved onto the default branch after its parent lands; a fix in a lower layer flowing up as a restack, which ships off; the decision when a layer is declined; a layer's PR into its parent's branch, its description naming the parent's PR; and the stack on screen ("1 of 3", "Layer 2 of 3, on <parent's title>").
- Needed from 042 first: S1 (the records) and S2 (a tree started from a given base) before a stack run can be built; S7's review of a layer against its parent before the layers are worth reviewing; S4 (bottom first) before the original's landing rules here; S6's `publishItem` into the parent's branch before a layer opens its PR.
- What this request changes in 042, listed in `notes.md` for 042's own edit:
  - Five layers and 300 lines become what a plan aims for, not refusals. A stack made from 1,586 lines cannot be five layers of 300.
  - A stack made from a change has an origin, the change it equals.
  - Every line of the change is in a layer, so 042's "the rest of the plan stays in the top layer's brief" does not apply.
  - `adoptBranch` takes a `parent`, since the run registers branches it already made.

### Who makes the stack

- An agent run that hobkin starts from the review on the user's press: a Work item of kind `stack`, "Make a stack of <title>". It goes to the front of the queue, as a review the user asks for does (`requestReview`, `hobkin/src/cli/work/controls.mjs:444-459`). While work mode is off or paused it goes to the main agent to hand to a session, as a review does (`controls.mjs:451-454`).
- It is handed the original (hobkin's item, or the pull request's repository, number, author and head), the commit the original starts from and its head, the approved plan, the user's note if they wrote one, and the review's facts for every file: its zone, its bucket, its changed lines, the tests that cover it, its ways in and which of its parts need the reviewer. The host writes these to the stack item's folder, and the run's request names the file.
- It works in a linked worktree hobkin makes at the original's start (042 S2), never in the project's folder, even on a project whose runs work in its folder. The original's branch, or the pull request's refs, are read and never written. For a pull request, hobkin fetches its head into `refs/hobkin/stack/<id>/head` in the project's repository, as a review fetches one (`host/src/review/pull-checkout.ts:54`), and moves no branch of the user's.
- It makes one branch for each layer, `hobkin/<stack id>-<n>-<slug>`, the bottom on the original's start and each built on the one below. It runs the project's tests at each layer's commit, and registers each layer with `hobkin work item` as finished work with its `parent`, `layerKind`, summary and proof. It pushes nothing and opens nothing.
- The run has the check hobkin runs, as `hobkin work stack check <slug> <stack>`, so it sees what hobkin will see before it ends.
- It reports as runs do: its summary in Chat, its page in Work, and the button's place in the review.
- The change's repository must be a Work project, since a layer is a Work item. A pull request whose repository is not one is refused in the words below.

### The plan, and the user's yes before any branch

- hobkin's code drafts the plan from the review the window already has: `stackPlan(review)` in `shared/review/stack-plan.ts`, pure, the same in the window and the host. Bottom first:
  1. One `mechanical` layer, when there is any: files whose bucket is `lockfile`, `generated`, `moved` or `format`, and dependency manifests.
  2. Then the code, zone by zone, deepest first: the window's zone order (`withZones`, `shared/review/zones.ts:83`) read backwards, so what is called comes before what calls it. Each zone takes its tests and the TLA+ models that name its files. Zones join one layer while it stays at 300 changed lines or under. A zone over 300 is a layer of its own, marked "the agent splits it further, or says why not".
  3. The change's spec and docs go in the first layer that is not mechanical, so every layer's review can read the spec.
- A layer's kind is `mechanical` when every file in it is, and `behaviour` otherwise. Only the agent can tell a refactor inside a file from a change of behaviour, so only the agent splits out `refactor` layers.
- Each layer of the plan has its number, kind, title (its zone's words, such as "Models · Sessions"), files, changed lines counted as land offers count them (additions plus deletions, `hobkin/src/cli/work/patterns.mjs:188`), and how many of the review's parts that need the reviewer it holds. The plan's files together are the change's files, each in one layer.
- The user sees the plan before any branch is made, and presses Build. The draft costs nothing and is there at once. The agent may move a seam when the code needs it: split a file's hunks between layers, join two layers, or add a refactor layer. It names each change from the plan in its report, and the stack shows the layers it built, not the plan.
- An agent's plan, or no plan at all, are the other ways. Their costs are in Open questions.

### The proof that the stack is the change

- hobkin checks in code, in `hobkin/src/cli/work/stack-check.mjs`, when the run ends and on each survey, and the run's own command runs the same check:
  - The bottom layer starts at the original's start.
  - Each layer's branch holds the one below and adds at least one changed line.
  - The top layer's tree is the original head's tree (`git rev-parse <top>^{tree}` against `<head>^{tree}`), so every file is the same, byte for byte.
  - The original is where it was: hobkin's branch at its head, or the pull request's head as the plan read it.
  - Each layer's proof names that layer's own commit. A proof that names another commit counts as none.
- A stack passes only when every one holds. One that fails says which check failed and where ("the top layer differs from the change in 2 files: …"), and its layers cannot be approved or merged until a run fixes it or the user removes the stack.
- hobkin asks the agent for what code cannot check: that every layer's tests pass on top of the one below, that no layer mixes a refactor with a change of behaviour, that mechanical layers come first, and that each layer is one self-contained change.
- After each layer's review, hobkin compares the layer's kind with what that review found. A `refactor` or `mechanical` layer whose review finds a change of behaviour says so on the layer.
- Once the stack passes, it is the change of record. A later fix in a layer moves the stack past the original on purpose, and the stack says "moved on with fixes" instead of failing.

### Whose change it is

- hobkin's own finished change: the layers are hobkin's finished changes. Each opens its PR with Approve on its own review, into the layer below's branch, and the bottom into the original's base branch (042 A4). The original stays as it is.
- The user's own pull request (`PullOwner.mine`, `shared/review/status.ts:95-98`): the same. The layers become hobkin's finished changes on branches of hobkin's own, and each Approve opens a PR into the one below. hobkin never rewrites or closes the original PR. Its review says it was made into a stack, and the user closes it with Remove when they want to (`ui/src/features/review/verdict.ts:177`).
- Another author's pull request, the pictured case. hobkin cannot rewrite it. The ways it can go:
  - (a) New stacked branches and PRs in the same repository, opened as the user, that together equal it and link to it. The author's work becomes PRs the user opened, the review splits across two places, and it needs push access and the author's agreement.
  - (b) A plan posted for the author: one comment, as the user, with the layers, their files, sizes and order. The author decides and does the split.
  - (c) Local layers only: the user reviews the stack layer by layer on this machine. Nothing goes to GitHub, and #183 stays the change that lands.
- Recommended: (c) always, with (b) one press away. The layers of another author's pull request are for reading. They offer no Approve, merge or Remove of their own, and their verdict section says the verdict goes on #183, with a way back to it. A note written on a layer goes with #183's verdict: on #183's line when that line is the same at the top layer, otherwise in the review's words with its file. (a) is the user's call, in Open questions, and is not built here.
- Two presses write outside the machine. Each shows first what it sends and does it only on a second press within ten seconds, as every verdict does (`ui/src/features/review/panel/Actions.tsx:46-60`):
  - Approve (A) on a layer of hobkin's own change or of the user's own pull request pushes that layer's branch at the commit its review read and opens its PR into the layer below.
  - "Post the plan for <author>", in the stack's box on another author's pull request, posts one comment on it.
- Make it a stack and Build this stack send nothing outside the machine. Build spends one run, so Build is the press for it.

### How hobkin understands a stack afterwards

- The stack item records `of` (the original: hobkin's item, or the pull request's repository, number, author and head), `start`, `head`, `plan`, `layers` (item ids, bottom first) and `check` (each check and when it ran). Each layer records 042's `parent`, `base` and `baseAt`, plus `stack` (the stack item's id) and `layerKind`. An original that is hobkin's item records `stackedAs`. Only `parent` and `layerKind` come from the run. `hobkin work item` drops the rest from what a run pipes to it, as it drops hobkin's other fields (`hobkin/src/cli/work/commands.mjs:422-423`).
- A layer is reviewed against its parent's branch, so its review shows that layer alone (042 A5). The bottom is reviewed first, as the user's ask. The layers above wait their turn in the repository's line, bottom first, as finished changes do (`058-review-turns-and-ratings`).
- Layers land bottom first. A fix or a decline in a lower layer does what 042 says: a restack of the layers above, off until the user turns it on (042 A13), or the decision to keep, move or drop them (042 A9).
- The original and its stack are one change, so only one of them lands:
  - While the stack equals the original and no layer has landed or moved, the user can still merge the original whole (M on its review). Its layers then close as landed with it.
  - Once a layer lands or moves, the original cannot merge, and says "Layer 1 of its stack has landed, so it lands as its stack now" or "Its stack has fixes the change lacks".
  - When the top layer lands, the original closes as landed through its stack.
  - When a pull request that is an original merges or closes on GitHub, its stack's layers close and say why ("#183 merged"). The survey asks gh once for each open stack, as the pass after a merge asks of issues (`hobkin/src/cli/work/after-merge.mjs:64-68`). hobkin closes nothing on GitHub by itself.
- A layer of another author's pull request has the gap `reading`, "it is for reading: #183 lands as its author says". No card, offer, group or YOLO pass offers to land it, and a merge or an Approve on it is refused in those words.
- YOLO mode merges no layer by itself, and says "it is a layer of a stack, and YOLO mode lands no stack yet" (`whyItAsks`, `hobkin/src/cli/work/yolo-pass.mjs:72-100`). The original would never have merged by itself at 1,586 lines. Its layers would be new merges by themselves, so they wait for the user's word (Open questions).
- A land offer weighs a layer on its own once it is the bottom: its own lines against the 300-line veto, and never vetoed for its parent (042 A6). The original keeps its own lines and its own vetoes.
- A layer's review gives that layer's own level, which is the risk that the layer breaks code or production. Splitting changes nothing in the original's answer.

### On screen

- The Work page's finished changes: the original's card becomes the stack's heading, one quiet line with its title, "Stack of 4", and whether the stack equals it ("equals it", "moved on with fixes", or what failed). The layers sit under it, bottom first, each "1 of 4", and only the bottom offers Merge (042 A10). The heading says what no layer says: what the stack is of, and whether it still is. A stack of two reads "Make sessions resumable · Stack of 2 · equals it" over two cards. A stack made from another author's pull request is not on the Work page, since none of it is the user's to land.
- The AI Reviews list: a stack's layers follow the original's row, bottom first, each named "Layer 2 of 4 · <title>". The original's row says "Made into a stack of 4".
- A layer's Change Review: the place line at the top keeps its height and gains "· Layer 2 of 4 of #183" after the place, with two quiet buttons for the layer below and the layer above, each naming its layer in its tooltip. `{` and `}` move to them. On the bottom layer the first is disabled, and on the top the second. The words go inside the line's flexible part, so Hide and Close stay where they are when the stack's facts arrive.
- In the original's review and in each layer's, once there is a stack, the button's place says "Stack of 4" and opens the stack's box: the whole stack from any of its members.

### The button

- "Make it a stack" ends the size row of the panel's header, after the files, the lines, the commits and Description (`ui/src/features/review/panel/Header.tsx:88-110`), because size is the reason for it. It is on every review of a change that has not merged, from the first paint. Until the review is ready it is disabled, so nothing moves when the review arrives. A merged change has none.
- When the change has more than 300 changed lines a reviewer reads (its lines without lockfiles and generated files), the button is drawn in the attention color of the Outdated notice, with the same words and width, and its tooltip says "1,586 changed lines to read, past the 300 a reviewer takes in at a sitting." Under 300 it is plain. The emphasis is about size: it never takes the risk badge's colors, and its words never say risky.
- Its key is ⇧S: S for stack, with Shift because S alone hides the panel. A press or ⇧S opens the stack's box under the size row, in place, as Description opens its box (`Header.tsx:113-123`). The box holds the plan, a line for a note to the agent, "Build this stack" with the keyboard on it, and Close. Escape or ⇧S again closes it. A long plan scrolls inside the box.
- The box's words: "A stack of 4, bottom first", a row for each layer ("1 · Mechanical · Lockfile and renames · 3 files · +40 −12"), then "An agent builds each layer on the one below in a tree of hobkin's own and runs its tests there. It may move a seam the code needs, and says so. Nothing is pushed, and #183 stays as it is."
- While the run goes, the button's place reads "Making the stack…" with the breathing dot a refresh uses (`Actions.tsx:270-277`), and a press opens the run's page, where Stop is.
- After the run, "Stack of 4", and the box lists the layers built, each with its kind, size, proof and review. On another author's pull request the box also offers "Post the plan for <author>".
- A stack that failed its check reads "Stack of 4 · not equal". Its box says which check failed and offers "Try again", which sends the agent back to the stack with what failed, as Send fixes sends one back to a change, and "Remove the stack", which on a second press drops the layers and deletes their branches and leaves the original as it is.
- A run that ended with no stack puts "Make it a stack" back, and the box keeps the reason and "Build again".
- What the window says when a stack cannot be made:
  - Not ready yet, in the tooltip: "The plan is made from the review, once it is ready."
  - The review is of an older commit: "This review is of an older commit. Rebuild it first: a stack is made from the commit its review read."
  - Not a Work project: "hobkin makes a stack inside a Work project, and <owner/repo> is not one. Add it to Work first."
  - Another run from this review: "An agent is already working from this review on this commit. Make the stack once it ends."
  - The change moved by the time Build was pressed: "The change moved since this review. Rebuild the review, then make the stack."
  - A sample review: "Sample review: nothing is made from here."
  - One layer: "The review's facts give one layer. The agent can still split it inside its files." Build stays.
  - Work mode off or paused, under Build: "Work mode is off or paused, so the main agent hands this to a session."
- Everything is keyboard reachable: ⇧S, Enter, Escape, Tab to every row and button, and `{` and `}` between layers. The review's key list (`ui/src/features/review/Shortcuts.tsx`) and the app's key list gain them. ⇧S, `{` and `}` are free today (`notes.md`, "The panel and its keys").

### Caps

- 300 changed lines is where the plan starts a new layer and where the button is emphasized. It is a default the agent may pass, saying why (a migration with the model it changes, a generated file). 300 stays a limit where it is one already, in land offers and YOLO mode, which are the user's rules for merges.
- About 100 lines a layer is what the agent aims for, from Google's guide as 042 quotes it.
- There is no cap on the number of layers. 042's five becomes a default there (`notes.md`).
- One stack run for one head of a change at a time. A second press joins the first, so the same work never runs twice. This limits presses, not what the agent decides.

### Beside the paused "Request agent to work on" (3f44)

- The other agent's paused work (`goal.md:19-25`, the section for Hobkin handoff 3f44) adds a row action to the AI Reviews list that sends an agent to work from a review and delivers one local branch. It holds `ui/src/features/work/AiReviews.tsx` and `shared/commands/registry.ts`.
- This spec's button is in the panel's header, a file 3f44 does not hold. The steps here that touch `registry.ts` (S5) and `AiReviews.tsx` (S6) wait until 3f44 releases them, or go first only if 3f44 is still paused when they start, and say so in `goal.md`.
- The two never run from one change's head at once: each refuses while the other runs from that review, in the words above. Both deliver through `hobkin work item`, and neither changes the original. The review's facts handed to a run are built by one host module, `host/src/review/handoff.ts`, made by whichever is built first and used by both.

## Out of scope

- hobkin rewriting, force-pushing or closing anyone's pull request. The user closes their own with Remove, as today.
- Opening stacked PRs from another author's pull request (option (a)) until the user says so.
- A stack that branches, a layer with two children, and stacks across forks (042).
- Merging or publishing several layers with one yes.
- Editing the plan by hand in the window, beyond the note to the agent.
- Making a stack of one layer of a stack.
- Stacking tools such as Graphite's CLI or gh-stack.

## Acceptance

- A1. For a review, the plan lists layers bottom first, each with its number, kind, title, files, changed lines and how many parts that need the reviewer it holds. Lockfiles, generated files, moves and format-only files are one mechanical layer first, when there are any. Code follows zone by zone, deepest first, each zone with its tests, and a layer other than the mechanical one passes 300 lines only when one zone is that big. Every changed file is in exactly one layer. A change with one zone and nothing mechanical gets one layer.
- A2. On every review of a change that has not merged, "Make it a stack" ends the size row from the first paint, disabled until the review is ready. Over 300 changed lines a reviewer reads it is drawn in the attention color with the same words and width; under that it is plain. Nothing before it in the row moves in either case. A merged change shows none.
- A3. A press or ⇧S opens the plan under the size row, with Build this stack holding the keyboard, and Escape or ⇧S closes it. Each case that cannot be done shows its words from Decisions, in the box or the tooltip, and offers no Build.
- A4. Build starts one stack run for that head and that plan, and a second press or a repeat starts no second one. With work mode off or paused it goes to the main agent as a review does. The run works in a tree of hobkin's own at the change's start, never in the project's folder. The original branch, or the pull request's head, is unchanged afterwards.
- A5. The run leaves one branch for each layer, the bottom on the change's start and each on the one below, each registered as a finished change with its parent, its kind, its changed lines and a proof run at its own commit. Nothing is pushed and no PR is opened.
- A6. A stack equals the change only when the top layer's tree is the change's head tree, every layer holds the one below and adds something, the bottom starts at the change's start, and the original is where it was. Otherwise the stack names the check that failed and where, and its layers cannot be approved or merged. A layer whose proof names another commit counts as unproven.
- A7. A layer the run called refactor or mechanical whose own review finds a change of behaviour says so on the layer, in its review and on the Work page.
- A8. While the run goes, the button's place reads "Making the stack…" and opens the run's page. After it, "Stack of N" opens the layers. After a failed check it reads "Stack of N · not equal", with Try again, which sends the agent back with what failed, and Remove the stack, which on a second press drops the layers and deletes their branches and leaves the original unchanged. After a run that made no stack it reads "Make it a stack" again, with the reason kept. The row's other controls never move.
- A9. A layer's review says "Layer 2 of 4 of <the original>" in the place line and has the layers below and above as buttons, which `{` and `}` reach. The bottom's first button and the top's second are disabled. Hide and Close stay where they are. A stack of two works the same.
- A10. The Work page shows a stack of hobkin's own change or of the user's own pull request under one quiet heading that says what it is of and whether it still equals it, its layers bottom first with "1 of N", and only the bottom offers Merge. In AI Reviews the layers follow the original's row. A stack of another author's pull request is in AI Reviews only.
- A11. While the stack equals the original and nothing of it has landed or moved, merging the original whole closes the layers as landed with it. After a layer has landed or moved, merging the original is refused with why. When the top layer lands, the original closes as landed through its stack. When a pull request that was made into a stack merges or closes on GitHub, its layers close and say so, and hobkin closes nothing on GitHub.
- A12. YOLO mode merges no layer, and says "it is a layer of a stack, and YOLO mode lands no stack yet". A land offer for the bottom layer counts that layer's own lines and is never vetoed for its parent.
- A13. Approve on a layer of hobkin's own change or of the user's own pull request pushes that layer's branch at its reviewed commit and opens its PR into the layer below's branch, the bottom into the original's base branch. Its description starts "Part 2 of 4 of <the original>. Builds on #190, which merges first." Approve is refused while the layer below has no open PR and has not merged, and names that layer.
- A14. A layer of another author's pull request offers no Approve, merge or Remove, and its verdict section says the verdict goes on the original, with a way back to it. A note on a layer goes with the original's verdict, on the original's line when that line is the same at the top layer, and otherwise in the review's words with its file. "Post the plan for <author>" shows its comment first and posts it as the user only on a second press within ten seconds.
- A15. Without one of the two presses that write outside the machine (Approve on a layer, Post the plan), nothing of a stack is pushed, opened, posted or merged.

## Proof

- A1. `shared/test/review-stack-plan.test.ts` › "a plan puts lockfiles, generated files and moves first, then zones deepest first with their tests, every file once" and › "one zone and nothing mechanical is one layer, and a zone past 300 lines is a layer of its own"; check: the plan of the pictured review, rpsleague #183, read beside its files once the window has it.
- A2. `ui/test/review-stack-button.test.ts` › "the button ends the size row from the first paint, disabled until the review is ready, emphasized past 300 lines a reviewer reads, and absent once merged"; check: still renders of the header at 120 and at 1,586 lines, not ready and ready, light and dark, then the live window.
- A3. `ui/test/review-stack-button.test.ts` › "a press or ⇧S opens the plan with Build holding the keyboard, Escape closes it, and each case that cannot be done says why with no Build"
- A4. `hobkin/test/cli-work-stack.test.mjs` › "Build files one stack job for a head, a repeat joins it, work mode off hands it to the main agent, and the run's tree is never the project's folder"; `host/test/review-stack.test.ts` › "the host refuses a plan for a head that moved and starts one job for a head"
- A5. `hobkin/test/cli-work-stack.test.mjs` › "a stack run's layers are registered bottom first with their parent, kind, size and proof, and nothing is pushed"
- A6. `hobkin/test/cli-work-stack-check.test.mjs` › "a stack equals its change only when the top tree is the head's, each layer holds the one below and adds something, the bottom starts at the start and the original did not move" and › "a failed check names what failed and where, and a proof at another commit is no proof"
- A7. `host/test/review-stack.test.ts` › "a refactor layer whose review finds a change of behaviour is marked so"
- A8. `ui/test/review-stack-button.test.ts` › "the button's place reads the run, the stack, a failed check and a run with no stack, and the row does not move"; `hobkin/test/cli-work-stack.test.mjs` › "Try again sends the agent back with what failed, and Remove the stack drops its layers and branches and leaves the original"; check: still renders of the four states, light and dark.
- A9. `ui/test/review-stack-header.test.ts` › "a layer's place line names its place in the stack, its neighbours are buttons that { and } reach, and Hide and Close do not move"; check: still renders of layer 1 of 2, 2 of 2 and 3 of 6.
- A10. `ui/test/work-stack.test.ts` › "a stack sits under its original's line bottom first, only the bottom offers Merge, and another author's stack is only in AI Reviews"; check: a still render of the Work page with a stack of two and one of five, and of AI Reviews with both.
- A11. `hobkin/test/cli-work-stack-landing.test.mjs` › "the original merges whole only while its stack equals it and nothing landed or moved, then its layers close" and › "the top layer's landing closes the original, and a pull request that merged or closed on GitHub closes its layers"
- A12. `hobkin/test/cli-work-yolo-pass.test.mjs` › "YOLO mode merges no layer of a stack"; `hobkin/test/cli-work-patterns.test.mjs` › "a layer's offer counts its own lines and is never vetoed for what lies below it"
- A13. `host/test/review-publish.test.ts` › "Approve on a layer opens its PR into the layer below, names its place and the PR it builds on, and waits for the layer below"; `hobkin/test/cli-work-publish.test.mjs` › "a layer's PR goes into its parent's branch, names the parent's PR, and waits for the parent's PR"
- A14. `ui/test/review-stack-reading.test.ts` › "a layer of another author's pull request offers no Approve, merge or Remove and points to the original"; `host/test/review-stack.test.ts` › "a note on a layer goes with the original's verdict, on its line when the top layer has the same line" and › "the plan for the author is previewed and posted once, only with its confirmation"
- A15. `host/test/review-stack.test.ts` › "a stack made, built, checked and reviewed sends nothing to GitHub and pushes nothing"

## Steps

S1 can be built at once, and it is the first thing to see: the button shows the plan for any review, and nothing is built. S2 needs 042 S1 and S2. S3 can be built beside S2. S4 needs S2 and S3. S5 needs S4 and 042 S7's review of a layer against its parent. S6 needs S5 and shares 042 S8's files. S7 needs 042 S4. S8 needs 042 S6. S9 needs S5. S10 is last. S5 and S6 wait for 3f44 to release `shared/commands/registry.ts` and `ui/src/features/work/AiReviews.tsx`, as Decisions says.

- [ ] S1 (A1, A2, A3). Shared and window: `stackPlan`, and the button with its box, from the review the window has, with sample reviews and no host. Build this stack is not offered yet, and the box says "hobkin cannot build a stack yet." Files: new `shared/review/stack-plan.ts`, `ui/src/features/review/panel/Header.tsx`, new `ui/src/features/review/panel/StackBox.tsx`, `ui/src/features/review/keys.ts`, `ui/src/features/review/Shortcuts.tsx`, `ui/src/app/key-list.ts`; tests new `shared/test/review-stack-plan.test.ts`, new `ui/test/review-stack-button.test.ts`.
- [ ] S2 (A4, A5). Runtime, unwired: the stack item (kind `stack`, `of`, `start`, `head`, `plan`, `layers`, `check`, and `stackedAs` on the original), `hobkin work stack <slug> <item or pull> --plan <file>`, `adoptBranch` taking a `parent` that must be the layer below in the same stack, and hobkin's fields dropped from what a run pipes. Files: `hobkin/src/cli/work/store.mjs`, `hobkin/src/cli/work/adopt.mjs`, `hobkin/src/cli/work/commands.mjs`, new `hobkin/src/cli/work/stack.mjs`; tests new `hobkin/test/cli-work-stack.test.mjs`.
- [ ] S3 (A6). Runtime, unwired: the check in code, and `hobkin work stack check`. Files: new `hobkin/src/cli/work/stack-check.mjs`, `hobkin/src/cli/work/commands.mjs`; tests new `hobkin/test/cli-work-stack-check.test.mjs`.
- [ ] S4 (A4, A5, A6, A8). Runtime, the live path: `stackChange` in `controls.mjs` (to the front of the queue, to the main agent while work mode waits, one job for a head, Try again and Remove the stack), the director starting a stack job in a tree at the start, the pull request's head fetched into `refs/hobkin/stack/<id>/head`, the prompt `work-stack.md`, and the check at the run's end and on each survey. Files: `hobkin/src/cli/work/controls.mjs`, `hobkin/src/cli/work/director.mjs`, `hobkin/src/cli/work/unmerged.mjs`, new `hobkin/src/prompts/work-stack.md`; tests `hobkin/test/cli-work-stack.test.mjs`, `hobkin/test/cli-work-director.test.mjs`.
- [ ] S5 (A4, A7, A15). Host and protocol: `review.stack` (the host's own plan compared with the window's, the head unchanged, a Work project, the facts written by `handoff.ts`), the stack on `ReviewStatus` and `FinishedChange`, each layer's kind checked against its review, and the layers' reviews in the repository's line. Files: `shared/commands/registry.ts`, `shared/protocol/work.ts`, `shared/review/status.ts`, new `host/src/review/handoff.ts`, `host/src/review/reviews.ts`, `host/src/work.ts`; tests new `host/test/review-stack.test.ts`.
- [ ] S6 (A8, A9, A10). Window: Build this stack, the button's states, a layer's place line with `{` and `}`, and the stack on the Work page and in AI Reviews. Files: `ui/src/features/review/panel/Header.tsx`, `ui/src/features/review/panel/StackBox.tsx`, `ui/src/features/review/keys.ts`, `ui/src/features/work/finished-cards.ts`, `ui/src/features/work/Finished.tsx`, `ui/src/features/work/ai-reviews.ts`, `ui/src/features/work/AiReviews.tsx`; tests `ui/test/review-stack-button.test.ts`, new `ui/test/review-stack-header.test.ts`, `ui/test/work-stack.test.ts`.
- [ ] S7 (A11, A12). Runtime: the original and its stack (merged whole while equal, refused after, closed with the top, a pull request's merge or close closing its layers), the gap `reading`, and YOLO mode passing over layers. Files: `hobkin/src/cli/work/reads.mjs`, `hobkin/src/cli/work/controls.mjs`, `hobkin/src/cli/work/yolo-pass.mjs`, `hobkin/src/cli/work/after-merge.mjs`; tests new `hobkin/test/cli-work-stack-landing.test.mjs`, `hobkin/test/cli-work-yolo-pass.test.mjs`.
- [ ] S8 (A13). Host and runtime: Approve on a layer, into the layer below. The host's publisher takes the layer's base instead of the default branch (`host/src/review/publish.ts:57`), and the description names the layer's place and the PR it builds on. Files: `host/src/review/publish.ts`, `host/src/review/reviews.ts`, `hobkin/src/cli/work/controls.mjs`; tests `host/test/review-publish.test.ts`, `hobkin/test/cli-work-publish.test.mjs`.
- [ ] S9 (A14). Host and window: another author's pull request. Layers for reading, notes carried to the original's verdict, and Post the plan with its preview and confirmation. Files: `host/src/review/reviews.ts`, `ui/src/features/review/verdict.ts`, `ui/src/features/review/panel/Actions.tsx`, `ui/src/features/review/panel/StackBox.tsx`; tests `host/test/review-stack.test.ts`, new `ui/test/review-stack-reading.test.ts`.
- [ ] S10 (A4, A5, A6, A13). With the user's go-ahead, one live stack in a project the user names, since it spends a run: from a finished change of hobkin's own of more than 300 lines, read layer by layer in the window. Approve the bottom layer only if the user says so, since that pushes and opens a PR as the user.

## Open questions

- The plan. (a) Drafted in code from the review and approved before any branch, as decided: free and at once, but a cut by files and zones that the agent then corrects. (b) An agent plans first, the user approves, then an agent builds: a better first plan, at the cost of a second run and minutes before the user sees anything. (c) No plan, straight to building: one run, but the user sees the split only after paying for it, and may not want it.
- Another author's pull request. (a) Local layers for reading, and the plan posted for the author on a press, as decided: nothing written without the user, and the author keeps their PR, at the cost that #183 stays one big PR unless its author splits it. (b) Also open the stack as PRs of the user's, each saying it is built from #183 by its author: several PRs at once, as the user asked, at the cost that the user owns another person's work on GitHub, the review splits across two places, and it needs push access and the author's agreement. (c) Local only, with no plan to post: nothing written to GitHub at all, and the author never hears why.
- YOLO mode and layers. (a) It merges no layer until the user says, as decided: nothing new merges by itself. (b) The bottom layer of hobkin's own change merges by itself under every rule YOLO mode has, with its own size: small layers land without the user, at the cost that part of a feature can land alone because each part passed on its own.
- The user's own pull request once its stack is open. (a) It stays open until the user removes it, as decided: one more press for the user. (b) The press that opens the bottom layer's PR also closes it, with a comment linking the stack: one press, at the cost of a GitHub write folded into another.
- The original after a stack exists. (a) It can still merge whole while the stack equals it, as decided: the user is never held to the stack. (b) Once a stack exists the original lands only as its stack: one way to land, at the cost of a review the user may already have finished.
- 042's own open questions stay open and weigh more here, since a stack made from a big change has more layers: merging a stack with one yes, a restack in code or as a run, a declined layer, and drafts above the bottom.

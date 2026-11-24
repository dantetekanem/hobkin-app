---
{
  "id": "060-make-it-a-stack",
  "title": "Make it a stack: an agent splits a change that is too big",
  "kind": "work",
  "status": "doing",
  "depends": ["024-github", "032-change-review", "034-durable-hobkins", "058-review-turns-and-ratings"],
  "updated": "2026-11-24"
}
---
# Make it a stack: an agent splits a change that is too big

## Outcome

"Make it a stack" starts an agent on the max tier and hands it a prompt: split this change into a stack of small changes that land in order. The agent reads the change itself, decides the layers, and builds each one as a branch on the one below, in a tree of its own. It is a hobkin the user can watch and talk to, on its own page. The button is on the review's panel and on every row of the AI Reviews list, so a stack can be asked for without opening the review. Rebuild, for a review that is of an older commit, is on the row too.

The user, 2026-11-24, with a picture of Change Review on `rpsleague #183` (another author's pull request, 32 files, +1273 −313): "this PR looks good, but is too big, we need to have stacking in mind. this can be easily several PRs which a much easier progression. and hobkin needs to understand and support stacking as well. design this, and I want a button in there 'Make it a stack'". Then, the same day, on the first build, which drew a plan of layers worked out in code: "having an AI to spawn is always the solution, we dont need to hardcode the fucking stack, just pass a prompt to a max agent", "i dont want the stack option to be only in the ai review window", and of the Outdated notice, "this rebuild is also stupid to have to be inside the review window only".

The user again, with a picture of Work listing the five layers an agent had made of #183 as five unrelated cards, each with its own Merge it: "we should know how to render a stack. or this must be pushed first?"

## Decisions

- hobkin's code plans nothing. The first build's plan in code (`stackPlan`, its box and its rules) is removed. The agent decides how many layers there are, where the seams are and how big each is.
- The agent is a durable hobkin (`034-durable-hobkins`) started on the max tier in the change's repository, with the stack prompt as its first message and "Stack: <the change's title>" as its name. The user sees it in the agents list, opens its page, and can tell it to do the split another way.
- The prompt is a file, `host/src/review/stack.md`, filled with the change's facts: its title, its repository and folder, the pull request's number, address and author when it is one, whether it is the user's own, the commit it starts from and its head, and its branch. The review's own findings are not needed, so a review of an older commit can still be made into a stack: the agent reads the change as it is now.
- What the prompt asks for: layers that each stand alone and pass the project's tests on top of the one below; renames, moves, lockfiles and generated code before changes of behaviour; a refactor never in the same layer as a change of behaviour; each layer small enough to review at a sitting; and the top layer equal to the original change, which the agent proves with an empty `git diff` against the original head.
- What the prompt forbids without the user's word, said to the agent in the conversation: pushing, opening or changing a pull request, commenting on GitHub, merging, and touching the original branch or the user's own working folder. The agent works in a git worktree it makes for itself.
- For hobkin's own change and the user's own pull request, the agent registers each layer's branch with `hobkin work item`, so Work lists the layers as finished changes and reads them as a stack the way it already reads branches built on each other.
- For another author's pull request, the layers are local branches for reading, and the agent writes the split as a comment the user can post for the author. It posts nothing itself.
- One agent for one change at a time. A second press while that agent is still there opens it and starts nothing.
- The button is on every review of a change that has not merged: at the end of the panel's size row, and among a row's actions in the AI Reviews list. Past 300 changed lines it is drawn in the attention color of the Outdated notice, with the same words and width. It never takes the risk badge's colors.
- A press starts the agent and opens its page. Shift+S in the review puts the keyboard on the button, and Enter presses it, so no single key spends a max run.
- A row whose review is of an older commit offers Rebuild on the row, in the words the review's own notice uses, and it does what that notice's button does.
- `review.stack` takes a review and answers with the agent it started, or the one already there. Only the window sends it.

### A stack once it exists

- hobkin reads a stack from the branches themselves: finished branches built one on the other. Nothing has to be pushed and no pull request has to exist. The survey already finds which finished branch holds which.
- A stack lands bottom first. Before this, a branch under another said "it lands with the branch above it", and a yes on the top brought everything under it at once, which is the big change again. Now the bottom layer is the one that can merge, and a merge of it brings that layer alone. A layer with one under it that has not landed waits, says which layer lands first, and is refused a merge, a publish and an offer in those words. YOLO mode still merges no layer that has one under it.
- A merge is a merge commit or a fast forward, never a squash, so the layers above need no moving after the one under them lands: what they hold beyond the default branch is then their own change.
- Each finished change in a stack carries its place: the stack, its layer counted from the bottom, how many have not landed, the layer under it and the commit that layer is at, and what the stack is of when its maker said. The stack agent says it when it registers a layer (`stack` beside `branch` on `hobkin work item`).
- A layer's review shows that layer alone: it starts at the commit the layer under it is at, not at the default branch.
- On the Work page a stack is one group. Its heading is one quiet line, "Stack of 5", with what it is of when known. Its layers are in order, bottom first, each "1 of 5". The bottom layer is a whole card with its yes. The layers above are one line each, with their title and their review's state, and open to the whole card on a press. None of them offers Merge until the one under it has landed.
- A change that is in no stack is drawn as before.

## Out of scope

- A plan made or checked by hobkin's code.
- Records of a stack in hobkin's own store (parent, base, landing bottom first, restack). Those are `042-stacked-work`, still a draft.
- Rebuilding a review of an older commit by itself.
- A new name for the AI Reviews list.

## Acceptance

- A1. `review.stack` starts one durable hobkin on the max tier in the change's repository, named for the change, with the stack prompt holding the change's facts. A second ask while that hobkin is there starts nothing and answers with it. A merged change, and a review whose repository has no folder on this machine, are refused in plain words. hobkin's own client tool cannot run it.
- A2. The prompt says what a stack is, what proves the top equals the change, and what the agent never does without the user's word, and it differs for hobkin's own change, the user's own pull request and another author's.
- A3. The button is at the end of the panel's size row on every review of a change that has not merged, plain under 300 changed lines and in the attention color past that, the same width either way. A press starts the agent and opens its page. Shift+S puts the keyboard on it.
- A4. Every row of the AI Reviews list whose change has not merged offers Make it a stack, and a row whose review is of an older commit offers Rebuild. No control of a row moves when either is pressed.
- A5. Nothing in the window or the host works out layers: no plan is drawn.
- A6. Finished branches built one on the other are a stack in work status: each carries its stack, its layer from the bottom, how many have not landed, the layer under it with its commit, and the stack's name when one was given. A branch with nothing under or over it carries none.
- A7. The bottom layer merges alone. A layer over one that has not landed is refused a merge, a publish and an offer, naming the layer that lands first. Once the bottom lands, the next is the bottom and what it brings is its own change.
- A8. A layer's review starts at the commit the layer under it is at, so it shows that layer alone. The bottom's starts where it did.
- A9. Work draws a stack as one group under one quiet line, its layers bottom first with "1 of N", the bottom a whole card and the others one line each that open on a press, with no Merge above the bottom. A stack of two reads the same. A change in no stack is drawn as before.

## Proof

- A1. `host/test/review-stack.test.ts` › "it starts one agent in the repository folder with the change title and the prompt", › "a long title is cut to the title limit", › "a second ask while the agent is there starts nothing, and a new one starts after it ends", › "two asks at once start one agent", › "a merged change and a repository with no folder are refused in plain words" and › "only the window sends it: hobkin's own client tool neither lists nor runs it"
- A2. `host/test/review-stack.test.ts` › "the prompt carries the change facts, with no place left unfilled, for each kind of change"; check: the prompt read whole, `host/src/review/stack.md`.
- A3. `ui/test/review-stack-button.test.ts` › "the button is there on every change that has not merged, plain up to 300 changed lines and emphasized past them, and never about risk", › "a press asks the host once with the review, a second press while it is on its way does nothing, and the answer opens the hobkin page", › "an agent that was already there is opened the same, and a refusal stays as one line until the next press", › "with no host a press says a sample review starts nothing, and asks nobody" and › "Shift+S in the review puts the keyboard on the button, and S alone still hides the panel"; check (2026-11-24, still renders): the header with the plain button, the emphasized one in the dark theme, and a refusal in one line under the size row.
- A4. `ui/test/work-ai-reviews-again.test.ts` › "a row names its build button by its state: Rebuild for a review of an older commit, Review now for one waiting its turn, Review again for the rest"; check (2026-11-24, still renders): a row of a current review and a row of an older commit in the dark theme, each with Make it a stack beside Remove, and the smallest list of one row.
- A5. check: nothing in `ui/`, `shared/` or `host/` names `stackPlan` or the plan's box (`rg "stack-plan|StackBox|stackPlan"` finds none).

## Steps

- [x] S1 (A1, A2). Host: `review.stack` and the prompt. d8666ce, 62475d3. Tested with fakes: no real agent was started, and the reader of a review's facts was never run on a live review.
- [x] S2 (A3, A5). Window: the button starts the agent, and the plan in code is removed. 4cb85cb, 149c749. The review's key listener is registered once, so the app's window needs one Command+R before Shift+S works.
- [x] S3 (A4). Window: Make it a stack and Rebuild on the rows of the AI Reviews list. 19e0e4d. Rebuild takes the place of Review again on a row of an older commit and calls what the review's own notice calls.
- [x] S4. In the app's window, on a real pull request: one press, the agent's page, and what the agent built. The user, 2026-11-24, on rpsleague #183: the agent made five layers and registered them, and Work listed them as five unrelated cards.
- [ ] S5 (A6, A7). Runtime: a stack read from the branches, its place on each finished row, bottom first, and the stack's name on `hobkin work item`.
- [ ] S6 (A8). Host: the place passed to the window, and a layer's review started at the layer under it.
- [ ] S7 (A9). Window: the stack as one group on Work.

## Open questions

- Other places that list a change, such as Work's finished cards and the GitHub screen's rows, do not have the button yet.
- A row of the AI Reviews list does not know whether its change has merged, so it always offers the button, and the host refuses a merged change in a line.
- The host keeps which agent it started for which review in its memory. After a restart of the host, a second press starts a second agent even if the first is still there.
- hobkin still reads a stack only after it exists, from branches built on each other. Landing bottom first and moving the layers above after a fix are `042-stacked-work`.

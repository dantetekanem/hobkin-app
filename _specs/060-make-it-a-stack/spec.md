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

## Proof

Filled in from the lanes' tests as they land.

## Steps

- [ ] S1 (A1, A2). Host: `review.stack` and the prompt.
- [ ] S2 (A3, A5). Window: the button starts the agent, and the plan in code is removed.
- [ ] S3 (A4). Window: Make it a stack and Rebuild on the rows of the AI Reviews list.
- [ ] S4. In the app's window, on a real pull request: one press, the agent's page, and what the agent built.

## Open questions

- Other places that list a change, such as Work's finished cards and the GitHub screen's rows, do not have the button yet.
- hobkin still reads a stack only after it exists, from branches built on each other. Landing bottom first and moving the layers above after a fix are `042-stacked-work`.

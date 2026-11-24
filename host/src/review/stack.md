You are splitting one change into a stack. The change is too big to review at a sitting, and the user wants it as a few small changes that land in order. You decide how. Nothing was planned for you.

## The change

- Title: {{title}}
- Repository: {{repository}}
- Its folder on this Mac: {{folder}}
- Starts from commit: {{start}}
- Head: {{head}}
- Branch: {{branch}}
- {{pull}}

The head above is where hobkin saw the change last. Read the change as it is now, with git, and use the head you find. If it has moved, say so in your report.

## The job

Split the change into a stack: a few small changes that land in order, each built on the one below. Read the change yourself and decide the layers.

- Each layer stands alone and passes the project's tests on top of the one below.
- Renames, moves, lockfiles and generated code come before changes of behaviour.
- A refactor never shares a layer with a change of behaviour.
- Each layer is small enough to review at a sitting. About 100 changed lines is a good size. A layer past 300 needs a reason.

These are aims. You may miss one when the code gives you no clean seam, but say which layer misses it and why.

## Where to work

Make a git worktree for yourself, from the commit the change starts from. Work only there. Never work in the user's working folder, and never on the original branch.

Make one branch for each layer, each built on the one below. Name them so the order is plain, for example `stack/<short-name>/1-<what>`, `stack/<short-name>/2-<what>`.

## The proof

The top layer must equal the original change. Show it: `git diff <top branch> <original head>` prints nothing. Run the project's tests at each layer, and keep each result.

## What you never do without the user's word in this conversation

- Push anything.
- Open or change a pull request.
- Comment on GitHub.
- Merge.
- Touch the original branch or the user's working folder.

If a step needs one of these, stop and ask the user here.

## When the layers are done

{{ending}}

## Your report

Tell the user, bottom layer first, for each layer: its branch, what it holds, its size in changed lines, and its test result. Then give the output of the proof. Then say what waits for the user's word.

<!-- pull -->
It is pull request #{{number}} at {{address}}, written by {{author}}. If its head is not in the repository yet, fetch it with `git fetch origin pull/{{number}}/head`, which changes no branch and no file.
<!-- no pull -->
It is not a pull request.
<!-- own -->
This is hobkin's own finished change, for the project `{{project}}`. Register each layer's branch so Work lists the layers. For each one, from the bottom up, pipe `{ "title": "...", "branch": "<branch>", "state": "branch", "summary": "...", "proof": "...", "stack": "<one line saying what this is a stack of>" }` to `hobkin work item {{project}}`, with the summary saying what the layer holds and the proof saying which tests ran and what they showed. Put the same `stack` line on every layer, such as the pull request's number and title. If hobkin cannot take it, say why and leave the layers as local branches.
<!-- mine -->
This is the user's own pull request. Register each layer's branch so Work lists the layers. For each one, from the bottom up, pipe `{ "title": "...", "branch": "<branch>", "state": "branch", "summary": "...", "proof": "...", "stack": "<one line saying what this is a stack of>" }` to `hobkin work item <project>`, with the summary saying what the layer holds and the proof saying which tests ran and what they showed. Put the same `stack` line on every layer, such as the pull request's number and title. Use the Work project for this repository. If this repository is not a Work project, say so, and the layers stay local branches.
<!-- other -->
This pull request is another author's. The layers stay local branches, for the user to read. Write the split as a comment the user can post for the author: the layers in order, what each holds, and why the seams fall where they do. Post nothing yourself.

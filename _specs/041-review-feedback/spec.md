---
{
  "id": "041-review-feedback",
  "title": "Review feedback on PRs hobkin opened",
  "kind": "work",
  "status": "draft",
  "depends": ["011-work", "024-github", "032-change-review", "045-dev-system"],
  "updated": "2026-11-14"
}
---
# Review feedback on PRs hobkin opened

## Outcome

When someone reviews a pull request hobkin opened, hobkin reads the unresolved threads and the review comments. For feedback from people with write access it starts a review round: an agent sorts each comment as blocking, non-blocking or a question, fixes in code what it should, asks when a comment is unclear, gives a reason when it disagrees, runs the checks again, and drafts one reply per thread. The user sees the drafts in the change's review, where they already confirm verdicts, edits or drops any, and confirms. hobkin then pushes the fix and posts the replies on GitHub as the user. A new comment or a new review starts the next round. When the same kind of comment keeps coming back across PRs, hobkin files a deterministic check (a lint rule, a test or a type) as its own item.

## Decisions

### What hobkin reads today, and what changes

- The survey lists each project's PRs with `gh pr list --json` and keeps only `reviewDecision` of the review (`src/cli/work/unmerged.mjs:19`, `:84`). No thread or comment is read.
- A PR gets a `pr-fix` item only for a conflict or failing CI (`src/cli/work/unmerged.mjs:432-446`). Its run makes the branch "ready to merge, not to add anything" (`src/prompts/work-do.md:77-86`).
- The loop that works is local: the user's Change Review comments become one note (`shared/review/verdict.ts:122`), sent with `workAction('ask')` (`host/src/review/reviews.ts:1164`, `host/src/work.ts:391`), which sets `workNote` (`src/cli/work/controls.mjs:762`), and the next run does what it says (`src/prompts/work-do.md:32`). That loop stays as it is.

### Which PRs and which comments

- A PR hobkin opened is an open PR on a `hobkin/` branch whose item waits on its merge, as the survey already reads it (`src/cli/work/unmerged.mjs:52`, `:302`).
- For each one, the survey makes one read-only call, `gh api graphql`, for: `reviewDecision`; the first 100 `reviewThreads`, each with `id`, `isResolved`, `isOutdated`, `path`, `line`, `startLine`, `diffSide`, `viewerCanReply` and its first 50 comments (`id`, author login and type, `body`, `createdAt`, `url`); and the last 50 reviews (`id`, `state`, author, `body`, `submittedAt`). These are GitHub's documented fields (https://docs.github.com/en/graphql/reference/pulls). A PR with more threads than that says so on its card. The survey still never writes to a repository or to GitHub (`src/cli/work/unmerged.mjs:500`).
- Feedback is an unresolved thread whose last comment is not hobkin's, and a review with words in its body (`CHANGES_REQUESTED` or `COMMENTED`) that no round has answered. An outdated thread that is still unresolved counts: the run checks whether the new code already answers it.
- A resolved thread is done. Comments in the PR's conversation, outside any review, are not feedback (see Open questions).
- A comment in hobkin's exact envelope (`agentMessage`, `shared/agent-message.ts:62`) is hobkin's own and is never feedback. Change Review posts the user's own words exactly as they wrote them, with no marker (since 2026-11-19, `048-work-mac-fixes` entries 31 and 41), so such a comment reads and counts as any other comment of the user's.
- Hidden characters and HTML comments are taken out of every comment before it reaches a request, as GitHub does for its own agent (https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations).

### Who can start a round

- Only people with write access. hobkin asks `GET /repos/{owner}/{repo}/collaborators/{username}/permission`, and `admin` or `write` counts (https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user). The answer is kept for a day for each login and repository in `work/<slug>/reviewers.json` in hobkin's home. When GitHub cannot answer, the person counts as having no write access, and the card says hobkin could not check.
- This is the rule GitHub's coding agent follows: "Only users with write access to the repository can trigger" it, and "Comments from users without write access are never presented to the agent" (same page as above).
- The user counts, since hobkin opens PRs with the user's own gh login.
- A comment from someone without write access never reaches a request. The change's review lists it as "Not acted on: no write access to this repository". The user can take it up by writing their own comment on the change, which is today's ask.
- A bot is an author of type `Bot`, or a login that ends in `[bot]`. A bot's comment never starts a round and never reaches a request. The review lists it as from a bot. Failing CI is already the `ci` work (`src/cli/work/unmerged.mjs:440-445`).

### When a round starts

- `pr-fix` is widened, not joined by a new kind: `shipWork` gains `need: 'review'`. A round is filed, ranked and run as the other `pr-fix` work is, ahead of new work (`src/cli/work/store.mjs:569`), and it belongs to the item that made the branch (`ships`).
- Order on one branch: a conflict first, with its rebase item, as now. Then review feedback, whose round also takes in failing CI on that branch, since its push runs CI again. Then failing CI alone.
- Key: `ship:review:<branch>:<hash of the feedback's comment ids>`. A repeat survey files nothing, and new feedback is new work. A round is not held to once a day (`src/cli/work/unmerged.mjs:451`), since each one answers new words from a person.
- No round is filed for a branch while one runs, or while a round's drafts wait for the user. Feedback whose newest comment is less than 10 minutes old waits for the next survey, which comes every 30 minutes (`src/cli/work/director.mjs:49`), so a reviewer still writing can finish.
- A thread that has been through 3 rounds and is still unresolved starts no fourth. The card says that thread needs the user.
- Rounds are off until the user's go-ahead, since each one spends the subscription and ends in posts on GitHub. Work mode gains `reviewRounds`, off on every home. `hobkin work rounds on` turns it on, and main hobkin runs that only on the user's word, as it does `hobkin work reviews on` today (`src/cli/work/commands.mjs:319-326`). While it is off the survey reads no threads and files no round.

### What the round's run does

- `work-do.md` gets a section for a `pr-fix` item with `need: 'review'`, beside today's (`src/prompts/work-do.md:77-86`). The run follows the coding flow `045-dev-system` sets, plan on the item first. The request carries each piece of feedback: the thread's id, path and lines, whether it is outdated, the whole thread, who wrote it and the review's state.
- The request fits the run's prompt limit. A prompt over `promptByteLimit()`, 256 KiB unless `HOBKIN_MAX_PROMPT_BYTES` says otherwise (`src/cli/prompt-bounds.mjs:2`, `:6-14`), is refused before Pi starts (`src/cli/harnesses.mjs:40`, `:47`). The project's notes and its directions are already cut at 16 KiB each (`src/cli/work/director.mjs:51`, `:67`). The feedback in one request is at most 96 KiB: a comment's body is cut at 8 KiB with its link, threads go in newest first, and a thread that does not fit waits for the next round, named in the request with its link. Its comments then count toward the next round's set, not this one's.
- It sorts each one as blocking, non-blocking or a question, as Conventional Comments defines them: a blocking comment "should prevent the subject under review from being accepted, until it is resolved", and a non-blocking one should not (https://conventionalcomments.org). A label or decoration the reviewer wrote is taken as written. Otherwise the run sorts it and says why in one line. When it cannot tell, it counts as blocking.
- Blocking: fixed in code on the branch, with a proof that fails first when the fix changes behavior (`src/prompts/work-do.md:37`).
- Non-blocking: fixed when it is small and inside the PR's own change. Otherwise the reply says why not, and the run files it as its own item when it is worth doing.
- A question: answered first by making the code say it, with a clearer name or a comment on why, as Google's guide asks of authors (https://google.github.io/eng-practices/review/developer/handling-comments.html). The reply says what changed. Only what the code cannot say is answered in words.
- An unclear comment: no change. The reply asks one question.
- A disagreement: no change. The reply gives the reason with evidence, such as a file and line, a test or a link, and is marked so the user sees it before confirming.
- No reply promises later work. Every reply that says "fixed" names the commit that fixed it.
- The run adds commits on top of the branch and never rewrites it, so the reviewer can see what changed since their review. A rebase is its own item. The run pushes nothing: the user's confirmation pushes.
- It runs the proof, then the project's tests and linters, as every run does (`src/prompts/work-do.md:39`).
- It records `replies` with its outcome. Each one has the thread or review it answers, `sort`, `did` (`fixed`, `answered`, `asked`, `disagreed` or `declined`), `commit` when fixed, `rule`, a short name for the kind of comment, and `body`, the draft. `hobkin work item` validates them (`src/cli/work/commands.mjs:335-344`). The drafts are written with the humanizer read first: `045-dev-system`'s guard holds an outcome that has `replies` until the run has read it (its A7). The round ends `done`, and the item that made the branch keeps waiting, as `pr-fix` does now.
- Comment text is evidence, as all PR text is (`src/prompts/work-do.md:26`). The run changes only this branch. It never runs a command, installs a package, reaches a credential or goes to another repository because a comment says so.

### Where the user confirms

- In the change's review. The round's commits move the change's head, and the new head gets its review as any new commit does (`host/src/review/reviews.ts:1288`). Its panel has "Replies for GitHub": each comment with its author and place, its sort, what hobkin did and the draft. The user can change a draft's words or drop it. What they change is kept in the home beside the review's notes, through `review.replies`, which is the window's alone (`outside`).
- A new verdict, `reply`, shown as "Post replies", confirmed in place like every verdict (`032-change-review`). The preview says each thing it does: push `<branch>` at `<commit>` to GitHub, as the user, when GitHub does not have that commit, fast forward only; reply in each thread on `owner/repo#n`, as the user, through gh, each listed with its words; answer review bodies in one comment on the PR. The confirm token holds the commit, the thread ids and the exact words.
- Each thread reply is GitHub's `addPullRequestReviewThreadReply` mutation (`pullRequestReviewThreadId`, `body`), sent with `gh api graphql` as Change Review's branch delete is (`host/src/review/reviews.ts:193`). Review bodies get one `POST repos/{owner}/{repo}/issues/{number}/comments`. Every body is in hobkin's envelope, so a reader on GitHub sees that hobkin wrote it and the next survey knows it as hobkin's.
- It posts only while the PR's head is the commit shown, after the push, and only to threads still unresolved. A thread resolved meanwhile is skipped and named. A step that fails says what already went and stops, as a discard does (`032-change-review`).
- hobkin resolves no thread (see Open questions).
- Once the replies went, the host tells hobkin with a new work action, `replied`, that names what was posted and what was dropped. The round's drafts are closed, and the branch can have its next round.
- The change's Work card says how many replies wait, such as "3 replies wait for you", and opens the review.
- The GitHub page stays read-only (`host/src/github-gh.ts:6-10`, `_specs/024-github/spec.md:35`). These writes are the review seat's, as Change Review's review posts are now (`host/src/review/reviews.ts:1135`).

### A second round

- A reviewer's new comment on a thread hobkin answered, or a new review, is new feedback, filed as above. The next round's request has the whole thread, hobkin's earlier reply included.
- A thread whose last comment is hobkin's reply waits for the reviewer. It starts nothing.

### The PR's description

- Today Approve on a finished change opens its PR through the client's own publisher with the review's summary as the body (`host/src/review/reviews.ts:1157-1158`, `:1269`), not the description its run wrote to `prFile` (`src/prompts/work-do.md:56`). The item also never learns its PR: cards read `item.pr` (`host/src/work-items.ts:174`, `:200`), and nothing records it. hobkin's own `publishItem` does both: it opens the PR with the description and records `state: 'pr'` with its address (`src/cli/work/controls.mjs:550-602`).
- 041 fixes this, because a review round needs the item to know its PR, and reviewers read the body first. Approve on a finished change calls hobkin's `publish` work action, pinned to the reviewed commit. The preview shows the description's title and first paragraph, read from the item's `prFile`. How the description is written stays with `045-dev-system`.

### A comment that keeps coming back

- When the same `rule` shows up in 3 comments across at least 2 PRs of one project within 90 days, hobkin files one `improvement` item with key `check:<rule>`. Its brief quotes the comments with their links and says the first change is a deterministic check that fails on the code the reviewers flagged: a lint rule in the project's own linter, a test, or a type.
- It is never a new line in the project's `AGENTS.md`, hobkin's directions or the project's notes. The idea comes from a talk the user shared.
- A round's request lists the `rule` names the project already has, so the run reuses one when it fits. The key makes filing twice safe.

## Out of scope

- PRs hobkin did not open. Change Review's own review of other people's PRs stays as it is.
- Resolving threads, until the user decides.
- Conversation comments as feedback, and comments from bots, until the user decides.
- Patterns across projects.
- GitHub Enterprise and hosts other than github.com.

## Acceptance

- A1. For each open PR on a hobkin branch whose item waits on its merge, the survey reads its unresolved threads with their comments, and its reviews, in one read-only gh call. A PR with no feedback files nothing. A read that fails keeps the last answer and files nothing.
- A2. Only feedback from people with write access starts a round. Comments from people without write access, from bots, and hobkin's own replies never start one and never reach a request. The review lists the first two as not acted on, with the reason.
- A3. Feedback files one round for each branch and set of comments: a repeat survey files nothing, new feedback files a new round once the last round's drafts are answered, nothing is filed while a round runs or waits, a conflict gets its rebase first, and a thread after 3 unresolved rounds starts no more while the card says it needs the user.
- A4. A round's run sorts each piece of feedback as blocking, non-blocking or a question, fixes blocking ones in new commits on top of the branch, asks one question for an unclear comment, gives a reason with evidence when it disagrees, runs the proof and the project's tests, and pushes nothing. It records one draft per thread, and a draft that says "fixed" names a commit on the branch, or the outcome is refused.
- A5. The drafts show in the change's review with each comment, its author and place, its sort and what hobkin did. The user can change a draft's words or drop it, and the changes hold after a restart. The change's Work card says how many replies wait and opens the review.
- A6. "Post replies" shows what it will do and does it only on the second click: it pushes the fix when GitHub lacks it, fast forward only, then posts each kept reply in its thread as the user, in hobkin's envelope, and resolves no thread. A PR that moved since is refused. A push GitHub refuses stops before any reply. A thread resolved meanwhile is skipped and named. A step that fails says what already went.
- A7. After the replies went, the next survey counts those threads as answered. A reviewer's new comment there, or a new review, starts the next round, and its request carries the whole thread.
- A8. Approve on a finished change opens its PR with the description its run wrote and records the PR on the item, so its card offers to merge that PR.
- A9. When the same kind of comment shows up 3 times over 2 PRs of a project within 90 days, one improvement item is filed whose brief quotes the comments and asks for a lint rule, test or type. Filing again adds nothing.
- A10. Hidden characters and HTML comments in a comment never reach a run's request.
- A11. A round's feedback takes at most 96 KiB of its request, so the request stays inside the prompt limit. A comment longer than 8 KiB is cut with its link, and a thread that does not fit waits for the next round, which the request names.
- A12. With `reviewRounds` off, which it is on every home until the user turns it on, the survey reads no review threads and files no round.

## Proof

- A1. `hobkin/test/cli-work-review-threads.test.mjs` › "the survey reads each waiting hobkin PR's threads and reviews in one read-only call" and › "a failed read keeps the last answer and files nothing"
- A2. `hobkin/test/cli-work-review-threads.test.mjs` › "only write access starts a round, and others, bots and hobkin's own replies are listed and never sent"
- A3. `hobkin/test/cli-work-ship.test.mjs` › "review feedback files one round per set of comments, after a conflict's rebase, never beside a round that runs or waits" and › "a thread after three unresolved rounds starts no more"
- A4. `hobkin/test/cli-work-commands.test.mjs` › "a round's replies are validated, and a fixed reply must name a commit on the branch"; check: in the live round (S8), the run's commits sit on top of the branch, nothing was pushed before the confirmation, and each draft's sort and action match its comment.
- A5. `host/test/review-replies.test.ts` › "changed and dropped drafts are kept in the home and come back after a restart"; `ui/test/review-replies.test.ts` › "each draft shows its comment, author, place, sort and what hobkin did, and can be changed or dropped"; check: a still render (server markup with the app's built CSS, no browser) of a review with three drafts and one comment not acted on, dark and light.
- A6. `host/test/review-verdict.test.ts` › "posting replies pushes the fix fast forward, then replies in each thread as the user, only after the yes, and resolves nothing" and › "a moved PR is refused, a refused push sends no reply, and a thread resolved meanwhile is skipped"
- A7. `hobkin/test/cli-work-review-threads.test.mjs` › "a thread hobkin answered waits for the reviewer, and their next comment is a new round with the whole thread"
- A8. `host/test/review-verdict.test.ts` › "approving a finished change opens its PR through hobkin with its run's description, and the item records it"
- A9. `hobkin/test/cli-work-review-checks.test.mjs` › "the same kind of comment three times over two PRs files one check item, once"
- A10. `hobkin/test/cli-work-review-threads.test.mjs` › "hidden characters and HTML comments never reach the request"
- A11. `hobkin/test/cli-work-review-threads.test.mjs` › "a round's feedback fits its share of the prompt limit, and a thread that does not fit waits for the next round, named"
- A12. `hobkin/test/cli-work-ship.test.mjs` › "with review rounds off the survey reads no threads and files no round"

## Steps

S1, S2, S3 and S6 can be built at once. S4 comes after S1, S2 and S3. S5 comes after S3. S7 comes after S5. S8 is last.

- [ ] S1 (A1, A2, A7, A10, A11). Runtime: reading feedback, as a module nothing calls yet. The GraphQL read for one PR, the write access check with its day of memory, bots and hobkin's own envelope told apart, text cleaned, the feedback cut to its 96 KiB, and the feedback set with its hash. Files: new `hobkin/src/cli/work/review-threads.mjs`; tests new `hobkin/test/cli-work-review-threads.test.mjs`, with a fake gh.
- [ ] S2 (A9). Runtime: counting `rule` names over a project's rounds and filing the check item, as a module nothing calls yet. Files: new `hobkin/src/cli/work/review-checks.mjs`; tests new `hobkin/test/cli-work-review-checks.test.mjs`.
- [ ] S3 (A4, A7). Runtime: `replies` in a run's outcome, validated by `hobkin work item`, and the `replied` work action that closes a round's drafts. Files: `hobkin/src/cli/work/commands.mjs`, `hobkin/src/cli/work/controls.mjs`, `hobkin/src/cli/application.mjs`; tests `hobkin/test/cli-work-commands.test.mjs`, `hobkin/test/cli-work-control.test.mjs`.
- [ ] S4 (A1, A2, A3, A4, A7, A9, A12). Runtime: the live path, switched off. `reviewRounds` in work mode, off, and `hobkin work rounds on|off`; while it is off nothing below runs, and the user's go-ahead turns it on. `shipWork` gains `need: 'review'` in its order, the survey reads each waiting PR with S1, rounds are filed and held as decided, S2 runs after each round, the request carries the feedback and the project's `rule` names, and `work-do.md` gets the review section. Files: `hobkin/src/cli/work/unmerged.mjs`, `hobkin/src/cli/work/director.mjs`, `hobkin/src/cli/work/commands.mjs`, `hobkin/src/cli/work/store.mjs`, `hobkin/src/prompts/work-do.md`; tests `hobkin/test/cli-work-ship.test.mjs`.
- [ ] S5 (A5, A6). Host: the drafts on a change's review, `review.replies` to keep the user's changes, and the `reply` verdict's preview and posts, pinned to the commit shown, ending with `replied`. Files: `shared/review/verdict.ts`, `shared/commands/registry.ts`, `host/src/review/reviews.ts`, `host/src/review/store.ts`, `host/src/host.ts`; tests new `host/test/review-replies.test.ts`, `host/test/review-verdict.test.ts`.
- [ ] S6 (A8). Host: Approve on a finished change goes through hobkin's `publish` work action, and its preview reads the description from `prFile`. `host/src/review/publish.ts` and `host/test/review-publish.test.ts` go once nothing uses them. Files: `host/src/review/reviews.ts`, `host/src/review/seat.ts`; tests `host/test/review-verdict.test.ts`.
- [ ] S7 (A5). UI: "Replies for GitHub" in the review panel, "Post replies" among the verdicts, and the line on the change's Work card. Files: new `ui/src/features/review/panel/Replies.tsx`, `ui/src/features/review/verdict.ts`, `ui/src/features/review/panel/Actions.tsx`, `ui/src/features/work/finished-cards.ts`; tests new `ui/test/review-replies.test.ts`.
- [ ] S8 (A4, A6, A7). With the user's go-ahead, `reviewRounds` on, then one live round on a PR made for the check, in a project the user names, since it spends the subscription and posts on GitHub as the user: one blocking comment, one non-blocking, one question, then a second comment on one thread for the next round.

## Open questions

- Resolving threads. (a) hobkin never resolves one, and the reviewer does: nothing to build, and the reviewer keeps the last word. (b) The confirmation also resolves each thread hobkin fixed in code, with `resolveReviewThread` (`threadId`): one more call per thread, and a reviewer who wanted to check the fix has to reopen it. (c) A switch on each draft, off by default: (b) on the user's word, at the cost of one control per draft.
- Bots. (a) A bot's comment never starts a round: review bots that find real problems wait for the user to copy them. (b) The user names, for each project, the bots that count as reviewers: a list kept with the project's directions, and that bot's words reach a request as evidence like a person's.
- Comments in the PR's conversation. (a) Not feedback: a reviewer who writes there and not in a review is missed. (b) Feedback when the author has write access, answered in one comment on the PR: more rounds started by "thanks" or "when does this ship", unless the run may end a round with no change and no reply.
- When the fix is pushed. (a) On the user's confirmation, with the replies: reviewers see the code and the answers together, and the PR waits until the user confirms. (b) By the run, as a rebase item pushes now, when the project's PR mode is not off: reviewers see the fix sooner, without its replies, and a fix the user would not have sent is already on GitHub.

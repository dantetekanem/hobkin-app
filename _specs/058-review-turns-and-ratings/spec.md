---
{
  "id": "058-review-turns-and-ratings",
  "title": "Change review: a line for each repository, what a review costs, and the user's ratings in every review",
  "kind": "work",
  "status": "doing",
  "depends": ["032-change-review", "049-yolo-mode", "053-work-control-room", "055-review-origins-tests-zones"],
  "updated": "2026-11-23"
}
---
# Change review: a line for each repository, what a review costs, and the user's ratings in every review

## Outcome

For one repository the reviews that exist are few, current and worth what they cost, and nothing is paid for twice without a reason. Every AI review, of a finished change or of a pull request, opens with the user's own questions answered: five ratings with their evidence, the general rate and what is still missing.

The user, 2026-11-23: "outdate reviews are becoming a problem. we should not accumulate too many reviews in the same repo, otherwise this will be useless expensive". And: "i also dont see the damn ratings in a PR for yolo mode", "each AI review should present my needs".

## Decisions

- An audit on 2026-11-23 found the causes. They are in `notes.md` beside this spec, by file and line.
- Every finished change of every project was reviewed as soon as it finished, with no limit for a repository or for a day: twenty finished changes of one repository started twenty reviews within a second. A review was built again by itself each time its branch moved, and when hobkin rebased the branches of a repository every one of them was built again. A rebuild reused nothing. Nothing recorded what a review cost. Reviews of every commit were kept for ever, and the list never said which were outdated.
- Ratings existed only where hobkin's own scored run had made them: with scoring turned on, or with YOLO mode on and the project ready. A pull request never had any, and a change that finished as a pull request was never scored by itself. What the scored run said was still missing, and the commit it rated, never reached the window.

### The line

- Each repository keeps at most three reviews current. The line is the order Work lands changes in, with P0 work always taken. What the user asks for (Review now, Review again, opening a change that has no review) is always built and pushes nothing out of the line.
- A change is not in the line while it conflicts, is being brought up to date, or is back at work: each says why, and a review waiting to be built for a change sent back to work is dropped. A change that has waited 48 hours is taken next, so none waits for ever.
- Every other change says how many are ahead of it, "Waits its turn: 3 ahead", with Review now.

### Outdated reviews

- A review whose change moved is built again by itself only while the change is in the line. Any other is marked outdated, says for which commit it was built, and waits its turn. After a merge only the next change in the line is built.
- A review is carried, not built again, when only the base moved: the change's commits are the same ones on a newer start, no file the review read changed in between, and the scan finds the same callers of each changed definition. The review is copied to the new commit, says it was carried and from where, and only the change's tests are run there. No model is called. If those tests fail, or any of the three conditions does not hold, it is built in its turn.
- Commits that touch only specs or Markdown carry the review the same way.
- Review again or Rebuild with nothing changed since the review says so first, and that it costs a whole review, and does it on a second press.
- A change of the engine or the host makes no review outdated.

### What a review costs

- Each model call's tokens are kept beside its review, and the numbers add them by day.
- The background builds at most twenty reviews a day across all repositories. At the limit, rows say so and when the next will be built. What the user asks for is still built.
- Both numbers, reviews kept current for a repository and background reviews a day, are set in the workload sheet and kept with hobkin's workload.
- Review tokens are shown beside hobkin's own. They are not counted in its daily allowance.

### Cleaning up

- For each change the newest two reviews are kept whole. Older ones keep their summary and their progress and lose the rest.
- A change that merged, was removed, or that hobkin closed leaves the list. Its heavy files go after thirty days. Notes, the record of what landed and the summaries stay.
- A review outdated and out of the line for fourteen days folds under "Outdated".
- A broken review tree goes after seven days.
- Remove stays the user's own delete.

### The list

- AI Reviews has one line for each repository above its rows: how many reviews are current, waiting and outdated, how many were built this week and about how many tokens they took. Rows that wait fold under "Waiting". Each says why it is not being built. A carried review says from which commit.

### The user's ratings

- Every AI review opens with "Your questions": do tests cover the change, were tests added or changed to prove it and what proof is missing, does it risk the deploy or data, would a regression show in the monitoring, and what is the risk and the time to roll back. Each is a whole number from 1 to 10 with one line of evidence. With them: the kind of change, the general rate and the floors by hobkin's own formula, what is still missing, the commit they were made at and who made them.
- They are the Reviewer's, from the one call the review already makes. No call is added. Code checks them as it checks the Reviewer's other claims and caps them by the facts the review measured: with no test that proves a changed definition, coverage is 3 at most; with no test added or changed, proof is 4 at most; with a part that can break, deploy and data is 5 at most; with nothing that undoes it, rollback is 4 at most; with no monitoring known on a path that writes data or runs at load, visibility is 4 at most. An answer without them leaves the review "not rated", never a guessed number.
- The project's monitoring and its way back, which hobkin's readiness record holds, are handed to the Reviewer as the model checks are. A repository hobkin knows nothing of has no visibility rating and no general rate, and the other four are shown.
- They show at the top of the review's panel, in its row of the AI Reviews list, and for each waiting change on the YOLO mode page with who rated it and at which commit. The scores hobkin's own scored run made stay where they are shown today, named as hobkin's.
- YOLO mode goes on reading hobkin's own scores for now. Whether the review's ratings replace them, so that one review is paid for and not two, is the user's call.

## Out of scope

- Reusing the Reviewer's words for one unit, or a test's result, across a rebuild.
- Posting ratings on GitHub. It sends something outside this machine, so it needs the user's word.
- YOLO mode reading the review's ratings.

## Acceptance

- A1. Of the finished changes of one repository only the first three in Work's order are built, with P0 always among them. The rest wait, each with how many are ahead, and after a merge only the next one is built.
- A2. A change that conflicts, is being brought up to date or is back at work is not built and says why, and a review waiting for a change sent back to work is dropped. A change that waited 48 hours is taken next.
- A3. Review now, Review again and opening a change with no review build it outside the line and stop none of those current.
- A4. A review whose change moved is built again by itself only in the line. Out of it, it is marked outdated with the commit it was built for.
- A5. A change rebased with the same commits onto a start that changed nothing the review read is carried: no model call, one run of its tests at the new commit, and the review says it was carried and from where. A changed file the review read, a new caller of a changed definition, or a failing test there builds it again in its turn. Commits of specs or Markdown alone carry it.
- A6. Review again with nothing changed says so, and builds only on a second press.
- A7. Each model call's tokens are kept beside its review, and the numbers add them by day.
- A8. At the day's number of background reviews the rest wait for midnight and say so, and what the user asks for is still built. The two numbers are kept with the workload, 3 and 20 unless set.
- A9. Older reviews of a change keep their summary and progress and lose the rest. A change hobkin closed leaves the list, and its heavy files go after thirty days with its notes kept. A broken review tree goes after seven days.
- A10. The AI Reviews list has a line for each repository with its counts and its week's cost, folds waiting rows, says why each waits, offers Review now, and says of a carried review where it was carried from.
- A11. The Reviewer's one answer carries the five ratings with their evidence, the kind and what is missing. A malformed one is dropped with why, and the review still finishes, not rated. The ratings are capped by the facts.
- A12. A review's status and its row carry its ratings, the commit they were made at, and the rate and floors by hobkin's formula. A pull request is rated the same way, with visibility and the general rate left out when no monitoring is known.
- A13. Every review opens with the five ratings, their evidence, the rate and what is missing, a pull request too. A row shows the five and the rate, and a waiting change on the YOLO mode page shows its rate, who rated it and at which commit.

## Proof

## Steps

- [ ] S1 (A1, A2, A3, A4). Host: the line for a repository.
- [ ] S2 (A5, A6). Host: carried reviews, and Review again with nothing changed.
- [ ] S3 (A7, A8). Host and runtime: what a review cost, the day's number, the workload's two settings.
- [ ] S4 (A9). Host: cleaning up.
- [ ] S5 (A10). Window: the list's line for a repository, waiting rows, carried reviews.
- [ ] S6 (A11). Engine: the ratings in the Reviewer's answer.
- [ ] S7 (A12). Host: the ratings on a review, and the project's monitoring to the Reviewer.
- [ ] S8 (A13). Window: "Your questions" in the review, the row and the YOLO mode page.

## Open questions

- Whether the review's ratings replace hobkin's scored run, so that YOLO mode reads them and one review is paid for. The audit's default is to run both for two weeks on ready projects, with YOLO mode merging only when both pass, then to replace.
- Three reviews current for a repository, twenty background reviews a day, 48 hours before a waiting change is taken, two reviews kept whole, thirty and fourteen days: defaults the user has not confirmed.
- A change that is not in the line gets no review, and so no agent is sent back to it when it would have been risky. It waits its turn instead.

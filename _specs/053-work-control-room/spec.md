---
{
  "id": "053-work-control-room",
  "title": "Work as a control room: numbers, a project page, a trail, a workload, and approval at a glance",
  "kind": "work",
  "status": "doing",
  "depends": ["032-change-review", "049-yolo-mode", "050-tla-proofs", "052-ten-times-lighter"],
  "updated": "2026-11-21"
}
---
# Work as a control room: numbers, a project page, a trail, a workload, and approval at a glance

## Outcome

Work, YOLO mode, World and a new page for each project show what work mode did and is doing in numbers and charts: what waits for the user, what merged and who merged it, how often a change is approved the first time, how much merges by itself, how the AI reviews answer. Every page says where the user is and how they got there, and Escape goes back one place to the row they left. The user sets how much automated work runs, and the page says what holds it and until when. An AI review starts by itself and starts again when it was cut short. A change of 200 files opens on the few parts that need a person, with the rest folded and still reachable, and a TLA+ check or TLAPS proof opens beside the review with one key. Whatever can be clicked shows it.

## Decisions

Findings, sources and page sketches are in `notes.md` beside this file. The sketches are the layout to build.

The trail
- Every page has a trail in the frame, above its content: the places the user came through to get here, oldest first. Each earlier place is a button. The last is where the user is, and is plain text.
- The trail is one return stack in `useView`, in place of `reviewReturn`, `agentReturn` and `proofReturn`. Opening a contextual page (World, YOLO mode, a project, an agent, a review, a proof, a report or action item reached from one of them) puts the place left on the stack. Going to a place already on the trail goes back to it. Opening a menu page from the menu, Command with a number or the spotlight starts a new trail.
- A place holds the page, what it is about (a project, an agent, a review, a proof run), Work's tab, the item in focus and the scroll position. Going back restores all of it.
- Escape goes back one place. Command+Left and Command+Right keep walking the 50-step history as they do.
- The trail holds at most 6 places. The oldest leave first.

A page for each project
- `project` is a contextual page under Work, for one project by its slug. It is opened from Work's project row, a World island, a YOLO card's name, Home's project tile and the spotlight.
- It shows, in this order: the project's name with its priority, pull request mode and YOLO readiness, and its Pause and Priority controls; the same six tiles as Work, for this project; the flow from queued to merged; what waits for the user; its agents at work; its queue; what merged lately, each row saying whether it merged by itself or on the user's yes; its models; its YOLO readiness parts.
- It shows nothing Work does not know. A project work mode has not taken says so and offers to take it.

Numbers
- `work.metrics` is a read-only host command. It answers with `WorkMetrics` (`shared/protocol/metrics.ts`): one `MetricsDay` for each local day of the period, for all projects and for each, and three spans. The period is 30 days unless asked, and 180 at most.
- The numbers are folded from records that exist already (`notes.md`, "Records the numbers can be folded from"), so the first read shows history. A source that cannot be read is named in `gaps` and the rest still counts.
- hobkin folds its own records in a new module and the host adds what only it keeps (the AI reviews). Neither reads the other's files.
- Two records are added so the numbers stay right from now on: a stop from the window (`work_stopped`), and the item on each line of `tokens.jsonl`. Stops have no history before 2026-11-21.
- Merges, declines and send-backs are read from each item's own record (`landed.route`, the declined state, its pushbacks), which covers a yes given in chat or on another machine. A missing file is not a gap: nothing was written yet. A pull request's AI review counts in the total for all projects only.
- A change counts as merged by itself when its route is `yolo`, and by the user for every other route. First pass means merged or declined without `done_sent_back` before it.
- A rate with nothing under it reads "no data yet", never 0% or 100% (`ratesOf`).
- The window reads the numbers when Work, YOLO mode, World or a project opens, and again at most once a minute while one of them shows. The host keeps the last fold for a minute.
- Charts are the app's own SVG and HTML, as Home's week bars are: no chart library. A chart is drawn again only when its numbers change, and has no endless motion. Every chart and tile has a sentence saying what it counts, and is a button that opens the list of what it counts.

Work
- The header keeps its title, switches and counts. Under it sit six tiles: Waiting for you, Merged today, First pass, By itself, AI reviews, Tokens today. Each has its figure, a line of context and a 30-day sparkline.
- One line under the tiles says what work mode does next, or the one thing holding it, until when, and the control that changes it. It replaces the "Next 8h" forecast line and the `held` line.
- A third tab, Numbers, holds the charts and the table of projects. It is not mounted while another tab shows.
- A finished change's card and a project's row are buttons: a click does what Enter does. A queue row is a button that selects it. No row changes on hover without doing something on a click.

YOLO mode
- Under the switchboard: the share merged by itself, how many of those regressed after their deploy, and how many changes were held for the user, over 30 days.
- A funnel says how many finished changes passed each gate over 30 days, from finished to merged by itself.
- One chart of merges by itself for each day, over all projects.
- A project card's name opens the project. A row of Next to merge opens its review, and its model opens the proof.

World
- An island opens the project's page. Its card on hover and focus shows the project's figures and an "Open project" button.

Workload
- A sheet over Work, opened by a button beside the status line and by W, sets how much automated work runs:
  - agents at once (as today);
  - whether work mode picks work by itself (`autoPick`);
  - changes a day: a cap on work runs started in a local day, or no cap;
  - tokens a day: any whole number of millions from 1 up, not only 10 to 200;
  - hours: always, or a window of local time outside which nothing new starts;
  - ship first: the number of finished changes waiting at which new work is held, and whether the rule is on;
  - whether hobkin scores finished changes by itself (`reviewOnFinish`);
  - which pull requests get an AI review by themselves: mine, those waiting for my review, or none.
- Each is kept in `<home>/work/mode.json` beside the settings there now, set through one host command, `work.workload`, and enforced in `planOf` with the forecast agreeing.
- The sheet ends with the forecast for the settings as they stand: about how many changes start today, and when the next one starts.
- When today's tokens are spent, the status line offers "Add today's amount again", which answers the runtime's allowance request.
- The defaults are today's behavior: no cap on changes, always, ship first on at 8, pull requests not reviewed by themselves. Nothing changes for a home that sets nothing.

AI reviews start by themselves
- A review of a finished change that was cut short (it has progress and no answer, and nothing is running it) is started again by the background, once for each commit.
- The background asks git where each finished change's branch is, at most once a minute for each, and reviews a branch that moved even while its card still names the older commit.
- A finished change whose review has not started shows in AI Reviews as waiting its turn. It is not hidden.
- A pull request is reviewed by itself when the workload says so for its kind. Drafts are left out, and so is a pull request a finished change opened.
- A run that fails writes its reason (`failed.json`), so a run with progress and neither an answer nor a reason is one that was cut short. Starting it again is recorded (`restarted.json`), which is what keeps it to once for a commit. A stop the user asked for is a failure and is not started again.

The review of a large change
- A node needs the reviewer when it is high or critical, has a finding that breaks or fails a test, a dangling reference or a broken model, has an open question, is changed code of mid or high level with no test, is where the blind check disagreed, is a failed test, or is an acceptance line with a warning. It is worth a look when it is mid, unverified, of low confidence, judged from the diff alone, a test that did not run, an unproven acceptance line, or code the engine did not rate. The rest is safe. Rank goes by tier, then the weight of its reasons, then the size of its change (`shared/review/attention.ts`).
- The host puts on each node of a review what the engine found: `attention`, with a `tier` (`needs-you`, `worth-a-look` or `safe`), a `rank` within the review, and up to three `reasons` in plain words; and a `bucket` (`code`, `test`, `generated`, `lockfile`, `locale`, `moved`, `format`, `docs`). Both are optional, so an older review opens as it does today.
- Which files get full detail is chosen by what matters (code and tests first, then by size of change), not by their order. The limit of 60 files and 4,000 lines stays.
- The graph opens in Focus: every node that needs the reviewer and every one worth a look is a card. Safe nodes fold into group cards by bucket, and safe code by its top folder. A group card says what it holds, how many and how many lines, and why it is safe.
- Enter on a group opens it in place: its members become cards, up to the budget, and the outline lists all of them. S on a group marks every member seen.
- At most 60 cards and 120 wires are mounted for any review. A test counts them on a review of 200 files. React Flow draws only what is in view. Above 40 cards the entrance fades in and draws no wire.
- The outline is a list at the left, opened and closed with L: every unit and file under Needs you, Worth a look and Safe, in rank order, with its lines and its seen mark. Typing filters it. Enter moves the graph to the row. Its rows are drawn only while in view.
- A node is seen when its step was visited, its code was opened, or S marked it. Marks are kept for each commit, and a mark goes when the node's code changes.
- N goes to the next node that needs the reviewer and is not seen, and Shift+N to the one before.
- The panel leads with the evidence for the verdict: tests, the AI review's answer, models and proofs, and how many of the nodes that need the reviewer are seen. Approving stays two presses. With unseen nodes that need the reviewer, the first press says how many.
- A move writes nothing to localStorage by itself: the review's memory is saved at most once a second, and when the review closes. `focusLevels` runs once for a move.
- A review keeps its place. Coming back from a proof, the code or another page returns to the same step, camera, mode and history.

Proofs
- No one approves a proof. Its result is evidence for the change, shown where the change is approved.
- T in a review opens the proof beside it, in a panel at the right, and T or Escape closes it. The review stays mounted and keeps its place. The same panel opens from a finished change's proof chip on Work and from a model on YOLO mode and a project's page. Shift+T, or the panel's expand button, opens the full page.
- On a panel or page 1,100 pixels wide or more, the check and the proof show together: the trace or state graph at the left, the math and the proof tree at the right. Narrower, they stay tabs.
- J and K go to the next and previous model of the change, and the heading says "Model 2 of 5".
- F and Shift+F go to the next and previous thing that failed: a broken rule's trace step, or a proof step that failed, is missing or was omitted. The heading counts them.
- 1, 2 and 3 show Run, State graph and Math. / focuses the search. R runs it again. These keys act while the proof has the keyboard; T and Escape act from the review too.
- The tab, the picked state, the graph's view and search, and the math step are kept for each run while the app is open.
- "Proof fails" opens the proof tree at the first step that failed. A run that does not count as evidence says so.
- The state graph, each math block and each proof step are stops on the Up and Down walk.
- The look stays: the same cards, tones, fixed heights, step bar, inspector and math type.
- A run's object keeps its identity while nothing in it changed.

What can be clicked shows it
- Everything that acts on a click has the pointer cursor, a hover layer and the focus ring. One rule in `globals.css` covers buttons, links, summaries and `[role="button"]`; one utility, `pressable`, gives a row or card its hover and pressed layer.
- A row or card that opens something shows an arrow at its end on hover and on focus. The arrow's place is always kept, so nothing moves.
- Nothing that does not act changes on hover.

Kept from before
- Spec 052's rules hold: nothing is redone while its inputs are the same, endless motion moves only transform and opacity of HTML boxes, what cannot be seen is not mounted, and budgets are tests that count.
- Every protocol field added here is optional. A window with an older host shows the page without what the host does not send.
- Sample data covers every new page, so each shows without a host.

## Out of scope

- hobkin reading Change Review's answers for its land offers and YOLO mode (spec 045, S13 and S14).
- Cost in dollars. The numbers are in tokens.
- A chart library.
- Changing YOLO mode's gates, or what a proof must show.
- Numbers for more than one person.

## Acceptance

- A1. Every page shows a trail whose last place is the page itself. After Work, YOLO mode, a project, its review and a proof, the trail names all five, and a click on "YOLO mode" returns there.
- A2. Escape from a page opened from Work's AI Reviews tab returns to that tab, with the same row in focus and the same scroll position.
- A3. Opening a page from the menu starts a new trail, and a trail never holds more than 6 places.
- A4. A project's page opens from Work's project row, a World island, a YOLO card and the spotlight, and shows that project's tiles, flow, waiting changes, agents, queue, merges, models and readiness. A project with nothing yet says so in each section.
- A5. `work.metrics` answers with one day for each day of the period, zeros included, for all projects and for each. A record that cannot be read is named in `gaps` and the rest still counts.
- A6. A change merged by YOLO mode counts as merged by itself and any other as merged by the user. A change merged after being sent back is not first pass.
- A7. A rate with nothing under it reads "no data yet".
- A8. Work shows the six tiles with their sparklines, and a click on a tile opens Numbers at what it counts.
- A9. Numbers shows the charts of the sketch for 7, 30 and 90 days and the table of projects, and a row opens the project.
- A10. The line under Work's tiles names the one thing that holds work mode, until when, and offers the control that changes it: the day's tokens, the hours, the cap on changes, ship first, auto-pick off, a usage limit. While nothing holds it, it says when the next change starts.
- A11. The workload sheet sets each of its eight settings, the setting is still there after a restart, and the forecast under it changes with it.
- A12. With a cap of 3 changes a day, a fourth run does not start that day and starts the next. With hours of 09:00 to 18:00, nothing new starts at 20:00 and running agents finish.
- A13. With ship first off, new work starts while 8 finished changes wait.
- A14. A home that set none of the new settings starts work exactly as before.
- A15. A finished change's review that was cut short starts again by itself, once for its commit.
- A16. A finished change whose branch moved is reviewed at the new commit by itself within a minute of the host publishing, while its card still names the older commit.
- A17. A finished change whose review has not started shows in AI Reviews as waiting its turn.
- A18. With "my pull requests" on, a pull request of the user's gets an AI review with no click. With it off, none starts.
- A19. A review of 200 files and 10,000 changed lines opens with at most 60 cards and 120 wires mounted, every node that needs the reviewer among them.
- A20. Safe nodes show as groups that name their kind, count and lines. Enter opens a group, and S marks its members seen.
- A21. The outline lists every unit and file of the review in rank order under its three headings, filters as the user types, and Enter moves the graph to the row.
- A22. A node visited in the story, opened as code or marked with S is seen. Its mark goes when a newer commit changes its code, and stays when it does not.
- A23. N goes to the next unseen node that needs the reviewer and says so when none is left.
- A24. The panel shows tests, the AI answer, models and proofs, and the seen count above the verdict. Approving with unseen nodes that need the reviewer says how many on the first press and approves on the second.
- A25. Moving through 50 steps of a review writes to localStorage at most once a second.
- A26. Leaving a review for a proof or another page and coming back returns to the same step and mode.
- A27. T in a review opens the proof beside it and T or Escape closes it, with the review at the same step underneath.
- A28. At 1,100 pixels or more the trace and the proof tree show together. Narrower, they are tabs.
- A29. J and K move through the change's models and the heading says which of how many. F moves through what failed and the heading counts it.
- A30. A run opened again shows the tab, state and math step it was left at.
- A31. "Proof fails" opens the proof tree at the first failed step.
- A32. Up and Down reach the state graph, the math blocks and the proof steps.
- A33. Buttons, links and rows that act show the pointer cursor and a hover layer, a row that opens something shows its arrow on hover and focus without moving anything, and nothing that does not act changes on hover.
- A34. The motion check passes, and no chart or tile has an endless animation.
- A35. Every new page and panel shows with sample data and no host.

## Proof

Each lane names its tests here as it writes them. Until then an id below is unproven.

- A1. unproven
- A2. unproven
- A3. unproven
- A4. unproven
- A5. In hobkin, `test/cli-work-metrics.test.mjs` › "work.metrics has one day for each local day of the period, zeros included, for all projects and for each" and › "a line or a file that cannot be read is named in gaps, and the rest still counts"; here, `host/test/metrics.test.ts` › "work.metrics adds the AI reviews the host keeps to hobkin fold: each answer on its day, one that stopped before it, and how long they took"
- A6. In hobkin, `test/cli-work-metrics.test.mjs` › "a change merged by YOLO mode counts as merged by itself and any other as merged by the user, and one merged after being sent back is not first pass"
- A7. `shared/test/metrics-rates.test.ts` › "a rate with nothing under it is null, never 0 or 100 percent of nothing"
- A8. unproven
- A9. unproven
- A10. unproven
- A11. unproven
- A12. unproven
- A13. unproven
- A14. unproven
- A15. `host/test/review-starts-by-itself.test.ts` › "a finished change's review that was cut short starts again by itself, once for its commit"
- A16. `host/test/review-starts-by-itself.test.ts` › "a finished change whose branch moved is reviewed at the new commit by itself within a minute, while its card still names the older one"
- A17. `host/test/review-starts-by-itself.test.ts` › "a finished change whose review has not started is listed as waiting its turn, and one the user removed is not"; `ui/test/work-ai-reviews.test.ts` › "a finished change whose review has not started shows as waiting its turn, after those under way; a stopped one that waits for nothing stays out"
- A18. `host/test/review-starts-by-itself.test.ts` › "with "my pull requests" on, a pull request of the user’s gets an AI review with no click; with it off, none starts"
- A19. unproven
- A20. unproven
- A21. unproven
- A22. unproven
- A23. unproven
- A24. unproven
- A25. unproven
- A26. unproven
- A27. unproven
- A28. unproven
- A29. unproven
- A30. unproven
- A31. unproven
- A32. unproven
- A33. unproven
- A34. `scripts/perf/motion.ts`
- A35. unproven

## Steps

- [x] S1 (A7). The numbers contract: `shared/protocol/metrics.ts` and its rates.
- [x] S2 (A5, A6). hobkin folds its records by day, records a stop from the window and the item on each token line; the host adds the AI reviews and answers `work.metrics`.
- [ ] S3 (A1, A2, A3). The trail: one return stack, places that restore, the trail in the frame, Escape.
- [ ] S4 (A33). The pointer and hover rule, `pressable`, the arrow on rows that open, and no hover on what does not act.
- [x] S5 (A19, A20, A22). The host lays attention and buckets on a review's nodes, and detail goes to what matters.
- [ ] S6 (A15, A16, A17, A18). AI reviews start by themselves: cut short, a moved branch, waiting rows, pull requests by the workload.
- [ ] S7 (A19, A20, A21, A22, A23, A25, A26). The review window: Focus, groups, the outline, seen marks, next unseen, the budget, saved at most once a second, its place kept.
- [ ] S8 (A28, A29, A30, A31, A32). Proofs: check and proof together, the keys, positions, kept state, stops, a panel that can sit in another page.
- [ ] S9 (A11, A12, A13, A14). The workload in hobkin and the host: the settings, `planOf`, the forecast, `work.workload`, the allowance answer.
- [ ] S10 (A8, A9, A10, A11). Work: tiles, the status line, Numbers, the workload sheet, rows that are buttons.
- [ ] S11 (A4). The project's page, and World and YOLO mode opening it.
- [ ] S12 (A8, A9). YOLO mode's trust figures, funnel and chart, and World's card.
- [ ] S13 (A24, A27). The proof beside the review and the evidence above the verdict.
- [ ] S14 (A34, A35). Sample data for every new page, still renders in light and dark, the motion check.

## Open questions

- In an open review, the panel's Remove is still the no that closes the pull request, while a row's Remove now only takes the review out of the list. Either the panel's is renamed "Close pull request", or it becomes the row's Remove and closing is left to Remove and delete branch. Not decided; the panel is unchanged until it is.
- Pull requests reviewed by themselves default to off, since each review spends tokens. Turning "mine" on by default would cost a review for each pull request the user opens by hand.
- A change merged with the user's yes in chat counts as merged by the user. If chat merges after a long talk should not count as first pass, that needs a verdict record.

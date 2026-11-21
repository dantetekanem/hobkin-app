---
{
  "id": "011-work",
  "title": "Work mode on the canvas",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "017-model-tiers"],
  "updated": "2026-11-21"
}
---
# Work mode on the canvas

## Outcome

The Work screen shows one hobkin delegating to many. hobkin sits on the left of a live map, wired to every agent it started, and each agent shows what it is doing right now. Under the map are the queue, the projects and the finished changes. While agents run, they are also listed at the bottom of the chat, and each has a canvas of its own that shows how its work is going. Work mode keeps the rules it has in the terminal app.

## Decisions

- Work mode's data and rules are hobkin's (`src/cli/work/`). The screen renders hobkin's snapshot and calls its work actions. It adds no rules of its own.
- The delegation map uses the same node and wire language as Change Review. hobkin is one node. Each running agent is a node with a small hood in its own hue, its project, its task, its tier and what it is doing. A wire pulses when an agent reports back. A finished agent slides into the finished column.
- Running agents are listed at the bottom of the chat, under the input, and only while something runs. The list is navigated as pi-extended-teams' activity card is: Down from an empty input enters it. Down and Up move, and the canvas shows the selected agent at once. Enter opens that agent with the keyboard in its input, `i` interrupts the tool command the agent is running, `x` stops the agent, and Escape returns to the input and puts the canvas back as it was.
- An agent's canvas always has an input at its bottom, which is how the user talks to it. What the user sends goes to that agent while it works, as steering, the way hobkin's `message_check` does. Escape in the input goes back onto the same agent in the list. (The user, 2026-11-12: this replaces stepping in, where the canvas grew over the chat and the input rose only after Enter.)
- A new agent pops into the list from below like a bubble rising, and the rows above make room. While an agent works its hood moves. The screen menu's item for an open agent carries the agent's name. A row shows the agent's title, project, what it is doing, its tier, and the elapsed time.
- An agent's canvas is a rendered view of how the work is going, not a raw log: the mission (goal, question, expected result), the steps taken so far as a short path, the tool calls and their output as they happen from hobkin's job activity, and what it changed. The Agent item appears in the screen menu while one is open.
- In the client, agents run without Herdr panes, as Pi child processes the host owns. Where hobkin needs a pane today, it gets a path without one on the `client-host` branch. Herdr is not supported: the host removes every `HERDR_*` variable before hobkin opens, for every home, the real one included, so neither hobkin nor anything it starts finds a pane. Work agents as background Pi jobs through hobkin's job runner, with no pane at all, are the hobkin lane's change on its branch.
- The queue shows hobkin's offered rows with their grade and reason. A row can be started, skipped or moved to the front. hobkin has one key that both starts a row and puts it first (`run`, Enter in the terminal): the screen calls it Run next, and Enter on the row presses it. Skip and Put back are its `s`.
- Projects show priority and the pull request setting, both changeable.
- The projects list lives in the Work screen, not in the chat: every project work mode knows, with its state. The ones taken come first, by priority, then hobkin's proposals in the order its look ranked them, then the ones left alone. A proposal is taken or skipped as y and n answer it in the terminal, and a project left alone can be taken again.
- How many work agents may run at once is set on the Work screen, from one to hobkin's most. hobkin's work actions have no key for it, so the host calls the function `hobkin work agents` uses (`setAgents`), and the file changes as the terminal changes it.
- The first-run setup hands work mode the projects folder and the projects picked there (`setup.work`, `025-onboarding`). hobkin's work actions have no key for these either, so the host calls hobkin's own functions: `setFolder`, which saves the folder only while work mode is off and never turns it on, `hobkin work add project` for a project taken, and `proposeProject` for one only offered, while work mode runs and picks by itself. A project work mode already knows is left as it is.
- Finished changes use hobkin's three groups: ready to merge, refresh then merge, needs you. A card says what the change is, its proof, its safety grade and what a yes will do. "Review" opens it in Change Review.
- Turning work mode on starts nothing by itself. This is hobkin's rule and it stays.
- The host reads work mode from hobkin's snapshot with hobkin's own functions (`approvalGroups`, `groupPlan`, `groupWords`, `landingWay`) and sends it whole as its own slice (`work` in `shared/protocol/work.ts`). The finished changes are the rows hobkin's Decisions lists for approval (`waiting.branches`, pull requests included), the most urgent first. A card's words and choices are those of hobkin's terminal card, which hobkin does not export, so the host writes them out as they are (`host/src/work.ts`).
- Every action is one of hobkin's own work actions (`workAction`), and a refusal comes back in hobkin's words. Opening a pull request never goes through hobkin's own browser opener: a card links to it, as the GitHub page does.
- Images pasted or dropped on an agent's input go with the words, as in the main input: the same tray, hobkin's limits on each message, and Backspace at the start takes the last one out. Each counts against that agent's message alone, and hobkin's own model need not see images. hobkin's runner hands them to the run with the words, to Pi as image content and to Claude Code as its own image blocks, and a note's receipt counts them.
- Words for a running agent go through hobkin's `message_check` (`runner.messageCheck`), which hands them to Pi as a steer. Routines take them today; work agents take them once hobkin opens an inbox for their runs (host/proposed-hobkin-changes/03). Stopping a work agent is hobkin's `k` (for now, or not approved); any other agent is cancelled with hobkin's `kill`.

## Out of scope

- Agents on other machines.
- New kinds of work items.

## Acceptance

- A1. With work mode on and two agents running, the map shows hobkin wired to two agent nodes. Each names its project, its item and what it is doing, and updates within 1 second of a change.
- A2. An agent that finishes leaves the running column, and a notice appears in the conversation, as in the terminal app.
- A3. Opening an agent from the list under the input, or from its node on the map, shows its canvas: mission, steps so far, and tool calls with their output, updating live. The canvas stays readable after the agent finishes.
- A4. The queue lists hobkin's offered rows in hobkin's order. Start, Skip and "Run next" each do what the terminal keys do.
- A5. Finished changes appear in hobkin's three groups, and each card shows the reason it is in its group.
- A6. "Merge it" on a card merges on this machine and pushes nothing. A change that cannot merge says why and stays.
- A7. A group's action (for example "Merge all 3") shows every title it will act on before it acts, then reports each result.
- A8. With work mode off, the screen says so and offers to turn it on. Turning it on starts no agent.
- A9. A project's priority and pull request setting can be changed, and the change is the one `hobkin work` reports afterwards.
- A10. An agent can be stopped from its node. Its run ends as hobkin records a stopped run.
- A11. Down in an empty input moves to the agents list and shows the first agent's canvas. Down and Up move the selection and the canvas follows. Enter opens the agent with the keyboard in its input. `i` interrupts the selected agent's running tool command without stopping the agent, and `x` stops the agent after a confirmation. Escape returns to the input, and the canvas returns to the screen it showed before the list was entered.
- A12. The list under the input shows exactly the agents and routines running now, and disappears when none is running.
- A13. A click on an agent shows its canvas to stay, as it is: the canvas does not grow over the chat and the keyboard stays where it was. Enter on it does the same and puts the keyboard in the agent's input. Escape there goes back onto the same agent in the list.
- A14. A message sent from that input reaches the agent while it works and appears in the agent's canvas. With the agent finished, the input says so and sends nothing.
- A15. A new agent pops into the list and the others make room. Each working agent's hood moves, in the list and on its canvas, and no two side by side move in step. The menu's item for an open agent shows the agent's name.
- A16. Each agent's small face shows what it is doing with hobkin's own moods (working, thinking, searching and the rest), in the list, in the menu and on its canvas.
- A17. An agent that waits for the user (a question, or help it asked for) wears a question mark on its face and nothing else marks its row. It comes first in the list, the row's second line says what it waits on, and the list's heading counts how many wait, with the key that goes to them (019 A16). Enter on it, or Cmd+G, opens its question in the question sheet with its choices; an answer given there, or later from Action Items, clears the question mark, and the agent's exchange keeps the answer in words under the question. Putting it off sends it to Action Items, and the agent keeps waiting. (Seen 2026-11-10: Cmd+G, 2, the heading went from 2 to 1 waiting and the keyboard returned to the message input.)
- A18. The input is always at the bottom of the agent's canvas, and the newest step rests just above it. The agent's canvas uses the canvas width less a tenth on each side.
- A19. While the user walks the agents list, each agent shows only its small screen: face, title, what it is on, and its question or its last message cut to two lines with the count of messages. Once there is an exchange to read, the header shrinks into a bar at the top in one movement and the exchange opens at its newest message. Only transforms and opacity move, and messages out of view are not drawn.
- A20. With no host the Work screen draws a sample in the shape the host sends, says it is sample data, and its actions answer the way hobkin would without reaching hobkin, a refused merge included. With a host it draws hobkin's own work mode, and when the host has none to show (a view the terminal saved), it says work mode is not known yet.
- A21. The Work screen works from the keyboard alone. Up and Down walk it. Enter opens or presses what has the keyboard: an agent's canvas, a queue row run next, a change opened in Change Review, a group's question. Left and Right move along a row to its own choices and back, and change a project's setting. Escape steps back from a choice to its row, and leaves a group's or a stop question without acting. When what had the keyboard leaves (a merged card, a skipped row), the keyboard stays on the screen.
- A22. While work mode is on the map keeps a place for every agent hobkin may run at once, free or taken. A pulse runs back along a wire to hobkin when its agent reports. Nodes, wires and hobkin move together on one spring, by transform alone. Under Still they are placed where they belong and only fade, and no pulse runs.
- A23. A finished change on GitHub links to its pull request, and shows where its review and checks stand once gh has read it.
- A24. The Work screen lists every project work mode knows with its state: taken, proposed, skipped or dropped, and paused. A proposal can be taken or skipped there, and a project left alone taken again, with hobkin's own answers.
- A25. How many work agents may run at once can be changed from the Work screen, from one to hobkin's most, and the change is the one `hobkin work` reports afterwards. A number out of range is refused and changes nothing.
- A26. No home sees a Herdr pane, the real one live included: hobkin and every process it starts find no `HERDR_*` variable. Every home but the real one, live, stays kept to itself through `HOBKIN_HOME`.
- A27. A finished card or queue row whose work was filed from a GitHub issue shows it as `#n`, linked to the issue. A queue row whose item has a pull request links to it as `PR #n`. Work filed by hand shows no issue.
- A28. A finished branch whose run left the user a note shows under "Left for you", right after "Needs you", with the note whole, Review, Ask for changes and Close without merging. Close without merging takes a second click within ten seconds and runs hobkin's own `done`: nothing merges and the branch stays. No merge is offered on the card, and Change Review does not prepare a review for it by itself.
- A29. What the user said yes to that an agent is still bringing up to date before it merges is listed under "You said yes, merging", with when they said yes, until it merges.
- A30. On the GitHub page, an issue's chip says what its work waits on and leads to where the user can act on it: "Read its note" opens its Left for you card, "Review its change" and "Approve its change" its finished card, "Merging after your yes" its row there, and "In queue" its queue row. A chip for work the Work screen shows nowhere is quiet and is not a button.
- A31. A finished change whose AI review says risky to deploy goes back into hobkin's queue by itself, ahead of new work as a note does, with hobkin's own note of what the review found (032 A37). The note is never the user's: it counts against no pattern, is not told as something the user did, and the agent reads it as findings that authorize nothing past the fix, leaving in `left` what only the user can do. While work mode is off or paused, everywhere or on the project, nothing is sent and nothing is handed to the main agent. A change still risky after two rounds waits in Action Items, once.
- A32. An image pasted or dropped on an agent's input shows in the same tray as the main input's, under hobkin's limits on each message, and Backspace at the start of the input takes the last one out. Sent with words or alone, it reaches the agent's turn with the message, on Pi and on Claude Code, and the note shows it and gets its receipt. With the agent finished, nothing is attached.

## Proof

- A1. `host/test/work.test.ts` › "running agents reach the state with what each is doing"
- A2. `host/test/work.test.ts` › "a finished run leaves running and files a notice"
- A3. `host/test/work.test.ts` › "job activity is forwarded and kept"
- A4. `host/test/work.test.ts` › "queue actions call hobkin's work actions"
- A5. `host/test/work.test.ts` › "finished changes keep hobkin's groups and reasons"
- A6. `host/test/work.test.ts` › "merge passes hobkin's refusal through"
- A7. `host/test/work.test.ts` › "a group action lists its targets before acting"
- A8. `host/test/work.test.ts` › "turning work mode on starts nothing"
- A9. `host/test/work.test.ts` › "project settings round trip"
- A10. `host/test/work.test.ts` › "stopping an agent ends its run as stopped"
- A11. `host/test/work.test.ts` › "interrupt cancels the running tool and keeps the agent, stop ends it"
- A12. `host/test/work.test.ts` › "the running list follows the runs"
- A13. check: Down, Enter, type, Escape, Escape. Watch the canvas, the chat and the input move.
- A14. `host/test/work.test.ts` › "a message to a running agent is delivered as steering, and refused once it finished"
- A15. check: raise Agents at once in Settings and watch the list. Open an agent and read the menu.
- A16. check: open agents with different moods in the list, the menu and the canvas.
- A17. `ui/test/asking.test.ts`; check: Cmd+G, answer, read the list and the canvas.
- A18. check: sample the agent's face every 50ms while pressing Enter on it, and look for any jump.
- A19. check (2026-11-09, Chrome): with a 40-message exchange on one agent, walking four agents ran at a median 8.3ms a frame and 9.4ms at worst, and no exchange was drawn while walking. Stepping in, the face rose from 149px to 116px in one movement, the exchange opened at its newest message, and the shrunken title ended 13px above it.
- A20. `ui/test/work.test.ts` › "the sample answers as hobkin would: a refused merge keeps its card, and a group says how each row went"
- A21. check (2026-11-10, Chrome, sample data, keyboard only): the walk went switch, two agent nodes, queue rows, project settings, the group's yes, cards. Right reached Run next and Skip and stopped at the end, Left came back, Escape returned to the row and stayed in the screen. Enter on a row ran it next, Skip sent it to the end and the queued count fell from 7 to 6, with the keyboard kept in place. Right and Left changed storefront's priority and where its work goes. Enter on "Merge all 3" put the keyboard on the question's own yes; Escape left with all 6 cards there; yes reported a line for each of the 3 and kept the refused one. Enter on a node opened its canvas, and Enter on a card opened Change Review.
- A22. check (2026-11-10, Chrome): a sample agent's pulse went from its node's pin (897, 425) to hobkin's (775, 390) in 1.15s, fading in and out. Under Still no pulse was drawn, the header only faded in (no transform), and a skipped row moved with no transform on any row.
- A23. check (2026-11-10, Chrome, sample data): the card for storefront #479 showed Approved and Checks pass from the sample GitHub, and its Open PR #479 links to the pull request.
- A24. `host/test/work.test.ts` › "projects show their state, and a proposal is answered as in the terminal"
- A25. `host/test/work.test.ts` › "agents at once round trip"
- A26. `host/test/herdr.test.ts` › "no home sees a Herdr pane, the real one live included"
- A27. `host/test/work-items.test.ts` › "a finished card and a queue row carry the GitHub issue their item was filed from, and one filed by hand carries none"; check: an issue-filed card shows `#n`, and the link opens GitHub.
- A28. `host/test/work-items.test.ts` › "a finished branch whose run left a note is a Left for you card: the note whole, Review and Close without merging, and no merge" and "Change Review prepares by itself only what waits in hobkin groups, and a Left for you card only once the user asks"; `ui/test/work-left.test.ts`; `ui/test/work-finished-cards.test.ts`; check: rpsleague #75, #68 and #80 show under Left for you, and Close without merging asks for its second click.
- A29. `host/test/work-items.test.ts` › "what the user said yes to that is still being brought up to date is listed until it merges"; check: after Refresh and merge, the change shows under You said yes, merging until it merges.
- A30. `ui/test/github-issue-work.test.ts`; check: on the GitHub page, rpsleague #75 reads Read its note and opens its card on the Work screen.
- A31. In hobkin, `test/cli-work-risk-fix.test.mjs` › "hobkin's AI review sends an agent back to its own risky change with the findings, in hobkin's words and first in the queue", › "no agent goes back to a branch that moved since its review, one an agent is already going back to, or one that is not finished", › "with work mode off or paused, everywhere or on the project, nothing is sent and nothing goes to the main agent" and › "a change still risky after its rounds is the user's: one Action Item for it, with what remains, the same one when asked again"; `host/test/review-risk-fix.test.ts`; check: a risky change's card leaves Finished for the queue, and comes back at its new commit.
- A32. In hobkin, `test/cli-runner.test.mjs` › "a message to a running check takes the images the user attached, and its receipt counts them" and `test/cli-harnesses.test.mjs` › "images the user attached go to Pi with the first prompt and with a steer"; `host/test/agent-images.test.ts` › "an image for an agent counts against that agent's message, and needs nothing of what hobkin's own model sees" and › "a message to a running agent carries the images attached for it, and pictures alone get words"; `host/test/claude-code-harness.test.ts` › "images the user attached go to Claude as image blocks, and the receipt counts them"; `ui/test/agent-images.test.ts`; check: paste a screenshot into a working agent's input and send it (not seen live yet).

## Steps

- [ ] S1 (A1, A2, A3, A10). Host: agents, activity and stop as state and commands. hobkin branch: agents without panes. Done: `agent.stop` (hobkin's `k` for a work agent, its `kill` for a routine) and a finished job's last activity kept in what the snapshot sends (`host/src/agents.ts`, `host/src/activity.ts`); the A3 and A10 tests pass. Left: the A1 and A2 tests. Agents without panes are the hobkin lane's, on its branch; the host already hides Herdr from every home (A26).
- [ ] S2 (A1, A2, A3). UI: the delegation map and the agent's canvas. Done: the map on the Work screen (`ui/src/features/work/DelegationMap.tsx`), reading the same agents as the list under the input. Left: the finished column, and the canvas drawing the activity the host now keeps.
- [ ] S5 (A11, A12, A15). The agents list under the input: live rows that pop in and move, keys, interrupt and stop. Since 2026-11-10 the list, the menu's agents row and the agent canvas read hobkin's real runs when a host is connected (`agentsFrom` in ui/src/lib/host/frame.ts): every running run that is not the main conversation, with its mood from its activity; with no host, the sample pool. Seen live with nothing running: the list is hidden (A12). Left: interrupt and stop. Stop now exists in the host as `agent.stop`, by run id. Interrupt has no way in yet: hobkin cannot stop one tool call of a job and keep the job going (Pi's abort ends the turn), so it needs a hobkin change first.
- [ ] S6 (A13, A14, A18). Stepping into an agent to talk to it, with delivery through the host. Done: `agent.say` in the host, through hobkin's `message_check`, refused once the agent has finished; the A14 test passes with fakes. Routines take words today, work agents with proposed hobkin change 03. `sayToAgent` (`ui/src/features/work/say.ts`) is ready for the agent's input. Left: the input in `AgentScreen.tsx` calling it, and saying why when nothing was sent.
- [ ] S7 (A16, A17). Moods and waiting agents. Done on sample data; the host has to report each run's mood and what it waits on.
- [ ] S10 (A27). The issue and the PR on every finished card and queue row. Done: the host's `workReader` (`host/src/work-items.ts`) adds each item's issue from hobkin's items, read once per snapshot of the work, and `IssueLink` and `PullLink` (`ui/src/features/work/parts.tsx`) draw them; the A27 test passes (2026-11-12). Left: the check.
- [ ] S11 (A28, A29, A30). The finished work that vanished: hobkin's `waiting.yours` rows that are finished branches become the "Left for you" group, and `work.closing` rows the user said yes to become `merging`, both in the same reader. The GitHub page's chip reads where Work shows the item (`placeOnWork` in `ui/src/features/github/issue-work.ts`). The A28 to A30 tests pass (2026-11-12). Left: the checks.
- [ ] S12 (A31). hobkin's own fix of a risky change: `fixRisk` and `riskStays` in hobkin (42bcb0d), sent by the host from the change review (spec 032 S16). The A31 tests pass (2026-11-21). Left: the check.
- [ ] S13 (A32). Images in an agent's input: the main input's upload flow shared (`ui/src/features/chat/image-uploads.ts`), each agent's tray (`ui/src/features/work/agent-images.ts`), `agent.say` with `images`, and hobkin's runner and harness passing them on (hobkin 25f94c7). The A32 tests pass (2026-11-21). Left: the check.
- [x] S3 (A4, A8, A9). Queue, projects, and the on and off state. Proof: `node --test host/test/work.test.ts` passes "queue actions call hobkin's work actions", "turning work mode on starts nothing" (a real host on a test home) and "project settings round trip" (2026-11-10). Seen live against a scripted host on a scratch home: the folder question, hobkin's own start, and its forecast saying nothing starts.
- [x] S4 (A5, A6, A7). Finished changes: groups, cards, actions, and the link to Change Review. Proof: `node --test host/test/work.test.ts` passes "finished changes keep hobkin's groups and reasons", "merge passes hobkin's refusal through" and "a group action lists its targets before acting" (2026-11-10).
- [x] S8 (A20, A21, A22, A23). The Work screen (`ui/src/features/work/WorkScreen.tsx`): sample and live data, the keyboard, the map's movement, and the links to pull requests. Proof: `node --test ui/test/work.test.ts` passes, and the checks under A21 to A23 (2026-11-10).
- [x] S9 (A24, A25, A26). The projects list in Work with each project's state and hobkin's answers to a proposal (`work.proposal`), the number of work agents at once (`work.agents`), and no Herdr for any home (`keepToSurroundings` in `host/src/owner.ts`). Proof: the three tests pass (2026-11-10). Seen in Chrome on sample data: Down from the switch reached the agent count, Right made it 3 and the map drew a third place; Enter on a proposal took it, and it joined the taken projects with its own settings.

## Open questions

- hobkin's highest work level runs on Claude in a Herdr pane today (`src/cli/work/store.mjs:9`). The client has no panes. `017-model-tiers` proposes that the `max` tier replaces this special case.

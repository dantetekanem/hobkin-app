---
{
  "id": "076-ludicrous-mode",
  "title": "Ludicrous mode",
  "kind": "work",
  "status": "draft",
  "depends": ["011-work", "049-yolo-mode", "052-ten-times-lighter", "059-new-project", "068-run-guide", "070-load-skill"],
  "updated": "2026-11-26"
}
---
# Ludicrous mode

## Outcome

Work mode has a Ludicrous page beside YOLO mode. It builds a whole project as fast as the Mac allows: "create the whole platform", not "add a feature". Before anything starts, the page says plainly what it costs. The user picks a project, new or one Work already has, writes the idea, picks a machine tier of 30, 50 or 100 agents, and presses Start. Five planning agents discuss the idea and write the plan and a spec for every area of the project. The page shows the plan. A second Start fills the tier with agents and keeps it full until the work is done. They commit to one branch, coordinate only through the specs and trail files, and verify before each commit so nothing is overwritten. Each area has one leader. The page never shows what an agent is doing. It shows a simple drawn map of the project's areas with how many agents are in each, how many run now, how many were spawned this run, and the history of both. The only controls are Start and Stop. Stop kills every agent at once, then hobkin compiles what they finished, pushes the branch and opens one pull request. When the subscription runs out, Ludicrous waits for the reset and starts again by itself.

## Decisions

### The user's words

- 2026-11-26: "I want us to design a new feature inside Work Mode, side-by-side to YOLO mode called Ludicrous Mode. It will be design as Tesla's do, a max push on all resources. - it will be clear on what it does when opening "It will burn all your tokens, it will put all your computing to max, your fan will spin like crazy. Ludicruos mode is designed to create brand new projects as fast as possible, with the best quality. If you have infinity tokens, it will run until its done. It doesn't show what agents are doing, just how many in which area of the project, in a simple drawn map here in hobkin and quantity. It will track a history of how many agents are on right now and how many were spawned in the session. [...] They will track work in artifacts that after a stop will be compiled. The first planning will be the most important step, it will ask you to bootstrap your idea, it will run 5 agents to discuss and think on what is doing. it will use the tiers wisely. after all planned, the work will be orchestrated to run in your Tier (this is due to your machine capabilities more than API limits), 30, 50 or 100 agents allowed. The work will be designed around this, so this tier of agents will run all the time until done. It will start slowly as it plans and design all the specs around the project. It will not produce code to be reviewed, it will commit and merge, will use worktrees if not killing your machine space, or will share the same changes as possible. worktree here is the exception, not the base. it will work on a single branch. Expect a single PR with 1 million lines of change. This is designed for the most ambitious work you have. Dont think "Add a feature", think "Create the whole platform"."
- The same message: "When Ludicrous is on, it will not stop normal machinery work, but thinks will be slow. If your subscription is out, ludicruous will see the next restart time and plan the restart. Remember that sop wont hold the agents, but kill them, all of them run in the background, they dont use tasks or other Pi smart extensions, schedules, etc. Only skills and MCPs, rest is pure AI engineering. They coordinate around the same files in the specs and trails, they dont communicate with each other, they verify before pushing so no rewrite is done. Each batch of agents has a leader that handles coordination."
- Their answers the same day: the controls are "just Start and Stop"; it runs on new or existing projects, and "if existing, it should be clear that no one else should work on that due to conflicts arising, so it talks clearly about what is going to happen"; the plan is shown and waits for Start; at the end hobkin pushes and opens the PR itself.

### Two words for tier

- The machine tier is how many Ludicrous agents run at once: 30, 50 or 100. The model tiers are hobkin's `fast`, `mid`, `high` and `max` (`hobkin/src/cli/tiers.mjs`). The page and this spec always say which one they mean.

### The page

- Ludicrous is a page of Work mode beside YOLO, a view of its own next to `yolo` in `ui/src/app/Canvas.tsx`. One run exists at a time, on one project.
- The opening, before any run, says in hobkin's voice: it burns all your tokens; it runs your Mac at full power and the fan will spin like crazy; it is made to create brand new projects as fast as possible, at the best quality; think "create the whole platform", not "add a feature"; with unlimited tokens it runs until the work is done; it starts slowly, because five agents plan the project and write every spec first; you see how many agents are in each area, not what each one does; it commits to one branch and nothing waits for your review; expect one pull request, maybe a million lines; Stop kills every agent at once, then hobkin compiles what they finished and opens the pull request; your other work keeps going, slowly; when your subscription runs out it waits for the reset and starts again by itself.
- Then the project (New project, as in 059, or one Work already has), "Your idea" in the user's own words, the machine tier, and Start.
- On a project Work already has, the page says before Start: while Ludicrous runs here, nobody else should work on this project. That means the user, another agent and hobkin's own Work, because anything else that changes these files will conflict with up to 100 agents. hobkin pauses its own Work here until the run's pull request is merged or closed. Ludicrous works in this folder, on its own branch, so the folder must have no uncommitted changes. Start stays disabled with that reason until it is clean.
- The only controls are Start and Stop, in the same place in every phase. Start begins planning, then building after the plan, and resumes a stopped run. With a stopped run on the page, picking another project makes Start begin a new run there, and the label says which it will do.
- While building, the page shows the map, the numbers and the history, and nothing about what any single agent is doing. Ludicrous agents never appear in the running agents list, the Work map (`DelegationMap.tsx`) or an agent page.
- The map draws each area of the plan as a region, laid out by code from the plan's dependencies, with the foundation in the middle. Each region shows its name, the agents in it now, its leader, and its steps done of total. The numbers above it are agents running of the tier, agents spawned this run, tokens used, and time running. Below it is the history: agents running over time and the spawned total. The phase line says planning (with its round), plan ready, building, waiting for the subscription (with when it starts again), compiling, stopped, or done.

### The machine tier

- hobkin measures the Mac's cores, memory and free disk and picks the largest tier it fits. The user can pick any of the three, and the page says what a tier above the measure risks. The cost of one agent is measured in S1, not guessed.
- Leaders count toward the tier.
- While a run builds, hobkin holds the Mac awake (`caffeinate -i`) and lets go at Stop or done.

### Who runs, and how

- Every Ludicrous agent is a Pi started in the background by hobkin's conductor, the runtime code that owns the run. It has Pi's own tools, skills (`load_skill`, 070) and the user's MCP servers, and no other extension: no tasks, teams, subagents, schedules or durable jobs. Agents never start agents. Only the conductor starts or stops a process.
- Each agent runs in a process group of its own, with its session file in the run's folder in hobkin's home (`ludicrous/<run>/sessions/`). The window never streams their transcripts. The host gets at most one Ludicrous frame a second with the phase and the counts.
- Their instructions are skills that ship with hobkin: `ludicrous-planner`, `ludicrous-leader`, `ludicrous-worker` and `ludicrous-compile`, with each system prompt in a `.md` file under `hobkin/src/prompts/`.
- Model tiers: planners and the planning lead run on `max`, leaders on `high`, and the compile on `high`. Each packet carries the tier its leader gives it: `mid` by default, `high` for hard work, `fast` for mechanical work.

### Planning

- The first Start runs five planners, and nothing else, on the idea and the folder. Each has one lens: product (who uses it and what they do), architecture (stack, boundaries, contracts between areas), data and state (models, state machines, TLA+ where a machine matters, as in 050), quality (tests, proof, monitoring, the run guide of 068), and delivery (areas, waves, and packets sized so the tier stays busy).
- They never talk to each other. They discuss through files under `_specs/ludicrous/planning/`, each writing only its own: round 1, a draft each; round 2, each reads all five and writes its critique and revision; round 3, the delivery planner writes `_specs/ludicrous/plan.md` (the idea, the areas with their dependencies, the waves, the contracts, and what done means), and the five then write one spec per area in `_specs/<area>/spec.md` in the README's format, one writer for each spec; round 4, each checks the whole set against its lens and the delivery planner settles what they raise.
- Questions for the user go in `_specs/ludicrous/questions.md`, and only ones whose answer changes the path. Each carries the planners' pick. The page shows them with the plan. Start takes the pick for any question left unanswered. An answer that changes the plan runs one short round in which the delivery planner updates it before building starts.
- The plan always opens with a foundation area: the repository's skeleton, build, test runner, lint, the run guide and the contracts the other areas build on. It opens first with a few workers, and the other areas open once its contracts are committed. That is the slow start.

### Building

- The second Start is the user's word for this run, and only for it: commits on the run's branch, merges into it, installing the project's own packages in its folder, pushing that one branch and opening or updating its one pull request. It never merges the pull request, deploys, pushes another branch or sends anything else.
- The branch is `ludicrous/<project slug>`, made from the default branch in the project's own folder. Agents share that checkout. A packet gets a worktree of its own only when its leader asks for one, for work that would break the shared build while half done, and only while free disk stays above the floor S1 sets. Otherwise it waits for the shared checkout. A worktree packet merges back onto the branch.
- Each open area has exactly one leader. The conductor starts it when the area opens and starts a fresh one whenever it ends with the area not done. The leader reads its spec and every trail, splits the work into packets, and writes them to `_specs/ludicrous/trails/<area>/queue.jsonl`: an id, the spec step, the paths the packet owns, the model tier, and whether it needs a worktree. It checks the boxes in its area's spec when the proof passes, and runs the area's whole suite at checkpoints, writing a fix packet for anything broken.
- A worker takes one packet and ends when it is done. It writes only the paths its packet owns and its own trail, `_specs/ludicrous/trails/<area>/<packet>.md`, saying what it did, its proof, its commit, and anything it needs from another area. The leader of that area reads the need and writes the packet for it. Package manifests and lockfiles belong to the foundation's leader.
- Every file under `_specs/ludicrous/` has one writer, so trails never conflict.
- Tests come first in every packet. A worker runs its own focused checks before it commits, never the whole suite.
- A commit is the `land` script that ships in `ludicrous-worker`. It builds the commit in a private index from the current branch head with only the packet's paths and moves the branch with a compare-and-swap (`git update-ref <branch> <new> <old>`), building again on the new head when the branch moved. It refuses and writes the refusal in the trail when a path it would write changed on the branch since the worker read it. No commit ever rewrites another agent's change.
- The conductor keeps the tier full: whenever fewer agents run than the tier allows and a queue holds a ready packet, it starts one, a few seconds apart (S1 measures the spacing), giving each open area a share in proportion to its ready packets.
- The history is `ludicrous/<run>/counts.jsonl` in hobkin's home: one line a minute with agents running (the most that minute), the spawned total, and the agents in each area.

### Stop, compile, resume

- Stop kills every Ludicrous process at once: the whole process group of each agent with SIGKILL, then a sweep for anything left running from the run's folder, such as a dev server an agent started. Nothing waits for an agent to finish.
- Then the conductor compiles. In code, it saves each killed packet's uncommitted edits as `ludicrous/<run>/unfinished/<packet>.patch`, checks the patch applies, and takes those edits out of the tree, so the branch holds only verified commits. Then one compile agent builds the branch head and runs its suite, checks spec boxes only where a trail's proof passes, and writes the run's report: each area's done, proven and left, the counts, and the tokens. The report goes to Reports and is the pull request's description. Last, in code, hobkin pushes the branch and opens its pull request the way `publishItem` does, as a draft after a stop, or updates the one already open.
- Start after a stop resumes the same run from its plan and trails. Nothing is planned again, and each patch goes back to its packet's queue for a worker to continue from.
- Done is every area's spec with all its acceptance proven, then a final check by one agent on `high`: the whole suite and the run guide end to end. A failure there becomes fix packets for the areas that own it. Once it passes, the compile runs, the trails fold into each area's `notes.md`, the final commit removes `_specs/ludicrous/trails/`, and the pull request is marked ready for review. The run ends.
- hobkin's AI review and YOLO mode never take a Ludicrous pull request. The user merges it.
- A hobkin restart during a run is a stop without a compile: on start, the conductor kills whatever is left of the run's agents by their recorded process groups and starts building again from the trails.

### The subscription

- When an agent ends on the provider's usage limit, or hobkin's usage readings (`hobkin/src/cli/work/usage.mjs`) show a window used up, the conductor starts nothing and the agents still running end as they fail. Their packets go back to the queue with their edits left in the tree. Nothing is compiled.
- It plans the restart for the window's reset time plus one minute and shows it on the page. With no reset time known, it tries one agent every 30 minutes until one runs. Then it fills the tier again by itself.
- Ludicrous never asks about pace. Work's daily budget and its pace question (`subscription.mjs`) do not count Ludicrous runs.

### Everything else keeps working

- Work mode, YOLO mode, routines and the main chat keep running on the user's other projects, slowly. Only the window starts or stops Ludicrous: its commands are marked `outside`, hobkin's `client` tool refuses them, and no agent can run them, as with `work.yolo` (049).

## Out of scope

- A third control, such as a pause or a drain.
- Showing what an agent is doing, its transcript, or an agent page for it.
- Change Review or an AI review of a Ludicrous pull request.
- Merging the pull request or deploying anything.
- Harnesses other than Pi.
- More than one run at a time, or a tier other than 30, 50 or 100.
- Creating a remote repository for a project that has none.
- Windows and Linux.

## Acceptance

- A1. Work mode has a Ludicrous page beside YOLO. Before any run, it says what Ludicrous does in the words above. Its only controls are Start and Stop, and they keep their place in every phase.
- A2. On a project Work already has, the page says nobody else should work on it while the run lasts, and why. Start stays disabled with the reason while the folder has uncommitted changes. Start pauses the project in Work, and it stays paused until the run's pull request is merged or closed.
- A3. The first Start runs exactly five planners on `max` and no other Ludicrous agent. They leave a plan, one spec per area in the README's format, and the questions that change the path, each with a pick. The page shows the areas and the questions, and nothing builds until the second Start, which takes the picks for questions left unanswered.
- A4. After the second Start, Ludicrous agents running never exceed the tier, and while any queue holds a ready packet the count returns to the tier within the start spacing.
- A5. Every open area has exactly one leader, and a worker starts only from a packet a leader wrote. Every Ludicrous agent is a Pi started by hobkin with only skills and MCP servers, no other extension, and no tool to start an agent.
- A6. All of a run's work lands on `ludicrous/<slug>`. A commit carries only its packet's paths. When a path it would write changed on the branch since the worker read it, the commit is refused and the refusal is in the trail. Two workers committing at the same moment both land, and neither loses a line of the other's.
- A7. A packet runs in a worktree only when its leader asked for one and free disk stays above the floor, and it merges back onto the branch. Otherwise every agent shares the project's folder.
- A8. While building, the page shows each area's agents now, its leader, and its steps done of total; agents running of the tier, spawned this run, tokens and time running; and the history of running and spawned agents. It never shows what an agent is doing, and Ludicrous agents never appear in the running agents list, the Work map or an agent page.
- A9. Stop leaves no Ludicrous process running after 10 seconds, including processes an agent started. The compile then saves each killed packet's edits as a patch, takes them out of the tree, checks spec boxes only from passing proof, writes the report, pushes the branch, and opens the pull request as a draft or updates the open one. It never merges it.
- A10. Start after a stop resumes the same run without planning again, and each patch goes back to its packet.
- A11. When the subscription runs out, Ludicrous starts nothing, the page shows when it starts again, and at that time it fills the tier by itself, with no compile and nothing from the user.
- A12. When every area's acceptance is proven and the final check passes the whole suite and the run guide, the pull request is marked ready for review, the trails are folded into the area notes and removed in the last commit, and the run ends.
- A13. The page offers 30, 50 and 100, picks the largest the Mac's measure fits, lets the user pick any, and says what a tier above the measure risks.
- A14. With 100 Ludicrous agents running, Work mode keeps starting runs on other projects, and the window's cost on 052's benchmarks stays within what it is with none.
- A15. Only the window starts or stops Ludicrous. hobkin's `client` tool refuses its commands, and no `hobkin` command an agent can run starts or stops a run.
- A16. After a hobkin restart during a run, none of the run's old agents is left running, and building starts again from the trails.
- A17. On a project with no remote, the compile keeps the branch local and the page says there is no remote to open the pull request on.
- A18. The Mac does not idle-sleep while a run builds, and hobkin stops holding it awake at Stop or done.

## Proof

- A1. check: still renders of the page in every phase (vite build, an SSR entry, qlmanage), light and dark, then the live window.
- A2. `ui/test/work-ludicrous-page.test.ts` › "an existing project says nobody else should work on it, and a folder with changes keeps Start disabled with the reason"; `hobkin/test/cli-ludicrous-run.test.mjs` › "Start pauses the project in Work until the run's pull request is merged or closed"
- A3. `hobkin/test/cli-ludicrous-planning.test.mjs` › "the first Start runs five planners on max and nothing else, and building waits for the second Start"
- A4. `hobkin/test/cli-ludicrous-conductor.test.mjs` › "the tier is never exceeded, and it fills again while packets are ready"
- A5. `hobkin/test/cli-ludicrous-conductor.test.mjs` › "one leader for each open area, and workers start only from its queue"; `hobkin/test/cli-ludicrous-harness.test.mjs` › "a Ludicrous Pi loads only skills and MCP servers"
- A6. `hobkin/test/ludicrous-land.test.mjs` › "two workers landing at once both keep every line" and › "a path that changed since it was read is refused, and the trail says so"
- A7. `hobkin/test/cli-ludicrous-conductor.test.mjs` › "a worktree only on a leader's ask and above the disk floor"
- A8. `ui/test/work-ludicrous-page.test.ts` › "the map shows each area's agents, leader and steps, and never what an agent is doing"; `host/test/work-ludicrous.test.ts` › "Ludicrous agents are not running agents"
- A9. `hobkin/test/cli-ludicrous-stop.test.mjs` › "Stop kills every process group and leaves nothing running" and › "the compile keeps only verified commits, saves the rest as patches, and opens a draft pull request"
- A10. `hobkin/test/cli-ludicrous-stop.test.mjs` › "Start after a stop resumes from the trails, with each patch back on its packet"
- A11. `hobkin/test/cli-ludicrous-subscription.test.mjs` › "a used-up window starts nothing and fills the tier again at its reset"
- A12. `hobkin/test/cli-ludicrous-done.test.mjs` › "done marks the pull request ready and folds the trails into the area notes"
- A13. `hobkin/test/cli-ludicrous-run.test.mjs` › "the tier hobkin picks from the Mac's measure"; `ui/test/work-ludicrous-page.test.ts` › "a tier above the measure says what it risks"
- A14. check: 052's benchmarks (`scripts/perf`) with 100 fake Ludicrous agents against none, and a Work run started on another project during them.
- A15. `host/test/work-ludicrous.test.ts` › "only the window starts or stops Ludicrous"
- A16. `hobkin/test/cli-ludicrous-conductor.test.mjs` › "a restart kills the old process groups and builds again from the trails"
- A17. `hobkin/test/cli-ludicrous-stop.test.mjs` › "with no remote the branch stays local and the report says so"
- A18. `hobkin/test/cli-ludicrous-conductor.test.mjs` › "the Mac is held awake only while building"

Every test runs on a throwaway home with a fake Pi and a fake `gh`. Nothing touches `~/.hobkin`, a real provider or a real code host.

## Steps

- [ ] S1 (A5, A7, A13). Measure before building: a bare Pi agent's memory and CPU, the start spacing the Mac takes without stalling the window, how Pi loads MCP servers with no other extension, and a worktree's disk cost. Fix the tier picks and the disk floor from that, in `notes.md`.
- [ ] S2 (A2, A13, A15). Runtime: the run record, its phases, the tier pick, the project's pause in Work, and the `outside` commands. Files: new `hobkin/src/cli/ludicrous/run.mjs`, `hobkin/src/cli/ludicrous/commands.mjs`, `hobkin/src/cli/work/controls.mjs`; tests new `hobkin/test/cli-ludicrous-run.test.mjs`.
- [ ] S3 (A4, A5, A7, A16, A18). Runtime: the conductor, with the process pool, start spacing, process groups, area shares, the counts history, restart recovery and holding the Mac awake. Files: new `hobkin/src/cli/ludicrous/conductor.mjs`, `hobkin/src/cli/harnesses.mjs`; tests new `hobkin/test/cli-ludicrous-conductor.test.mjs`, `hobkin/test/cli-ludicrous-harness.test.mjs`.
- [ ] S4 (A3). Planning: the five lenses, the four rounds, the plan, the area specs and the questions. Files: new `hobkin/src/cli/ludicrous/planning.mjs`, the `ludicrous-planner` skill, new `hobkin/src/prompts/ludicrous-planner.md`; tests new `hobkin/test/cli-ludicrous-planning.test.mjs`.
- [ ] S5 (A5, A6, A7). Leaders and workers: the queue and trail formats, the `ludicrous-leader` and `ludicrous-worker` skills, and the `land` script. Files: the two skills, new `hobkin/src/prompts/ludicrous-{leader,worker}.md`; tests new `hobkin/test/ludicrous-land.test.mjs`.
- [ ] S6 (A9, A10, A12, A17). Stop and compile: the kill, the patches, the compile agent, the report, the push and the pull request, resume, and done. Files: new `hobkin/src/cli/ludicrous/{stop,compile}.mjs`, the `ludicrous-compile` skill, new `hobkin/src/prompts/ludicrous-compile.md`; tests new `hobkin/test/cli-ludicrous-{stop,done}.test.mjs`.
- [ ] S7 (A11). The subscription wait and the restart at reset. Files: `hobkin/src/cli/ludicrous/conductor.mjs`, `hobkin/src/cli/work/usage.mjs`; tests new `hobkin/test/cli-ludicrous-subscription.test.mjs`.
- [ ] S8 (A8, A14, A15). Host: the protocol, the commands and the frame of at most one a second. Files: `shared/protocol/work.ts`, `shared/commands/registry.ts`, new `host/src/ludicrous.ts`; tests new `host/test/work-ludicrous.test.ts`.
- [ ] S9 (A1, A2, A8, A13). Window: the page, the opening, the map, the numbers, the history and the two controls. Files: new `ui/src/features/work/LudicrousScreen.tsx`, new `ui/src/features/work/ludicrous-page.ts`, new `ui/src/features/work/ludicrous-map.ts`, `ui/src/app/Canvas.tsx`, `ui/src/app/ScreenMenu.tsx`, `ui/src/features/work/WorkScreen.tsx`; tests new `ui/test/work-ludicrous-page.test.ts`.
- [ ] S10 (A4, A14). With the user's go-ahead, one real run on a throwaway project at the 30 tier, then the benchmarks with 100 agents.

## Open questions

- A project with no remote. (a) As decided: the branch stays local and the page says so. (b) The first compile creates a private repository on the code host with `gh repo create --private` and pushes there. That is a new outward step the user would have to allow.
- Tests in a shared checkout. One agent's half-written file can fail another's build. (a) As decided: workers run only their own focused checks, leaders run the area's suite at checkpoints, and a packet that would break the build while half done asks for a worktree. (b) Every packet gets a worktree while disk allows: less noise, much more disk.
- The trails in the pull request. (a) As decided: the final compile folds them into the area notes and removes them. (b) Keep them in the pull request as the record of how the project was built.
- When the run ends on an existing project. (a) As decided: Work stays paused there until the pull request is merged or closed. (b) It resumes at done, and the user's merge is the only thing left.

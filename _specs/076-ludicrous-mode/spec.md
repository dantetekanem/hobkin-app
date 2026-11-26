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

Work mode has a Ludicrous page beside YOLO mode. It builds a whole project as fast as the Mac allows: "create the whole platform", not "add a feature". Before anything starts, the page says plainly what it costs. The user picks a project, new or one Work already has, writes what they want, picks a machine tier of 30, 50 or 100 agents, and presses Let's plan this. Five planning agents discuss the idea and write the plan and a spec for every area of the project. The page shows the plan. When the user approves it with Go Ludicrous, the tier fills with agents and stays full until the work is done. They commit to one branch, coordinate only through the specs and trail files, and check before each commit that nothing is overwritten. Each area has one leader, and only leaders run tests, linters, builds and model checkers. Workers never run them: they plan around how the checks will go and work hard to confirm by reasoning that their code is right. The page never shows what an agent is doing. It shows a simple drawn map of the project's areas with how many agents are in each, how many run now, how many were spawned this run, and the history of both. The page has two controls: one main button, which says Let's plan this and then Go Ludicrous, and Stop. Stop kills every agent at once, then hobkin compiles what they finished, pushes the branch and opens one pull request. When the subscription runs out, Ludicrous waits for the reset and starts again by itself.

## Decisions

### The user's words

- 2026-11-26: "I want us to design a new feature inside Work Mode, side-by-side to YOLO mode called Ludicrous Mode. It will be design as Tesla's do, a max push on all resources. - it will be clear on what it does when opening "It will burn all your tokens, it will put all your computing to max, your fan will spin like crazy. Ludicruos mode is designed to create brand new projects as fast as possible, with the best quality. If you have infinity tokens, it will run until its done. It doesn't show what agents are doing, just how many in which area of the project, in a simple drawn map here in hobkin and quantity. It will track a history of how many agents are on right now and how many were spawned in the session. [...] They will track work in artifacts that after a stop will be compiled. The first planning will be the most important step, it will ask you to bootstrap your idea, it will run 5 agents to discuss and think on what is doing. it will use the tiers wisely. after all planned, the work will be orchestrated to run in your Tier (this is due to your machine capabilities more than API limits), 30, 50 or 100 agents allowed. The work will be designed around this, so this tier of agents will run all the time until done. It will start slowly as it plans and design all the specs around the project. It will not produce code to be reviewed, it will commit and merge, will use worktrees if not killing your machine space, or will share the same changes as possible. worktree here is the exception, not the base. it will work on a single branch. Expect a single PR with 1 million lines of change. This is designed for the most ambitious work you have. Dont think "Add a feature", think "Create the whole platform"."
- The same message: "When Ludicrous is on, it will not stop normal machinery work, but thinks will be slow. If your subscription is out, ludicruous will see the next restart time and plan the restart. Remember that sop wont hold the agents, but kill them, all of them run in the background, they dont use tasks or other Pi smart extensions, schedules, etc. Only skills and MCPs, rest is pure AI engineering. They coordinate around the same files in the specs and trails, they dont communicate with each other, they verify before pushing so no rewrite is done. Each batch of agents has a leader that handles coordination."
- Their answers the same day: the controls are "just Start and Stop"; it runs on new or existing projects, and "if existing, it should be clear that no one else should work on that due to conflicts arising, so it talks clearly about what is going to happen"; the plan is shown and waits for Start; at the end hobkin pushes and opens the PR itself.
- Later the same day, on the first mockup: ""press Start again" sounds stupid. "Not start" is wrong, should be a box "Write what you want, be as clear as possible" and "Let's plan this". and after the plan is done and approved, you click "Go Ludicruous" or something awesomely fun. The What Happens needs to be written in a much better way than that, more communicative and assertive, not just a payload".
- Later the same day: "another thing we need to be careful is about testing, if each agent start running tests or linters or whatever, it will kill the machine. the leaders of each "branch" should run the tests, but the agent working on it should assume how it will work and plan with this, same for TLA+. so the "workers" will not compile and run checkers, but will work very hard to confirm they're true, so the leaders manage that branch".

### Two words for tier

- The machine tier is how many Ludicrous agents run at once: 30, 50 or 100. The model tiers are hobkin's `fast`, `mid`, `high` and `max` (`hobkin/src/cli/tiers.mjs`). The page and this spec always say which one they mean.

### The page

- Ludicrous is a page of Work mode beside YOLO, a view of its own next to `yolo` in `ui/src/app/Canvas.tsx`. One run exists at a time, on one project.
- Before any run, the page opens with one box, "Write what you want. Be as clear as possible.", and the main button, Let's plan this. One line under the box says that five agents plan it first and nothing gets built until the user approves their plan.
- Below it, What happens says, in these words:

  > Ludicrous builds a whole project at once, as fast as your Mac allows and at the best quality it can reach.
  >
  > Tell it what you want. Five planning agents pull your idea apart, challenge each other's drafts, and come back with a plan and a spec for every part of the project. When you approve the plan, 30, 50 or 100 agents start building, and they keep going until it's done.
  >
  > It holds nothing back. It spends every token you have and runs your Mac at full power, so expect the fan to spin like crazy. Your other work keeps going, only slower. If your subscription runs out, Ludicrous waits for the reset and carries on by itself.
  >
  > Nothing waits for your review. Agents commit to one branch as they go, and you get a single pull request at the end, maybe a million lines long. You won't see what each agent is doing. You'll see how many are working in each part of the project, and how far each part has come.
  >
  > Stop kills every agent instantly. hobkin keeps what they finished and puts it in the pull request.
  >
  > Save it for your most ambitious work. Don't think "add a feature". Think "create the whole platform".

- Then the project (New project, as in 059, or one Work already has) and the machine tier.
- On a project Work already has, the page says before any planning: while Ludicrous runs here, nobody else should work on this project. That means the user, another agent and hobkin's own Work, because anything else that changes these files will conflict with up to 100 agents. hobkin pauses its own Work here until the run's pull request is merged or closed. Ludicrous works in this folder, on its own branch, so the folder must have no uncommitted changes. Let's plan this stays disabled with that reason until it is clean.
- The page has two controls, the main button and Stop, in the same place in every phase. The main button says Let's plan this before a plan exists, and Go Ludicrous once the plan is ready or after a stop. Go Ludicrous is the user's approval of the plan, and after a stop it resumes the run. While planners or builders run, the main button is disabled and keeps its place. With a stopped run on the page, picking another project opens the box for a new run there, and Go Ludicrous still resumes the stopped one.
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

- Let's plan this runs five planners, and nothing else, on the idea and the folder. Each has one lens: product (who uses it and what they do), architecture (stack, boundaries, contracts between areas), data and state (models, state machines, TLA+ where a machine matters, as in 050), quality (tests, proof, monitoring, the run guide of 068), and delivery (areas, waves, and packets sized so the tier stays busy).
- They never talk to each other. They discuss through files under `_specs/ludicrous/planning/`, each writing only its own: round 1, a draft each; round 2, each reads all five and writes its critique and revision; round 3, the delivery planner writes `_specs/ludicrous/plan.md` (the idea, the areas with their dependencies, the waves, the contracts, and what done means), and the five then write one spec per area in `_specs/<area>/spec.md` in the README's format, one writer for each spec; round 4, each checks the whole set against its lens and the delivery planner settles what they raise.
- Questions for the user go in `_specs/ludicrous/questions.md`, and only ones whose answer changes the path. Each carries the planners' pick. The page shows them with the plan. Go Ludicrous takes the pick for any question left unanswered. An answer that changes the plan runs one short round in which the delivery planner updates it before building starts.
- The plan always opens with a foundation area: the repository's skeleton, build, test runner, lint, the run guide and the contracts the other areas build on. It opens first with a few workers, and the other areas open once its contracts are committed. That is the slow start.

### Building

- Go Ludicrous is the user's word for this run, and only for it: commits on the run's branch, merges into it, installing the project's own packages in its folder, pushing that one branch and opening or updating its one pull request. It never merges the pull request, deploys, pushes another branch or sends anything else.
- The branch is `ludicrous/<project slug>`, made from the default branch in the project's own folder. Every agent shares that checkout, and no agent gets a worktree of its own. Nobody builds or tests in the shared folder, so a half-written file there breaks nothing.
- Each open area has exactly one leader. The conductor starts it when the area opens and starts a fresh one whenever it ends with the area not done. The leader reads its spec and every trail, splits the work into packets, and writes them to `_specs/ludicrous/trails/<area>/queue.jsonl`: an id, the spec step, the paths the packet owns, and the model tier. It runs its area's checks and checks the boxes in its area's spec when the proof passes.
- A worker takes one packet and ends when it is done. It writes only the paths its packet owns and its own trail, `_specs/ludicrous/trails/<area>/<packet>.md`, saying what it did, its proof, its commit, and anything it needs from another area. The leader of that area reads the need and writes the packet for it. Package manifests and lockfiles belong to the foundation's leader.
- Every file under `_specs/ludicrous/` has one writer, so trails never conflict.
- The conductor keeps the tier full: whenever fewer agents run than the tier allows and a queue holds a ready packet, it starts one, a few seconds apart (S1 measures the spacing), giving each open area a share in proportion to its ready packets.
- The history is `ludicrous/<run>/counts.jsonl` in hobkin's home: one line a minute with agents running (the most that minute), the spawned total, and the agents in each area.

### Checks

- Running tests, linters, compilers, type checkers, builds and model checkers on every agent would stall the Mac, so only leaders run them. That covers TLA+ too: workers write models and the code that follows them, and leaders run TLC and TLAPS.
- Workers never run a check. Tests still come first in every packet: the worker writes the tests, then the code, then confirms by reasoning that both are right. It traces each test through the code by hand, against its area's spec and the contracts, and reads every call it makes into another area's code. For each test, its trail says why it expects the test to pass and what it assumed, so the leader can tell a wrong assumption from a wrong line.
- hobkin enforces this in code. Worker processes start with stand-ins first on their `PATH` for the project's check commands, which the plan names: its package manager, test runner, compiler, linter, and `java` for TLC. A stand-in refuses with one line ("Workers don't run checks. Your leader does.") and the refusal is logged in the run.
- Leaders check committed code only, never the shared folder. A check runs in a check worktree moved to the branch head, through the `check` script in `ludicrous-leader`: the area's tests, its lint, its build and its models. Check worktrees are the only worktrees in a run. There are as many as the Mac takes check runs at once (S1 measures both the number and their disk), and a leader waits for a free one. Each area has at most one check running.
- A leader checks whenever its area has commits since its last check, so under load one check covers many packets. A failure becomes a fix packet that names the failing check, the commit that brought it and the trail whose assumption was wrong. Between checks the branch can be red. That is expected, and the report says which commits are checked.
- The planners' quality lens writes each area's check commands into its spec, so every leader knows what to run before the first packet lands.

### Commits

- A commit is the `land` script that ships in `ludicrous-worker`. It makes the commit in a private index from the current branch head with only the packet's paths and moves the branch with a compare-and-swap (`git update-ref <branch> <new> <old>`), making it again on the new head when the branch moved. It refuses and writes the refusal in the trail when a path it would write changed on the branch since the worker read it. No commit ever rewrites another agent's change. It runs no check.

### Stop, compile, resume

- Stop kills every Ludicrous process at once: the whole process group of each agent with SIGKILL, then a sweep for anything left running from the run's folder, such as a dev server an agent started. Nothing waits for an agent to finish.
- Then the conductor compiles. In code, it saves each killed packet's uncommitted edits as `ludicrous/<run>/unfinished/<packet>.patch`, checks the patch applies, and takes those edits out of the tree, so the branch holds only verified commits. Then one compile agent builds the branch head and runs its suite, checks spec boxes only where a trail's proof passes, and writes the run's report: each area's done, proven and left, the counts, and the tokens. The report goes to Reports and is the pull request's description. Last, in code, hobkin pushes the branch and opens its pull request the way `publishItem` does, as a draft after a stop, or updates the one already open.
- Stop during planning kills the planners and compiles nothing. The next Let's plan this plans again from the round files already written.
- Go Ludicrous after a stop resumes the same run from its plan and trails. Nothing is planned again, and each patch goes back to its packet's queue for a worker to continue from.
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

- A1. Work mode has a Ludicrous page beside YOLO. Before any run, it says what Ludicrous does in the words above. It has two controls, the main button (Let's plan this, then Go Ludicrous) and Stop, and they keep their place in every phase.
- A2. On a project Work already has, the page says nobody else should work on it while the run lasts, and why. Let's plan this stays disabled with the reason while the folder has uncommitted changes. Let's plan this pauses the project in Work, and it stays paused until the run's pull request is merged or closed.
- A3. Let's plan this runs exactly five planners on `max` and no other Ludicrous agent. They leave a plan, one spec per area in the README's format, and the questions that change the path, each with a pick. The page shows the areas and the questions, and nothing builds until Go Ludicrous, which takes the picks for questions left unanswered.
- A4. After Go Ludicrous, Ludicrous agents running never exceed the tier, and while any queue holds a ready packet the count returns to the tier within the start spacing.
- A5. Every open area has exactly one leader, and a worker starts only from a packet a leader wrote. Every Ludicrous agent is a Pi started by hobkin with only skills and MCP servers, no other extension, and no tool to start an agent.
- A6. All of a run's work lands on `ludicrous/<slug>`. A commit carries only its packet's paths. When a path it would write changed on the branch since the worker read it, the commit is refused and the refusal is in the trail. Two workers committing at the same moment both land, and neither loses a line of the other's.
- A7. Every agent shares the project's folder. The only worktrees are the check worktrees, never more than S1's number, and each sits at a commit of the branch.
- A8. While building, the page shows each area's agents now, its leader, and its steps done of total; agents running of the tier, spawned this run, tokens and time running; and the history of running and spawned agents. It never shows what an agent is doing, and Ludicrous agents never appear in the running agents list, the Work map or an agent page.
- A9. Stop leaves no Ludicrous process running after 10 seconds, including processes an agent started. The compile then saves each killed packet's edits as a patch, takes them out of the tree, checks spec boxes only from passing proof, writes the report, pushes the branch, and opens the pull request as a draft or updates the open one. It never merges it.
- A10. Go Ludicrous after a stop resumes the same run without planning again, and each patch goes back to its packet.
- A11. When the subscription runs out, Ludicrous starts nothing, the page shows when it starts again, and at that time it fills the tier by itself, with no compile and nothing from the user.
- A12. When every area's acceptance is proven and the final check passes the whole suite and the run guide, the pull request is marked ready for review, the trails are folded into the area notes and removed in the last commit, and the run ends.
- A13. The page offers 30, 50 and 100, picks the largest the Mac's measure fits, lets the user pick any, and says what a tier above the measure risks.
- A14. With 100 Ludicrous agents running, Work mode keeps starting runs on other projects, and the window's cost on 052's benchmarks stays within what it is with none.
- A15. Only the window starts or stops Ludicrous. hobkin's `client` tool refuses its commands, and no `hobkin` command an agent can run starts or stops a run.
- A16. After a hobkin restart during a run, none of the run's old agents is left running, and building starts again from the trails.
- A17. On a project with no remote, the compile keeps the branch local and the page says there is no remote to open the pull request on.
- A18. The Mac does not idle-sleep while a run builds, and hobkin stops holding it awake at Stop or done.
- A19. A worker's call to any check command the plan names (a test runner, linter, compiler, build, package manager or TLC) is refused with one line and logged, and no worker process ever runs one. Each worker's trail says, for every test it wrote, why it expects it to pass and what it assumed.
- A20. Only leaders run checks, always on a committed head in a check worktree. An area never has two checks running, the Mac never runs more than S1's number at once, and a failing check becomes a fix packet naming the check, the commit and the trail.

## Proof

- A1. check: the opening's words match the ones above; still renders of the page in every phase (vite build, an SSR entry, qlmanage), light and dark, then the live window.
- A2. `ui/test/work-ludicrous-page.test.ts` › "an existing project says nobody else should work on it, and a folder with changes keeps Let's plan this disabled with the reason"; `hobkin/test/cli-ludicrous-run.test.mjs` › "Let's plan this pauses the project in Work until the run's pull request is merged or closed"
- A3. `hobkin/test/cli-ludicrous-planning.test.mjs` › "Let's plan this runs five planners on max and nothing else, and building waits for Go Ludicrous"
- A4. `hobkin/test/cli-ludicrous-conductor.test.mjs` › "the tier is never exceeded, and it fills again while packets are ready"
- A5. `hobkin/test/cli-ludicrous-conductor.test.mjs` › "one leader for each open area, and workers start only from its queue"; `hobkin/test/cli-ludicrous-harness.test.mjs` › "a Ludicrous Pi loads only skills and MCP servers"
- A6. `hobkin/test/ludicrous-land.test.mjs` › "two workers landing at once both keep every line" and › "a path that changed since it was read is refused, and the trail says so"
- A7. `hobkin/test/cli-ludicrous-conductor.test.mjs` › "agents share the folder, and the only worktrees are the check worktrees"
- A8. `ui/test/work-ludicrous-page.test.ts` › "the map shows each area's agents, leader and steps, and never what an agent is doing"; `host/test/work-ludicrous.test.ts` › "Ludicrous agents are not running agents"
- A9. `hobkin/test/cli-ludicrous-stop.test.mjs` › "Stop kills every process group and leaves nothing running" and › "the compile keeps only verified commits, saves the rest as patches, and opens a draft pull request"
- A10. `hobkin/test/cli-ludicrous-stop.test.mjs` › "Go Ludicrous after a stop resumes from the trails, with each patch back on its packet"
- A11. `hobkin/test/cli-ludicrous-subscription.test.mjs` › "a used-up window starts nothing and fills the tier again at its reset"
- A12. `hobkin/test/cli-ludicrous-done.test.mjs` › "done marks the pull request ready and folds the trails into the area notes"
- A13. `hobkin/test/cli-ludicrous-run.test.mjs` › "the tier hobkin picks from the Mac's measure"; `ui/test/work-ludicrous-page.test.ts` › "a tier above the measure says what it risks"
- A14. check: 052's benchmarks (`scripts/perf`) with 100 fake Ludicrous agents against none, and a Work run started on another project during them.
- A15. `host/test/work-ludicrous.test.ts` › "only the window starts or stops Ludicrous"
- A16. `hobkin/test/cli-ludicrous-conductor.test.mjs` › "a restart kills the old process groups and builds again from the trails"
- A17. `hobkin/test/cli-ludicrous-stop.test.mjs` › "with no remote the branch stays local and the report says so"
- A18. `hobkin/test/cli-ludicrous-conductor.test.mjs` › "the Mac is held awake only while building"
- A19. `hobkin/test/cli-ludicrous-harness.test.mjs` › "a worker's check command is refused and logged"; check: the trails of S10's run, read for the reasoning on each test.
- A20. `hobkin/test/ludicrous-check.test.mjs` › "a leader checks only a committed head, one check an area, and waits for a free check worktree" and › "a failing check files a fix packet naming the check, the commit and the trail"

Every test runs on a throwaway home with a fake Pi and a fake `gh`. Nothing touches `~/.hobkin`, a real provider or a real code host.

## Steps

- [ ] S1 (A5, A7, A13, A20). Measure before building: a bare Pi agent's memory and CPU, the start spacing the Mac takes without stalling the window, how Pi loads MCP servers with no other extension, and how many check runs at once the Mac takes beside the tier, with a check worktree's disk cost. Fix the tier picks and the number of check worktrees from that, in `notes.md`.
- [ ] S2 (A2, A13, A15). Runtime: the run record, its phases, the tier pick, the project's pause in Work, and the `outside` commands. Files: new `hobkin/src/cli/ludicrous/run.mjs`, `hobkin/src/cli/ludicrous/commands.mjs`, `hobkin/src/cli/work/controls.mjs`; tests new `hobkin/test/cli-ludicrous-run.test.mjs`.
- [ ] S3 (A4, A5, A7, A16, A18). Runtime: the conductor, with the process pool, start spacing, process groups, area shares, the counts history, restart recovery and holding the Mac awake. Files: new `hobkin/src/cli/ludicrous/conductor.mjs`, `hobkin/src/cli/harnesses.mjs`; tests new `hobkin/test/cli-ludicrous-conductor.test.mjs`, `hobkin/test/cli-ludicrous-harness.test.mjs`.
- [ ] S4 (A3). Planning: the five lenses, the four rounds, the plan, the area specs and the questions. Files: new `hobkin/src/cli/ludicrous/planning.mjs`, the `ludicrous-planner` skill, new `hobkin/src/prompts/ludicrous-planner.md`; tests new `hobkin/test/cli-ludicrous-planning.test.mjs`.
- [ ] S5 (A5, A6, A7, A19, A20). Leaders and workers: the queue and trail formats, the `ludicrous-leader` and `ludicrous-worker` skills, the `land` script, the `check` script with its check worktrees, and the stand-ins on a worker's `PATH`. Files: the two skills, new `hobkin/src/prompts/ludicrous-{leader,worker}.md`, `hobkin/src/cli/ludicrous/conductor.mjs`; tests new `hobkin/test/ludicrous-land.test.mjs`, new `hobkin/test/ludicrous-check.test.mjs`.
- [ ] S6 (A9, A10, A12, A17). Stop and compile: the kill, the patches, the compile agent, the report, the push and the pull request, resume, and done. Files: new `hobkin/src/cli/ludicrous/{stop,compile}.mjs`, the `ludicrous-compile` skill, new `hobkin/src/prompts/ludicrous-compile.md`; tests new `hobkin/test/cli-ludicrous-{stop,done}.test.mjs`.
- [ ] S7 (A11). The subscription wait and the restart at reset. Files: `hobkin/src/cli/ludicrous/conductor.mjs`, `hobkin/src/cli/work/usage.mjs`; tests new `hobkin/test/cli-ludicrous-subscription.test.mjs`.
- [ ] S8 (A8, A14, A15). Host: the protocol, the commands and the frame of at most one a second. Files: `shared/protocol/work.ts`, `shared/commands/registry.ts`, new `host/src/ludicrous.ts`; tests new `host/test/work-ludicrous.test.ts`.
- [ ] S9 (A1, A2, A8, A13). Window: the page, the opening, the map, the numbers, the history and the two controls. Files: new `ui/src/features/work/LudicrousScreen.tsx`, new `ui/src/features/work/ludicrous-page.ts`, new `ui/src/features/work/ludicrous-map.ts`, `ui/src/app/Canvas.tsx`, `ui/src/app/ScreenMenu.tsx`, `ui/src/features/work/WorkScreen.tsx`; tests new `ui/test/work-ludicrous-page.test.ts`.
- [ ] S10 (A4, A14). With the user's go-ahead, one real run on a throwaway project at the 30 tier, then the benchmarks with 100 agents.

## Open questions

- A project with no remote. (a) As decided: the branch stays local and the page says so. (b) The first compile creates a private repository on the code host with `gh repo create --private` and pushes there. That is a new outward step the user would have to allow.
- Where leaders check. (a) As decided: in check worktrees at a committed head, which costs the disk of each one. (b) In the shared folder, which costs no disk, but a check there sees every worker's half-written files and fails on them.
- The trails in the pull request. (a) As decided: the final compile folds them into the area notes and removes them. (b) Keep them in the pull request as the record of how the project was built.
- When the run ends on an existing project. (a) As decided: Work stays paused there until the pull request is merged or closed. (b) It resumes at done, and the user's merge is the only thing left.

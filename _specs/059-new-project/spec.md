---
{
  "id": "059-new-project",
  "title": "New project, and projects that are goals",
  "kind": "work",
  "status": "doing",
  "depends": ["011-work", "025-onboarding", "049-yolo-mode", "053-work-control-room"],
  "updated": "2026-11-24"
}
---
# New project, and projects that are goals

## Outcome

Work and YOLO mode each have a New project button. It opens a popup where the user names a folder, typed or picked in the Mac's own chooser, and says what they want from the project. Add puts the project in Work, taken, with those words given to every run there. A project does not have to be code. A goal is something to reach: Work studies the folder, files steps toward what the user described, and does them in the folder itself, with no branch, pull request, review or merge. Every project has a git repository of its own, so every step has a way back: a folder that has none gets one at the add, with no remote.

The user, 2026-11-24: "I want to be able to add new projects to work mode and yolo mode, which is like a 'New Project' button. will open a popup, where I will put the folder (or open one), and describe what I want from this project. not every project in work mode needs to be a code project following the rules, can be just an achievement".

The user again, the same day, on what a goal's run does to files where the folder keeps no versions: "we should always initialize git, even not having a remote. that should be a requirement for a tracked project".

## Decisions

### What was there before

- A project reached Work two ways: hobkin's look through the Work folder proposed it, or `hobkin work add project <folder>` took it. The window had no way to add one. `addProject` refused any folder with no `.git` ("Not a git repository"), so a folder of documents could not be a project.
- Every look and every run on a project is given the text of `work/<slug>/directions.md` in hobkin's home, and both prompts treat it as the only project text that counts as instructions. Nothing wrote that file. The audit of 2026-11-24 is in `notes.md` beside this spec.

### Two kinds

- A project has a kind, `code` or `goal`. A record with no kind is code, so every project from before this spec is unchanged.
- Only the user's own add sets the kind. An agent's proposal cannot carry one.
- The guard everywhere is the kind, never "is this a git repository": git looks upward for a repository, so a goal's folder inside some other repository would otherwise be read as that repository.
- Every project has a git repository of its own. A folder that holds none gets one at the add: `git init` there and one first commit of what is in it, made as hobkin makes its own commits, with no remote. A folder that already holds one is left as it is. So either kind can be picked for any folder.

### The popup

- New project stands in the Projects heading of Work and of YOLO mode. N opens it on both pages. Escape closes it and the keyboard goes back to the button.
- Folder is a typed path, with `~` for home, and an Open button that shows the Mac's own folder chooser and writes what was picked into the field. The chooser is the host's: the app's shell has none, and adding one would need a restart.
- One line under the field says what hobkin sees there: nothing typed yet, a git repository, a folder with no repository yet (hobkin starts one at the add), no folder, a file, a project Work already has, or another project that has its name. The line keeps its height in every state.
- Kind is Code or Goal, with one line that says what that kind means. It follows the folder until the user picks one: a repository starts as Code and any other folder as Goal.
- "What do you want from it?" is the user's own words. A goal needs them, since they are what Work works toward. Code can be added without them.
- "YOLO mode here" is a switch, on when the popup was opened from YOLO mode and off from Work. It cannot be on for a goal, and its line says a goal has nothing to merge.
- Add project is pressed with Command+Enter from anywhere in the popup. While something is missing it is disabled and the line beside it says what. hobkin's own refusal shows in that same line, and the popup stays open with what was typed.
- After an add the popup closes and the keyboard is on the new project's row.
- With no host the popup works on sample data: the look answers from the sample's own projects and an add changes only the sample.

### What an add does

- The project is taken at hobkin's own level for a project added by hand, and its work joins the queue. Nothing else starts: whether its study runs now is work mode's own switch and the workload, as for any taken project.
- The user's words are written to the project's `directions.md`. They reach the study, every look and every run with no new plumbing.
- A folder Work already has is refused with which project it is. Changing a project's words later is not part of this spec.
- With the YOLO switch on, the window then turns the project's own YOLO switch on with `work.yolo.project`, as a press on its card does. If that is refused the project stays added and the refusal is shown.

### A goal in Work

- A goal's runs work in the folder itself. There is no worktree and no branch.
- hobkin commits each step when its run ends: the paths the run changed, under the step's title, and the commit is recorded on the step. What the user had already changed in the folder before the run stays theirs, uncommitted. The agent never commits, branches, stashes, resets or cleans.
- Its study reads the folder and the user's words and writes where the goal stands and what comes next, then files the first steps. After that one look, at the project's own pace, reads what changed and what comes next. The code looks never run on a goal: no lenses, no state machines, no signals, no watch.
- A step ends `done` with a summary and what shows it, naming every file it wrote or changed. A step only the user can take, such as signing, sending or paying, is filed for the user and shows with what is left for them.
- A goal's run never sends, submits, signs, pays or deletes. It still follows the folder's own rules for keeping versions when it has any (a README, `AGENTS.md`, `CLAUDE.md` or a skill it names).
- A goal's runs keep the purpose of the code runs (`work-look`, `work-do`), so their tools, skills and limits are the same, and carry `workPrompt` to read `work-goal-look.md` and `work-goal-do.md` in place of the code prompts.
- A step's kind is one hobkin already has: `feature`, `improvement`, `fix`, `chore`, or `yours` for a step only the user can take.
- A finished step tells the user as any finished run does: its `Useful:` report is a quiet line in Chat, its summary and proof are on the item, and what it left for the user reaches Attention. There is no card to land, since there is no branch.
- Nothing about a goal is merged, reviewed, published or deployed. YOLO mode, pull requests and GitHub issues are refused on a goal in hobkin's own words, and a goal is not on the YOLO page.
- In the Projects list a goal's row says Goal and counts its steps to do, done and left for the user. It has no pull request or issue settings.

### Commands

- `work.project.look` reads what is at a folder: whether it is a folder, whether it has a repository of its own, the name it would get, and the project Work already has for it or under its name. It only reads.
- `work.project.new` adds the project with its kind and the user's words, and answers with hobkin's own line about what happens next.
- `work.folder.pick` shows the Mac's folder chooser and answers with the folder picked, or with none when it was closed. Only the window sends it.

## Out of scope

- Changing a project's words or its kind after the add.
- Goals proposed by hobkin's own look through the Work folder.
- A way back for a goal's folder kept by hobkin, such as a history of what each run changed.
- A project that is only a remote to clone.
- Goals in World.

## Acceptance

- A1. An add takes a folder that is no git repository, as a goal or as code, and starts a repository there with one first commit of what is in it and no remote. A folder that already holds one is not initialized again and gets no commit. A known project and a namesake are refused as before.
- A2. The words given with an add are the project's directions, and the study and every run on it are given them.
- A3. A run on a goal works in the project's folder, gets no branch and no worktree, and its item ends `done` with its summary. When the run ends, the paths it changed are one commit under the step's title, recorded on the step, and what the user had changed before stays uncommitted.
- A4. A goal gets its study and then its own look, and none of the code looks. Its study and its runs follow the goal prompts.
- A5. YOLO mode files no readiness work on a goal and its switch is refused there. Pull request and issue settings, a branch or a pull request recorded on an item, and a branch adopted there are refused on a goal. The survey of unmerged branches skips it.
- A6. Work status carries a goal's kind and how many of its steps are done.
- A7. `work.project.look` says what is at a folder: missing, a file, a folder, a repository, the project Work has for it, and a namesake. It changes nothing.
- A8. `work.project.new` adds a code project or a goal with the user's words through hobkin's own function, refuses a goal with no words, and passes hobkin's refusal on in its words.
- A9. `work.folder.pick` answers with the folder picked or with none, and opens nothing in a test.
- A10. The popup's model: the line for each state of the folder, the kind following the folder until the user picks one, either kind for any folder, YOLO off for a goal, and what stands in the way of Add.
- A11. New project is in the Projects heading of Work and of YOLO mode, N opens it, Command+Enter adds, and no control moves when the folder's line, the kind's line or a refusal changes.
- A12. A goal's row says Goal with its steps to do, done and left for the user, and has no pull request or issue setting.

## Proof

- A1. In hobkin, `test/cli-work-goal.test.mjs` › "newProject takes a goal in a plain folder, with its words as the directions", › "newProject takes code from a repository, keeps its words, and never reads a goal's parent as the project", › "newProject refuses in plain words and changes nothing" and › "the command line takes a goal with its words on stdin, and a proposal can never carry a kind"
- A2. In hobkin, `test/cli-work-goal.test.mjs` › "the user's words are written as the directions, and blank words write nothing"; `host/test/work-new-project-runtime.test.ts` › "a folder that is no repository is added as a goal: hobkin takes it with its kind, and the words are its directions". That a run is given a project's directions is hobkin's own test from before, `test/cli-work-director.test.mjs` near line 2000.
- A3. In hobkin, `test/cli-work-goal.test.mjs` › "a goal is studied and worked in its own folder, with no worktree, branch or code look" and › "the item command takes a finished step on a goal and refuses a branch, a pull request and an adopted branch there"
- A4. In hobkin, `test/cli-work-goal.test.mjs` › "after its study a goal gets one look of its own and none of the code looks"; `test/cli-harnesses.test.mjs`, its test of the goal prompt.
- A5. In hobkin, `test/cli-work-goal.test.mjs` › "YOLO mode files nothing on a goal, refuses its switch, leaves it out of the view, and still treats code as before", › "a goal takes no pull request or issue setting, and code still does" and › "the survey of unmerged branches skips a goal, even one inside a repository with unmerged work"
- A6. In hobkin, `test/cli-work-goal.test.mjs` › "status carries a goal's kind and how many steps are done, and gives code no such count"; `host/test/work.test.ts` › "a goal's kind and how many of its steps are done reach the window, and a project with no kind sends neither"
- A7. `host/test/work-new-project.test.ts` › "the look says what is at the folder, for each thing it can be", › "~ and ~/... mean the home folder", › "the look finds the project Work has for this very folder by any spelling, and another folder under its name" and › "the look reads only: it never calls hobkin to add and never refreshes"
- A8. `host/test/work-new-project.test.ts` › "an add passes hobkin the real folder, the kind and the words, then reads hobkin again", › "an add refuses in plain words what cannot be added, and calls hobkin for none of it", › "code in a folder with no repository is refused, and a goal there is not", › "a goal needs words that are not blank, before any handler runs" and › "a hobkin without the function says it cannot add from here yet"; against hobkin's own add, `host/test/work-new-project-runtime.test.ts`, both tests.
- A9. `host/test/folder-pick.test.ts`, its five tests: a picked folder, a closed chooser, another platform, a second press, and a host that shows no chooser unless its entry hands one in.
- A10. `ui/test/new-project.test.ts` › "the folder line says one thing for each state of what is typed", › "an answer for older text is no answer: the line says it is looking", › "the kind follows the folder until the user picks, and Code never stands for a folder with no repository", › "picking Code for a plain folder changes nothing, and the line says why", › "the YOLO switch starts from the page, and a goal has none to switch", › "what stands in the way of Add, in the order the user can fix it", › "the add sends the folder, the kind and the words, and no words as none", › "an add turns YOLO mode on after it, and its refusal keeps the add" and › "the sample looks from its own projects and an add changes only the sample"
- A11. `ui/test/new-project.test.ts` › "N opens the popup alone, once, outside fields; Command+Enter adds" and › "the keyboard goes to the project’s row on Work and its card on YOLO mode"; check (2026-11-24, still renders, no browser): the popup with nothing typed, a repository as Code, a folder as Goal with words, no folder there, and a refusal in the foot are one size, with every changing line in its place. Not yet seen in the app's window.
- A12. `ui/test/work-goal-row.test.ts` › "a goal says Goal and counts its steps to do, done and left for the user, zeros included" and › "a project with no kind is code and says what it said before"; check (2026-11-24, a still render): the Projects list with one code project and one goal.

## Steps

- [x] S1 (A1, A2). Runtime: the kind on the record, the add for a goal, and the words written as directions. hobkin f8e645f (`isGoal`, `writeDirections`) and fb8929c (`newProject`, `add project --goal`, a proposal drops `kind`).
- [x] S2 (A3, A4). Runtime: where a goal's run works, its plan, and the goal prompts. hobkin 264d461. Tested with the director's fake runs in temporary homes: no real agent has studied a goal or done a step.
- [x] S3 (A5, A6). Runtime: the refusals, the survey, and the status. hobkin f8e645f and 09dce9c.
- [x] S4 (A7, A8, A9). Host: the three commands. 01b5e47, 58f8afc, 9d16d65, c8d06c9, 254796a, and 2d96221 for the check against hobkin's own add. The Mac's chooser was never shown: every test hands in a fake.
- [x] S5 (A10, A11, A12). Window: the popup, the two buttons, and a goal's row. 4ffa52a, 88f7bdf, 8bed998, ac902f6, 922d0a5. Seen in still renders only.
- [ ] S6. In the app's own window: the two buttons, N, the chooser from Open, an add of a goal, and its row.

## Open questions

- Undoing a step from the window. Each step is a commit now, so the way back exists, and nothing in the window offers it yet.
- The first commit takes everything in the folder, large files included, into its `.git`. A folder of scans and PDFs doubles on disk.
- A goal has no page for its finished steps. Each is a line in Chat and a count on its row. A list of a goal's steps with their summaries would be the next thing to build.
- Changing a project's words after the add has no place in the window yet. The same popup opened on an existing project would do it.
- The folder chooser is the host's, shown by `osascript`. It has not been seen from the app, and it may open behind the window. The shell's own chooser would be certain, and needs a restart.

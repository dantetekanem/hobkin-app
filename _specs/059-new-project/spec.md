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

Work and YOLO mode each have a New project button. It opens a popup where the user names a folder, typed or picked in the Mac's own chooser, and says what they want from the project. Add puts the project in Work, taken, with those words given to every run there. A project does not have to be code. A goal is something to reach, kept in a folder that need not be a git repository: Work studies the folder, files steps toward what the user described, and does them in the folder itself, with no branch, pull request, review or merge.

The user, 2026-11-24: "I want to be able to add new projects to work mode and yolo mode, which is like a 'New Project' button. will open a popup, where I will put the folder (or open one), and describe what I want from this project. not every project in work mode needs to be a code project following the rules, can be just an achievement".

## Decisions

### What was there before

- A project reached Work two ways: hobkin's look through the Work folder proposed it, or `hobkin work add project <folder>` took it. The window had no way to add one. `addProject` refused any folder with no `.git` ("Not a git repository"), so a folder of documents could not be a project.
- Every look and every run on a project is given the text of `work/<slug>/directions.md` in hobkin's home, and both prompts treat it as the only project text that counts as instructions. Nothing wrote that file. The audit of 2026-11-24 is in `notes.md` beside this spec.

### Two kinds

- A project has a kind, `code` or `goal`. A record with no kind is code, so every project from before this spec is unchanged.
- Only the user's own add sets the kind. An agent's proposal cannot carry one.
- The guard everywhere is the kind, never "is this a git repository": git looks upward for a repository, so a goal's folder inside some other repository would otherwise be read as that repository.
- A folder with a git repository of its own can be either kind. A folder without one can only be a goal.

### The popup

- New project stands in the Projects heading of Work and of YOLO mode. N opens it on both pages. Escape closes it and the keyboard goes back to the button.
- Folder is a typed path, with `~` for home, and an Open button that shows the Mac's own folder chooser and writes what was picked into the field. The chooser is the host's: the app's shell has none, and adding one would need a restart.
- One line under the field says what hobkin sees there: nothing typed yet, a git repository, a folder that is not a repository, no folder, a file, a project Work already has, or another project that has its name. The line keeps its height in every state.
- Kind is Code or Goal, with one line that says what that kind means. It follows the folder until the user picks one: a repository starts as Code and any other folder as Goal. Code cannot be picked for a folder that is not a repository, and the line says why.
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

- A goal's runs work in the folder itself. There is no worktree and no branch, and nothing of hobkin's is written into the folder.
- Its study reads the folder and the user's words and writes where the goal stands and what comes next, then files the first steps. After that one look, at the project's own pace, reads what changed and what comes next. The code looks never run on a goal: no lenses, no state machines, no signals, no watch.
- A step ends `done` with a summary and what shows it, naming every file it wrote or changed. A step only the user can take, such as signing, sending or paying, is filed for the user and shows with what is left for them.
- A goal's run never sends, submits, signs, pays or deletes. The folder has no way back of its own, so a run follows the folder's own rules for keeping versions when it has any.
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

- A1. `hobkin work add project` takes a folder that is no git repository as a goal when asked for one, and still refuses it as code. A known project and a namesake are refused as before.
- A2. The words given with an add are the project's directions, and the study and every run on it are given them.
- A3. A run on a goal works in the project's folder, gets no branch and no worktree, and its item ends `done` with its summary.
- A4. A goal gets its study and then its own look, and none of the code looks. Its study and its runs follow the goal prompts.
- A5. YOLO mode files no readiness work on a goal and its switch is refused there. Pull request and issue settings, a branch or a pull request recorded on an item, and a branch adopted there are refused on a goal. The survey of unmerged branches skips it.
- A6. Work status carries a goal's kind and how many of its steps are done.
- A7. `work.project.look` says what is at a folder: missing, a file, a folder, a repository, the project Work has for it, and a namesake. It changes nothing.
- A8. `work.project.new` adds a code project or a goal with the user's words through hobkin's own function, refuses a goal with no words, and passes hobkin's refusal on in its words.
- A9. `work.folder.pick` answers with the folder picked or with none, and opens nothing in a test.
- A10. The popup's model: the line for each state of the folder, the kind following the folder until the user picks one, Code refused for a folder that is no repository, YOLO off for a goal, and what stands in the way of Add.
- A11. New project is in the Projects heading of Work and of YOLO mode, N opens it, Command+Enter adds, and no control moves when the folder's line, the kind's line or a refusal changes.
- A12. A goal's row says Goal with its steps to do, done and left for the user, and has no pull request or issue setting.

## Proof

Filled in from each lane's tests as they land.

## Steps

- [ ] S1 (A1, A2). Runtime: the kind on the record, the add for a goal, and the words written as directions.
- [ ] S2 (A3, A4). Runtime: where a goal's run works, its plan, and the goal prompts.
- [ ] S3 (A5, A6). Runtime: the refusals, the survey, and the status.
- [ ] S4 (A7, A8, A9). Host: the three commands.
- [ ] S5 (A10, A11, A12). Window: the popup, the two buttons, and a goal's row.

## Open questions

- A goal's runs change the user's own files with no way back kept by hobkin. The default taken: they work in the folder and follow its own rules for versions. The other choice is a history hobkin keeps for each goal outside the folder, so any run can be undone from the window. It costs a copy of the folder's files in hobkin's home and a second piece of work.
- Changing a project's words after the add has no place in the window yet. The same popup opened on an existing project would do it.
- The folder chooser is the host's, shown by `osascript`. It has not been seen from the app, and it may open behind the window. The shell's own chooser would be certain, and needs a restart.

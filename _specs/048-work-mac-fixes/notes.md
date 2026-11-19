# hobkin work fixes

This file is the one record of what we change. Changes stay local and are never committed. The repo is public, so company-specific names stay out of the code, the tests and this file. Company values live only in the local hobkin config.

Each entry says what was wrong or missing, what changed, where in words, how to redo it step by step, the tests that go with it, its status, and how to check it. No entry names code: no file lists, identifiers, function names, line numbers or snippets.

## Redesigns in progress

Two separate sessions redesign and rebuild parts of the app, each in its own pane. Each keeps its own decisions file, outside the repo, because those files name company systems. Each decisions file lists every file its session changes, so these entries point there instead of repeating the list.

- Work mode as a project manager: boards, columns and cards for tracked issues and review requests across code hosts, issue trackers and plain local folders, shown in the top menu, with work started from any item, and a redesigned queue. It owns the GitHub and Work screens, the top menu and navigation, and their host and protocol files. Decisions: the work mode design file in the private artifacts folder.
- The Home dashboard, rethought from the daily routine. It owns the Home feature and its spec. Decisions: the dashboard design file in the private artifacts folder.

## Running the app

### 1. Rust for the desktop shell

- Problem: Homebrew's Rust compiler on this Mac crashes on start, because it cannot load its LLVM library, and it comes first on the PATH.
- Change: none in the repo. Start the app with rustup's Rust first on the PATH.
- Where: this Mac's shell, outside the repo.
- How to redo it:
  1. Install Rust with rustup.
  2. In the shell that starts the app, put rustup's folder of programs before Homebrew's on the PATH.
- Status: done.
- Check: the desktop shell builds and the window opens.

### 2. hobkin checkout too old for the client

- Problem: the client loads hobkin's code from the sibling checkout. That checkout was 66 commits behind and lacked five files the client imports, so the host crashed on every start and the window said "Disconnected from hobkin".
- Change: the hobkin checkout is on the latest main, with its packages reinstalled, and the host restarted afterwards. A host that started while the packages were being reinstalled could not find Pi until it restarted.
- Where: hobkin's own checkout, the sibling folder the client loads hobkin from, outside this repo.
- How to redo it:
  1. Bring hobkin's checkout to its latest main.
  2. Install its packages again.
  3. Restart the host once the install has finished. A host started during the install does not find Pi.
- Status: done. Outside this repo.
- Check: the host log says the host is listening, with no missing module.

## Setup

### 3. Pi version check

- Problem: setup offered to install Pi when Pi was already installed. Pi prints its version on stderr, the client read only stdout, so it saw no version. It also wanted exactly the pinned version.
- Change: any Pi from 1.0 passes. The version is read from stderr when stdout is empty. A Mac without Pi still gets the pinned version installed.
- Where: the host's Pi install step and the setup protocol's version rule, with the install step's tests.
- How to redo it:
  1. Read Pi's version from its standard error when its standard output is empty.
  2. Accept any Pi from 1.0 on, instead of only the pinned version.
  3. Keep installing the pinned version on a Mac without Pi.
- Tests to write: a Pi that prints its version on standard error passes; 1.0 and newer pass and older versions do not; a Mac without Pi gets the pinned version.
- Status: done.
- Check: the Pi step does not show when Pi 1.0 or newer is installed.

### 4. Old Pi found first by the app

- Problem: setup said it found Pi 0.68.0. Starting the app through pnpm puts pnpm's global folder first on the app's PATH, and that folder still holds leftover program files of an old Pi from before its package was renamed. The terminal finds the right Pi elsewhere.
- Change: delete the two leftover program files (pi and pi-ai) in pnpm's global folder.
- Where: pnpm's global folder of programs on this Mac, outside the repo.
- How to redo it: delete the two leftover programs of the old Pi, pi and pi-ai, from pnpm's global folder of programs, then start the app again.
- Status: not done. Waiting for a yes.
- Check: setup finds Pi 1.5.0.

### 5. pi-search-hub optional

- Problem: setup required pi-search-hub. It should be optional.
- Change: a package can be marked optional. Setup neither asks for an optional package nor installs it. pi-search-hub is marked optional.
- Where: the shared list of Pi packages setup knows, and the host's install step, with its tests.
- How to redo it:
  1. Let a package in that list be marked optional.
  2. Make setup leave an optional package out both when it asks what to install and when it installs.
  3. Mark pi-search-hub optional.
- Tests to write: an optional package is neither asked for nor installed, and a required one still is.
- Status: done.
- Check: the packages step never lists pi-search-hub.

### 6. The launcher counts as an account

- Problem: setup asked for the OpenAI subscription although models are reached through the launcher in the hobkin config. The app checks accounts with Pi inside its own process, which never sees the launcher's providers or credentials.
- Change: when the hobkin config names a launcher, the host asks it for its models, as hobkin's own setup check does. The launcher shows as one connected account named by its command, and its models join the app's list, so the app also counts as signed in. The answer is kept five minutes, and asked again at once when the launcher changes.
- Where: a new part of the host that asks the launcher for its models, the host's account check and model list, and the description of hobkin's config the host reads, with tests for the new part.
- How to redo it:
  1. When the hobkin config names a launcher, ask it for its models the way hobkin's own setup check does.
  2. Show it as one connected account named by its command, and add its models to the app's list, so the app counts as signed in.
  3. Keep the answer five minutes, and ask again at once when the launcher in the config changes.
- Tests to write: a launcher's models make one account and join the list; the answer is kept, then asked again after five minutes or when the launcher changes; a launcher that lists nothing gives no account.
- Status: done. Checked against the real config: 223 models, the chat model among them.
- Check: setup says it found the launcher's account and offers the questions.

### 8. Work computer asks for the launcher

- Problem: on a work computer Pi often starts through a command the company provides, and a new home does not know it.
- Change: on a work computer with no account found, setup asks for that command. The host tests it by asking for its models, refuses one that lists none with what it printed, and keeps it as the launcher in the hobkin config. The main conversation then starts again behind it, the Pi check runs through it, and packages install through it. Setup does not ask on a personal computer, when the config already names a launcher, or when an account was found.
- Where: setup's story and its storyteller in the window; the host's launcher part, its start, its Pi install step, the command list and the setup protocol; with tests for the story, the install step and the launcher part.
- How to redo it:
  1. On a work computer where no account was found, add a setup question that asks for the command the company provides to start Pi.
  2. In the host, test the answer by asking that command for its models. Refuse one that lists none, with what it printed.
  3. Keep a good one as the launcher in the hobkin config.
  4. Start the main conversation again behind it, and run the Pi check and package installs through it.
  5. Never ask on a personal computer, when the config already names a launcher, or when an account was found.
- Tests to write: the question shows only on a work computer with no account and no launcher; a command that lists models is kept, and one that lists none is refused with what it printed; the Pi check and installs then go through the launcher.
- Status: done. Tested with unit tests. Not yet tried end to end on a new home.
- Check: run setup again on a work computer without a launcher, type the command, and the account is found.

### 11. Setup without an account comes back

- Problem: setup that ended with no account was marked as finished, so the next launch opened the existing home and the setup could not be finished.
- Change: setup told to the end with no account is marked unfinished. The next launch opens it again at the account step, and keeps whether the computer is personal or work. Skipping setup, or finishing it with an account, still marks it finished. The tour starts only for a finished setup. Spec 025 says the same now.
- Where: the window's first-run record, setup's store, story and storyteller, and spec 025, with setup's tests.
- How to redo it:
  1. When setup is told to the end with no account, mark it unfinished.
  2. On the next launch, open it again at the account step, keeping whether the computer is personal or work.
  3. Mark it finished when it is skipped, or when it ends with an account.
  4. Start the tour only for a finished setup.
  5. Say the same in spec 025.
- Tests to write: setup ended with no account comes back at the account step, the kind of computer kept; skipping it or finishing with an account marks it finished; the tour waits for a finished setup.
- Status: done. The saved mark on this Mac already says finished, so use Run setup again in Settings once.
- Check: end setup with no account, relaunch, and setup opens at the account step.

### 21. Max thinking for the launcher's models

- Problem: the thinking levels offered for a model stopped at xhigh, so max could not be chosen. On a Mac whose models all come through the launcher, every model got a fixed list of levels that left max out.
- Change: a thinking model that comes through the launcher offers every level, max too. Pi's model table says only whether a model thinks, and Pi brings a level down to what the model has, which hobkin already accepts.
- Where: the host's launcher part, with its tests.
- How to redo it:
  1. For a model that comes through the launcher and thinks, offer every thinking level, ending with max, instead of a fixed list that stops at xhigh.
  2. Rely on Pi to bring a level down to what the model has.
- Tests to write: a launcher model that thinks offers every level, ending with max; one that does not think offers none.
- Status: done. Checked in a browser tab: Change models now offers max after xhigh for the lead and every tier. One call through the launcher with max thinking on the high tier's model answered.
- Check: Settings, Models, Change models: each tier's levels end with max.

## Routines

### 20. Routines remember which groups are open

- Problem: a group the user folded or opened on the Routines screen, such as Every day, went back to its default whenever the screen was left or the window reloaded.
- Change: each group's choice is kept with the screen's view in the window's own storage. A group the user never touched still follows what is due. Opening a routine from the sky still opens its group, so the keyboard has a row to come back to. Only the screen's own groups, each open or folded, come back from storage.
- Where: the Routines screen's store and its lists, with a new test for the store.
- How to redo it:
  1. Keep each group's choice, open or folded, with the screen's view in the window's own storage.
  2. Let a group the user never touched follow what is due, as before.
  3. When a routine is opened from the sky, still open its group, so the keyboard has a row to come back to.
  4. Bring back from storage only the screen's own groups, each open or folded, and ignore anything else there.
- Tests to write: a choice comes back after a reload; an untouched group follows what is due; unknown groups and values in storage are ignored; opening a routine from the sky opens its group.
- Status: done. Checked in a browser tab: Every day opened stayed open after leaving for Reports and coming back, and after a reload; folded again, it was kept folded. Not checked: an app restart, which uses the same storage as the theme and the view choice.
- Check: fold or open a group, reload the window, and the group is as you left it.

### 7. Weekday routines under Every day

- Problem: routines that run Monday to Friday were listed under Every week.
- Change: a weekly routine that runs exactly Monday to Friday is listed, and walked by the keyboard, with the daily ones. Its file stays in the weekly folder.
- Where: the Routines screen's rules and its lists, with the rules' tests.
- How to redo it:
  1. Treat a weekly routine that runs exactly Monday to Friday as daily, for the list and for the keyboard's walk.
  2. Leave its file in the weekly folder.
- Tests to write: a Monday-to-Friday routine is listed under Every day, and other weekly ones stay under Every week.
- Status: done.
- Check: the Routines screen lists the weekday routines under Every day.

## Main chat

### 24. The main chat compacts by size

- Problem: every message in the main chat was slow. Across the 57 turns of November, half took 25 seconds or more. Model calls were 86% of that time, and a message takes about three of them. Each call reads the whole chat again, and the chat had grown to 328,000 tokens, last compacted on October 30. hobkin compacts the main chat ahead of time only from 80% of the model's window. The models used here have a window of a million tokens, so that point was 800,000 tokens away. After any pause of several minutes the first call waited 6 to 15 seconds for its first word, against 1.3 to 2.7 seconds for a conversation of 80,000 to 100,000 tokens on the same Pi. On 43% of the turns the cached copy had run out, and sending the chat again cost $1.26 to $2.63 each time.
- Change: the main chat is also worth compacting ahead of time once it holds 160,000 tokens, which is where a window of 200,000 tokens reaches its 80%. So a window of 200,000 or less behaves as before, and a bigger one compacts at that size. The rest of the rule is the same: only when the chat has been quiet for two minutes and nobody needs it soon, and it gives way to the user's next message. Size alone never forces a compaction, and forcing still starts at 95% of the window. hobkin's guide says the same now.
- Where: hobkin's own checkout, the sibling the client loads: the rule that decides when the main chat compacts, its tests, and the sentence about it in the guide.
- How to redo it:
  1. Find the rule that decides whether the main chat should compact. It is given how full the window is. It answers forced from 95%, and at a good moment from 80% when the chat is free, has been quiet for two minutes, and either other agents are working or the next scheduled run is at least two hours away.
  2. Give that rule the chat's size in tokens as well. The place that calls it already has the size next to the percentage.
  3. Make the chat worth compacting at a good moment from 80% of the window or from 160,000 tokens, whichever comes first. Leave every other condition and the forced level as they are. A size nobody knows is no reason.
  4. Update the guide's sentence about when the chat compacts.
- Tests to write, two:
  1. A chat of 160,000 tokens that fills 16% of its window compacts at a good moment, and so does one of 328,000 tokens. One of 159,999 tokens does not, and neither does one whose size is not known.
  2. A big chat still waits for the good moment: not when it was used a minute ago, not while it is busy, not with a run coming in half an hour, and not with Pi's own compaction turned off.
- Status: done, in hobkin's checkout, uncommitted. The two tests pass, and so do the existing ones about compacting. Seen on the real chat on November 15: the app started again with the change, and the chat compacted by itself at once, from 334,496 tokens, in 37 seconds. How fast the next message is has not been measured yet.
- Limits: expected, not measured yet: the first message after a pause still waits longer than the next ones, but closer to what a small conversation waits than to the 6 to 15 seconds of today. A message still takes about three model calls when the main hobkin uses tools before it answers.
- Open: keeping the cached copy warm between messages would remove most of the wait after a pause. It costs a model call every few minutes, so it is not done. The main hobkin also asks the window to describe a command before it runs it, which is one more model call the first time it uses each command.
- Check: start the app and leave the chat quiet for two minutes. hobkin says it is compacting, and afterwards the chat's size is a small part of what it was. Then send a message after a pause of ten minutes. That turn's timing record in the home's events file shows the model's first word within a few seconds.

### 28. Hobkin's mind keeps time as agents' canvases do

- Problem: hobkin's mind timed the main agent's steps only while it was open. Opened late, every earlier step was stamped with the moment it opened, so the times on its steps were wrong. Between steps it said "Thinking" with no time, where an agent's canvas says "Thinking · 12s".
- Change: the window times the main agent's steps from the moment the host sends them, whether the mind is open or not, the way it times agents' steps. Between steps, the mind says what the agent is doing and for how long, as an agent's canvas does, counting from the turn's start as the host gives it when that came after the last step.
- Where: the window's shared timing of agents' activity, and the mind's rules and screen, with the mind's tests.
- How to redo it:
  1. In the window's background timing of agents' steps, also time the main agent's steps each time the host sends them, under the main agent's own key, with the same rule: seen when first sent, and started and ended for a tool call first seen running.
  2. Take the turn's start from the host's running main conversation, as the chat's own count of a turn does.
  3. Have the mind read those times instead of keeping its own while it is open. A sample keeps its own times, as an agent's sample does.
  4. Between steps, show the word for what it is doing and, from two seconds on, how long it has been quiet: since its last step, or since its turn began when that came later, in seconds under a minute, then minutes and seconds.
- Tests to write: the quiet time from the last step, from a turn that began after it, before the first step, with nothing to count from, and never below zero.
- Status: done, uncommitted. The window's unit tests pass, but for the four that failed before this change. Not yet seen in the window.
- Check: send hobkin a message, wait, then open its mind with Command+J. Earlier steps show their real durations, and between steps it says "Thinking" with the seconds counting up.

### 29. Every step in an agent's window says when it was received, history included

- Problem: an agent's window did not say when anything in it arrived. hobkin kept no time for an agent's steps, so even the window's own guess, when it first saw a step, was empty for everything that came while it was closed, such as a routine's whole run. Two earlier tries missed: one changed how long things take into hh:mm:ss, and one put a time only under the agent's words, from when the window saw them. Both are replaced, and durations count as before ("8s", "1m 05s").
- Change: hobkin stamps each step of an agent's work with the time it first receives it: a stretch of the agent's words, a command, a tool call, a search. The time stays with the step, so a finished agent, or a routine that ran with no window open, still shows it. In an agent's window, hobkin's mind and a durable hobkin's page, every step starts with that time, as hh:mm:ss on the Mac's clock, in a narrow column at the start of its row, the way a log reads. A step from a hobkin from before has the window's first sight of it, or no time when it was already there as the window opened. The user's messages show under them when they were sent. On a hobkin's page, the message that began a turn shows when it was asked, and an answer that came with no steps shows when its turn ended. A report's saved run shows, in each entry's heading, the time Pi wrote it.
- Where: in hobkin's own checkout, the part that builds agents' steps from Pi's events, with its tests; tests that compared whole steps now leave the time out and check that every step has one. In this repository, the shared shape of a step, the step rules, the agents' step views, a small time part in the window's shared library, the agent screen's sent messages, a durable hobkin's page and its rows, the saved run view and the shared timing of agents' activity, with tests.
- How to redo it:
  1. In hobkin, give the part that builds steps a clock, and stamp each step with its time when the step first appears. Keep that time as the step grows and as its call runs and ends.
  2. Carry the time in the shared shape of a step; the host passes steps on whole.
  3. In the window, take a step's time from hobkin, else from when the window first saw it, unless it was already there when the window first heard from the host.
  4. Draw every step with its time in a fixed narrow column at the start of its row, nudged down to sit on the step's first line, and keep the column when the time is not known.
  5. Under each message the user sent, show when it was sent. On a hobkin's page, give the message that began each turn its asked time, and show under an answer when its turn ended.
  6. In a saved run, add to each entry's heading the time Pi wrote on it.
  7. Keep the durations of steps, the Thinking lines and the chat's count of a turn in seconds, then minutes and seconds.
- Tests to write: in hobkin, a step keeps the time it first arrived while its words grow and its call runs and ends, and a later call gets its own; in the window, a step's time from hobkin, from the window's first sight, and none when it was there as the window opened; times read as text or milliseconds; the formatter at a few times of day; durations and the turn count still in seconds, then minutes and seconds.
- Status: done, uncommitted. The new tests pass in both repositories. hobkin's suites keep only the seven failures they had before this change, checked with and without it. The client's suites pass, but for the 27 that failed before. Not yet seen in the window; the running host loads hobkin's side on its next restart, and steps received before that have no hobkin time.
- Check: after the next run of a routine, open its window: every row starts with a time, such as 10:30:01, also when the window was closed while it ran. A report's saved run shows the time in each entry's heading.

### 30. A hobkin's page always narrows beside its sketch

- Problem: when a durable hobkin drew a sketch, the window formed the split around it: the right side grew over the chat, the menu moved over the sketch, and the sketch came in on the right. The page stayed full width on top of the sketch, so its steps drew over it. The page's narrowing was set only when the window caught the split changing while the page was on screen, so a change it missed left the page wide.
- Change: on every draw, the page's inset is checked against where it should be: the sketch's width while its split shows, and nothing otherwise. When it is there or on its way, it is left alone. The split forming or undoing on the page still travels on the split's spring. Anything else, such as arriving on the page, a resize, Still or a split it missed, puts it there at once.
- Where: the window's frame, where a hobkin's page and its sketch share the right side, and the view store's rules, with the canvas tests.
- How to redo it:
  1. Keep where the page's inset was last sent.
  2. On every draw, work out where it should be.
  3. When the page is on screen and the two differ, let it travel when the split formed or undid on the page, and put it straight there otherwise.
  4. Leave a page on its way out as it is.
- Tests to write: the split forming and undoing travel; a draw that finds it in place leaves it; a split shown with the page still wide is put right at once; a resize, arriving on the page and Still put it straight there; a page on its way out keeps its width.
- Status: done, uncommitted. The unit tests pass. Not seen in the window: the cause was read from the code and a screenshot, not reproduced, so a page that still sits over its sketch needs a look in the running app.
- Check: with a hobkin's page open, let it draw a sketch. The page narrows to the chat's width with the sketch beside it, also after leaving the page and coming back.

### 31. An approval carries only what the user wrote

- Problem: approving a pull request posted text the user did not write: a first line saying hobkin wrote the review, "Approved." when the user wrote nothing, and notes hobkin had written itself. The user's rule: nothing automated, no comments and no communication from hobkin unless they say so.
- Change: an approval carries the user's own words in its body and their own comments on lines, exactly as written. Nothing of hobkin's goes with it: no line saying hobkin wrote it, no filler, and none of hobkin's own notes. With nothing written, it is an approval with no words. Approve and merge on the user's own pull request, where their approval would not count, posts their words as a comment in the same way, and posts nothing when they wrote nothing. Comment and Ask for changes followed in entry 41.
- Where: the shared rules for what a verdict posts, and the review code that builds Approve and merge, with the verdict tests.
- How to redo it:
  1. Build an approval from the user's notes only, leaving out every note hobkin wrote.
  2. Put the user's summary and their notes without lines in its body as they wrote them, and their notes on lines as line comments, with no added first line and no filler.
  3. Count an approval with no words and no line comments as one that says nothing.
  4. For Approve and merge on the user's own pull request, post that same text as a comment, and skip it when it says nothing.
- Tests to write: an approval with nothing written has no words; an approval with a summary, a note on lines, a note on a step and a note of hobkin's carries the first three as written and not hobkin's; the preview of an approval shows only the user's words.
- Status: done, uncommitted. The unit tests pass, but for one about the specs' format that failed before.
- Check: approve a pull request without writing anything: it gets an approval with no text. Approve with a sentence: it gets exactly that sentence.

### 32. Leaving the agents list goes back to the agent window it was walked from

- Problem: on an agent's window, walking the agents list under the input previews each agent in turn. Leaving the list should end the preview, but from an agent's window it did not: hobkin remembered only a screen to go back to, and an agent's window is no screen of its own, so the window stayed on the last agent previewed, away from the one the user started on.
- Change: a walk that starts on an agent's window remembers that agent, and leaving the list goes back to it, still closing later to where it was first opened from. Choosing an agent from the list, or stepping into its window, keeps that agent, as before. A walk from any other screen goes back to that screen, as before.
- Where: the window's view store, with the canvas and view tests.
- How to redo it:
  1. When a preview starts on an agent's window, keep that agent; keep nothing new while the walk goes on.
  2. When the walk ends without a choice, open that agent's window again.
  3. Forget it when an agent is chosen, when the agent's window closes, and whenever the view moves to another screen, Settings or the main canvas.
- Tests to write: walked from an agent's window, leaving comes back to it, and it still closes to where it was opened from; an agent chosen from the list stays; walked from a screen, leaving goes back to the screen.
- Status: done, uncommitted. The window's unit tests pass, but for the four that failed before. Not yet seen in the window.
- Check: open an agent's window, press Down into the agents list, walk to another agent, then press Escape or click outside the list: the first agent's window is back.

### 33. A working agent's model and effort change from its message box

- Problem: an agent's model and thinking level were fixed when it started. Nothing could change them while it worked, and a durable hobkin kept its own until it was ended.
- Change: in an agent's message box, or a durable hobkin's, a line "/model" and a model, or "/effort" and a thinking level, changes how it works instead of being sent to it. The agent takes the change from its next step. A durable hobkin on Pi, or on a tier, also keeps it for every later turn, and one that is waiting starts its next turn with it. The model is a full provider and model, or a short name that only one model Pi can use now matches, and the level must be one that model offers. The answer shows under the box: what it works on now, or why not. A hobkin on Claude Code, hobkin's own conversation, an agent that has finished and a sample agent are refused with a reason.
- Where: in hobkin's own checkout, the part that runs Pi processes, the runtime and the durable hobkins, with a new test. In this repository, the host's agent and hobkin commands, the rule that turns a short name into a model, the command list, the shared list of thinking levels, and the message boxes of the agent screen and of a hobkin's page with a small rule for the slash lines, with new tests.
- How to redo it:
  1. In hobkin, give each running agent's process handle a way to change its model and thinking level: send Pi's own setters for only what changed, then ask Pi what it holds, and answer with that. A durable hobkin's turn handle does this only while its turn runs.
  2. In hobkin's runtime, let a working agent's run change. Refuse a run that is not working, not admitted, hobkin's own conversation, or whose process has closed. Record on the run what Pi now holds, and leave anything Pi did not say as it was.
  3. In hobkin's durable hobkins, let a hobkin change by saving a Pi engine with the new model and level for its next turns, and passing only what changed to the turn in flight. When that turn ends meanwhile, keep the change for the next turn and say why the turn did not take it. Refuse a hobkin on Claude Code, before reading anything, and an ended one.
  4. In the host, add one command that changes a working agent by its run and one that changes a durable hobkin. Before either, turn a short model name into the one model Pi can use now that it names: an exact id first, else a part of its id or name, and when several match, list up to five back. Check the level against that model, or against the model it is on. A durable hobkin's turn changes through its hobkin, so its later turns keep the change. A runtime from before says to restart the app.
  5. In the window, read a message-box line that starts with /model or /effort as a change, not a message: one model after /model, one of Pi's levels after /effort, and otherwise say what to write. Send it, show the answer under the box, and on a refusal show why and give the words back.
  6. Keep Pi's thinking levels in one shared list that the command list and the window both read.
- Tests to write: a short name made full, an exact id over a longer one, several matches listed, none, a level the model lacks, a level alone with no known model, and nothing asked; a working agent changed with only what changed passed on, and a finished one, hobkin's own conversation and a refused level reaching nothing; a durable hobkin's turn changed through its hobkin; a runtime from before; a hobkin's answer when its turn took the change, when none was working and when the turn ended meanwhile; the slash lines and the words that are not slash lines; in hobkin, the process taking only what changed and refusing a model without its provider, the run recording what Pi holds and refusing every run that is not working, and a hobkin saving the change, waiting or working, while one on Claude Code, an ended one, nothing asked and an unknown level save nothing.
- Local only: nothing is posted. The change lasts for the agent's session and its hobkin's saved settings, not Pi's defaults.
- Status: done, uncommitted. The new tests pass in both repositories. hobkin's process and hobkins suites pass; its runtime suite has 11 failing tests, all on one missing call in the main chat's session code, which this change does not touch. The client's suites pass, but for the 27 that failed before. Not tried on a live agent: the running host loads it on its next restart.
- Limits: no keyboard shortcut yet, only the slash lines. A waiting hobkin on a tier has no known model, so a level alone needs the model with it. The main conversation's model stays in Settings.
- Check: while an agent works, type /effort high in its box. Under the box it says "It works on … at high from its next step.", and its next step runs at high.

### 34. Work's hobkin page draws when the user comes to it

- Problem: Work's first page, hobkin's own work, came up empty when the user came to it from another screen, such as GitHub, or from another of Work's tabs, such as a board or AI Reviews. Only a reload while on it drew it. The page's pieces land on an arrival that comes from above them: the screen's, when it travels in. When the page mounted after that arrival, as when its tab was set just after the screen moved, or when hobkin's work came in after the page had landed, its pieces waited for an arrival that had passed and stayed hidden.
- Change: each Work page now brings its pieces in itself as it arrives. It slides in the way it came along the menu's second row, or only fades in under Still, and its pieces land with it. The queue, the finished changes and the projects, which wait for hobkin's work, bring themselves in when it comes. Leaving the Work screen, the screen still goes the way it did, but the page's pieces no longer fade out one by one.
- Where: the Work screen, where it shows the page in front and where hobkin's own work page lays out its sections.
- How to redo it:
  1. Give the box that holds Work's page in front the two moments its pieces wait for, arriving and in place, with the slide or the Still fade on them.
  2. Start it at arriving and send it to in place each time a page comes to the front, so its pieces land with it.
  3. Hold the sections that wait for hobkin's work in a box of their own that does the same when the work comes, with the same spacing between them.
- Tests to write: none run in the unit tests, since this is the window's motion; the change was checked by reading the code and by the window's suites still passing.
- Status: done, uncommitted. The window's unit tests pass, but for the four that failed before. Not yet seen in the window.
- Check: go from GitHub to Work: the hobkin page's header, agents, queue, finished changes and projects are all there without a reload. Do the same from a board's tab and from AI Reviews.

### 35. A board opens on what hobkin already read, and reads again only on its timer or when asked

- Problem: opening a board read it again whenever its last read was more than a minute old, so nearly every open started a fresh read: its lanes swept, the refresh mark spun, and the cards changed under the user. The GitHub board read all of GitHub again. It felt like a reload on every click, and it lagged.
- Change: opening a board never reads it. The board shows the cards the host already keeps, at once. The host still reads every board on its own timer in the background, every ten minutes unless the board sets its own interval, and a board set to be read only by hand waits for that. The user still reads a board at once with its key or its refresh button.
- Where: the board page in the window.
- How to redo it:
  1. Take out the board page's read as it opens, and the age it read from.
  2. Keep the host's timed reads and the board's read key and button as they are.
- Tests to write: none run in the unit tests, since the read was the page's own effect on opening; the window's and the boards' suites still pass.
- Status: done, uncommitted. The window's unit tests pass, but for the four that failed before. Not yet seen in the window.
- Check: open a board, go to another page and open it again: its cards are there at once, with no sweep and no spinning refresh mark. Its "Read … ago" line grows until the next timed read.

### 36. A board lane for reviews asked for in chat channels (local setup only)

- Problem: the user's review board listed what the review host says is asked of them and of their teams, but not the reviews people ask for by posting a link in a chat channel. An older tool of theirs tracked those, and it no longer runs.
- Change: the review board has one more lane, "Asked in channels". Every fifteen minutes a small local program reads the user's chosen channels through the company's tool gateway, with no model in between, and finds the review links in their messages, including links through the preview sites people build for the review host. It keeps the last week, looks each pull request up on the review host, and lists the open ones that are not the user's own and that the user has not approved since they were asked. Each card says in which channel it was asked and, once the name is known, by whom. Nothing in either repository changed: the board already runs any program as a lane.
- Where: the user's own settings folder: the boards file, a settings file for the program with its channels, and the program with its cache.
- How to redo it:
  1. Write a program that gets the gateway's token the way the user's agent setup does, opens one session with the gateway, and reads each channel's history since its last poll, less ten minutes, and at most a week back.
  2. Search only the messages' links for the repository's pull requests: the review host's links, and preview-site links whose route holds a large enough number after a slash, an equals sign or a hash.
  3. Keep the newest ask of each pull request, drop asks older than a week, and look up the people who asked a few at a time. Profiles are rate limited, so wait as long as a refusal says, and never keep a refusal as a name.
  4. Look each pull request up on the review host, with a few at once, and keep only the open ones that are not the user's own and that their own last review has not approved since the ask. When a lookup fails, show the pull request as it was last read.
  5. Print them as the review host gives them, newest ask first, with where and by whom as labels, and keep a small cache.
  6. Add a lane to the review board that runs the program every fifteen minutes with a two-minute limit, counted with the team asks, not as waiting on the user.
- Tests to write: none in the repositories. The program was run by hand: a first poll of a week took about fourteen seconds and found twelve open pull requests; later polls take about ten.
- Local only: everything here is in the user's settings folder.
- Status: done. The running host picked the lane up on its own and read it without an error.
- Limits: names fill in over a few polls because of the rate limit. A pull request asked in a channel and also of the user's teams shows in both lanes. A host opened without the user's login session cannot get the token, and the lane then shows that error and keeps its last cards.
- Check: open the review board: "Asked in channels" lists the pull requests posted for review in the chosen channels this week, each with its channel.

### 37. The list of AI reviews says who each pull request is from

- Problem: the list of AI reviews named each pull request's project, number and title, but not its author. Only the review panel, once opened, said who it was from (entry 27).
- Change: each pull request's row says who it is from on its top line, after its kind, the way the panel does: "By" and its author, or "By" the agent that opened it, "for" whoever asked. The row is itself a button, so the names are words, not links; the panel keeps the links. The window asks the host once for each review while it is open, and the list and the panel share the answer, so opening a review from the list asks nothing again. A question the host could not answer is asked again the next time. A finished change names nobody, as before.
- Where: the review part of the window: a small shared piece that asks the host for a review's people and keeps the answers, the panel's by-line rules, the panel's header, and the rows of the list of AI reviews, with the by-line test.
- How to redo it:
  1. Keep one answer per review, asked of the host once, and forget an answer that failed.
  2. Let the panel's by-line and the list's rows both read from it.
  3. Add a rule that writes the by-line as words, and show it on a pull request's row after its kind, letting it shorten before the time does.
- Tests to write: the by-line as words for an author, for an agent and who asked, and as nothing when it names no author.
- Status: done, uncommitted. The window's unit tests pass, but for the four that failed before. Not yet seen in the window; asked of the running host, the twelve ready reviews each came back with their people.
- Check: open Work's AI Reviews: each pull request's row says "By" and a name on its top line, and an agent's says "By" the agent, "for" who asked.

### 38. A review's graph draws the English locale and leaves the other translations out

- Problem: a change that adds a string to every language changes one file per language, and the review gave each of them a node. A change with fifty languages drew a tall column of fifty tiny nodes, and the code that mattered was lost beside it.
- Change: the review's graph leaves out every translation of the English source: a file the change review reads as a locale, with a real language code that is not English. It draws the English file, the code and everything else as before. The change still lists every file, and the review says how many translations it left out and that they are still in the change. The AI review's own reading is as it was: one locale read whole, and every other checked for every key.
- Where: the part that drafts a review's nodes from the change, which now reads the change review's locale rules, and those rules, which now share their language-code rule; with a new test.
- How to redo it:
  1. Take the change review's way of reading a path as a locale, and count as a translation any file it reads with a real language code other than English.
  2. Draft the review's units, file nodes and every connection between them from the change without those files, and keep the full list of the change's files.
  3. When any were left out, add a notice that says how many, that only the English one is drawn, and that they are still in the change.
- Tests to write: a change with code, the English locale, two other locales in a locale folder and a Rails-style named one draws the code and the English file, leaves the three out, still lists all five files, and says so.
- Status: done, uncommitted. The unit tests pass, but for one about the specs' format that failed before. The host loads it on its next restart, and a review already built keeps its nodes until it is built again.
- Check: after a restart, rebuild a review of a change that adds a string to many languages: the graph shows the English file and the code, and the review says how many translations it left out.

### 39. The hobkin's hood has its tip bent over, like a wizard's hat

- Problem: the character was a straight, even cone with two eyes, and in white it could read as a hate group's hood.
- Change: the tip of the hood now bends over to one side, like a wizard's hat. The body, its flat foot and the eyes are where they were, so every face, mood and size draws as before. The same shape is used by the character everywhere in the window, the small mark, the page icon, and the app's icon, whose image files were made again from it.
- Where: the character's shape in the window's avatar, the window's page icon, and the app's icon and its image files.
- How to redo it:
  1. Keep the hood's left side, right side, foot and eyes, and change only its top: the left side rises to a tip that bends over to the right and comes back down into the right side.
  2. Use the same shape for the window's character, its mark and its page icon.
  3. Put it in the app's icon picture and make the app's icon files from it again, keeping only the six the app uses.
- Tests to write: none new; the window's suites still pass, including the one that places the character in onboarding by its proportions.
- Status: done, uncommitted. The window's unit tests pass, but for the four that failed before. The window draws it at once; the Dock and the app's own icon take it when the app is next started.
- Check: look at hobkin by the message box, an agent in the list and the app's icon: each hood's tip bends over to the right.

### 40. A pull request's name at the top of its review opens it

- Problem: the review panel's top line named the pull request, its repository and number, but it could not be clicked, so opening the pull request meant finding it some other way. Making it a link was not enough: the window's strip that drags it runs along the top of the canvas over every screen, and during a review it lay over the panel's top line, so a click there dragged the window instead. The panel's hide and close buttons, on the same line, were under it too.
- Change: for a pull request, that line is a link to the pull request's own page on the host it lives on, opened in the browser as every link in the window is. It is always underlined, the way the panel's other links are. A finished change's line names its project and is not a link. The drag strip now begins where the part of the review panel on screen ends, following it as it hides and comes back, so the panel's top line takes its own clicks and the rest of the top still drags the window.
- Where: the review panel's header and its panel, and the window's frame, where the drag strip is.
- How to redo it:
  1. Make the pull request's page address from the review's own identity, with the rule that already does it for the GitHub page's rows.
  2. Wrap the icon and the repository and number in an underlined link to it, and keep the project line of a finished change as it was.
  3. Have the review panel tell the frame where its part on screen ends, as it moves, and stop telling when it goes.
  4. Cut the drag strip's left side back to that edge, so it takes no clicks over the panel.
- Tests to write: none new; the rule that makes the address is tested for a named host and for GitHub, and the strip is the window's layout.
- Status: done, uncommitted. The window's unit tests pass, but for the four that failed before. Not yet seen in the window; the cause was read from the code.
- Check: open a pull request's review and click its underlined repository and number at the top: its page opens in the browser. The hide and close buttons beside it work by click, and the empty top of the canvas still drags the window.

### 41. Every review posts only the user's own words, and a pull request is commented on or approved

- Problem: a comment the user posted on a pull request went out as hobkin's: a first line saying hobkin wrote the review, "Commented." as filler, and the user's own question folded away under "See more". Ask for changes was built the same way, hobkin's own notes went with both, and a pull request's closing comment had the same first line. The user's rule: these are their comments, posted as they wrote them, as their review tool does, and on a pull request they only comment or approve.
- Change: every review of a pull request carries exactly what the user wrote and nothing of hobkin's: their summary and their notes without lines in its body, and their notes on lines as line comments, unfolded, with no added line and no filler. hobkin's own notes never go with it, and they stay unsent. A review with no words of the user's leaves its body out, as an approval or one with only line comments. A comment with nothing in it is refused before anything is sent, and so is a request for changes with no words. The words a pull request gets before it is closed unmerged go as the user wrote them. A pull request's panel offers Comment and Approve, and on the user's own, Approve and merge and the two discards, but no longer Ask for changes. A finished change keeps Send fixes, its note to hobkin's work agent. One confirmation posts once: a second click with it is refused, so the same words never go twice.
- Where: the shared rules for what a verdict posts, the review code that previews, refuses, posts and marks notes sent, and the review panel's choices, with the verdict and publication tests.
- How to redo it:
  1. Build every pull request review from the user's notes only: their summary and their notes without lines in the body, each with what it is about, and their notes on lines as line comments, all as written.
  2. Count a review with no body and no line comments as one that says nothing, and leave an empty body out of what is sent.
  3. Refuse a comment that says nothing and a request for changes with no words, with a plain reason, before anything is sent.
  4. Send the words for a closing pull request as the user wrote them.
  5. After a post, mark only the user's notes on a pull request as sent, and remember the confirmation it used, so it cannot post again.
  6. Take Ask for changes out of a pull request's choices, and keep Send fixes for a finished change.
- Tests to write: a comment, an approval and a request for changes each carry the user's words as written and none of hobkin's notes, on lines, detached or general; a long summary goes unfolded; a comment with nothing is refused and a request for changes with no words too; the real publisher posts the previewed words once, refuses the same confirmation again and leaves hobkin's note unsent; a closing comment goes as written; a pull request's choices are approve, approve and merge, comment and the two discards, and someone else's are approve and comment.
- Status: done, uncommitted. All the suites pass, but for the 27 that failed before. Not yet seen in the window.
- Check: comment on a pull request with one sentence and one line comment: the pull request shows that sentence as the review's body and the line comment as written, with nothing else. The panel offers Comment and Approve.

### 42. The user's review words have their grammar fixed before they post

- Problem: what the user wrote went to the pull request exactly as typed, mistakes included. Their own review tool fixes grammar before it posts, and posts without asking again when the fix is only grammar.
- Change: before a review of a pull request goes, its words are checked by a model on the quick tier, the one the AI review's blind check uses. One pass corrects grammar, spelling, capitalization, punctuation and awkward word order, keeping meaning, tone, code, names and numbers. A second pass compares each correction with the original and says whether it changes only grammar, and says no when unsure. A correction that is only grammar is made, and the confirmation says how many places were fixed and shows the text that goes. One that could change what the user meant is not made: their words go as written, and the confirmation shows them beside the suggestion. When the check cannot run, as with no quick model set, the words go as written and the confirmation says why. Each text is checked once, so the confirmation and its yes send the same words. It covers a review's body, its comments on lines, the words of Approve and merge, and the words a pull request gets before it is closed unmerged. A host that asks no models checks nothing.
- Where: a new shared part for the grammar check and its rules, the review code that builds what a verdict posts, and the host's review setup, which gives it the quick model; with new tests.
- How to redo it:
  1. Write the two instructions: a grammar editor that returns the texts in the same shape, and a strict checker that marks each changed text as grammar-only or not.
  2. Read both answers strictly: the same number of comments, a body only when there was one, and exactly one judgment for each change; anything else is an error and changes nothing.
  3. Make only the grammar-only corrections, and keep the others as suggestions.
  4. Before a verdict is shown, check its body and line comments, keep the answer for those exact texts, and put the fixed text in what is shown and sent, with lines that say what was fixed, what was only suggested, or why nothing was checked.
  5. Do the same for Approve and merge and for the words of a closing pull request.
  6. Give the live host's reviews the quick tier for it, with a minute for each pass, and give a host that asks no models none.
- Tests to write: a grammar-only fix is made and a meaning fix is only suggested; nothing to fix asks the second pass nothing; a malformed answer or a failing model leaves every word as written; through the review code, the preview shows the fixed body and the comment as written with both lines, its yes sends exactly that, the texts were asked once, and a failing check posts the words as written and says why.
- Status: done, uncommitted. All the suites pass, but for the 27 that failed before. Not yet tried on a live pull request; the host loads it on its next restart.
- Check: comment on a pull request with "this dont handle the retry": the confirmation shows "This doesn't handle the retry." and says one place was fixed, and the pull request gets that text.

### 43. A node's code opens on its own lines, with the file's other changes folded away

- Problem: opening a node's code showed every change in its file, each with its surroundings, so in a file with many changes the node's own change came after all the others. In one review, a method's two added lines were row 179 of 192, and reaching them depended on the panel scrolling exactly that far through lines that wrap, or on the user scrolling there.
- Change: when the code panel points at a node's lines, it shows those lines and the changes among them, with three lines around them. The file's other changes wait behind the gaps above and below, which open with "show more" as before, and "Whole file" still shows every line. With nothing pointed at, every change shows as it did. In that review the panel now has 42 rows, starts with a gap of 156 lines, and opens at row 29, the node's change.
- Where: the code view's rules for which rows show, with its tests.
- How to redo it:
  1. When the view points at lines, keep only the groups of changes that touch those lines, plus the pointed lines that hold no change, as what must show.
  2. Fold everything else into gaps as before, and keep the whole-file view and the expanding gaps as they were.
- Tests to write: a file with a change near its top and a node's change far below opens with a gap first and the node's change near the top, from just above its first line; with nothing pointed at, every change shows; the whole file shows every change, the node's marked and the others unmarked; a node whose lines hold no change shows only its lines.
- Status: done, uncommitted. The window's unit tests pass, but for the four that failed before. Checked on the saved review's own file, not yet in the window.
- Check: open a node in a file with other changes above it: its code shows at once near the top of the panel, and "show more" or "Whole file" brings the rest.

### 44. A long conversation draws only its newest steps

- Problem: an agent's page drew every step of its run, and a durable hobkin's page every row of its conversation. Each change in a file worked out its diff, so a long run with many code changes was slow to draw and held a lot of memory, even for steps far above the screen.
- Change: both pages draw only the newest forty steps or rows. A row above them says how many came before and draws forty more each time it is pressed. New steps still arrive at the bottom, and the newest forty stay drawn as they do. Opening another agent or hobkin starts again from its newest. A step that is not drawn works out no diff and adds nothing to the page. hobkin's mind needs none of this, since hobkin keeps only its latest steps there.
- Where: a small shared rule for the window, the agent step views, which hold the row for earlier steps, the agent screen and a durable hobkin's page, with a test.
- How to redo it:
  1. Keep how many of a conversation's newest steps are drawn, forty to start, for each conversation by its own name.
  2. Draw only that many from the end of its steps, and above them a row that says how many came before and draws forty more.
  3. Start again from forty when another conversation opens.
- Tests to write: a short conversation draws every step; a long one starts at its newest forty; each press draws forty more and never past the first; a new step keeps the newest forty drawn.
- Status: done, uncommitted. The window's unit tests pass, but for the four that failed before. Not yet seen in the window.
- Limits: what each step holds still arrives whole, so an agent that writes many large files still brings their text; only the drawing is bounded.
- Check: open an agent with a long run: only its newest steps show, quickly, with "Show 40 earlier steps" above them, which draws the ones before.

### 45. A board's cards have a soft colored border for where they stand

- Problem: on a board every card looked the same, so which reviews were ready, which were broken or late and which needed the user took reading each card's chips.
- Change: a card has a thin border at about a third of its color. Red when something is broken or late: its checks fail, its AI review failed, found something critical or says it is risky to deploy, or a review asked of the user has waited more than a day since the pull request's last change. Yellow when it needs the user: the AI review says some parts need them, changes were asked for on their own pull request, or hobkin's work on it waits for them. Green when its AI review is ready with nothing of that, or their own pull request is approved. No border while it is new, a draft, or its review is still running. The first that applies wins, red before yellow before green. Only a lane whose cards wait on the user can be late: on the work board's second provider, 45 cards asked of the user's teams would otherwise have turned red at once. Pointing at a card says why it has its color, and so does what a screen reader hears.
- Where: a new small rule for a card's color, the board's card, and a test.
- How to redo it:
  1. Write the rule that reads a card and its AI review and answers its color and why, checking red, then yellow, then green.
  2. Count lateness from the card's last change, a day, and only on a lane that waits on the user and only for someone else's open pull request that is not a draft and not approved or sent back.
  3. Draw the color as a thin inset border at about a third of its strength, using the app's green, the yellow of its running chips and its red.
  4. Put why in the card's tooltip and in what a screen reader hears.
- Tests to write: a new card and one with a review running have no color; a ready, safe review and an approved pull request of the user's are green; a part that needs the user, changes asked of theirs and hobkin waiting on them are yellow; failing checks, a failed, critical or risky review and a review late by a day are red before anything else; the user's own, a draft, an approved one and one asked of their teams are never late.
- Status: done, uncommitted. The window's unit tests pass, but for the four that failed before. Not yet seen in the window.
- Limits: the list view of a board keeps its rows as they were.
- Check: open a board with an AI review ready on one card and a review asked of the user for two days on another: the first has a soft green border, the second a soft red one, and pointing at each says why.

### 46. A review's walk never leaves for the whole graph in the middle

- Problem: walking a review step by step, a step with no node sent the camera out to the whole graph, and the next step brought it back in: a jump each time. Such steps were mostly the AI review's units whose code sat in nodes an earlier step had already shown, since the walk went to each node once and left a later unit with nothing. Code told with no node is wrong anyway. In the walks the host served, a pull request had its last three steps that way, another ten in a row.
- Change: a unit whose nodes were all shown before goes back to them, so its code is always told beside the node that holds it; a step that still has a new node keeps only that one, as before. In the window, any step after the opening that still has no node is told beside the nearest step's node, the one before it, else the one after, so the camera stays where the walk is and every message is still its own step. Pressing that node is the step itself, not a detour. What such a step shows stays its own: it offers no code of its neighbor's. Only the opening shows the whole graph; the closing stays by the last node.
- Where: the host's story built from the change review's units, the window's walk through the story, and the card told beside a node; with tests on both sides.
- How to redo it:
  1. When building the walk from the units, give a step the nodes no earlier step had; when none are left, give it back its own nodes.
  2. In the window, work out the nodes a step is told beside: its own, or for a step after the opening with none, the nearest step's before it, else after it.
  3. Use that for where the camera goes, what draws in, which node press is the step itself and what counts as off the path.
  4. Keep the step's own content on its own nodes, and offer no code to open for a step told beside a neighbor's node.
- Tests to write: a unit whose only node an earlier step showed goes back to it and no walk step is left with none; in the window, the opening has no node, a bare step stays at the node of the step before, is on the path, pressing that node is the step, the closing stays by the last node, and with nothing before it the step after lends its node.
- Status: done, uncommitted. All the suites pass, but for the 27 that failed before. On the saved change reviews of six pull requests the host's walk has no step left without a node. The window's part works on its next reload; the host's on its next restart.
- Check: walk a review to a step that had no node: the camera stays on the node of the step before and the card is told beside it, with no jump out to the whole graph.

### 41. Esc stops a turn without ending the main chat

- Problem: pressing Esc twice while hobkin worked left the main chat dead. hobkin was opening a pull request's diff for review, in a tool that does not listen for a stop. hobkin asked Pi to stop, and Pi answers a stop only once its run has ended. After two seconds without an answer, hobkin ended Pi's process. A main chat whose Pi ended stayed stopped until the app restarted, with "Main chat stopped: Main Pi did not acknowledge Stop. Restart hobkin to reconnect".
- Change: a stop asks Pi to stop and waits for it, and never ends Pi's process. The line above the input says "stopping…" while it waits. A stop now waits up to thirty seconds for its answer, where it waited five. One still unconfirmed then says so, and Esc twice asks again. A quit still gives Pi two seconds and then ends the process, so quitting stays quick. A stop that outlasts its wait still ends the turn once Pi stops, and Chat says you stopped hobkin. Only when a message Pi never read waits to be given back does the turn keep the chat: a new message is then refused with "Stop hobkin again to get back what it had not read.", and the next stop gives it back. A reset no longer waits forever on a tool that ignores the stop: after the wait, the old Pi ends and the fresh conversation opens. When the main chat's Pi ends anyway, the next message opens the same conversation again, and the window hears the new process.
- Where: in hobkin's own checkout, the main chat's Pi process, the runtime's stop, quit and message path, the application's message delivery, quit and stopped-chat line, two sentences in the guide, and their tests. In this repository, the host's tracking of the main chat's startup, the chat's message input and the line above it, the chat spec, and the host's startup tests.
- How to redo it:
  1. In hobkin, make the main chat's stop send Pi's stop and wait for its answer, with no deadline and no signal. A Pi that exited counts as stopped once its output has closed. A refusal from a Pi that still runs leaves the stop unconfirmed, so the next stop asks again.
  2. Give the main chat's Pi a quit that asks the same way and, when Pi has not answered within two seconds, ends the process, as every stop did before. The runtime and the application use it when they close.
  3. Let a stop wait thirty seconds instead of five before it reports itself unconfirmed.
  4. When a stop that outlasted its wait later finds Pi stopped, no other stop under way and no unread message to give back, let the turn go: free the conversation, say once in Chat that the user stopped hobkin, and tell the window. The ordinary stop and this one share that Chat line. Not during a reset.
  5. While a turn whose Pi has stopped keeps the conversation only for unread messages, refuse a new message with "Stop hobkin again to get back what it had not read." Otherwise keep "Main conversation is stopping."
  6. In a reset, when the turn's stop stays unconfirmed and the main chat's Pi is a process of its own, quit that Pi and go on to the fresh conversation.
  7. Before a message is delivered, when the main chat's Pi has ended, open the saved conversation again. Refuse while a turn of that Pi is still being stopped, and while the chat resets. A second message joins a reopening already under way, and a close waits for it.
  8. Make the stopped-chat line say that the next message opens the chat again, and update the guide's sentences on Esc and on a child that exits.
  9. In the host, when hobkin begins a startup after the last one has finished and cleaned up, give it a slot of its own, as a reset does. Once it is in place, its conversation is the one the window hears.
  10. In the window, while a stop waits for its answer, say "stopping…" in the line above the input, and keep the stop button disabled.
- Tests to write: in hobkin, a stop that Pi answers late is waited for, asks once and never ends the process; a Pi that exited counts as stopped once its output closes; a refusal from a running Pi leaves the stop unconfirmed and the next stop asks again; a quit ends the process two seconds after an unanswered stop, and ends nothing when Pi answers; a turn whose tool ignores the stop is confirmed once Pi stops, inside the thirty seconds; a turn still being stopped keeps an ended Pi's conversation from opening; a stop that outlasted its wait lets go once Pi stops and Chat says so once; one with an unread message keeps the conversation, refuses a new message with the stop-again words, and the next stop gives the message back; with the stand-in Pi, a stop keeps the same process for the next message, a reset ends an old Pi held by a tool that ignores the stop and opens a fresh conversation, a Pi that exited opens again on the same conversation, and through the application the next message opens it; the application's close quits the main chat through the runtime. The tests that waited five seconds wait thirty. In this repository: a startup hobkin begins by itself gets its own slot, a failed one leaves the main as it was, and the next one becomes the main the window hears.
- Status: done, uncommitted. A second, read-only review of the change found the lock after a long stop and the reset with nowhere to go; steps 4 to 6 fix them. The new tests pass, and fail without the change. hobkin's stop, Pi session, runtime, launcher, process, owned lifecycle, event, application and conversation-control suites keep only the 20 failures they had before. Its whole command-line suite ran past 40 minutes on a loaded machine, with 79 failures; the same tests failed in a copy without this change, and the one that differed passes alone in both. The client's suites pass, but for the 25 that failed before, and its type check is clean. The app has run steps 1 to 3 and 7 to 10 since it restarted at 14:33 on November 16; steps 4 to 6 take effect on its next restart. No stop has been tried in the app yet.
- Limits: a tool that never returns still holds its turn. The stop says it is unconfirmed after thirty seconds and a new message is refused; a reset ends that Pi after the wait and starts a fresh conversation, and a quit ends it too. The window has no Force for the main chat, as the user decided before. The main chat's Pi counts as ended only once its output closes, so one killed from outside whose output another process keeps open is not reopened until that process exits.
- Check: after a restart, ask hobkin to review a pull request and press Esc twice while it works. The line says "stopping…", Chat says you stopped hobkin once the tool returns, and the next message gets its answer in the same conversation. No "Main chat stopped" line appears.

## Durable hobkins

### 22. A new hobkin's Pi starts before its first message

- Problem: the first answer of a new hobkin took three times as long as the same question in an open Pi tab: 9.1 seconds against about 3, measured on this Mac with the same model. A hobkin made with Command+N started its Pi process only when the first message came, so the answer waited for Pi to come up, 4 to 5 seconds here. A Pi tab pays that start when it opens, before anyone types.
- Change: a hobkin on Pi that is created with no first message starts its Pi process at once and keeps it waiting, the way a process is kept between turns. The first message only prompts it. The model is asked nothing until then, so the early start spends nothing. A message sent while Pi is still coming up waits for that process and starts no second one. Ending the hobkin or closing hobkin closes it. A process nobody uses goes after the same ten idle minutes as any kept one.
- Where: hobkin's own checkout, the sibling the client loads: the part that starts Pi runs and the part that keeps durable hobkins, each with its tests. The client needs no change, because Command+N already creates the hobkin with no first message.
- How to redo it:
  1. Let the part that starts a Pi run accept a durable hobkin's run that has nothing to ask. It starts Pi exactly as a turn would, waits for Pi to say it is ready, checks that Pi holds the model and thinking level that were asked for, and then keeps the process as it does after a turn that ended well. It sends no prompt. A run of any other kind with nothing to ask is still refused.
  2. When a hobkin on Pi is created with no first message, start such a run right away, in the background. Creating the hobkin does not wait for it.
  3. Start it with exactly what a turn's process is started with: the folder, the model and thinking level, the conversation file, the hobkin's directions, and the hobkin's token and home in its environment. Build that list in one place for both, because a turn takes a kept process only when every one of them matches.
  4. Start none for a hobkin created with a first message, whose turn starts its own, or for one on Claude Code.
  5. Make the first turn wait for a process that is still coming up, then take it. Make End and closing hobkin wait for it too, then close it like any kept process.
  6. Give up an early start that is not ready after 30 seconds, so nothing waits longer than that. Ignore one that fails: the turn then starts its own process, as before.
- Tests to write, four in all:
  1. A process started early is asked only whether it is ready, and it stays up. The first turn then sends its prompt to that process, no second process starts, and the turn's timing has no stage for a process start.
  2. A process that dies while starting early leaves the first turn to start its own. A run of any other kind with nothing to ask is refused and starts no process.
  3. With a stand-in for the runs: the early start and the first turn are given the same things to start with, and none is started early for a hobkin with a first message or on Claude Code.
  4. With the real run code and a stand-in Pi: the first turn runs in the early process, a message sent while it comes up starts no second process, and End and closing hobkin leave no process behind.
- Status: done, in hobkin's checkout, uncommitted. The app has started again since, so it runs with the change. Measured through the launcher with a small model and a one-word answer, two runs each: the first text came 1.8 seconds after the message with the early start, and 5.9 without. The four tests pass. The other tests fail only what main already fails, counting one screen test about learning that fails on untouched main in about half its runs. Not yet tried in the window.
- Limits: it helps only a hobkin created with no first message. Entry 23 covers a hobkin after a pause or a restart. While Pi comes up, about 4 seconds, Stop on a first turn and End take effect once it is up.
- Check: press Command+N and Enter, wait five seconds, and send a short question. The answer comes about as fast as in an open Pi tab. In the home's events file for the month, that turn's timing record has no stage for the process being started or being ready. A hobkin started with a first message still has both.

### 23. A waiting hobkin's Pi starts when its page opens

- Problem: entry 22 covers only a hobkin's first message. A kept process goes after ten idle minutes and every time the app restarts. So the next message to any hobkin after a pause or a restart waited for Pi to come up again, 4 to 5 seconds here.
- Change: while a waiting hobkin's page is on screen, the window tells the host, and hobkin starts that hobkin's Pi process if none is kept. One that is kept stays for another ten minutes. The window says so each time that begins: the page opens, the window shows again, or a turn ends. A working hobkin, an ended one and one on Claude Code start nothing. Only the window can say it; the main hobkin cannot. Spec 034 now has this and entry 22's change, as a decision, two acceptance items with their proof, and a step.
- Where: both checkouts. In hobkin's own: the part that keeps durable hobkins, with its test. In the client: the list of commands, the host's commands for durable hobkins, the description of hobkin's runtime that the host is typed against, the hobkin page's rules and hooks, two test files, and spec 034.
- How to redo it:
  1. In hobkin, give durable hobkins one more thing they can be told: this hobkin's page is on screen. It looks the hobkin up and refuses one that is not there or has ended. For one that waits, with no process coming up, it starts the early process of entry 22. When a matching process is already kept, that start only keeps it again, which restarts its ten idle minutes.
  2. In the client, add a command for it that only the window may run, with the hobkin's id as its one argument, and have the host pass it to hobkin. With a hobkin runtime from before this, answer yes and start nothing.
  3. On the hobkin's page, decide with a plain rule when to send it: the page is on screen, the window is showing, and the hobkin waits and does not run on Claude Code. Send it each time that becomes true, and ignore a refusal.
  4. Add both behaviors to spec 034: the decision, the command, two acceptance items, their proof and a step.
- Tests to write, four:
  1. In hobkin, with the real run code and a stand-in Pi: a restart leaves no process. Telling hobkin the page is on screen starts one, and the next turn runs in it and starts none. Telling it again starts no second one, a working hobkin starts none, and an ended one is refused.
  2. In the client's page rules: the hobkin's id comes back when the page is on screen and the hobkin waits on Pi. Nothing comes back while the page is away, while the hobkin works, on Claude Code, or with no hobkin.
  3. In the client's host: the command reaches hobkin with the id, and a runtime from before this answers yes.
  4. In the same file: the main hobkin's tool refuses the command and does not list it, and a home with no durable hobkins says to restart the app.
- Status: done, in both checkouts, uncommitted. The app has started again since, so it runs with the change. The tests above pass and the client's type check is clean. Not yet tried in the window.
- Limits: a hobkin whose page stays open and idle for more than ten minutes loses its process, and the next message starts it again. At most four processes are kept, so opening a fifth hobkin's page closes the one idle longest.
- Check: restart the app, open a waiting hobkin's page, wait five seconds and send a short question. The answer comes about as fast as in an open Pi tab, and that turn's timing record in the home's events file has no stage for a process being started.

## Change Review

### 13. Review pull requests from other code hosts

- Problem: the Review screen read pull requests from GitHub only. One from the company code host could only be handed to hobkin as a chat message.
- Change: a pull request can name its code host. Its review id, its folder in the home, its page and the refs it is fetched into carry that host, and a GitHub pull request keeps the names it always had. The home names other code hosts in the code host file in its client folder. Every read and the posted verdict go through that host. A host that allows no checkout gets the map, the code, the notes and the verdict, with no AI review and no call-graph scan. The window learns the named hosts each time it reaches the host, so a pull request page on one of them opens as its review everywhere, including board cards. Merging and closing there came later, in entry 26.
- Where: the shared review ids; a new part of the host that reads the code host file; the pull request checkout, the review sources, the review code and its setup; the command list; and a new part of the window that learns the named hosts, loaded when the app starts; with tests for the file, the checkout and the verdicts.
- How to redo it:
  1. Let a pull request's target name its code host. Put the host into its review id, its folder in the home, its page address and the refs it is fetched into, and keep the names a GitHub pull request always had.
  2. Read the home's code host file each time it is needed. For each host it names: the web address, the API command (a tool that answers GitHub's REST paths, with owner and repo filled in), the git address of a repository, the ref that holds a pull request's head (by number or by branch), the user's own clones to read (a bare clone counts), whether a review may check a repository out, and whether hobkin may merge there.
  3. Send every read and every posted verdict through that host.
  4. For a host that allows no checkout, give the map, the code, the notes and the verdict, and run no AI review and no call-graph scan.
  5. Have the window ask the host for the named hosts each time it reaches it, so a pull request page on one of them opens as its review everywhere.
- Tests to write: ids and folders with and without a host; the file's hosts, defaults and errors; a named host's API command, with a body on standard input and errors that show nothing shaped like a credential; a fetch from a bare clone through the host's own ref, moving nothing of the user's; verdicts posted through the host.
- Local only: the company host is named in the home's code host file, with the user's large repository read from its existing bare clone, where only hobkin's own review refs are added.
- Status: first version was not acceptable. On a host that allowed no checkout, no agent ran: the change review needs a checkout, so there was no careful pass, no grouping and no blind check, and the review showed the host's own line-counting steps, one per file (177 steps on a 296-file pull request). Showing those steps was a mistake. Entry 15 gives such a host a tree of its own, and the host's raw steps are hidden again until the change review is ready, as for GitHub. The model passes themselves are entry 16.
- Check: on the company host's board, a review request's review action opens the Review screen with the change, and Comment, Approve and Ask for changes post to that host.

### 14. The review takes the keyboard when it is ready

- Problem: once a review was ready, the arrow keys did nothing until the user clicked the screen. The screen is drawn anew when the review becomes ready and again when its AI review lands. Whatever held the keyboard, such as the preparing view's Stop button, left with the old screen, and the review only took the keyboard when its own section was focused.
- Change: a screen can ask to take the keyboard when it is nowhere, and the review does. Typing elsewhere, such as in the chat, is never taken. Other screens keep their behavior.
- Where: the app's keyboard focus handling and the Review screen, with a focus test.
- How to redo it:
  1. Let a screen ask to take the keyboard when nothing holds it.
  2. Have the review ask each time it is drawn anew: when it becomes ready, and when its AI review lands.
  3. Never take the keyboard from a place where the user types, such as the chat box.
  4. Leave the other screens as they are.
- Tests to write: the keyboard goes to the review when nothing holds it, and stays in the chat box when the user is typing there.
- Status: done. Checked in a browser tab on the live host: from preparing to ready, the keyboard moved from Stop to the review and the right arrow went to step 2 with no click. After Refresh review rebuilt the screen, the right arrow still moved the step. With the chat box focused, a rebuild left the keyboard there.
- Check: start a review, wait for it to be ready, and press the right arrow without clicking.

### 15. A code host's own review tree

- Problem: the change review needs a checkout of the change, and a repository too large to check out whole got none, so its pull requests had no change review at all.
- Change: a code host in the code host file can name a review tree of its own. hobkin makes it when it is missing, readies it for each review at the change's head, and runs the change review and the call-graph scan there.
- Where: a new part of the host that readies the tree, the reading of the code host file, the change review's runner, the review setup and the review code, with tests for the tree and for the file.
- How to redo it:
  1. Let a host in the code host file name a tree: where it is, the command that makes it when it is missing and the folder that command runs in, an optional command of the host's own that fits the tree to a change, the least free disk a new tree needs (20 GB unless named), and settings for those commands and for git there.
  2. In those commands, put the commit the change starts from wherever {base} is written, and only when it is a full commit.
  3. For each review, check the tree out at the change's head, empty it of what an earlier review left, and fit it: with the host's command when one is named, else to the folders of the changed files, leaving out any folder whose name could read as an option or a pattern.
  4. Ready only a tree that is a worktree of the same repository. Leave any other folder at that place alone.
  5. Run the change review and the call-graph scan in that tree, one at a time, and never make hobkin's own worktree for such a pull request. Keep pull request review trees apart for each code host.
- Tests to write: the file's tree settings and their errors; a missing tree made by its command, with not enough free disk refused; the tree checked out at the head and emptied; fitting by the host's command or to the changed folders, with unsafe folder names left out; a folder that is not a worktree of the repository left alone.
- Local only: the company host's tree is made with its own tree tool, started at the change's base commit, and fitted with its own checkout tool, with large-file downloads skipped. The user approved that hobkin makes and removes it.
- Status: done. Checked on a real one-file pull request: the tree was made in about 25 seconds, fitted to the change's area, checked out at the head, clean, and the change review ran there (triage, map, call-graph scan, story). Its model passes still fail on this Mac, which entry 16 fixes.
- Check: Refresh review on a pull request from that host shows the change review's units, and the host's tree list shows the review tree at the pull request's head.

### 16. Review agents reach the model through the launcher

- Problem: on this Mac no review agent had ever run. The change review's careful pass and its blind check asked Pi in the host's own process, which has no credentials: the user's Pi gets them from the launcher. Both failed with "No API key found", and the engine finished from facts alone: no model words, no grouping by the model, no blind check, fast and dumb. Conversation titles failed the same way.
- Change: when the home names a launcher, each model call of a review, and each conversation title, runs the launcher's Pi once, in its one-shot mode, as hobkin's own jobs without tools run. Without a launcher, calls run in the host's process as before.
- Where: the review's model runner in the host, with its tests.
- How to redo it:
  1. When the home names a launcher, run each model call of a review, and each title, as one run of the launcher's Pi in its one-shot mode.
  2. Give that run no tools, no session to keep, no skills, prompt templates, themes, context files or project settings, and the tier's model and thinking level.
  3. Send the question on standard input, and the system prompt in a private file kept only while the call runs, so neither is on the command line.
  4. Keep Pi's extensions when the launcher manages them, since one may bring the very provider.
  5. When a call fails, say which model it asked for, with anything shaped like a secret hidden.
- Tests to write: the run's options, with the question on standard input; the system prompt's file gone after the call; extensions kept only for a launcher that manages them; a failure naming the model with secrets hidden; titles going the same way.
- Status: done. Checked on real reviews: a one-file pull request from the company host and a twelve-file GitHub pull request (about 7.5 minutes, 5.5 of them the careful pass). Both now show the careful pass and the blind check done, a story by the model, and the blind check's questions.
- Check: Refresh review on any pull request; its progress shows the careful pass and the blind check done, not skipped.

### 17. The blind check's answer is read when it explains a choice

- Problem: the first real blind check answered well, but the review threw the answer away as unreadable. The checker wrote "too little." and then why, in the field that takes one of three choices, and the reader took only the bare choice.
- Change: a choice field reads the choice it starts with, when a word ends there, so "too little. The story says..." is "too little" and "not sure" is still no "no". What follows the context choice becomes the unit's note when it has none. The same reading applies to yes or no, and to the level.
- Where: the change review engine's reading of the blind check's answer, with its tests.
- How to redo it:
  1. Read a choice field as the choice it starts with, when a word ends right after it.
  2. When a unit has no note, make what follows the context choice its note.
  3. Read yes or no, and the level, the same way.
- Tests to write: a choice followed by why; "not sure" never read as "no"; the why becoming the unit's note; yes, no and the level read the same way.
- Status: done. The answer that was thrown away now reads as one unit with seven needs, and the next run counted the blind check as run.
- Check: a review's blind check shows its questions instead of "the checker gave no answer that could be read".

### 18. Merging and closing only on the user's own pull requests

- Problem: every pull request's review offered Approve and merge, Discard, and Discard and delete branch, even one somebody else wrote.
- Change: when a pull request's review is prepared, the host records its author and whether it is the user's. On someone else's, the review offers only Approve, Request changes and Comment, says in one line that merging or closing it is left to its author, and the host refuses the other three if asked. A review prepared before this reads as someone else's until it is reviewed again.
- Where: a new part of the host that says whose a pull request is; the review code, its sources, the reading of the code host file and the review setup; the review's shared types; and in the window, the verdict choices and the review's actions; with tests for each.
- How to redo it:
  1. When a pull request's review is prepared, record its author and whether it is the user's: they wrote it, by their login there or one of their email addresses; or an agent the home names opened it, and the first "requested by" line of its description names one of their addresses. An address after "modified by" on that line does not count. A pull request nobody can place is someone else's.
  2. Take the user's GitHub login from gh. Let the code host file list the user's email addresses and the agents that open pull requests for someone, by host and login.
  3. On someone else's pull request, offer only Approve, Request changes and Comment, with one line saying merging or closing it is left to its author, and refuse the other three in the host if asked.
- Tests to write: whose a pull request is, for the author, an agent with the user as the one who asked, an address after "modified by", and one nobody can place; the choices shown for each; the host refusing merge and close on someone else's.
- Local only: the user's email address and the company's agent accounts are in the home's file.
- Status: done. Checked in the window: someone else's pull request shows Approve, Request changes and Comment with the line; one of the user's own shows all six.
- Settled since: on the company host, the user's own pull requests now merge and close that host's way (entry 26).
- Check: open a review of someone else's pull request and of one of your own, and compare the verdict choices.

### 19. The code opens at the node's own change

- Problem: opening the code of a node could land away from what it changed. A node can own lines in two places, such as a line removed from the class body and the new method below it, and the code opened at whichever came first in the file: here line 12, with the method out of view.
- Change: the code opens at the node's change as it is now: the first changed line from where its lines begin on the new side. A node with no change there opens at its first change, as one only removed does, and a node with no change at its first line.
- Where: the window's code view and its diff rows, with their tests.
- How to redo it:
  1. Open a node's code at the first changed line from where its lines begin on the new side.
  2. For a node with no change there, open at its first change, as for one that was only removed.
  3. For a node with no change at all, open at its first line.
- Tests to write: a node that lost a line above its added method opens at the method; a node whose change is one added line opens at that line; a node only removed opens at its removal.
- Status: done. Checked in a browser tab on the live host: the node from the report now opens three lines above its added method instead of at the removed line 12, and a node whose change is one added line in a method still opens at that line.
- Check: open the code of a node whose file also lost a line above it; the code shows the node's own change.

### 9. The failure names its real cause

- Problem: when the code scan could not run at all, the review said it found no definition in the changed file, which blamed the file.
- Change: a review whose scan could not run says so and why, and names the files it could not map.
- Where: the change review engine's grouping into units and its pipeline, with their tests.
- How to redo it: when the scan could not run at all, say so with the scan's own reason, and name the files it could not map, instead of saying that no definition was found in them.
- Tests to write: a scan that could not run gives its reason and names the files.
- Status: done. Since entry 25, such a review goes on and reads the changed files from their diff; the scan's reason stays in its notes.
- Check: a review whose scan could not run says "The scan could not run" with its reason in its notes.

### 10. The scan tool

- Problem: Change Review needs an agentic-search program on the PATH, and none was installed. The client also always sends two options, for callers and for tests, that the released agentic-search 0.7.1 refuses, so reviews would still fail.
- Change: agentic-search is installed as a link in Homebrew's program folder to the local pi-agentic-search checkout. Both the review and its side panel find it. When agentic-search refuses one of the two newer options by name, the review scan and the side panel scan run once more without it, so callers and tests fall back to the tool's own limits. Any other refusal still stops the scan with what the tool said.
- Where: Homebrew's program folder on this Mac; the change review engine's scan and its package entry, and the host's side panel scan, with their tests.
- How to redo it:
  1. Link agentic-search into Homebrew's program folder from the local checkout of pi-agentic-search.
  2. When agentic-search refuses one of the two newer options, for callers and for tests, by name, run the same scan once more without that option, in the review scan and in the side panel scan.
  3. Let any other refusal still stop the scan with what the tool said.
- Tests to write: a refusal of one option by name runs the scan once more without it; any other refusal stops the scan with the tool's words.
- Status: done. Checked with the installed agentic-search on the pull request that failed: the scan maps the changed method and its three tests, and the side panel shows four links and eight tests. Later, agentic-search can gain the two options, and the second run stops happening.
- Check: Review again on that pull request finishes with its changed functions mapped.

### 12. Review learnings that hobkin's reviews follow

- Problem: Change Review had no place to learn from another review tool, or from its own reviews.
- Change: a rules file next to the review code, written from a study of a graph-based PR reviewer, that the reviewer model and hobkin's chat follow, and a file in the home for rules learned from the user's own reviews.
- Where: a new rules file beside the review code and a new part of the host that reads it; the review's model runner, its chat guide, the review code and its setup; with tests for the learnings and for hobkin's review chat.
- How to redo it:
  1. Write the rules file from the study. Give each section its readers: the reviewer model, hobkin's chat, or the short brief.
  2. Put the reviewer model's sections in its system prompt on every careful pass, about 4 KB, since it has no tools to follow a pointer. Leave the blind check as it is.
  3. Add the brief's rules, about 400 characters, to every message hobkin gets during a review, with where the fuller chat rules are: walking the change, chapters, tracing one path, and where notes go.
  4. Let the home keep rules learned from its own reviews in a learnings file in its client folder, read after the shipped ones and kept out of the repo, since it may name private code.
  5. When the user corrects a review, have hobkin offer one rule for that file, and add it once they agree.
  6. Read both files on every use, so an edit counts without a restart.
- Tests to write: each reader gets only its sections; the home's rules come after the shipped ones; an edit to either file counts on the next use; hobkin's messages during a review carry the brief.
- Status: done.
- Check: during a review, hobkin's answers name file and line, start from the tests, and never say a note was posted.
- Next lessons from the same study, needing code, not done (see also entry 13): a tests-first story skeleton so a review never shows a story of one step; comments on a whole method placed in the review body with their place and declaration line; and a list of what the review did not cover, with a way to ask about each gap.

### 25. The AI review reads what the search tool cannot map

- Problem: the AI review stopped with a scan failure on a pull request whose changes were in Rust and in an ERB data file, because the search tool has no parser for either and so found nothing to review. In a change where other files did map, a file like that became a part that said it was not checked and told the reader to read it; the reviewer model never saw its lines. Config and data files the search tool cannot read, such as a YAML file, were only counted, so their reviews said again and again that the contents were not read.
- Change: every changed file the scan was given and holds nothing for, where more than comments or blank lines changed, becomes a part of the review of its own, built from its diff. The careful pass reads its changed lines like any other part and rates them, and the review goes on. This holds for a language the search tool has no parser for, a file it found no definition in, and a scan that could not run at all, and for code, config, migration and dependency files alike. Such a part starts at worth a look, since no test was looked for, and the careful pass can raise it. Like any part that no test showed working, an argument alone never lowers it to safe. Its title says nothing mapped it and that it is read from its diff, and the review's notes list the files read that way.
- Where: in the change review engine: the step that turns the scan into the review's parts, just before levels are set, and the wording of the parts. Its tests sit with the engine's tests of a whole review.
- How to redo it:
  1. After the parts from the scan are made, and after the parts that take effect at load are given their proof, go through every file in a bucket the scan was given. Skip a file that already has a part, has no diff, or changed only comments and blank lines. Use the engine's own test for whether a diff changes code, reading both sides of the file.
  2. For each file left, make one general part named by the file. Let it span the new side from its first hunk to its last, so every hunk is shown to the careful pass, and list the lines it adds. Mark it new when every hunk adds to an empty file, removed when every hunk leaves nothing, and changed otherwise. Give it an id the scan did not use.
  3. Give it these facts, each with its reason as evidence: it changes behaviour, and what the changed lines do is read from the diff; its proof is unknown, because no definition was mapped and so no test was looked for; it reaches everyone, because no condition in front of it was looked for; a rollback undoes it. When its path is a script or build tool, mark it as code that does not run in a request.
  4. Give it one finding, "not mapped", by the search, that says why in a sentence: the search tool has no parser for it, found no definition in it, or the scan could not run, with the scan's own reason. End it with: so what calls it and what tests it were not looked for, and its change is judged from the diff alone.
  5. Add one line to the review's notes: "Read from the diff alone, with no map:" and the files.
  6. Wherever the review names a part in words, name such a part by its full path. The usual short name cuts at dots and would call a Rust file "rs". Title it with its path, then "changed", "is new" or "is removed", then "and nothing mapped it: it is read from its diff".
  7. Change nothing else. The floor table already puts a part no test showed at worth a look, the careful pass already reads every part that is not safe, and the rule that an argument never lowers that floor holds for these parts too.
- Tests to write, five in all, each through a whole review with a stand-in scan and a stand-in model that only records what it was shown:
  1. A code file the scan lists with no language: the review finishes, the file is one general part at worth a look with a "not mapped" finding that says it has no parser, the careful pass was shown its changed line, and the notes name the file.
  2. A scan that could not run: the changed code file is read the same way, its finding gives the scan's reason, and the notes still say the scan could not run.
  3. A change the search tool partly reads: a file with a definition and a file with no parser are both rated parts, and the careful pass was shown the second one's line.
  4. A config file with no parser is a part read from its diff, not only counted.
  5. A file with no parser whose change is only a blank line makes no part.
  Turn the two old tests that expected the review to stop into tests 1 and 2, and update the test whose new script had the old "not checked" title.
- Status: done, uncommitted. The engine's 196 tests and the host's review tests pass, and the third test fails when the change is limited to code files again. Checked in the window on the pull request that had stopped: the review finished safe to deploy, with its three files read. For the Rust registry the careful pass named the line that adds the new scope. For the generated Rust file it saw that only a doc comment holding a hash changed. For the ERB data file it named the line that adds the scope and the test that reads it. The blind check ran too. It would rate the Rust part high, since a partial deploy could leave the two languages' lists out of step.
- Limits: the careful pass sees each such file's hunks with their few lines of context, not the whole file, so it can miss a name that sits further up; it said so for the data file. No call map and no test is found for these parts. Not yet tried on a file deleted in a language the search tool cannot read.
- Check: press Review again on a pull request whose changes are in a language the search tool cannot parse. It finishes. Each such file is a part of its own, titled with its path and "nothing mapped it: it is read from its diff", and the careful pass's reasons quote its changed lines.

### 26. Merging and closing the user's own pull requests on another code host, the way that host does it

- Problem: on the company code host, Approve and merge, Discard and Discard and delete branch were refused on the user's own pull requests, because hobkin only knew GitHub's way of landing. That host merges only through a merge queue that a comment on the pull request asks for, and an author's own approval counts for nothing there. Separately, the AI Reviews list offered Discard on every pull request, also on other people's, which the host then refused.
- Change: the home can say, for a code host, which comment asks for a merge there and, in a sentence, what the host does once it is posted. On such a host, Approve and merge on the user's own pull request posts what they wrote as a comment, then that merge comment, and approves first on a pull request an agent opened because they asked. Just before the merge comment goes, hobkin reads the pull request again and posts nothing if it moved from the commit shown. The review then stays in the list as a merge that waits, with the host's sentence, until the host no longer has the pull request open. Discard closes it through the host's own tool, with the user's words first. Discard and delete branch also deletes the branch with git, from the clone hobkin fetches from, with the same checks GitHub gets and only while the branch is at the commit shown. Approve alone is refused on the user's own pull request there. Each row of the list says whether its pull request was the user's, and a row offers Discard only then.
- Where: in the host's review code: the code host settings, the verdict code, the pull request checkout, who a pull request belongs to, the review store's list and the review setup; in the window, the AI Reviews row actions and the row line of a merge that waits. The company host's own comment and sentence live only in the home's code host file.
- How to redo it:
  1. In the code host file, let a host have a merge entry with the comment that asks for a merge and an optional sentence on what happens next. Refuse the file when a host has one but does not let hobkin merge.
  2. Read a pull request's facts through its own host: who opened it, its base, its head, and whether it is open, a draft or in conflict. On GitHub keep using the login gh has; elsewhere the user is the author when their email from the home's file is the author's name.
  3. For Approve and merge on such a host: refuse a draft, a conflict or a closed pull request with a plain reason, and refuse a host with no merge entry, saying where to name one. Otherwise build the same review GitHub gets, as a comment on the user's own pull request and as an approval on an agent's. Preview it: that nothing is approved when the user opened it, the comment or approval, the merge comment with the host's sentence, and the commit it asks at. Do not name the base it merges into: a stacked pull request's base is the one below it.
  4. When the yes comes: post the review, read the pull request again, and stop with what already went if its head is not the commit shown. Otherwise post the merge comment, with the verdict's token as its idempotency key so a repeated yes is one comment. Record the merge as waiting, with the sentence, rather than as merged, and do not tell the GitHub screen that anything merged.
  5. Let the existing two-minute sweep that asks whether each reviewed pull request is still open take a waiting one off the list once its host has closed it.
  6. Close through the host's own tool, comment first, then the close, with the host's name in every message. For the delete, run GitHub's checks through the host's tool: not a fork, not the default branch, not protected, not another open pull request's branch, and not the base of an open pull request. Require GitHub's repository id only on GitHub.
  7. Delete on such a host with git in the clone the pull request is fetched into, through the remote whose address is on that host: a push of the deletion with a lease on the commit shown. Then ask the host with a remote listing that treats only "no such ref" as gone. Refuse a commit that is not forty hex digits or a name git does not accept as a branch.
  8. When something closes or merges on a host other than GitHub, tell the GitHub screen by the pull request's page address, never by its repository and number.
  9. Carry whether a pull request was the user's into each list row, from the stored review. In the window, offer Discard and Discard and delete branch on a pull request row only when it was, hide the More button when nothing is left in it, and name its choices from what it holds. Show a waiting merge's own sentence on its row.
- Tests to write: with a stand-in host tool, Approve and merge on the user's own pull request (the preview lines, a comment review, then the merge comment with its key, waiting in the list, gone after the sweep sees it closed); on an agent's (an approval, then the comment); a head that moved before the yes (nothing sent) and while the review posted (what went is said); a draft, a conflict, a closed one and a host with no merge entry refused before anything is sent; Approve alone refused on the user's own; Discard with the user's words; Discard and delete branch, refused when an open pull request merges into the branch or the host has no way to delete. With real git and a bare repository as the host: the delete keeps the branch for any other commit and deletes it at the commit shown. The code host file's merge entry and its errors. The author check. In the window: a row of someone else's pull request offers only Remove, and a waiting merge shows its sentence.
- Status: done, uncommitted. 252 review and Work tests pass, the typecheck is clean, and the moved-head check's test fails when that check is turned off. Checked against the live host by asking it for the previews over its socket, which sends nothing. For the user's own pull request on the company host, Approve and merge said nothing is approved, named the merge comment with the host's sentence, and pinned the commit. Discard and Discard and delete branch named the host, the branch and the commit, the delete passing every branch check. Approve alone was refused, and Discard on someone else's pull request was refused. Nothing has been posted to a real pull request.
- Limits: the merge comment carries no commit, so a push after it is posted is the host's to handle. Closing a queued pull request does not cancel its merge first. Reviews built before ownership was recorded have no answer on their rows, so their rows offer only Remove.
- Check: on your own pull request on that host, open its review, press Approve and merge once and read the preview, then let it go back. In AI Reviews, the More button of someone else's pull request offers only Remove.

### 27. The review panel names who a pull request is from, with links to their profiles

- Problem: the review panel showed a pull request's title, risk and size, but not who wrote it. For a pull request an agent opened, nothing said who had asked for it.
- Change: under the title, the panel says "By" and the author, or "By" the agent's name and "for" the person who asked. Each name links to their profile: a GitHub login to its GitHub page, a bot to its app page, and an email to the profile the home's people lookup finds. Each person is looked up once and kept in the home. A name that cannot be looked up shows as it is, with no link. A review built before it kept its author asks the pull request's host for it.
- Where: in the host, the reading of the code host file, a new part that finds people and keeps them, the review code and a new command for the window; in the window, the review panel's header and a small part that words the line.
- How to redo it:
  1. In the code host file, let the home name how a person is found by email: a command, run with no shell, with {email} in one of its words, that prints the person as JSON with an id and a name; and a profile address with {id} where the id goes. Let each agent have a short name it goes by.
  2. Keep the people found in a file in the home's client folder, by lowercased email: someone found for a month, someone not found for a day. Keep nothing when the command could not run, so it is asked again. Ask at most once at a time for the same email. Look up nobody whose email does not match a plain email pattern, and pass the email as a parameter of the lookup, never inside its query text. Use only an id made of letters, digits, dots, dashes and underscores in a link.
  3. Work out who a pull request is from. On GitHub, the author's login links to their page, or an app's page for a bot. Elsewhere, an author who is an email is looked up. An agent named in the file goes by its name, with no link off GitHub. When an agent opened it, the first email on its description's "requested by" line is looked up the same way, never an email after "modified by".
  4. Add a host command that answers this for a prepared review, from the author and description the review kept, or from the pull request's host when it kept no author. A finished change names nobody.
  5. In the panel, under the title of a pull request, ask the host once for each review and show "By" with the author, then ", for" with the one who asked, each a link that opens in the browser when it has one. Show nothing without a host, or when nobody is named.
  6. In the home's own file, point the lookup at the company's people directory and give the agents their names. None of that goes in the repo.
- Tests to write: GitHub and bot links; an email looked up once and kept; two asks at once making one lookup; someone not found asked again the next day; a lookup that cannot run keeping nothing; no lookup without a finder or for a malformed email; an answer with no usable id giving no link; the author, an agent and who asked it, on GitHub and elsewhere, never the one who modified it; the file's people entry, the agents' names and their errors; the command reading the kept author or asking the host; the panel's words.
- Status: done, uncommitted. The unit tests pass. Against the live host, every review in the list named its author: the user's own, colleagues', three opened by the agent with the person who asked, and two on GitHub by their logins. A first lookup took four to six seconds, and later ones none. Not yet seen in the window.
- Limits: a GitHub author shows by login, not by name. The first time someone shows up, the line appears a few seconds after the panel.
- Check: open the review of a pull request an agent opened. Under the title it says "By" the agent and "for" the person who asked, linked to their profile.

### 40. Finding who uses a changed constant no longer reads the whole repository

- Problem: in a very large monorepo, preparing an AI review kept two or more cores busy for minutes. The call-graph scan finds no caller for a changed constant, type or class, so the review asks git where the name is used at the pull request's head. Git searched every file in that commit. In a repository of about 2.4 million files and 75 GB of packs, each search ran for close to a minute at 170 to 240 percent CPU, held up to 40 percent of memory, and was stopped by the one-minute limit. The names were searched one after another, so a review that changed several constants did this several times. For a Ruby constant all that work was wasted: the review keeps a use in another file only when that file imports the name, Ruby files never do, so only the constant's own file could count.
- Change: the search reads only the files where a use can count. For a Ruby definition, that is its own file. For a JavaScript or TypeScript definition, it is its own file plus the JavaScript, TypeScript, Vue, Svelte and Astro files of its project. The project is the nearest folder above the file, at head, that holds a package.json, component.yml, Gemfile or gemspec, or the whole repository when no folder has one. The call-graph scan uses the same project root. The rule for which uses are kept is unchanged.
- Where: in the host, in the part of the review that maps who calls a change and what it calls: the git search for a name, and the step that asks it for a changed constant's uses. Its tests sit with the host's tests of that map.
- How to redo it:
  1. When the review asks where a changed constant is used, pass two things with the name: the file that defines it, and whether other files may import it. Other files may import it unless the definition is Ruby.
  2. In the git search, always search the defining file, given as a literal path.
  3. When other files may import it, find the project. In one git call, list at head the entries of every folder above the defining file. Take the deepest folder that holds one of the four root files. With none, the project is the whole repository.
  4. Add one glob path for each JavaScript and TypeScript extension under that folder. Escape glob characters in the folder name, so git never reads a folder name as a pattern.
  5. Keep the rest as it was: a whole-word, fixed-string search of the commit, never the working tree, with no optional locks, the same one-minute limit, and the same rule that a use in another file counts only when that file imports the name.
- Tests to write, three:
  1. The existing test of a changed TypeScript constant also checks that the search was asked for its own file, with importers allowed.
  2. A changed Ruby constant is searched in its own file only, and its use in a method of the same file is still its caller.
  3. Against a real git repository: a Ruby file's search finds only its own use, not another Ruby file's or a README's. A TypeScript file's search finds an importer in a subfolder of its project, but not one in a sibling project or a README. A file with no project above it searches every JavaScript and TypeScript file. An edit in the working tree after the commit is not read.
- Status: done, uncommitted. The host's tests of the caller map, the life cycle, pull reviews and review wiring pass (26), and the typecheck passes. Tests 2 and 3 failed before the change: the search got no scope, and git returned hits from every file, the README included. Measured in the monorepo, at the head of the review that was slow: a Ruby constant took 60 to 70 milliseconds instead of about a minute, and a TypeScript constant in a large app took about one second. It takes effect when the app next starts.
- Limits: a JavaScript or TypeScript importer outside the definition's own project is no longer found. The call-graph scan has the same limit for callers. In a small repository with nested packages, a file that imports from another package by a relative path is missed for the same reason. A Ruby constant used by its full name in another file was never kept as a caller, and still is not.
- Check: after the app restarts, start an AI review of a pull request in a very large repository that changes Ruby constants. While it prepares, no git search runs for more than a moment, and CPU stays near idle.

# hobkin

The proactive layer for your coding agents.

Your coding agent waits for you. hobkin doesn't. It's a Mac app that runs on top of the agents you already use. It keeps an eye on your projects and your day, does what's safe to do on a branch, and brings you the rest to decide.

You talk to hobkin on the left. Its work fills the right: the projects it's moving, the changes waiting for your review, the reports it wrote while you were away, and anything it wants to show you. One hobkin hands work to many agents, and you can watch every one of them at work.

hobkin runs on [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent), and its helper agents can run on Claude Code too. Everything it keeps lives in one folder on your Mac, `~/.hobkin`.

hobkin is in early release and runs on macOS. Windows and Linux aren't supported yet.

## A tour

### Talk to it

Write to hobkin the way you'd write to a colleague. A small pet sits beside the input, and its face follows hobkin's mood. Pick Round, Ears, Antenna or Sprout in Settings. Paste images, open a full Markdown editor for long prompts, and when hobkin drafts an email or a message for you, it comes as a block with a Copy button on top.

### A hobkin of your own

Press Command+N for a hobkin you drive yourself. It keeps its whole conversation, it's still there after a restart, and only you end it. Start it on one of your model tiers, on Claude Code, or on any model Pi can reach. Type `/` for Pi's commands, like switching the model halfway through a conversation.

Your hobkins can start helper agents, keep their own tasks, and schedule themselves. Ask one to watch a pull request and it sets a timer that brings it back only when the checks go red or finish. Every schedule shows near the input with when it fires next, and you can run it now, pause it or cancel it. Stop an agent, let it carry on, or push a message through mid-turn, as you would in any harness. Ctrl+Tab moves between agents.

### Twenty side projects, all moving

Turn on Work and point hobkin at a folder. It finds your repositories, proposes projects, and starts nothing until you take one. Agents study each project you take and file what they find into one queue, graded P0 to P3. Every change happens on its own branch, so git can always bring things back. Agents never commit to your default branch, and deploying stays with you.

A project doesn't have to be code. Give hobkin a folder and a goal, and it files the steps toward that goal and works through them. A code project gets a run guide: how to start it on your Mac, set up its database and try a change. An agent writes the guide from the project's own docs and scripts, then follows it to make sure it works.

Finished work comes back to you as one list, each change with its grades. Merge it, ask for changes in your own words, or say no, and hobkin learns from the no. If a change grew too big to read, "Make it a stack" hands it to an agent that splits it into small layers that land in order.

### Read a change like a story

Change Review turns a finished change into something you can follow. It draws the change as a graph of specs, tests and code, then takes you through it step by step, in an order that makes sense. For each part you see where it runs from (the request, job or command that reaches it), which tests covered it before, and which tests the change added, edited or removed.

Every review rates the change from 1 to 10 on five questions: coverage, proof, safety, visibility and rollback. Each score comes with a line of evidence, and together they make one overall rate. A change that could break something says "Risky to deploy" and tells you why. If you'd rather read the diff, open the same review as code.

Reviews work on GitHub pull requests too, both yours and the ones waiting on you. When ten or more are waiting, hobkin offers to take you through them one after another, so you never have to pick the next one from a long list.

### YOLO mode, when you want it

YOLO mode is off until you turn it on. Set the lowest rate you'll accept and the rules that matter to you: tests pass on the default branch, there's a known way back, the change is small enough, and certain paths always ask first. hobkin then merges what clears every rule, and everything else still waits for you.

### Proofs for the tricky parts

When an agent touches a state machine, it writes a TLA+ model of it. hobkin checks the model with TLC, and proves it with TLAPS when a proof is written. You can read the result as math, in plain words, or as a state graph you walk node by node, counterexamples included.

### Reports, routines, and the things you'd forget

Tell hobkin what to watch and when: a morning brief, your review queue, a deadline coming up. Each check runs on its schedule, writes a short report, and speaks up only when something changed. When reports pile up, hobkin writes one catch-up with what you missed and what's worth opening.

Questions hobkin has for you never hold anything up. They wait in Action Items until you get to them, and when something needs you while the window is in the background, your Mac tells you once.

### A canvas to show you things

Sometimes a picture explains it better, so the right side is a canvas. It holds pages hobkin draws, a whiteboard, a real browser for web pages, and previews of the files and images you click in a report or a chat.

### One memory for every agent

hobkin remembers what matters about you and your work, and every agent it runs knows it: the chat, your own hobkins, Work runs and routines, on Pi and on Claude Code. Everything it remembers is on one page, with where each memory came from. You can add to it, correct it, or make it forget.

### Your models, your tools

Delegated work runs on four tiers (fast, mid, high and max), and for each one you pick a model and a thinking level. hobkin's helper agents can run on Claude Code instead of Pi. Settings lists every Pi skill and extension, so you can read them, switch them off or update them in one place.

### Keyboard first

You can do everything from the keyboard. Tab walks the screens, the arrows walk agents and rows, Enter opens, and Escape goes back. The mouse works too, but you never need it.

## What stays yours

- Your chats, reports, memory and reviews live in `~/.hobkin` on your Mac.
- Agents work on branches. They never commit to your default branch, and deploying, publishing and deleting what git can't bring back stay with you.
- Nothing merges without your word, unless you turn on YOLO mode and a change clears your rules.
- Your model provider, and the tools you connect, see what agents work on. hobkin itself sends anonymous usage events, which you can turn off, and feedback only when you send it. The runtime's README lists [exactly what leaves your Mac](https://github.com/dantetekanem/hobkin#what-leaves-your-machine).

## Run it from source

You need a Mac, Node 22.19 or newer, pnpm, and Rust for Tauri. The app runs on hobkin's runtime, so clone both repositories side by side:

```sh
git clone https://github.com/dantetekanem/hobkin.git
git clone https://github.com/dantetekanem/hobkin-client.git
(cd hobkin && pnpm install)
cd hobkin-client
pnpm install
pnpm tauri dev
```

The first time it opens, setup finds what hobkin needs and installs what it can: a Node of its own when it can't find one, Pi, the Pi packages its agents use, and the TLA+ tools. Then you connect a model and you're in.

`pnpm tauri build` makes an app you open from the Dock. `pnpm test` runs the tests, and `pnpm typecheck` checks the types.

## How it's built

hobkin is a Tauri 2 window, a React 19 interface, and a Node host that runs hobkin's runtime. Every feature has a spec in [`_specs/`](_specs) that says what it must do and which tests prove it.

## License

MIT. See [LICENSE](LICENSE).

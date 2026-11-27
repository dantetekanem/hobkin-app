# hobkin

The proactive layer for your coding agents.

Your coding agent waits for you. hobkin doesn't. It's a Mac app that runs on top of the agents you already use. It keeps an eye on your projects and your day, does what's safe to do on a branch, and brings you the rest to decide.

You talk to hobkin on the left side of the window. The right side shows its work: the projects it's moving forward, the changes waiting for your review, the reports it wrote while you were away, and anything it wants to show you. One hobkin hands work to many agents, and you can watch each of them at work.

hobkin runs on the [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding agent, and its helper agents can run on Claude Code too. Everything it keeps lives in one folder on your Mac, `~/.hobkin`.

hobkin is in early release and runs on macOS. Windows and Linux aren't supported yet.

## Install

You can let a coding agent such as Claude Code or Codex do the steps below. Paste this into it:

```text
Install hobkin from https://github.com/dantetekanem/hobkin-client on this Mac and start it.
1. Check each tool, and install only the ones that are missing, each with its official installer:
   - Xcode Command Line Tools: check with `xcode-select -p`. If missing, run `xcode-select --install`,
     tell me to press Install in the window that opens, and wait until it finishes.
   - Node 22.19 or newer: check with `node -v`. If missing or older, install it from https://nodejs.org.
   - pnpm 11: check with `pnpm -v`. If missing, run `npm install -g pnpm@11`.
   - Rust: check with `cargo -V`. If missing, install it with rustup (https://rustup.rs),
     then run `. "$HOME/.cargo/env"`.
2. Clone the repository, go into it and run `pnpm run bootstrap`.
3. Run `pnpm tauri dev` and leave it running. The first build takes a few minutes.
4. When the hobkin window opens, tell me to follow its setup there. Don't sign in to anything for me.
If a step fails, stop and show me its last lines of output.
```

Or do it yourself:

1. Install the tools hobkin is built with. Skip any you already have; the second column checks.

   | Tool | Check | Install |
   | --- | --- | --- |
   | Xcode Command Line Tools | `xcode-select -p` | `xcode-select --install` |
   | Node 22.19 or newer | `node -v` | https://nodejs.org, or `brew install node` |
   | pnpm 11 | `pnpm -v` | `npm install -g pnpm@11` |
   | Rust | `cargo -V` | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh`, then open a new terminal |

2. Get the code and its packages:

   ```sh
   git clone https://github.com/dantetekanem/hobkin-client.git
   cd hobkin-client
   pnpm run bootstrap
   ```

   `bootstrap` installs hobkin's runtime in `packages/hobkin` first, then the app, each from its lockfile.

3. Start the app:

   ```sh
   pnpm tauri dev
   ```

   The first start builds the Mac shell, which takes a few minutes.

4. Follow the setup. The first time the app opens, hobkin checks this Mac and offers to install what's missing: its own copy of Node, Pi and the Pi packages its agents use, each when you press Install. The TLA+ tools set themselves up in the background. Then you connect a model. Settings › Check this Mac runs the same check at any time.

## A tour

### Talk to it

Write to hobkin the way you'd write to a colleague. A small pet sits beside the input, and its face follows hobkin's mood. You can pick its look in Settings: Round, Ears, Antenna or Sprout. You can paste images, and open a full Markdown editor for long prompts. When hobkin drafts an email or a message for you, the draft comes as a block with a Copy button on top.

### A hobkin of your own

Press Command+N to start a hobkin of your own, one that you direct yourself. It keeps its whole conversation and is still there after a restart. Only you can end it. You can run it on one of your four model tiers, on Claude Code, or on any model Pi can reach. Type `/` to use Pi's commands, such as switching the model in the middle of a conversation.

Your hobkins can start helper agents, keep their own task lists, and set timers for themselves. Ask one to watch a pull request, and it sets a timer that wakes it only when the checks fail or finish. Each timer shows near the input with the time it fires next, and you can run it now, pause it or cancel it. As in other agent tools, you can stop an agent, let it keep going, or send it a message in the middle of its turn. Ctrl+Tab moves between agents.

### Twenty side projects, all moving

Turn on Work, hobkin's work mode, and point it at a folder. hobkin finds the repositories in it and proposes projects. It starts nothing until you take one. Agents study each project you take and put what they find into one queue, graded P0 to P3. Every change happens on its own branch, so git can always undo it. Agents never commit to your default branch, and deploying stays with you.

A project doesn't have to be code. Give hobkin a folder and a goal, and it lists the steps toward that goal and works through them. A code project gets a run guide: how to start it on your Mac, set up its database and try a change. An agent writes the guide from the project's own docs and scripts, then follows it to make sure it works.

Finished work comes back to you in one list, and each change shows its grades. You can merge a change, ask for changes in your own words, or say no. hobkin learns from each no. If a change grew too big to read, "Make it a stack" has an agent split it into small layers that land in order.

### Read a change like a story

Change Review turns a finished change into something you can follow. It draws the change as a graph of specs, tests and code, then walks you through it step by step, in an order that makes sense. For each part, you see what runs it (the request, job or command that reaches it), which tests covered it before, and which tests the change added, edited or removed.

Every review rates the change from 1 to 10 on five questions: coverage, proof, safety, visibility and rollback. Each score comes with a line of evidence, and together they give one overall rate. A change that could break something is marked "Risky to deploy", with the reason. If you'd rather read the diff, open the same review as code.

Reviews work on GitHub pull requests too: your own, and the ones waiting for your review. When ten or more are waiting, hobkin offers to take you through them one after another, so you never have to pick the next one from a long list.

### YOLO mode, when you want it

In YOLO mode, hobkin merges a change without asking you when the change passes rules you set. YOLO mode is off until you turn it on. You set the lowest rate you'll accept and the rules that matter to you: tests pass on the default branch, there's a known way to undo the change, the change is small enough, and certain paths always ask you first. hobkin merges only what passes every rule. Everything else still waits for you.

### Proofs for the tricky parts

When an agent changes a state machine, it writes a TLA+ model of it. hobkin checks the model with TLC. When the model comes with a written proof, hobkin also checks the proof with TLAPS. You can read the result as math, in plain words, or as a state graph you step through node by node, including any counterexamples.

### Reports, routines, and the things you'd forget

Tell hobkin what to watch and when, such as a morning brief, your review queue or a deadline coming up. Each of these is a routine: a check that runs on its schedule and writes a short report. It only alerts you when something changed. When reports pile up, hobkin writes one catch-up with what you missed and what's worth opening.

When hobkin has a question for you, nothing else stops to wait for your answer. The question waits in Action Items until you get to it. If something needs you while the hobkin window is in the background, your Mac notifies you once.

### A canvas to show you things

The right side of the window is a canvas, for when a picture explains something better. It holds pages hobkin draws, a whiteboard, a real browser for web pages, and previews of the files and images you click in a report or a chat.

### One memory for every agent

hobkin remembers what matters about you and your work, and every agent it runs knows it: the chat, your own hobkins, Work runs and routines, on Pi and on Claude Code. One page lists everything it remembers and where each memory came from. There you can add a memory, correct one, or make hobkin forget one.

### Your models, your tools

When hobkin hands work to other agents, that work runs on one of four tiers: fast, mid, high and max. For each tier, you pick a model and a thinking level. hobkin's helper agents can run on Claude Code instead of Pi. Settings lists every Pi skill and extension, so you can read them, switch them off or update them in one place.

### Keyboard first

You can do everything from the keyboard. Tab moves between screens, the arrows move between agents and rows, Enter opens, and Escape goes back. The mouse works too, but you never need it.

## What stays yours

- Your chats, reports, memory and reviews live in `~/.hobkin` on your Mac.
- Agents work on branches. They never commit to your default branch. Deploying, publishing and deleting anything git can't bring back stay with you.
- Nothing merges unless you say yes. The one exception is YOLO mode: once you turn it on, a change that passes your rules merges by itself.

Some data does leave your Mac:

- Your messages, and what your agents read while they work, go to your AI model provider.
- A tool you connect, such as GitHub, gets what your agents send it.
- hobkin sends usage counts to its own server. They hold fixed words and counts, never your messages, names or file paths. You can turn them off.
- Feedback goes to hobkin's server only when you send it.
- The app checks hobkin.dev for updates.

The runtime's README has the details, in [what leaves your machine](packages/hobkin/README.md#what-leaves-your-machine).

## How it's built

hobkin has three parts: a Tauri 2 window, a React 19 interface, and a Node host that runs hobkin's runtime from `packages/hobkin`. Every feature has a spec in [`_specs/`](_specs) that says what it must do and which tests prove it.

Run the tests with `pnpm test` and check the types with `pnpm typecheck`.

## License

MIT. See [LICENSE](LICENSE).

---
{
  "id": "074-browser-tool",
  "title": "Browser: an agent's own Chrome, as an integration",
  "kind": "work",
  "status": "doing",
  "depends": ["065-integration-drops", "023-integrations", "031-home"],
  "updated": "2026-11-25"
}
---
# Browser: an agent's own Chrome, as an integration

## Outcome

An agent hobkin runs opens web pages in a Chrome of its own with one tool, `browser_run`. It passes one plain step, such as `{ do: "open", url }` or `{ do: "click", on: "Sign in" }`, or a list of steps in one call, and reads back what the page showed. A script in Pi's code mode asks for the same answer as JSON and chains calls in code. The tool carries its own guide, and the user installs what it runs on from the Integrations screen or from Home, where it shows as a need until it is there.

It is one folder, `integrations/browser/`. Nothing else in the app changes.

The user, 2026-11-25: "I want a very simple api with tool calls (chainaible for codemode as well". Then: "you can work on it. we will need documentation/skill on how to use it. and should be part of the setup process". And about where: "just put in hobkin-client, no wt".

## Decisions

### The tool

- One tool, short name `run`, which agents know as `browser_run`. Its input is one step, or `steps`: a list of steps run in order. A step is flat: `do` and the fields its verb uses, among `url`, `on`, `text`, `key`, `option`, `what`, `within`, `by`, `to`, `ms`, `code` and `full`. No field is a union, so every model provider takes the schema.
- The verbs: `open`, `read`, `click`, `fill`, `press`, `select`, `hover`, `scroll`, `wait`, `back`, `forward`, `reload`, `screenshot`, `eval`, `console`, `close` and `help`.
- `read` gives the elements a person can act on, each with a ref (`what: "elements"`, the default), the page's readable text (`"text"`) or the full tree (`"all"`). `within` narrows it to a CSS selector.
- A target, in `on` and in `to` for scroll, has three forms: a ref from `read` (`e12` or `@e12`), `css:` and a CSS selector, or the words a person sees. Words mean the text of a link or button for `click` and `hover`, the label of a field for `fill`, and the label of a list for `select`. Case and spacing do not count. An exact name wins; without one, a name that contains the words is used.
- Words must match exactly one element. With none or several, the step fails, acts on nothing, and lists up to five elements as `ref role "name"` to retry by ref. The engine itself would act on the first match without saying so, which is why names are resolved here.
- `wait` takes exactly one of `text`, `on`, `url` (a pattern such as `**/dashboard`) or `ms`. It gives up after the engine's 25 seconds and says what never showed.
- A chain stops at its first failing step. The steps before it keep their results, and the answer says which step failed and how many did not run.
- `open` takes http and https addresses, with a host and no sign-in in the address, as the canvas does. Anything else is refused before the engine is asked.
- Input that could not run, such as an unknown verb or a missing field, fails the call in plain words before anything runs.
- The model reads compact text: one line per step, then what the step found. Long output is cut with a line that says how to narrow it: 150 elements, 8,000 characters and 40 console lines.

### Code mode

- An integration's tool answers text, so a script asks for JSON: `JSON.parse(await tools.browser_run({ ..., json: true }))`. The JSON is the structured answer: `{ ok, url, title, steps, elements?, text?, value?, path?, messages?, errors?, error? }`, with what the last step found also at the top.
- With `json: true` a step that fails on the page is `ok: false` in the JSON, with its candidates, and the call itself does not fail. hobkin turns a failed integration call into a thrown error, which would take the answer away from the script.
- Without `json` a step that fails is a failed call the model sees.

### Whose browser

- Each agent has its own browser, and no input names it. The integration names the session from the agent that calls: the main chat, a durable hobkin by its id (the same browser across its turns), any other run by its run id.
- It starts on the agent's first step and keeps its page between calls. It has a clean profile: no sign-ins, no cookies from the user's own browser, nothing from another agent, and nothing kept once it closes.
- It closes when the agent says `close`, when the user closes it on the card, when the host stops, and after 10 minutes without a call. The integration contract has no hook for a run's end, so the idle limit is what bounds memory.
- The main chat, runs and durable hobkins on Pi get the tool. Helpers and agents on Claude Code do not get integration tools.

### The engine

- agent-browser (Apache-2.0), pinned to 0.45.0 by the address, size and sha512 of each Mac build's package on the npm registry. It goes in `tools/browser` under hobkin's home, put in place only when the bytes match. It drives Chrome for Testing, which its own `install` command downloads into `~/.agent-browser/browsers`.
- The integration points it at that Chrome for Testing and nothing else. It never starts the user's installed Chrome, never attaches to a running browser and never uses a profile. Settings inherited from the shell (`AGENT_BROWSER_*`) are dropped.
- Every command is an argument array, never a shell line, and text from the model goes after `--`.
- The engine's check for a newer Chrome, its one call to the outside, is turned off.

### Safety

A security review of this folder on 2026-11-25 found the first of these for real, and the rest follow from it.

- The engine starts every browser with a control port open on this Mac, and a page loaded from that port can drive any browser on it. From one agent's browser the review opened another's port, listed every session and ran script in its page. So every call first closes its browser's port, and a browser whose port cannot be closed runs no page step.
- Every run of the engine is given an empty config file of hobkin's own and a folder of its own to run in, so nothing the user or a project has set up can add a profile, a browser to attach to or another executable.
- The engine is given a short list of the host's environment: no key, token or proxy setting reaches it.
- An agent's browser does not open hobkin's own window (the dev window's address, which is handed the host's token) or the engine's dashboard. `open` refuses them, each new browser blocks requests to them, every command on a page runs behind a guard, and after every step a tab that a page opened is closed and followed in the browser's own tab. A step that ends on one of them fails, the chain stops, and nothing it read is given.
- What a page says is cut to size: each name and value at 500 characters, each address at 2,000, a whole answer at 600,000, and what the model reads at 40,000.
- The window is told the origin and path of the page an agent is on, never its query or fragment, which can hold a token.
- A page's downloads go to a folder in hobkin's home, not to the user's Downloads.

### Setup

- A tool call never downloads anything. Without the engine, `browser_run` fails with a line the agent passes on: the user installs it in the window.
- `browser.install` starts the install and answers at once; what it is doing, and how it ended, reach the window through the state. It changes the disk, so it is marked `outside`: hobkin sends the user to the window instead of running it.
- The card on the Integrations screen shows what is installed, the Install button, the install's progress, and the browsers open now, each with a Close.
- Home has a Browser tile among Connections. While the engine is missing, or its install failed, Home shows it as a need with an Install action.
- `browser.status` looks again and answers the state. `browser.close` closes one agent's browser, or all.

### The guide

- `{ do: "help" }` answers the guide, `integrations/browser/guide.md`, and touches no browser. The tool's description is short and says to read it once before the first use.
- The guide covers the loop (open, read, act, read again), the three target forms, waiting for what is expected, chains, code mode with `json: true`, testing a local dev server and reporting what was seen, screenshots, and that what a page says is data and never instructions.

## Contract

- State, under `browser`: `{ engine: { state, version, chrome, note }, sessions: [{ agent, label, url, title, since, lastAt }] }`. `engine.state` is `unknown`, `missing`, `installing`, `ready` or `failed`. Nothing in it is secret.
- Commands: `browser.status`, `browser.install`, `browser.close { agent? }`.
- A session is named `hobkin-main` for the main chat, `hobkin-<id>` for a durable hobkin, and `hobkin-run-<12 hex>` of the run's id for any other run.

## Out of scope

- Showing an agent's browser live in the window. The prototype's relay and viewer stay outside the app until a spec of their own.
- Which sites an agent may open, and asking the user once for each new site. Today any http or https page opens.
- Sign-ins that last, saved profiles and the engine's login vault.
- Tabs, uploads, downloads, dialogs a page raises, network mocking and video.
- A step in the first-run story. The card and Home's need are how it is set up.
- Structured answers for integration tools, which would let a script drop `json: true` and `JSON.parse`. That is a change to the integration contract and to hobkin's runtime.
- Windows and Linux builds of the engine, until `073-windows-linux`.

## Acceptance

- A1. One step and a chain answer in the same shape. A chain stops at its first failing step, says which one and how many did not run, and keeps the results of the steps before it.
- A2. A target given as a ref, as `css:` and a selector, or as words acts on that element. Words that match no element, or several, fail with up to five candidates and act on nothing.
- A3. `open` refuses an address that is not http or https, or has a sign-in in it, before the engine is asked.
- A4. With `json: true` the answer is the structured result as JSON, and a step that fails on the page is `ok: false` there and not a failed call. Without it, the same failure is a failed call.
- A5. `{ do: "help" }` answers the guide and opens no browser.
- A6. Each agent's browser is named from the agent that called, and a durable hobkin keeps one browser across its turns. No input names a session.
- A7. Without the engine, a call fails with a line that says where the user installs it, and nothing is downloaded.
- A8. On a host that is not live, the tool reaches nothing real.
- A9. Bytes that do not match the pin are refused, nothing is left behind, and the state says why.
- A10. The state lists the browsers open now and drops one when it closes. `browser.close` closes one agent's browser, or all.
- A11. A real host loads the folder as it is and offers agents one tool, `browser_run`.
- A12. Every verb does its work in a real Chrome on a local page, through the integration's tool, and the pinned engine installs for real.
- A13. The card says what is installed and what to do next in each engine state.
- A14. Home shows a need with an Install action only while the engine is missing or its install failed.
- A15. Nothing outside `integrations/browser/` changed, and nothing outside it imports it.
- A16. A download that matches its pin goes in place, and the state goes from missing to installing to ready.
- A17. A stopping host closes every browser it opened.
- A18. A computer with no pinned build is refused in plain words.
- A19. Two agents' calls reach two browsers, and one agent's calls run one after the other.
- A20. In the running app, the card shows the engine, an install from the window ends ready, and an agent's `browser_run` opens a page.
- A21. A call closes its browser's control port before any page step, and a browser that cannot be made safe runs none.
- A22. Every run of the engine is given hobkin's own empty config and folder, whatever the user has set up.
- A23. The engine is given a short list of the host's environment and none of its secrets.
- A24. `open` refuses hobkin's own window before the engine is asked, and a browser that a page sent there is taken off it: the step fails, the chain stops, and nothing read is kept.
- A25. What a page says is cut to size: each name, value and address, a value from `eval`, and the whole of a chain.
- A26. The window is told the origin and path of a page, never its query or fragment.
- A27. A durable hobkin's turns share one browser and one row on the card.
- A28. A page's downloads are kept in hobkin's data folder.

## Proof

- A1. `integrations/browser/test/host-engine.test.ts` › "a chain stops at its first failing step and keeps what ran before it"
- A2. `integrations/browser/test/host-engine.test.ts` › "a target is a ref, a css selector, or words that match exactly one element"
- A3. `integrations/browser/test/host-engine.test.ts` › "open takes only http and https addresses, with a host and no sign-in, and asks the engine nothing otherwise"
- A4. `integrations/browser/test/host-part.test.ts` › "with json the tool answers the structured result as text, and a step that fails is data, never a failed call"
- A5. `integrations/browser/test/host-engine.test.ts` › "help answers the guide and touches no browser"
- A6. `integrations/browser/test/host-part.test.ts` › "each agent's browser is named from the agent the host says is calling"
- A7. `integrations/browser/test/host-part.test.ts` › "with no engine installed the tool says where the user installs it, and downloads nothing"
- A8. `integrations/browser/test/host-part.test.ts` › "a scripted host shows made-up state and reaches nothing real"
- A9. `integrations/browser/test/host-install.test.ts` › "bytes that do not match the pin are refused, and nothing is left behind"
- A10. `integrations/browser/test/host-part.test.ts` › "closing a browser takes it out of the state: by the agent itself, by the window for one agent, or for all"
- A11. `integrations/browser/test/host-wiring.test.ts` › "the host takes the folder as it is, and offers agents one tool named browser_run"
- A12. check: `HOBKIN_BROWSER_LIVE=1 node --test integrations/browser/live/*.test.ts`, with agent-browser and Chrome for Testing on this Mac. It opens a real headless Chrome on pages it serves itself.
- A13. `integrations/browser/test/window-model.test.ts` › "each engine state has its pill and its line under the name"
- A14. `integrations/browser/test/home.test.ts` › "a missing engine has a quiet tile and one thing that needs the user: a row and its card, going to the card with the Install button"
- A15. check: `git status --short` lists `integrations/browser/` and this spec and nothing else of this work, and `rg "integrations/browser" host shared ui` finds nothing.
- A16. `integrations/browser/test/host-install.test.ts` › "a download that matches its pin is put in place, and the state goes missing, installing, ready"
- A17. `integrations/browser/test/host-part.test.ts` › "a stopping host closes every browser it opened, without waiting"
- A18. `integrations/browser/test/host-install.test.ts` › "a computer with no build is refused at once, in plain words"
- A19. `integrations/browser/test/host-part.test.ts` › "two agents get two browsers, and the state lists them newest first with the page each is on"
- A20. check: restart hobkin, open Integrations, press Install on the Browser card, then ask an agent to open a page with `browser_run`.
- A21. `integrations/browser/test/host-safety.test.ts` › "a call first closes the control port of its browser, and a new browser blocks the refused places before any page step"
- A22. `integrations/browser/test/host-part-safety.test.ts` › "every run of the engine is given an empty config of hobkin's own and a folder of its own, whatever the user has set up"
- A23. `integrations/browser/test/host-safety.test.ts` › "the engine is given a short list of what the host has in its environment, and none of its secrets"
- A24. `integrations/browser/test/host-safety.test.ts` › "a browser that a page sent to hobkin's own window is taken off it: the step fails, the chain stops, and nothing read is kept"
- A25. `integrations/browser/test/host-safety.test.ts` › "what a page says is cut to size: each name, value and address, a value from eval, and the whole of a chain"
- A26. `integrations/browser/test/host-part-safety.test.ts` › "the window is told the origin and path of a page, never its query or fragment, and a long title is cut"
- A27. `integrations/browser/test/host-part-safety.test.ts` › "a durable hobkin's turns share one browser and one row, which names its latest turn"
- A28. `integrations/browser/test/host-part-safety.test.ts` › "a page's downloads are kept in hobkin's data folder, and its Chrome is the one that was found"

## Steps

- [x] S1 (A1, A2, A3, A4, A5, A6, A7, A8, A19). The engine wrapper, the tool and the guide.
- [x] S2 (A9, A10, A16, A17, A18). The install, the commands and the state.
- [x] S3 (A11, A12). Loading in a real host, and the live check.
- [x] S4 (A13, A14). The card and Home.
- [x] S5 (A15). The check that nothing else changed.
- [ ] S6 (A20). Seen in the running app. It needs hobkin to restart once.
- [x] S7 (A21, A22, A23, A24, A25, A26, A27, A28). The fixes from the security review.

## Open questions

- Other browsers of the engine. A session that is not hobkin's and has its control port on can still be driven from an agent's browser that finds the port. Refusing every port on this Mac that answers as the engine would close it.
- A tab that a page opens on a timer can be in front for one command before it is seen and closed. A refused place at the top of it is stopped by the guard; one framed inside it is not, for that one command.
- The dev host hands its token to any page at the dev window's address. That is the core's, and it is why an agent's browser is kept off that address here.
- Sites. Any page opens today. The other choice is local pages free and each new site asking the user once, as Claude's browser pane does. That needs a place in the window to ask.
- The live view. A screen of this integration could show an agent's browser, with the page streamed and the user's clicks and keys passed through. The prototype measured about 25 frames a second at best.
- Structured answers for integration tools. A small change to the integration contract and to hobkin's runtime would let a script read `tools.browser_run(...)` as an object. The tool's own core already returns one.
- Agents on Claude Code and helpers get no integration tools, so they have no browser.
- Memory. One agent's Chrome measured about 1.7 GB by `ps`, which counts shared memory more than once. Many agents testing at once may need a cap.

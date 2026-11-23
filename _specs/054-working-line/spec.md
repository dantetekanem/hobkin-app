---
{
  "id": "054-working-line",
  "title": "Every hobkin's working line: time, tokens and when it goes quiet",
  "kind": "work",
  "status": "done",
  "depends": ["011-work", "034-durable-hobkins"],
  "updated": "2026-11-23"
}
---
# Every hobkin's working line: time, tokens and when it goes quiet

## Outcome

While any hobkin works, the main agent, a durable hobkin or an agent hobkin started, the window shows one line for it, as the user's Pi extension does in the terminal: whether it works or thinks, how long the run has gone, which way tokens last moved and how many, and a notice once it has been quiet for one minute, three and five.

## Decisions

### The user's words

- 2026-11-23: "i really like my pi-thinking-messaging, showing income/outcome and when is stale. i want this in all hobkins (main, durable, spawned)".

### What the line says

- It mirrors `pi-thinking-messaging` (`~/Poetry/pi-thinking-messaging/src/index.ts`), whose line is `Working… (7m 7s · ↓ 30.0k tokens)`.
- The phase is "Thinking" while the model's thinking arrives, and "Working" the rest of the time.
- The time counts from when the run began: `7s`, `7m 7s`, `1h 2m 3s`.
- The arrow is `↑` once a request goes to the model and `↓` once tokens of an answer arrive.
- The count is an estimate for the run. It starts with the prompt's characters over four. An answer adds each delta's characters over four, and when a message ends the output the provider reports takes that estimate's place if it is more. The count never goes down. It leaves out the system prompt, the tool definitions and cached context, so it is no bill.
- Quiet: with no token for over one minute the line adds "agent is taking a while...", over three "agent is probably idle...", both as a warning, and over five "agent is idle" as trouble. A tool can still be running, as in the extension, so a long test run reads as quiet.
- The line shows only while a run works. A hobkin that waits for the user, asks something or is at rest has none.

### Where it comes from

- hobkin's runtime works the pulse out for every run it observes and for the main session: when the run began, when a token last moved, the phase, the direction and the count. It is one small observer over the engine's events, the same for Pi and for Claude Code.
- The pulses reach the window as one optional key of the snapshot, `pulses`, with one pulse for each working run by its run id and the main turn's under `#main`. They go with the activity hobkin already publishes, and a run's pulse changes on the wire at most once a second. The window ticks the time and the quiet notice from its own clock.
- A pulse is `{ startedAt, lastTokenAt, phase, direction, tokens }`: two times in milliseconds, `working` or `thinking`, `up` or `down`, and a whole number.
- A host or a runtime older than this sends no pulse, and each place then shows what it shows today.

### Where it shows

- The main agent: the status row above the input, where its elapsed time is.
- A durable hobkin: the working row of its page, and its row in the list.
- An agent hobkin started: its row in the list, and the thinking row of its own page.
- In the list the line goes ahead of the agent's latest words and does not take their place (the user, 2026-11-23, asked for both). A run that went quiet says so first, so a narrow row cuts the words and never the notice.
- Nothing moves. The line goes only where a line of fixed height already is, its figures are tabular, and the quiet notice changes the line's words and tone, never its height.

## Out of scope

- The provider's exact token counts while a run is under way, cost, and cached tokens.
- Stopping an agent that went quiet. Work mode's own rule, an hour with no growth, stays as it is.

## Acceptance

- A1. A pulse follows a run's events as the extension does. It starts with the prompt's estimate and the arrow up, turns down as an answer's tokens arrive, says thinking while thinking arrives, takes the provider's output count at a message's end when that is more, and never counts down.
- A2. For a pulse and a time the line reads as the extension's does, `Working… (7m 7s · ↓ 30.0k tokens)`, with the quiet notices after one, three and five minutes without a token: a warning, a warning and trouble.
- A3. While the main agent, a durable hobkin or a started agent works, the snapshot carries its pulse, on Pi and on Claude Code, and none once it stops. A run's pulse changes on the wire at most once a second.
- A4. The window shows the line for each of the three where its working sign is today, and nothing moves when the line appears, changes or goes.
- A5. With no pulse on the wire, each place shows what it showed before.

## Proof

- A1. `hobkin/test/cli-pulse.test.mjs`, every test in it.
- A2. `shared/test/pulse.test.ts`, every test in it; check: a still render of the line in its three places, plain, as a warning and as trouble.
- A3. `hobkin/test/cli-pulses-wire.test.mjs`, every test in it; `host/test/claude-code-stream.test.ts`, the test of what a pulse needs from Claude Code's stream.
- A4. check: a still render of the status row, the list row at two widths and the working row. Not seen in the live window.
- A5. check: by reading. Each place gives the component what it showed before as its fallback, and the component shows it while the snapshot has no pulse for that run.

## Steps

- [x] S1 (A1, A2). The pulse observer in the runtime and the line in `shared/`. hobkin ee8241d, client 7617b9a.
- [x] S2 (A3). The runtime feeds the observer from the main session and from every observed run and publishes `pulses`, and Claude Code's stream passes on what a pulse needs. hobkin 6767c00, client c5c3516 and b5f628b. Run with fake sessions only. A main turn Pi starts by itself has no pulse, and a run prompted again after it ended starts a new pulse with its time at zero.
- [x] S3 (A4, A5). The window's line in the status row, the durable hobkin's page, the list and the agent's page. Client 393522e and 991828c. In the list a run that went quiet says so first, and the line goes ahead of the agent's latest words. The notice is joined with a middle dot where the extension has a hyphen. Seen only as a still render.

## Open questions

- Should a running tool count as activity, so a ten minute test run does not read as idle? The extension says no, and this follows it.

---
{
  "id": "048-work-mac-fixes",
  "title": "The work Mac's fixes, rebuilt on main",
  "kind": "work",
  "status": "doing",
  "depends": [],
  "updated": "2026-11-19"
}
---
# The work Mac's fixes, rebuilt on main

## Outcome

The fixes the user made on their work Mac, which stayed uncommitted there, are rebuilt here on main in hobkin-client and in hobkin, so both Macs get them from the same history. `notes.md` is that Mac's record, kept as written: each entry's problem, change, how to redo it, its tests and its check. The app stays quick while subagents run, which the user named as the biggest problem.

## Decisions

- The entries are rebuilt from `notes.md`, read against the code here. An entry this repo already has is marked done with the commit that has it, not built twice.
- Not rebuilt, since they changed that Mac and not the code: 1 (Rust on the PATH), 2 (an old hobkin checkout), 4 (leftover Pi programs) and 36 (a local lane that reads chat channels).
- Not rebuilt: 39, the bent hood. The four pets of `047-pets` replaced the hood.
- Not applicable: 35 and 45. They change Work's boards, and this repo has no boards (the canvas board of `040-canvas-board` is another thing).
- Company names and values stay out of the code, the tests and the commits. They belong only in a home's own config.
- Added on 2026-11-19, the user's words: "lets fix the sketching system, the agent sketch things withhout being asked". A hobkin draws on its canvas only when the user asks (`040-canvas-board`, The skill).
- Performance comes first in every lane: 24, 40 and 44, and what a measurement of the app with subagents running shows.

## Out of scope

- Pushing, a version bump, and anything under `src-tauri/` or `package.json` without the user's word.
- Trying a fix on the user's live home or host.

## Acceptance

- A1. Each entry rebuilt here passes the "Check" of its entry in `notes.md`, and its "Tests to write" exist and pass.
- A2. With subagents running, the window and the host stay responsive; the measurement before and after each performance fix is in its commit.
- A3. A hobkin opens or draws on its canvas only when the user asks for it.
- A4. Whole-project typecheck adds no error, and the focused tests of every changed module pass.

## Proof

- A1. Per entry, the commits in Steps; each commit names its tests.
- A2. The performance commits' bodies.
- A3. hobkin ef6d989 (the canvas skill) and client dcf4d4b (the client tool and the canvas commands); check: ask a durable hobkin for a plan without asking for a drawing; its canvas stays closed.
- A4. `pnpm typecheck`; each commit's focused tests.

## Steps

- [x] S1 (A3). The canvas only when asked: hobkin ef6d989, client dcf4d4b.
- [ ] S2 (A1, A2). Performance with subagents running, 44, then 28 and 29 in the window.
- [ ] S3 (A1, A2). In hobkin: 24, then 41 (Esc), 33, 23 and 29 on the runtime's side.
- [ ] S4 (A1, A2). Change Review: 40 (the constant search), 31 and 41 (only the user's words), 18, 38, 25, 9, 17, 10, 46, 16, 12, 42, 37, 40 (the title link), then 13, 15, 26 and 27 (other code hosts).
- [ ] S5 (A1). Review window: 43, 19, 14.
- [ ] S6 (A1). Setup and routines: 3 (03688b4), 5 (a42fa73), 6, 21, 8, 11, 7, 20.
- [x] S7 (A1). Views: 30 (388e3f9), 32 (876048f), 34 (f8616cd).
- [ ] S8 (A1). The window's halves of 41 (Esc), 33 and 23, once S3 has them.

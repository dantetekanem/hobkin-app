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
- [x] S2 (A1, A2). Performance with subagents running: 938ef44 (44), e8a831a, 8d3f2ce, 1f2b259, de62b84, 3057f50; 28 and 29 in the window: cc55aa3, d043796.
- [x] S3 (A1, A2). In hobkin: 3b79dd7 (24), b48126c (41, Esc), 7d42a93 (33), b46fe91 (23), 3d97be9 (29); performance 634de70, b070dd4, e63dcc8, 5660fb5.
- [x] S4 (A1, A2). Change Review: cdab6f5 (40), 7395763 (31, 41), d23d256 (18), b3d28c5 (38), e4eaad2 (25, 9), de78112 (17), e3cb12d (10), e4e897f (46), 83dba4e (16), 6bbfbe5 (42), 076ebaf (37), 13a7f2a and ea5d50e (40, the title link); other code hosts e94c020, a912a70, 6ed0130, a8c082c, 519a5c0, 85b6336 (13; 79891f1 shows it on a Mac without gh), 30fadec (15), 5c7538a, 65ea1a8, 636d742 (26), 4ff4905, 5a58c39, b0c208f, 1cf4de0 (27).
- [x] S5 (A1). Review window: 5461c60 (43), 63d2cdf (19), f43bc28 (14).
- [x] S6 (A1). Setup and routines: 03688b4 (3), a42fa73 (5), 6176739 (6), 514728b (21), b5abf50 (8), 6ffea4d (11), 584d331 (7), 266b93a (20).
- [x] S7 (A1). Views: 388e3f9 (30), 876048f and 755c659 (32), f8616cd (34).
- [x] S8 (A1). The window's halves of 41 (Esc): bb41cd5, e83a9fd; 33: 07d115e, d79be3e; 23: 07d115e, 94e5f0a.
- [ ] S9 (A1). 12, the review learnings: waits for the work Mac's rules file, which is not in `notes.md`.
- [ ] S10 (A1, A2). Seen in the app after the user's restart.

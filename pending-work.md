# Pending Hobkin work

Checkpoint from session `01a1d0c7-f5c4-7468-bf1c-29f6e3fdb091`, November 12, 2026.

**Development is stopped at the user's request.** The later request authorized committing existing work and recording what is missing, not restarting implementation. Both post-processing agents were stopped. Nothing was pushed or activated.

This file is the concise continuation checklist. `work-in-progress.md` retains the detailed history. Task numbers below belong to the recovered current queue; preserve its order and prerequisites. Open acceptance/inventory wrappers do not necessarily mean their underlying code is missing. Check existing evidence before rebuilding anything.

## Latest requests still unimplemented

- **63 — Discuss any report or action item.** Open the existing main chat with the exact item identity and context. Preserve drafts and focus. Discussion must not implicitly send, answer, approve or complete anything. Inventory all displayed source types and coordinate with the separate Actions/Review owner before editing.
- **64 — Mouse-select and copy readable text.** Support natural selection and Cmd+C across reports, actions, lists, detail views and chat. Selecting text must not trigger actions or navigation. Inspect shared CSS, pointer handlers and keyboard ownership first; avoid adding copy buttons everywhere.

These requests remain in their existing queue positions, not moved ahead of older work.

## Custom-theme checkpoint: implemented, not finally accepted

At the last lead-verified revision, all three slices were present: Settings submitted a dedicated theme request rather than using the main chat, and a host-bound, nondelegating child received only fixed-file `custom_style` read/replace operations. The approved scope was five palette colors and two optional border colors, with configured launchers refused and main `appearance.set` compatibility preserved. Concurrent edits during checkpointing mean this is a description of that verified revision, not a claim about the latest working tree.

The UI correlates an ask only through its acknowledged operation ID and exact saved appearance ID. Lost acknowledgement remains unknown, with no automatic retry. A saved theme, child completion and cleanup are separate facts.

- Runtime checkpoint: `93402ef5802f3f5a8674706420ce5db2b3dd9722` in `../hobkin`, branch `client/background-work`.
- A concurrent session's client commit, `61c5ea774fb4be9824dc0b9aafbb25f755246578`, picked up the staged host/Settings files and these notes alongside six unrelated Work files. It is a mixed commit, not this lead's isolated client commit. Its history was left intact.
- **68 remains incomplete:** reconcile the stopped runtime/host post-processing edits, finish only what is still necessary, and verify the final combined files. The agents did not deliver accepted final handoffs.
- **69 remains unstarted:** independent security/source acceptance, followed by lead reconciliation.
- The commit is a WIP checkpoint, not proof that the integrated feature is ready.

### Concurrent checkout changes to reconcile

The client HEAD advanced while this checkpoint was being prepared. Before staging, the hashes of `rules.ts`, `store.ts` and `settings-theme-ask.test.ts` under the Settings feature/test paths no longer matched this session's last verified files. After the mixed commit, further unowned changes appeared in `SettingsScreen.tsx` and `store.ts`; the latter changed the theme request back to a main-chat send. These changes were not made or accepted by this lead.

Do not undo another session's work or assume the old theme acceptance covers this mixture. If development resumes, establish the intended theme behavior with the current owner, reconcile the exact files, then repeat the appropriate focused verification. The client checkpoint is not an exact snapshot of this session's previously tested UI. No history rewrite or code restoration was attempted.

### Verification already obtained

| Slice | Last accepted evidence | What it does not prove |
|---|---|---|
| Runtime65 | 17 focused fake checks passed before final post-processing. | The later stopped-agent edits have not received final verification. |
| Host66 | 5 focused fake checks and typecheck passed before final post-processing. | The later stopped-agent edits and actual host wiring have not received final acceptance. |
| Settings67 / lead UI68 | 19 focused checks passed; the lead's UI readability changes also passed 19/19. | React rendering, native focus/keyboard behavior and real helper execution were not exercised. |
| TypeScript | Whole-project compiler passed after67. | It was not rerun after all stopped post-processing edits. |

No tests were rerun merely to make these checkpoint commits. Scoped/staged whitespace and commit attribution were checked. Previously passing checks must not be presented as verification of changed bytes.

Local receipts and stage reports:

- Runtime: `/tmp/hobkin-theme65-lead.E2fXRw/tests.txt`.
- Host: `/tmp/hobkin-theme66-lead.0TNzfB/{tests,types}.txt`.
- UI: `/tmp/hobkin-theme67-lead.RWOhH3/{tests,types}.txt` and `/tmp/hobkin-theme68-ui.jgiaZ0/tests.txt`.
- Reports: `/Users/someone/.pi/agent/reports/session-01a1d0c7-f5c4-7468-bf1c-29f6e3fdb091/theme-runtime65-acceptance.md`, `theme-host66-acceptance.md`, `theme-ui67-acceptance.md`, and `custom-theme-execution-plan.md`. Temporary receipts may eventually expire; do not invent missing evidence.

### Boundaries to preserve

- Theme-helper initiation is Settings-only. Broader styling, main-chat initiation and configured-launcher support remain outside the approved first version.
- The user removed numeric line/file limits for this theme feature. Older limits in historical reports are superseded; feature scope and safety boundaries are not.
- This restricts model tools; it is not OS containment or executable attestation.
- Browser/native launches, live-home/5188 operations, real provider/model/helper execution, services, signals, installs and pushes remain unauthorized. Existing real-Application/Work-streaming/browser fixtures must not run without the appropriate authorization.
- **Force-stop UI is for subagents only.** Do not restore the removed main-agent Force controls. Ordinary main Stop/Escape remains.
- Preserve separate Review/Actions/Work/Placeholder work and the runtime's untracked action-dismissal fixture. The registry's unrelated `work.change`/`done` hunk is excluded from this checkpoint. Its full-file hash also changed with a separate committed Review update; do not revert that update to match an old acceptance hash.
- Home has earlier source/fake acceptance at `2f84bac`; task7 originally remained open for native/rendered acceptance, not a rebuild. Separate current Home edits were observed during checkpointing and are not covered by that earlier evidence.

## Remaining queue

59 records remain open. “Waits for” lists immediate unfinished prerequisites, not permission to start. Development remains paused even when a row has no prerequisite.

| Task | Remaining work | Waits for |
|---|---|---|
| 7 | Home native/rendered acceptance; source/fake criteria already satisfied. | Native/browser authorization |
| 68 | Finish/reconcile theme post-processing and final isolated verification. | User resumes development |
| 69 | Independent theme boundary and integrated-receipt acceptance. | 68 |
| 9 | Reconcile single-file custom-theme inventory/wrapper; distinguish the limited first version from broader unfinished styling. | 69 |
| 10 | Show actual nested-agent activity in the existing client. | — |
| 11 | Deliver concise owned-agent updates to the companion. | — |
| 12 | Cmd+N controlled-agent and companion-return inventory/wrapper. | 10, 11 |
| 13 | Persist the selected persona and include it in both main prompt hooks. | — |
| 14 | Host-backed Settings personality selection. | 13 |
| 15 | Personality-controls/six-persona inventory and acceptance wrapper. | 14 |
| 16 | Session-owned direct shell execution without a model turn. | — |
| 17 | Explicit `!` draft submission, hint and actual shell results. | 16 |
| 18 | Direct-shell inventory/acceptance wrapper. | 17 |
| 19 | Separate root-agent spatial World page. | — |
| 20 | Approved-project World page opened from Work. | 10, 19 |
| 21 | Attached-image previews and zoomable lightbox. | — |
| 22 | Render codemode calls as focused tasks, inputs and results. | — |
| 23 | Make subagent entry transitions finish within 200 ms. | — |
| 24 | Reports context and first eligible report selected once per visit. | 7 |
| 25 | Allow main Hobkin to request allowlisted app pages through the existing client tool. | 24 |
| 26 | Bounded local dashboard configuration. | 25 |
| 27 | Home/dashboard/automatic-report/page-opening inventory wrapper. | 26 |
| 28 | Deduplicate only shared Mind/agent presentation. | — |
| 29 | Accept the existing prompt editor's draft lifecycle. | — |
| 30 | Accept Reports paging and prepared arrival. | — |
| 31 | Accept menu and Spotlight destinations. | — |
| 32 | Accept the extra page panel. | — |
| 33 | Accept Work priority and capacity roundtrips. | — |
| 34 | Accept local file links and viewer. | — |
| 35 | Explicit resource selections and per-purpose defaults. | 13 |
| 36 | Trusted installed resource candidates and selected SDK-resource binding. | — |
| 37 | Enforce selected resources in main SDK loading. | 35, 36 |
| 38 | Enforce resource policy in RPC and background bindings. | 16, 37 |
| 39 | Publish actual same-session loaded-resource facts. | 38 |
| 40 | Carry resource catalog/selections through the host protocol. | 69, 14, 25, 39 |
| 41 | Explicit cancellable MCP sign-in through the pinned Pi adapter. | 40 |
| 42 | Replace refresh-as-login with explicit MCP start/cancel UI. | 41 |
| 43 | Supported Pi MCP sign-in inventory/acceptance wrapper. | 42 |
| 44 | Show actual effective resources in Settings. | 40 |
| 45 | Preserve canonical filed-request identity for notification deduplication. | — |
| 46 | Request-only native notifications with explicit safe click routing. | 45 |
| 47 | Native-notification inventory/acceptance wrapper. | 46 |
| 48 | Rendered Routines tooltip bounds, focus and hover verification. | Browser/native authorization |
| 49 | Rendered routine deletion and draft/focus preservation verification. | Browser/native authorization |
| 50 | Expose completed app-refresh/current-state receipts to main Hobkin. | — |
| 51 | Exact-operation user authorization for governed app controls. | 50 |
| 52 | Typed access to Hobkin's domain information and exact data operations. | 51 |
| 53 | Main-conversation reset and clear-visible-chat with truthful receipts. | 51 |
| 54 | Native-owned backend restart and reconnect verification. | 53 |
| 55 | App-management tool inventory/acceptance wrapper. | 52, 54 |
| 56 | Settings Fun mode with a quiet mascot view; inventory placements first. | — |
| 57 | Plan animated setup and five-question onboarding with the user before implementing. | User discussion |
| 58 | Distinguish projects and actions with color. | — |
| 63 | Discuss/reply to any report or action item. | — |
| 64 | Mouse text selection and copying throughout the app. | — |
| 59 | Final cross-feature post-processing and verification. | 9, 12, 15, 18, 20–23, 27–34, 43, 44, 47–49, 55–58, 63, 64 |
| 60 | Independent integration and safety acceptance. | 59 |
| 61 | Accept the separate `pi-ask-user` nonblocking-screen repair. | — |
| 62 | Reconcile the trusted ledger and final evidence. | 60, 61 |

## Already committed in this continuation

Do not reimplement these from older wrapper descriptions:

- Runtime startup metadata fix: `ea1d305` — 9 focused checks passed; live startup unverified.
- Main-chat Force UI removal: client `228c2c9` — ordinary Stop retained.
- Nerd Stats Settings overlay: client `098ed80` — 35 focused checks, typecheck and source acceptance.
- Removed World target invalidation: client `57bffed` — 7 focused checks and typecheck.
- Stale-safe owned-child snapshots: client `a1c0d01` — 14 focused checks, typecheck and connected-source acceptance.

Native/rendered or live-runtime evidence remains separate from these source/isolated results.

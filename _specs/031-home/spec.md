---
{
  "id": "031-home",
  "title": "Home: smart stack and widgets",
  "kind": "work",
  "status": "doing",
  "depends": [],
  "updated": "2026-11-25"
}
---
# 031 Home: smart stack and widgets

## Outcome

Approved by the user on 2026-11-11. It replaces the "Ideas" cards and the Briefing on Home (#83 is superseded). Home is the main screen. It lives in the panel beside the chat, inside `SCREEN_COLUMN` (1040px at most). The sidebar is unchanged, and the layout uses **at most two columns**.

Mockup: https://claude.ai/artifact/NMtQJtSUzyAnsenwNEziDr. Its source is copied to `mockup/Main.dc.html` and `mockup/StackCards.dc.html`. It draws three columns with sample data; build two. Map its hex colors to the app's tokens and Tailwind classes. Never use raw hex.

## State when handed over

- `ui/src/features/home/types.ts` is the contract: `HomeInput`, `HomeModel`, `StackCard`, `HomeRow`, `NeedRow`, `HomeTarget`, `DayStrip`. Every field is documented.
- `ui/src/features/home/model.ts` is a placeholder returning an empty model. It needs the real rules, written test-first in `ui/test/home-model.test.ts`.
- `navigate.ts` (`openTarget`) and `use-home.ts` (`useHomeModel`) were started by a stopped lane. Review them before you trust them.
- `HomeScreen.tsx`, `reports/Overview.tsx` and `reports/HomeIdeas.tsx` are unchanged.

## Acceptance

### Layout

- A1. Header: Hob with `header.mood`, `header.title` ("5 things need you"), `header.line` (what came since the user last looked), and tone-dot chips (agents working, next check, work held).
- A2. An `@container` grid: one column when narrow, two from about 720px. The rows are: Smart stack | Needs you, Running now | Coming up, Problems | Projects, Connections | This week.
- A3. Home shows every widget its data holds the first time it is drawn, including when the app opens on Home, and a widget that turns up while Home is open enters on its own. No widget waits for a screen entrance that does not play (`ui/test/home-cells.test.ts`).

Reworked on 2026-11-12 at the user's request ("UX is bad, UI is not rich, clicks are not navigating well, the Decision card is horrifying"):
- A4. The header greets by time of day and date, and its chips are buttons that go where they point.
- A5. Every row is one button with a tone-tinted icon and a verb that says where it goes ("Review", "Decide", "Read", "Answer"); an outward arrow marks a link that leaves the app. Widget links read "See all", not an external-looking arrow.
- A6. The card's primary button uses the app's primary button (`bg-primary text-primary-foreground`). `text-sun-fg` on `bg-sun` drew yellow on yellow and hid the label.

### Smart stack

- A7. One card shows at a time. The most relevant card is on top, and each card says why it is there.
- A8. A pager (previous, "1 of 4", next), a segment bar in each card's tone, and a "Then: …" line let the user flip cards.
- A9. A card shows what the user weighs before going: a finished change's size, grade, safety, how far behind and conflicts; a report's next step; hobkin's pick, why, and the choices the destination will offer. Home shows choices; it never picks one.
- A10. If the shown card disappears, show the top card. A new top card takes over unless the user flipped cards in the last 30 seconds.
- A11. An empty stack shows a calm "nothing needs you" card. Nothing is invented.
- A12. The primary button is the screen's only yellow fill. Motion uses `@/lib/motion.ts` and respects `useStill()`.

- A13. Rank by tier, at most one card per kind and at most 7 cards in all:
  Before the tiers below, show recent unread **critical findings**, then **open reminders** already filed by the host, then **genuine actions** (`answerTo.kind === 'action'` or personal `yours` rows). Reminders and actions retain the decision card's identity and existing answer/dismissal path; the Needs you list gives them the same priority. Oldest first within each personal band. The card shows the actual title, detail and available choices, and opens the existing item, not a generic report-reading task. Report delivery/read state is never action completion. The host owns due-date/timezone admission and completion; the client neither parses dates out of prose nor schedules reminders. Report-only reminders are never automatically promoted. The November 13 follow-up explicitly authorizes one existing delivered reminder occurrence: host-owned `client/reminder-occurrences.json` metadata references its exact original report id, due instant, local date/timezone, delivery time and actual next action. Its initial state is `pending-confirmation`, not evidence of an unmade call. Home shows that action above work noise and below critical findings, with Done and Dismiss controls; the report is supporting evidence, not the task. Only the window's user-only `reminder.resolve` command records an explicit terminal choice, bound to the current data root and an existing validated identity. Terminal choices have no expiry, survive restart/root changes and cannot be overwritten by delivery, reading or retention. There is no creation command, bulk report promotion, new routine, notification or Action Item. Native reminder identities and valid Home dismissals take precedence.
  1. **Only you can decide:** the chat question, the oldest Action Item, a finished change to review, an agent that asks something, a GitHub review requested. Longest wait first.
  2. **Something broke:** the newest unread critical or blocked report from the last 7 days, with its triage `next` step. Also a PR of yours with failing checks. Newest first.
  3. **Catch-up:** "away" when at least 3 reports came in and the user was gone 2 hours or more (from `sinceLastLook`).
  4. **About to happen:** a routine starting within 15 minutes, or one that is held. A running agent.
  5. **The day:** wins, from 17:00 local time, when anything was merged or decided.

- A14. The explicit reminder occurrence card is the bounded exception to navigation-only Home: Done and Dismiss persist the user's choice without performing the underlying call. Its × also means explicit dismissal; Needs you omits the temporary local-dismiss affordance for this identity so it cannot bypass durable completion. Other Home cards keep their existing navigation/dismissal behavior.

### Widgets (navigation only: Home never answers, merges, runs or stops anything)

- A15. **Needs you:** the chat question, then Action Items (oldest first; a row with `opens` goes where it is handled), then finished changes, then GitHub review requests, then Pi servers waiting for sign-in, then proposed projects. Show 5 and a "+N more". The header title counts all of them.
  - A16. A finished change shows once. An Action Item that asks about it (a merge decision naming its slug and item, at any head, or work left for the user under its title and project) takes it over and opens the change in Review.
  - A17. A GitHub review request opens the pull request in the app's own Review, with "Open on GitHub" beside it.
- A18. **Running now:** agents with their own faces and what they are doing. Also why work is held, and "2 of 4 slots · 3 queued". With nobody working, the next three queue rows.
- A19. **Coming up:** a day strip (done runs grey, failed ones red, next ones outlined, a yellow tick for now), then the next 3 routine runs and a summary like "9 runs · 2 failed".
- A20. **Problems:** unread critical or blocked reports from 7 days, with repeats folded into one row (×N), the "Next:" step and their age. Held routines and Pi servers that failed to connect go here too. Show 4 and a "+N more".
- A21. **Projects:** only projects with `state === 'chosen'` (binding rule #89). Each has a health dot and counts of problems, changes to review, PRs, paused, and a failed last look.
- A22. **Connections:** gh and each of Pi's servers as a tile with its mark and state (connected, sign in, failed, off, connecting), a summary such as "3 connected · 1 needs sign-in", and the counts of reviews for you and PRs failing checks. Tiles open GitHub or Integrations.
- A23. **This week:** today's merged and decided counts, the streak, a 7-bar runs chart, and completed vs failed totals.

- A24. Copy is short and plain, in sentence case. No developer caveats and no emoji.

### Cleanup

- A25. Remove `<HomeIdeas/>` and the `standalone` prop from `reports/Overview.tsx`. Delete `reports/HomeIdeas.tsx`, `reports/home-ideas.ts` and `ui/test/home-ideas.test.ts`. Overview stays the Reports pane's briefing.

## Later (needs data the app does not get yet)

These need host work and are not part of this task:
- the "Brief me" catch-up
- reminders that are not due yet
- the week of wins
- money spent
- acting straight from Home (merge, answer, run, stop), except the explicitly authorized reminder completion above

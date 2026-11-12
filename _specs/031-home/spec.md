# 031 Home: smart stack and widgets

Approved by the user on 2026-11-11. It replaces the "Ideas" cards and the Briefing on Home (#83 is superseded). Home is the main screen. It lives in the panel beside the chat, inside `SCREEN_COLUMN` (1040px at most). The sidebar is unchanged, and the layout uses **at most two columns**.

Mockup: https://claude.ai/artifact/NMtQJtSUzyAnsenwNEziDr. Its source is copied to `mockup/Main.dc.html` and `mockup/StackCards.dc.html`. It draws three columns with sample data; build two. Map its hex colors to the app's tokens and Tailwind classes. Never use raw hex.

## State when handed over

- `ui/src/features/home/types.ts` is the contract: `HomeInput`, `HomeModel`, `StackCard`, `HomeRow`, `NeedRow`, `HomeTarget`, `DayStrip`. Every field is documented.
- `ui/src/features/home/model.ts` is a placeholder returning an empty model. It needs the real rules, written test-first in `ui/test/home-model.test.ts`.
- `navigate.ts` (`openTarget`) and `use-home.ts` (`useHomeModel`) were started by a stopped lane. Review them before you trust them.
- `HomeScreen.tsx`, `reports/Overview.tsx` and `reports/HomeIdeas.tsx` are unchanged.

## Layout

1. Header: Hob with `header.mood`, `header.title` ("5 things need you"), `header.line` (what came since the user last looked), and tone-dot chips (agents working, next check, work held).
2. An `@container` grid: one column when narrow, two from about 720px. The rows are: Smart stack | Needs you, Running now | Coming up, Problems | Projects, GitHub | This week.

## Smart stack

- One card shows at a time. The most relevant card is on top, and each card says why it is there.
- Vertical dots and a next button let the user flip cards. Two slabs peek out underneath when there are more cards.
- If the shown card disappears, show the top card. A new top card takes over unless the user flipped cards in the last 30 seconds.
- An empty stack shows a calm "nothing needs you" card. Nothing is invented.
- The primary button is the screen's only yellow fill. Motion uses `@/lib/motion.ts` and respects `useStill()`.

Rank by tier, at most one card per kind and at most 7 cards in all:

1. **Only you can decide:** the chat question, the oldest Action Item, a finished change to review, an agent that asks something, a GitHub review requested. Longest wait first.
2. **Something broke:** the newest unread critical or blocked report from the last 7 days, with its triage `next` step. Also a PR of yours with failing checks. Newest first.
3. **Catch-up:** "away" when at least 3 reports came in and the user was gone 2 hours or more (from `sinceLastLook`).
4. **About to happen:** a routine starting within 15 minutes, or one that is held. A running agent.
5. **The day:** wins, from 17:00 local time, when anything was merged or decided.

## Widgets (navigation only: Home never answers, merges, runs or stops anything)

- **Needs you:** the chat question, then Action Items (oldest first; a row with `opens` goes where it is handled), then finished changes (skip any already covered by a finished-branch Action Item), then GitHub review requests, then proposed projects. Show 5 and a "+N more". The header title counts all of them.
- **Running now:** agents with what they are doing. Also why work is held, and "2 of 4 slots · 3 queued".
- **Coming up:** a day strip (done runs grey, failed ones red, next ones outlined, a yellow tick for now), then the next 3 routine runs and a summary like "9 runs · 2 failed".
- **Problems:** unread critical or blocked reports from 7 days, with repeats folded into one row (×N), the "Next:" step and their age. Held routines go here too. Show 4 and a "+N more".
- **Projects:** only projects with `state === 'chosen'` (binding rule #89). Each has a health dot and counts of problems, changes to review, PRs, paused, and a failed last look.
- **GitHub:** reviews waiting for you and failing PRs. Say it is not connected when that is the case.
- **This week:** today's merged and decided counts, the streak, a 7-bar runs chart, and completed vs failed totals.

Copy is short and plain, in sentence case. No developer caveats and no emoji.

## Cleanup

Remove `<HomeIdeas/>` and the `standalone` prop from `reports/Overview.tsx`. Delete `reports/HomeIdeas.tsx`, `reports/home-ideas.ts` and `ui/test/home-ideas.test.ts`. Overview stays the Reports pane's briefing.

## Later (needs data the app does not get yet)

These need host work and are not part of this task:
- the "Brief me" catch-up
- reminders that are not due yet
- the week of wins
- money spent
- acting straight from Home (merge, answer, run, stop)

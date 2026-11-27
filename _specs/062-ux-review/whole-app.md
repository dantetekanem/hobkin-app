# UX review: the whole app outside the finished-changes lists and Change Review

Written 2026-11-24. Read-only review of `ui/src/app/`, `ui/src/features/`, `ui/src/components/`, `ui/src/styles/` and specs 000, 019, 031, 044 and 053. The Work page's finished-changes lists and the Change Review screen belong to two other lanes and are left out.

How to read the evidence. "Picture" means I rendered the screen with its sample data in the dark theme (server-rendered markup, the app's own CSS, `qlmanage` for the PNG) and looked at it. "Code" means I read it at the `file:line` given. "Inference" means I am reasoning from either. Pictures stayed in the review session's scratch folder and are not in the repository (`work-dark.html.png`, `actions-dark.html.png`, `github-dark.html.png`, `reports-dark.html.png`, `routines-dark.html.png`, `yolo-dark.html.png`, `settings-dark.html.png`).

## The short answer

The app does not have one way of organizing what it shows. It has good shared parts that only some screens use. The frame is shared (`SCREEN_SCROLLER`, `SCREEN_COLUMN`, `PAGE_TOP` in `app/screen-layout.ts`), the trail says where the user is on every page (`app/Trail.tsx`), and there is one key list (`app/key-list.ts`). Below the frame, each screen builds its own header, its own row, its own state words, its own segmented control and its own way of asking "are you sure". The unused shadcn files make this visible: `components/ui/tabs.tsx`, `toggle-group.tsx`, `badge.tsx` and `card.tsx` have zero imports, because every screen wrote its own.

The user's complaint ("no organized thought", "too much information", "not slop") matches what the code shows. The same thing is said in different shapes on different screens, so the eye has to relearn each page.

## 1. Inventory

Where "how a row looks" says "title first", the title is the first line of text in the row.

| Screen | Purpose | Reached by | How a row looks | How a state is said | How an action is asked |
| --- | --- | --- | --- | --- | --- |
| Home | What needs me, what runs, what is next (`031`) | Menu, Cmd+1 | Button, `rounded-xl`, 14px sans title, 12px meta, tone icon (`home/parts.tsx:106-128`). Widgets are bordered cards with a 16px plain heading (`home/Sections.tsx:29,36`) | Tone dot, "Waiting for you", "Held", "Paused", "Failed" (`home/model.ts:300,336,405,521,593,704`) | The row is a link with a verb ("Review", "Decide"). Home never acts, except the reminder card |
| Reports | Read what routines and work found | Menu, Cmd+2 | Three lines: tone dot, title and time, one-line summary, source with icon. `rounded-2xl px-3 py-2.5` (`reports/ReportRow.tsx:57-96`) | Tone word in the summary: "Critical.", "Blocked." (`reports/Tone.tsx:6-31`) | Open in a reader pane on the right; reply box |
| Routines | See and switch scheduled work | Menu, Cmd+3 | Hood avatar, 15px title, schedule line, next run as a big time on the right, Run button, switch. `min-h-[64px]` (`routines/Lists.tsx:153-190`) | "Held" chip plus orange reason line (`routines/words.ts:95`) | Switch and Run act at once with no confirmation. Delete is an inline paragraph and "Confirm delete" (`routines/Detail.tsx:172-173`) |
| Action Items | Things only the user can answer | Menu, Cmd+4 | Icon tile, source eyebrow above a 16px title, time at the right, choices as muted inline text, one or two buttons. `rounded-3xl p-5` (`actions/ItemCard.tsx:65-147`) | "Put off", "hobkin's pick", kind labels (`actions/kinds.ts:5-11`) | Review and Discuss buttons. Choices read as text in the picture |
| Work (upper half) | Control room for coding agents | Menu, Cmd+5 | Tiles, a 26px sentence, a status line, tabs, "At work" map, queue rows with priority badge (`work/Queue.tsx:141-198`), project rows (`work/Queue.tsx:346-420`) | Dot colors, "waiting: a free worker" in amber, "Paused" eyebrow, "Picked" eyebrow | Start now, Run next, Skip on each queue row; three selectors on each project row |
| YOLO mode | Switch and readiness for merging by itself | Button on Work | Switchboard, tiles, two titled blocks, a chart, project cards (`work/YoloScreen.tsx:158-176`) | "Ready", "Held" (`work/yolo-page.ts:489-501`) | Switch and a rate selector; Open review |
| World | Map of projects | Button on Work (3 or more projects) | Islands on a map (`work/WorldScreen.tsx`) | Island marks | Click opens the project |
| Project | One project's page | Work project row, World, YOLO | Many blocks stacked at `gap-10` (`project/ProjectPage.tsx:42-60`) | "Paused", "Waiting for you" (`project/sections.tsx:58,101`) | Pause and Priority controls |
| GitHub | Pull requests and issues through gh | Menu (can be hidden), Cmd+6 | Meta line (repo, number, author, time) above the title, chips, a 260px AI-review column at the right (`github/rows.tsx:179-300`) | Green or amber chips: "Checks pass", "Safe to deploy", "3 to review" | "Open on GitHub", "Start AI review", "Open review"; close issue arms for 10 seconds (`github/rows.tsx:472`) |
| Agent page | One running agent | Dock, menu second row, Work | Step stream | "Waiting", "Failed", "Stopped" (`agent-activity/steps.ts:551-597`) | Force Stop dialog, "Confirm Force Stop" (`work/AgentScreen.tsx:305-320`) |
| Durable hobkin page | A hobkin the user talks to | Dock, Cmd+N | Conversation | `stateLabel` in the subtitle (`hobkins/HobkinScreen.tsx:316`) | End asks inline: "End X?" (`HobkinScreen.tsx:346`) |
| Settings | Preferences | Gear, Cmd+comma | About 17 tiles in a 6-column grid, each an eyebrow plus a 20px sentence (`settings/SettingsScreen.tsx:99-101,180-702`) | Segmented values, switches | Live changes; Backup restore in a dialog (`settings/BackupTile.tsx:225`) |
| Memory, Skills, Pi extensions, Integrations | Four more pages under Settings | Buttons in Settings, Cmd+I | Each its own list and header (`memory/MemoryScreen.tsx:104`, `skills/SkillsScreen.tsx:121`) | On/off switches, "connected", "sign in", "failed" | Remove arms with "Press again to remove" (`integrations/Detail.tsx:251`); Forget has Undo (`memory/MemoryRow.tsx:92`) |
| Spotlight | Search everything | Cmd+K | One row per hit, grouped under nine headings (`app/Spotlight.tsx:22-32`) | None | Enter goes there |
| Agents dock | Running agents under the chat input | Always there; Down from an empty input | Small face, title, words (`app/AgentsDock.tsx`) | "Waiting" row first, face shows state | Enter opens; `x` stops |
| First-run setup | Told story, accounts, goals | First launch | Dialogue bubbles (`features/onboarding/`) | n/a | Choices in bubbles |

Menu: six places in the first row (Home, Reports, Routines, Action Items, Work, GitHub), and thirteen "contextual" ids that show only while open: World, YOLO mode, Project, Proof run, Agent, Hobkin's mind, Review, Settings, Integrations, Skills, Pi extensions, Memory, Canvas (`app/screens.ts:5-31`). Settings, which the user reaches often, is contextual.

## 2. Where the same kind of thing is done in different ways

### 2.1 Page headers: six treatments

A page says its name and its state in six different ways (code, and picture for Work, GitHub, YOLO, Settings).

- A small uppercase eyebrow, then a 26px sentence that states the page's state: Work (`work/WorkScreen.tsx:456-460`), GitHub (`github/GitHubScreen.tsx:173-174`), Reports briefing (`reports/Overview.tsx:203-204`).
- The same pair, but the sentence is 20px: Settings (`settings/SettingsScreen.tsx:100-101`), and each Integrations block (`integrations/IntegrationsScreen.tsx:327-328`).
- Only the eyebrow, no sentence: YOLO mode (`work/YoloScreen.tsx:162`), World (`work/WorldScreen.tsx:29`).
- A 28px title with no eyebrow: Home (`home/Stage.tsx:236`).
- A 26px name with no eyebrow: Project (`project/sections.tsx:35,49`), Integrations (`IntegrationsScreen.tsx:315`).
- A 22px or 20px title: agent page (`work/AgentScreen.tsx:110`), durable hobkin (`HobkinScreen.tsx:301`), Hobkin's mind (`main-agent/MainAgentScreen.tsx:74`), sign-in (`signin/SignInScreen.tsx:36`).

Routines has no heading at all: its first element is the sky tile (`routines/Routines.tsx:178`). Title sizes in use: 28, 26, 24, 22, 20 and eyebrow-only.

The trail already says where the user is. So the eyebrow is a second "where am I" on pages that have one, and the only one on pages where it is missing.

Section rhythm differs too. The column's gap between blocks is `gap-3` (Settings `:59`, Routines `:177`, Action Items `:242`), `gap-5` (Home `home/HomeView.tsx:42`, Proof `proofs/ProofScreen.tsx:52`), `gap-6` (GitHub, YOLO, World), `gap-8` (Memory `:103`), `gap-10` (Work `work/WorkScreen.tsx:256`, Project, Skills) and `gap-12` (Integrations `:203`, Extensions `:111`). Six values for the same job.

Section headings inside a page also split. The eyebrow style is used 96 times. But Home's widgets use a plain 16px semibold heading in a bordered card (`home/Sections.tsx:29`), and YOLO's "Gates now", "What holds the rest" and "Merged by itself by day" are plain bold while "PROJECTS" on the same page is an eyebrow (picture, `yolo-dark.html.png`). A group heading `SectionHeading` already exists (`work/parts.tsx:144-154`) and only Work uses it.

### 2.2 Rows: seven anatomies for "a thing to look at"

Each list builds its own row. Order of facts, title size, radius and padding all differ (code, confirmed in pictures).

| List | First line | Title | Shape | Right side |
| --- | --- | --- | --- | --- |
| Reports (`ReportRow.tsx:57`) | title and time | 14px heading | `rounded-2xl px-3 py-2.5` | nothing |
| Action Items (`ItemCard.tsx:65-74`) | source eyebrow and age | 16px heading | `rounded-3xl p-5` | Review, Discuss |
| Routines (`Lists.tsx:153-156`) | title | 15px heading | 64px row | next time, Run, switch |
| GitHub (`rows.tsx:182-193`) | repo, number, author, time | link, 15 to 16px | card | 260px AI-review column |
| Queue (`Queue.tsx:163-171`) | "project: title" | 13.5px sans | row with badge | Start now, Run next, Skip |
| Work projects (`Queue.tsx:357-414`) | title and "Paused" eyebrow | 15px heading | `rounded-3xl px-5 py-4` | three selectors |
| Home (`parts.tsx:122-128`) | title | 14px sans, no heading font | `rounded-xl px-2 py-2` | arrow |

Two rows hold the same kind of fact (a thing waiting for the user, with its source and its age) in opposite orders: Reports puts the title first and the source last, Action Items puts the source first. GitHub puts the source first, Routines has no source. Radii in use: `rounded-xl` 64 times, `rounded-2xl` 107, `rounded-3xl` 30, `rounded-[20px]` 14, `rounded-[28px]` 15.

### 2.3 One state, many words

"Waiting for the user" is said at least eight ways: "Waiting for you" (`home/model.ts:521,704`, `numbers/format.ts:207`, `project/sections.tsx:101`), "Waiting for your review" (`home/model.ts:593`), "Waiting for review" (`github/rows.tsx:74`, `work/change-row.ts:33`), "Waiting on you" (`work/yolo-page.ts:210`), "Waiting for hobkin" (`home/Stage.tsx:83`), "Waiting its turn" (`work/ai-reviews.ts:78,152`), "Waiting for your next message" (`main-agent/MainAgentScreen.tsx:67`), and "N waiting for you" in the At work header (`work/WorkScreen.tsx:350`).

The first and last do not count the same thing. In the picture of Work, the first tile says "Waiting for you 19" and, two screens down, the At work header says "1 waiting for you". By the names alone, they are different sets (finished changes versus agents asking a question). The words do not tell the user that. This is inference from the names and the sample picture.

"Not moving" is said "Held" (`routines/words.ts:95`, `home/model.ts:300,674`, `work/yolo-page.ts:489-501`), "Paused" (`home/model.ts:336`, `work/Queue.tsx:369`, `project/sections.tsx:58`) and "Put off" (`actions/ItemCard.tsx:72`). "Broken" is "Failed" (`routines/words.ts:253`, `integrations/tiles.tsx:69`, `reports/Tone.tsx:42`, `work/AiReviews.tsx:37`), "Critical" and "Blocked" (`reports/Tone.tsx:8`). Only Reports has a table that maps a tone to a name, a fill and a text color (`Tone.tsx:6-31`). Nobody else uses it.

Capitalization differs for the same name: the Work tile says "AI reviews", the tab beside it says "AI Reviews" (picture).

### 2.4 Segmented controls and tabs: eight copies

The same pill-shaped control is hand-built eight times, each with its own `layoutId`: `work/PageTabs.tsx:34` (tablist), `work/parts.tsx:188` (`Segmented`), `reports/Controls.tsx:21`, `routines/parts.tsx:71`, `settings/SettingsScreen.tsx:123`, `github/ProjectTabs.tsx:30`, `settings/BackupTile.tsx:126` and `settings/PetTile.tsx:37`. Work's page tabs are real tabs, the rest are radio groups, and they look nearly the same.

### 2.5 Confirming an action: nine ways

1. Press again within 10 seconds, with the same label changing: "Click again to close" (`github/rows.tsx:472`, `work/change-controls.tsx:116`).
2. The same, worded "Click again to confirm" (`schedules/ScheduleLine.tsx:442`).
3. The same, worded "Press again to remove" (`integrations/Detail.tsx:251`).
4. An inline paragraph and a second button: "Delete this routine?" then "Confirm delete" (`routines/Detail.tsx:172-173`).
5. A dialog: "Confirm Force Stop" (`work/AgentScreen.tsx:305-320`).
6. An inline ask that replaces the header: "End X?" (`hobkins/HobkinScreen.tsx:346`).
7. No confirmation, with Undo: Forget (`memory/MemoryRow.tsx:92`).
8. A dialog for restoring a backup (`settings/BackupTile.tsx:225`).
9. Nothing at all for actions that change money or work: the Routines switch and Run, Skip and Start now on the queue.

On top of that, leaving unsaved text is "Close again to drop them" (`settings/DirectionsTile.tsx:166`) in one place and "Press Escape again to drop them" (`memory/MemoryEditor.tsx:57`) in another.

### 2.6 Counts: five places

A count appears as a suffix on an eyebrow (`work/parts.tsx:146-150`, `github/rows.tsx:551-553`, `routines/Lists.tsx:299`), as a pill in a tab (`TabCount`, GitHub and Work tabs), inside a 26px sentence ("2 working, 7 queued, 19 finished" at `work/WorkScreen.tsx:467`, "8 things" in Action Items, "9 unread, 2 critical" in Reports), in an eyebrow with other words ("1 P0 · 7 QUEUED", picture), and as a "+N more" link (Home, Action Items pile). The same number carries two names on one page: Work's header says 19 finished while its first tile says 19 waiting for you (picture; sample data).

### 2.7 The same thing on several screens, with different facts

- A finished change shows on Work (Finished changes), in Work's "Waiting for you" tile, on Home (Needs you and the smart stack, `031` spec), and in Action Items as "Finished branch · work mode" with Review and Discuss (picture, `actions/kinds.ts:6`). Four places, four sets of facts.
- A running agent shows in the dock, in the menu's second row on an agent page, in Work's "At work", in Home's "Running now", in Reports' briefing "Now" list (picture) and in Spotlight. Six places.
- "Agents at once" can be set in three places: Work (`work/WorkScreen.tsx:362-367`), Settings (`SettingsScreen.tsx:368`) and the Workload sheet (spec `053`). "Daily budget" is in Settings (`:464`) and as tokens a day in the Workload sheet, with the figure again in a Work tile.
- What "needs me" is listed in Home (Needs you), Action Items, Reports (Needs attention), Work (the tile, the At work counter and the finished list), GitHub (Review requested) and Spotlight (Action items). `031` says Needs you "counts all of them", while each other list counts its own part.

### 2.8 Too much on one screen (picture)

Work's upper half, before the first row the user can act on, holds: a title, three controls, six tiles with sparklines, a status line, a sample-data note, three tabs with two live counts, and the At work header with its own steppers (`work-dark.html.png`). The tiles overlap: "Merged today 7, 4 by itself" and "By itself 43% of 47 merged" say the same thing at two scales. There is a collapsed section called "Owned execution controls 0" (`work/DelegationMap.tsx:255`) that holds nothing. Settings is 17 tiles with no groups. Home has seven widgets plus the stack (`031`). The user's "30 seconds" rule is met by none of these.

### 2.9 Layout shift and floating (code only, not tested)

The Work status line and header are built to hold their height (`work/StatusLine.tsx`, comment at top), and the trail never moves content (`app/Trail.tsx`). I did not find a violation of "nothing floats over other content" beyond the menu itself and the pills, which the code treats on purpose. I did not run the app, so I cannot say this holds on every state.

## 3. What other tools do

I fetched these pages. I could not read everything I tried; what I did not get is listed at the end.

GitHub's Primer design system

- Page header. One component holds the title, an optional description, actions, navigation tabs and breadcrumbs, and the title has three sizes: medium by default, large only for user-written content (issues, pull requests), and a subtitle when the title is elsewhere. https://primer.style/product/components/page-header/ . Here: one `PageHeading` for every screen, 26px for the page, one smaller size for a page inside a page (agent, hobkin, project), and nothing at 28, 24, 22 or 20.
- State labels. A StateLabel is for the status of an issue or pull request, in a fixed set (draft, open, merged, closed) with an icon per status, in two sizes. https://primer.style/product/components/state-label/ . Here: one fixed state set with one icon, one word and one color each, used by Reports, Routines, Work, GitHub and Home.
- Empty states. There are three kinds (not yet used, temporarily empty, error), each built from a graphic, a title, optional brief secondary text, and at most one primary action. Tone is human and non-technical. https://primer.style/product/ui-patterns/empty-states/ and the component at https://primer.style/components/blankslate/react/alpha . Here: one `Empty` for all lists, with those kinds.
- Progressive disclosure. Use it sparingly, only when information must be truncated; keep the user's first point of focus intact; chevron toggles content, an ellipsis toggles truncated text, a kebab is for menus. https://primer.style/product/ui-patterns/progressive-disclosure/ . Here: the folded sections on Work, Finished and Project should follow one chevron rule. The "Owned execution controls 0" fold fails it.

Linear

- A small set of objects (issues, teams, projects, initiatives, cycles), and views are different ways to look at the same work without changing it. https://linear.app/docs/conceptual-model . Here: Needs-you, finished changes, agents and PRs are each one object with several views, not four copies with four sets of facts.
- Display options (grouping, ordering, list or board, which properties show) live in one control, apply per view, persist for the user and can reset to default. They show or hide properties and do not remove items. https://linear.app/docs/display-options . Here: one display control per list, in the same place, in place of a new filter widget on each screen.
- Search and the command menu take prefixes to narrow by type. https://linear.app/docs/search . Here: Spotlight already groups by kind (`app/Spotlight.tsx:22-32`); add the same prefix idea and let it act on the item in view.

Raycast

- Enter runs the primary action, which is the first in the list. Cmd+K opens the Action Panel with every other action for the selected item, each showing its shortcut, grouped in sections, with a filter field. https://manual.raycast.com/action-panel . Here: every row has one Enter verb and one menu for the rest. This is the rule that would replace "Review, Discuss" side by side and the three selectors on a Work project row.

Stripe

- The Dashboard separates list pages (an overview of many objects), details pages (one object) and home (an overview routing to core workflows), and limits custom styling on purpose to keep consistency and accessibility. https://docs.stripe.com/stripe-apps/design . Here: three page types only, each with one shape. It said nothing about status badges or destructive confirmation on that page.

Not read: Vercel's dashboard guidance, Superhuman, and a Primer page on confirmation dialogs (the address I tried returned only the site's home page). I make no claim from those.

## 4. The rules that would make it one app

Seven rules. Each says what it asks, which component owns it, and where it breaks today, worst first.

### Rule 1. One header, and the trail is the only "where am I"

Every page opens with a `PageHeading`: the page's name as the eyebrow only when the trail does not already name it, one sentence at one size that says the state of the page ("3 pull requests wait for your review"), and one status line. A page opened from another (agent, hobkin, project) uses the one smaller size. Between blocks the column uses one gap, set once in `app/screen-layout.ts`. Group headings use the existing `SectionHeading` (`work/parts.tsx:144`), moved to `components/`.

Owner: `components/PageHeading.tsx` (promote `skills/page-parts.tsx:68`) and `SectionHeading`, plus a `SCREEN_GAP` in `screen-layout.ts`.

Breaks it, worst first: Home (28px, bordered cards with plain headings, `home/Stage.tsx:236`, `Sections.tsx:29`); YOLO (eyebrow only, plain bold block titles, `YoloScreen.tsx:162`); Settings (20px, `SettingsScreen.tsx:101`); Routines (no heading, `Routines.tsx:178`); agent and hobkin pages (22px and 20px); Integrations and Extensions (`gap-12`).

### Rule 2. One row, with the title first

A row has four slots: a mark on the left; a first line with the title and at most one fact at the right (a time); a second line with the one sentence that says what it is; a third line with source and state, in that order. One primary verb is the row's Enter. Other actions are in the row's menu, with their keys. A row is at most three lines and its height does not change on hover or on update. Group headings are an eyebrow and a count and say something the members do not. Each list owns one `Empty`: a one-line title and at most one action, never reserved blank rows.

Owner: `components/List/Row.tsx` and `Empty.tsx`. Reports' `ReportRow` is the closest to the rule already, so it is the base.

Breaks it, worst first: Action Items (source before title, 16px, `p-5`, choices as text, `ItemCard.tsx:65-147`); GitHub (meta line above the title, a 260px column on the right, `rows.tsx:179-300`); Work project rows (`px-5 py-4`, three selectors inside the row, `Queue.tsx:357-414`); Routines (big time on the right, two controls, `Lists.tsx:153-190`); Home rows (`parts.tsx:122-128`).

### Rule 3. One state set, said one way

Six states, each with one word, one icon and one color token: needs you, working, waiting (on something other than the user), held, failed, done. "Needs you" is the only phrase for waiting on the user, and the number beside it is the same number everywhere. Severity from reports (critical, blocked, useful) stays a separate scale and is never drawn as a state.

Owner: `components/State.tsx` and one `state.ts` table, grown from `reports/Tone.tsx:6-31`.

Breaks it, worst first: Work (two different "waiting for you", `WorkScreen.tsx:350` and `numbers/format.ts:207`); Home (`model.ts:300-704`); GitHub ("Waiting for review", `rows.tsx:74`); YOLO ("Waiting on you", "Held", `yolo-page.ts:210,489`); Routines ("Held", `words.ts:95`); Actions ("Put off", `ItemCard.tsx:72`).

### Rule 4. One place for a count

A count sits after the name in a heading or a tab, muted and tabular, and nowhere else. Sentences state a state, not a tally ("Work mode is on" in place of "2 working, 7 queued, 19 finished"). A number that stands for a set the user can act on is the same number in the menu, on Home and on the page that lists it.

Owner: `SectionHeading` and `TabCount`.

Breaks it, worst first: Work's header sentence and tiles (`WorkScreen.tsx:467`); Reports briefing ("9 unread, 2 critical"); Action Items ("8 things"); Queue ("1 P0 · 7 QUEUED").

### Rule 5. One way to act, one way to confirm

Enter does the primary verb. The row's menu (Cmd+K on the row, as in Raycast) lists the rest with their keys. Then confirmation depends on what can be undone:

- It can be undone: do it and show Undo, as Forget does (`memory/MemoryRow.tsx:92`). This covers switches, Skip, Start now and Run next.
- It cannot be undone and takes no input: one inline "Press again to X" for 10 seconds, always in this wording, with the same progress line (`work/change-controls.tsx:72`).
- It needs input or explains a lot: a dialog.

Owner: `components/ConfirmButton.tsx` (grown from `work/change-controls.tsx`) and one `useUndo`.

Breaks it, worst first: Routines delete (`Detail.tsx:172-173`); agent Force Stop (`AgentScreen.tsx:305-320`); hobkin End (`HobkinScreen.tsx:346`); schedules cancel (`ScheduleLine.tsx:442`); integrations remove (`Detail.tsx:251`); the two "drop unsaved changes" wordings.

### Rule 6. One control for choosing a view or a value

One `Segmented` and one `Tabs` for the whole app. Tabs change what the page lists; a segmented control sets a value. Neither changes size when the selection changes.

Owner: `components/ui/segmented.tsx` and `tabs.tsx` (the shadcn `tabs.tsx` is already there and unused). Delete the other seven.

Breaks it: all eight copies listed in section 2.4.

### Rule 7. One home for each fact, a link everywhere else

Each object has one page that owns its facts. Other screens show at most a mark, a name and one state, and link to it. A setting has one place: agents at once and daily budget live in the Workload sheet, and Settings links to it.

Owner: one `summaryOf(item)` per object kind (finished change, agent, action item, pull request), used by every list that shows it.

Breaks it, worst first: finished changes (four places); agents (six places); agents at once (three) and daily budget (two); "needs me" (six lists).

## 5. Navigation

Today: six first-row screens and thirteen contextual ones, with three overlapping "what needs me" lists (Home, Reports, Action Items) and Settings with four subpages.

Proposed top level, in this order (inference; it needs the user's call before anyone builds it):

1. Home. A short page: Needs you, Running now, Coming up. Problems folds into Needs you. Projects, Connections and This week move out (the numbers belong to Work, connections to Settings).
2. Inbox. Action Items and Reports together, because both are things that arrived for the user to read or answer. Two tabs: To do (Action Items) and Reports. Home's Needs you links here.
3. Routines.
4. Work. Tabs: Now, Reviews, Numbers, World. YOLO mode becomes part of the Workload sheet and a block on Numbers, not a page. Projects are a list in Work and a page under it. GitHub's pull requests that ask for the user's review are a tab or a section of Work; the user already can hide GitHub from the menu (`screens.ts:45`), so it is optional.
5. Settings, pinned at the end of the first row and always visible, with Memory, Skills, Pi extensions and Integrations as its sections, not as screens with their own trail entries.

What is missing: one page for agents and durable hobkins. They have a dock and a menu row, but no list the user can scan with state, age and owner. The dock is the only place a durable hobkin is listed.

What is one too many: Reports and Action Items as two top-level entries; World and YOLO as pages (World is a second view of what Work lists); Skills, Pi extensions and Integrations as screens; the contextual Settings.

Keys: Cmd+1 to Cmd+5 would then be stable. Today numbering follows what the menu shows (`screens.ts:55-67`), so the number of a screen can change while another page is open. The keys in `key-list.ts` are good and need little change; add one: the key that opens a row's menu.

## 6. The ten changes that matter most

1. One `PageHeading` and one `SCREEN_GAP`. Files: `skills/page-parts.tsx`, `home/Stage.tsx`, `work/YoloScreen.tsx`, `work/WorldScreen.tsx`, `settings/SettingsScreen.tsx`, `work/AgentScreen.tsx`, `hobkins/HobkinScreen.tsx`, `main-agent/MainAgentScreen.tsx`, `routines/Routines.tsx`, `app/screen-layout.ts`. Size: medium. The user notices that every page opens the same way and gaps stop changing from page to page.
2. A state table and `State` component. Files: new `components/State.tsx`, grown from `reports/Tone.tsx`; then the strings in `home/model.ts`, `routines/words.ts`, `work/yolo-page.ts`, `github/rows.tsx`, `work/change-row.ts`, `actions/ItemCard.tsx`. Size: medium. The user notices that "needs you" means one thing and one number.
3. Cut Work's upper half to what the user acts on. Drop one of the overlapping tiles, fold the status line into the header sentence, hide "Owned execution controls" when it holds 0 (`work/DelegationMap.tsx:255`), and rename the At work counter so it does not reuse "waiting for you". Files: `work/WorkScreen.tsx`, `work/WorkTiles.tsx`, `work/work-tiles.ts`, `work/StatusLine.tsx`. Size: medium. The user sees the first actionable row without scrolling past six tiles.
4. One `ConfirmButton` and one `useUndo`. Files: `work/change-controls.tsx` (source), `github/rows.tsx`, `schedules/ScheduleLine.tsx`, `integrations/Detail.tsx`, `routines/Detail.tsx`, `work/AgentScreen.tsx`, `hobkins/HobkinScreen.tsx`, `settings/DirectionsTile.tsx`, `memory/MemoryEditor.tsx`. Size: medium. Same wording and timing for every risky button.
5. One `Row` component, starting with Action Items. Files: new `components/List/Row.tsx`; then `actions/ItemCard.tsx`, `reports/ReportRow.tsx`, `routines/Lists.tsx`, `github/rows.tsx`, `work/Queue.tsx`, `home/parts.tsx`. Size: large (do it in that order, one list per commit). Lists look alike and the title is where the eye expects it.
6. One `Segmented` and one `Tabs`, delete seven copies. Files: `work/parts.tsx:159`, `work/PageTabs.tsx`, `reports/Controls.tsx`, `routines/parts.tsx`, `settings/SettingsScreen.tsx`, `github/ProjectTabs.tsx`, `settings/BackupTile.tsx`, `settings/PetTile.tsx`, `components/ui/tabs.tsx`. Size: small to medium. Same control, same motion, same keys.
7. Merge Action Items and Reports into Inbox. Files: `app/screens.ts`, `app/location.ts`, `app/key-list.ts`, `app/spotlight-entries.ts`, `home/navigate.ts`, `features/actions/`, `features/reports/`. Size: large. One place for "things that arrived", and one list fewer to read.
8. Fold YOLO and World into Work. Files: `app/screens.ts`, `work/WorkScreen.tsx`, `work/YoloScreen.tsx`, `work/WorldScreen.tsx`, `work/WorkloadSheet.tsx`, `app/trail.ts`. Size: large. Two fewer pages in the menu logic and trail.
9. Group Settings and give each setting one home. Four groups (Look, Agents and work, Connections, Privacy and data) over the 17 tiles; "Agents at once" and "Daily budget" live in the Workload sheet and Settings links to them; Integrations, Skills, Pi extensions and Memory become sections. Files: `settings/SettingsScreen.tsx`, `work/WorkScreen.tsx` (`AgentsAtOnce`), `work/WorkloadSheet.tsx`. Size: medium. A user can find a setting in one place.
10. Shrink Home to three widgets: Needs you, Running now, Coming up, with Problems inside Needs you. Files: `home/HomeView.tsx`, `home/Sections.tsx`, `home/model.ts`, spec `031`. Size: medium. Home passes the 30-second test.

## 7. What I could not verify or render

- Home could not be rendered (its model needs live data; the server-rendered attempt failed). I reviewed it from `031`, `home/Sections.tsx` and `home/parts.tsx`.
- The Routines sky is blank in the picture because the canvas draws only in a browser. The list below it is real.
- Not rendered at all: the chat and its status row, the agent page, the durable hobkin page, World, Project, Numbers, Spotlight, the dock and the first-run setup. These are from code.
- All pictures use sample data and the dark theme only. Wording seen in pictures ("1 waiting for you" against "Waiting for you 19") may differ with real data.
- No host was started, no test was run, nothing under `~/.hobkin` was read, and I did not check keyboard behavior live.
- Web: Vercel, Superhuman and Primer's confirmation guidance were not read. Primer's StateLabel page gave no colors.

---
{
  "id": "024-github",
  "title": "GitHub through gh",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "019-keyboard", "023-integrations"],
  "updated": "2026-11-24"
}
---
# GitHub through gh

## Outcome

GitHub is the first integration that reads real data. It connects through gh, GitHub's command line tool, with the login gh already has, so connecting takes nothing in the app. A page under Pages, Pages › GitHub, shows the pull requests waiting for the user's review, the user's own open pull requests with where each one's review and checks stand, and the user's open issues. Each row opens its page on github.com. A row of project tabs narrows the whole page to one project hobkin works on, a choice of Newest or Oldest orders it, and a stack of pull requests shows as one stack. The Integrations screen shows GitHub as connected through gh, as which account, with a way to open the page.

## Decisions

- The host runs gh as a program of its own with execFile, never through a shell, with a 20 second limit. It runs one command only: `gh api graphql --hostname github.com` with one fixed query (`host/src/github-gh.ts`). The query only reads. The host never runs `gh auth token` and never sees a token. gh keeps its own.
- One query reads everything: the account (`viewer`) and four GitHub searches, each for the 50 most recently updated: `is:pr is:open review-requested:@me`, `is:pr is:open author:@me`, `is:issue is:open assignee:@me` and `is:issue is:open author:@me`, all with `archived:false`. An issue that is both assigned to the user and opened by them is listed once.
- Review state: GitHub's review decision when a review is required, otherwise the latest review of each reviewer (changes asked for outweigh an approval), otherwise waiting when a review is asked for, otherwise none. Checks state: the status rollup of the last commit, as passing, failing, pending or none.
- The connection is not known yet, gh missing, gh not signed in, or connected as a login. gh's exit code 4 and an HTTP 401 mean not signed in. The host looks for gh on the PATH, then in Homebrew's folders, because an app opened from the Finder has a short PATH.
- The host keeps what it read last and sends it as the `github` slice of the state messages, whole, when any of it changed and with every reset. It reads when it starts, on `github.refresh`, and every minute while a UI is connected. A pull request or an issue the host itself saw merge or close leaves the lists at once and stays out while GitHub's search catches up, and GitHub is read again right away and ten seconds later. Each item's own state is believed over the list it came in. A refresh during a read joins that read, so there is never more than one at a time. A failed read keeps the lists and says what went wrong in plain words. Anything shaped like a token is taken out of what gh says before it reaches the state or the log.
- The scripted host shows made-up data and never runs gh. `--github` makes it read the real GitHub through gh, read only. A `--live` host always reads the real GitHub. A host started in a test reads made-up data unless the test hands it a source of its own.
- A row is a link. In a browser tab it opens its page as any link does. The Mac window's web view opens no window for a link, and the shell has no opener, so there the host opens it: `github.open` runs `open <url>` with execFile, only for an address that starts with `https://github.com/`. Nothing opens a browser unless the host's entry hands it an opener. The app does. A test never does.
- The page sits under Pages, as Integrations sits under Settings: the menu's second row reads Pages › GitHub, and Escape goes back up to Pages. Keys: Up and Down walk the rows and Refresh, Enter opens a row, and `r` reads again. Left and Right change the page's tab, project tab or order that has the keyboard, and Tab is the frame's.
- Rows land one after another as the page arrives, and a row that a refresh brings rises in on its own. With Movement set to Still, or following a Mac that asks for less, nothing travels and only fades remain.
- In Integrations, GitHub is a full integration, apart from the MCP servers (023-integrations). Its card says how gh stands and as which account, what the page holds, has a button that opens the GitHub page, and holds the setting that shows GitHub in the menu. GitHub is not in the MCP catalog; a GitHub MCP server the user configured shows with their own servers.
- Project tabs (2026-11-13): one quiet row above the page's tabs, All first, then a tab for each project hobkin works on, its `chosen` projects with paused ones, in the Work screen's order (`trackedProjects`), each with how many open pull requests and issues it holds. It is a filter over the whole page, so it sits apart from Pull requests and Issues and narrows both. An item is a project's when its repository, `owner/name` in any case, is the project's own on GitHub as hobkin finds it (`repoOfProject`: its folder's origin, or the remote hobkin clones), never by name. A pull request the AI reviewed that GitHub no longer lists is matched by its review's repository.
- The host adds that repository to each project hobkin works on in the Work state (`WorkProject.repo`, in `host/src/work-items.ts`), with `git remote get-url origin`, only reading, once per folder for the host's life. Proposals are not asked about, as a look for projects can propose many folders. A project not on github.com has no tab, as nothing on the page can be its. One with nothing open keeps its tab with 0, so the row does not jump as lists change; with no project on GitHub the row does not show. What is in no project's repository shows under All only.
- Under a project tab the title, the page tabs' counts and the group headings count what it holds, the empty lines name the project, and a tab with nothing of the project's says so once ("Nothing open in storefront."). The count leaves out the others the AI reviewed, which are no longer open; under a project tab those are the 8 most recent of its own, not of all. The chosen project is kept as the page's tab is: a reload and Command+Left and Right bring it back, a new visit starts on All, and a project hobkin no longer works on falls back to All. The row is a radio group: Up and Down reach it, Left and Right, Home and End choose, and the pill under the chosen one moves on a spring, and does not travel under Still.
- Order (2026-11-24): Newest and Oldest, by when GitHub last updated each, as the Review list's Newest and Oldest go by when a row last moved. One choice for both tabs and every list on them, Newest first, which is GitHub's own order, so a first visit looks as it did. A small radio group in Work's order look (`window/OrderChoice.tsx`), at the right end of the page tabs' row and held to its top, so it never moves as the tabs' counts change and nothing floats over the lists. It is kept as the tab and the project are: a reload brings it back and a new visit starts on Newest. Up and Down reach it, Left and Right choose. The others the AI reviewed have no time of GitHub's: they come newest first by their review, and Oldest turns them round; under a project tab they are still the 8 most recent of its own.
- Stacks (2026-11-24): the read asks GitHub for each pull request's base and head branch by name (`baseRefName headRefName`, with `isCrossRepository`, so a fork's head, which lives in another repository, is left out: a fork's branch named main is not the repository's main). They travel as two optional fields of the core's `PullRequest`, so a host or a cached list from before still reads. A pull request whose base branch is another listed open pull request's head branch, in the same repository (`owner/name` in any case, a branch's name exactly), sits on it; the bottom is one whose base is no listed pull request's head. The rule is one pure function, `pullStacks` in `shared/review/pull-stacks.ts`, so Work can use it too, and it gives each layer Work's own `StackPlace`: its layer from 1 at the bottom, of how many, the one under it, and the commit that one is at. The layers are counted from what both lists hold: a layer missing from them breaks the chain where it was, and the bottom here then names the branch it sits on. Two on one stay one stack, each layer straight after the one it sits on and the one opened first first, and each line says which layer it sits on. Bad data stacks nothing: bases that come round in a loop, and a branch two pull requests share.
- How a stack is drawn (2026-11-24), as Work draws one (`ui/src/features/work/StackGroup.tsx`): one frame under one quiet line, "Stack of 3 on main", quieter than the layers in it. The lowest layer the list holds is its whole card; each layer over it is one line (its "Layer k of n" badge, title, number, checks, and the layer it sits on) that Enter or a click opens to its whole card under the line, and closes again. Every card of a layer carries the same badge. In each list, and under a project tab, a stack's layers stay together, bottom first, whatever the order; the stack sorts as a whole by its newest layer under Newest and its oldest under Oldest. A stack split between the two lists (a colleague's layers on the user's own, asking for their review) keeps its count, and says plainly where its other layers are, in its heading or under a lone layer's card. The group headings count pull requests, not stacks. Under Still nothing slides, and a card that opens only fades. A pull request in no stack looks exactly as before. The grouping is a visual aid only.
- The sample holds a stack of three of the user's own pull requests (api 1185, 1186 on it, 1187 on 1186) and a stack of two among the review requests (storefront 484 on 482), so the page with no host shows both.

## Out of scope

- Writing to GitHub: commenting, reviewing, merging, closing. This version only reads.
- GitHub Enterprise and hosts other than github.com.
- Signing gh in from the app. The page names the command to run in Terminal.
- Notifications, and filters on the page other than the project tabs.
- Orders other than Newest and Oldest, and asking GitHub for a layer its lists do not hold.

## Acceptance

- A1. One gh call reads the account, the open pull requests waiting for the user's review, the user's own open pull requests, each with its review state, checks state and whether it is a draft, and the open issues assigned to the user or opened by them. Each row has its repository, number, title, labels, when it was last updated and its address.
- A2. With gh missing, the connection reads gh missing. With gh installed and not signed in, or with a sign-in GitHub refuses, it reads not signed in.
- A3. The host runs only `gh api graphql --hostname github.com` with its fixed read query: never `gh auth token`, and never a write.
- A4. A refresh while a read is under way starts no second read.
- A5. A read that fails, such as one that finds no network, keeps what was read before and shows gh's reason in plain words.
- A6. The scripted host shows sample data and never runs gh. With `--github` it reads through gh.
- A7. The host opens a page only when asked, and only an address that starts with `https://github.com/`.
- A8. The page works with the keyboard alone: Up and Down reach every row and Refresh, Enter opens a row, `r` refreshes, and Escape goes back to Pages.
- A9. Rows land one after another as the page arrives, and a row that a refresh brings rises in by itself. With Movement set to Still nothing travels.
- A10. A group with nothing in it shows a line of its own, and a group that holds only the most recent 50 says that GitHub has more.
- A11. In Integrations, GitHub's card says how gh stands: signed in, and as which account, or what gh needs while it is missing or not signed in. GitHub is not one of the MCP servers.
- A12. A UI that connects gets the GitHub slice at once, and later gets it again only when something in it changed.
- A13. No token appears in the state, in a message to the UI, or in the log.
- A14. The host reads by itself every minute while a UI is connected, and not while none is. What it saw merge or close leaves the lists at once.
- A15. A gh that hangs is stopped after 20 seconds, and the read fails with that reason.
- A16. The window keeps the GitHub slice between messages, and drops it when a host that does not read GitHub starts over.
- A17. While gh is signed in, the page shows the account, when it last read, and the three groups, with each of the user's own pull requests showing its review and checks state. While gh is missing or not signed in, it says which and names the command to run in Terminal.
- A18. A row opens its page on github.com: in the system browser from the Mac window, and in a new tab from a browser tab.
- A19. In Integrations, GitHub's card has a button that opens the GitHub page, with the keyboard on its first row.
- A20. The page has a row of project tabs: All, then one for each project hobkin works on whose repository is on GitHub, in the Work screen's order, each with how many open pull requests and issues it holds. A project with nothing open keeps its tab with 0. With no such project the row does not show.
- A21. A project's tab narrows every list on the page, under Pull requests and under Issues, to what is in that project's repository, matched by `owner/name` in any case; All shows everything again, what is in no project included. The title, the page tabs' counts and the group headings follow it, and a tab with nothing of the project's says so in one line.
- A22. The chosen project tab is remembered as the page's tab is: a reload and Command+Left and Right bring it back, a new visit starts on All, and a project hobkin no longer works on falls back to All.
- A23. The project tabs work with the keyboard: Up and Down reach the row, and Left and Right, Home and End choose a tab. The selection moves on a spring, and with Movement set to Still it does not travel.
- A24. Each project hobkin works on comes to the window with its repository on GitHub, from its folder's origin or the remote hobkin clones, and each folder is asked once.
- A25. The one read brings each pull request's base and head branch by name, leaves out a fork's head, and still reads an answer without them.
- A26. A pull request whose base branch is another listed open pull request's head, in the same repository, is the layer over it: a chain of 2 to 5 reads bottom first as layer k of n; two on one stay one stack, each after the one it sits on; a loop, a branch two share and a branch of another repository stack nothing; a layer missing from the lists breaks the chain, and the layers are counted from what is listed.
- A27. The page has a Newest and Oldest choice beside its tabs that orders every list under both tabs by when GitHub last updated it, Newest first, in a place that does not move. It is kept as the tab is: a reload keeps it and a new visit starts on Newest. Up and Down reach it, Left and Right choose.
- A28. In every list, and under a project tab, a stack's layers stay together, bottom first, and the stack sorts by its newest layer under Newest and its oldest under Oldest.
- A29. A stack shows as one quiet frame: the lowest layer the list holds as its whole card, each layer over it as a line that opens to its whole card in place and closes again, each with "Layer k of n". A stack split between the two lists says plainly where its other layers are. A pull request in no stack looks as before. With Movement set to Still nothing travels.
- A30. The sample, which the page shows with no host, holds a stack of three of the user's own pull requests and one of two among the review requests.

## Proof

- A1. `host/test/github.test.ts` › "reads the three lists from one gh answer"
- A2. `host/test/github.test.ts` › "gh runs only the fixed read, and how it ends becomes the connection"
- A3. `host/test/github.test.ts` › "gh runs only the fixed read, and how it ends becomes the connection"
- A4. `host/test/github.test.ts` › "there is never more than one read at a time"
- A5. `host/test/github.test.ts` › "a failed read keeps what was read before and says what went wrong"
- A6. `host/test/github-host.test.ts` › "the scripted host shows sample GitHub data, and gh runs only with --github"
- A7. `host/test/github-host.test.ts` › "a refresh answers with the slice, and only pages on github.com open"
- A8. check: open Pages › GitHub and use it with Up, Down, Enter, `r` and Escape only, in light and dark.
- A9. check: open the page on the scripted host and press `r` twice (every second sample read brings one more review request), then again with Movement set to Still.
- A10. check: a group with nothing in it, such as Waiting for your review on a quiet day, shows its line.
- A11. `ui/test/integrations-sample.test.ts` › "GitHub has a page of its own, so it is no MCP item: a GitHub MCP server the person configured is one of their own"; check: open Integrations with gh signed in, then signed out.
- A12. `host/test/github-host.test.ts` › "the GitHub slice travels whole, only when some of it changed"
- A13. `host/test/github.test.ts` › "nothing shaped like a token reaches what gh said"
- A14. `host/test/github.test.ts` › "it reads again on a gentle timer, only while someone is looking"
- A15. `host/test/github.test.ts` › "gh runs as its own program, with a time limit"
- A16. `ui/test/github.test.ts` › "the GitHub slice comes with state messages, and a reset without it means the host does not read GitHub"
- A17. check: open Pages › GitHub on a host started with `--github`, then look at the page with gh missing and with gh signed out.
- A18. check: press Enter on a row in the Mac window and in a browser tab.
- A19. check: in Integrations, press Enter on Open GitHub in GitHub's card.
- A20. `ui/test/github-projects.test.ts` › "the tabs are All, then each project hobkin works on, by its repository on GitHub, each with how many open pull requests and issues it holds" and "with no project hobkin works on that is on GitHub there are no tabs, so the row does not show"
- A21. `ui/test/github-projects.test.ts` › "a project's tab narrows every list to its repository, whatever the case, and All shows everything again" and "the others the AI reviewed are the most recent of the tab’s own, so a busy project does not crowd out a quiet one"; check: open Pages › GitHub on the sample, choose a project, then one with nothing open, in light and dark.
- A22. `ui/test/github-projects.test.ts` › "the chosen tab is the one remembered, and a project hobkin no longer works on falls back to All"; `ui/test/location.test.ts` › "a reload comes back to the same screen and its way back, and to the details once their home has them" and "command left and right walk back and forward through the moves, with the slide each move has"
- A23. check: walk up to the project tabs, choose with Left, Right, Home and End, then again with Movement set to Still.
- A24. `host/test/work-repos.test.ts` › "each project hobkin works on carries its repository on GitHub, from its folder's origin or the remote hobkin clones, and each folder is asked once"
- A25. `integrations/github/test/host-github.test.ts` › "a pull request's base and head branch come from the same read, and a fork's head, which lives in another repository, is left out"
- A26. `integrations/github/test/pull-stacks.test.ts` › "a chain of 2 to 5 is one stack, bottom first, whatever order the lists hold it in", "two on one keep the stack together: each comes after the one it sits on, the one opened first first, and says which it sits on", "a loop in bad data stacks nothing on it, and a sound chain beside it still stacks", "a branch only matches in its own repository, whatever the case of its name, and a branch two pull requests share is no one's base", "a layer missing from the lists breaks the chain where it was, and the layers here are counted from what is listed" and "a pull request on its own, one without branch names, and one listed twice are no stack"
- A27. `integrations/github/test/window-page-order.test.ts` › "Newest is GitHub’s own order, the most recently updated first, and Oldest the other way, in every list and for issues"; check: in the window, walk up to the order, choose Oldest with Right, reload, then leave the page and come back.
- A28. `integrations/github/test/window-page-order.test.ts` › "a stack keeps its layers together, bottom first, and sorts by its newest layer under Newest and its oldest under Oldest" and "under a project tab a stack stays whole, as all its layers are in one repository"
- A29. `integrations/github/test/window-page-order.test.ts` › "a stack the page holds in two lists keeps its count, and each list says plainly where its other layers are" and "a pull request in no stack is one unit with no place, as before"; check: open the sample's stacks in the window, open and close a layer with Enter, in light and dark, then again with Movement set to Still.
- A30. `integrations/github/test/window-page-order.test.ts` › "the sample, which the page shows with no host, holds a stack of three of the user’s own and one of two among the review requests"

## Steps

- [x] S1 (A1, A2, A3, A4, A5, A13, A14, A15). Host: run gh, read its answer, the refresh rules, and a sample source, tested on a fake gh.
- [x] S2 (A6, A7, A12, A16). Wiring: the `github` state slice, the `github.refresh` and `github.open` commands, and `--github`.
- [ ] S3 (A8, A9, A10, A17, A18). The page, Pages › GitHub. Checked in a browser tab on 2026-11-10 with the real gh, in light and dark and with Movement set to Still. A row's link was taken with Enter there, and its opening was held back. Still to check: Enter on a row in the Mac window.
- [x] S4 (A11, A19). Integrations: GitHub's tile and detail follow gh. Replaced on 2026-11-12 by GitHub's card as a full integration (023-integrations, S5), not yet seen in the window.
- [ ] S5 (A20, A21, A22, A23, A24). Project tabs: the filter rule, the row, the remembered choice, and each project's repository from the host. Seen on 2026-11-13 in still renders of the sample (server render with the app's CSS), light and dark, All, a project, and one with nothing open. Still to check in the window: the keyboard, the spring and Still, and the user's own projects.
- [ ] S6 (A25, A26, A27, A28, A29, A30). Order and stacks: the branch names in the read, the stacking rule, the order and the stacks' look. The pure parts are tested. Seen on 2026-11-24 in still renders of the sample (server render with the app's CSS, through QuickLook), light and dark: a stack closed, a layer open, Oldest chosen, and a stack split between the two lists. Still to check in the window: the keyboard, the motion and Still, the order kept across a reload, and the user's own stacks on GitHub.

## Open questions

- Should hobkin itself read this list, so it can answer "what waits for my review?" Marking `github.refresh` as a command hobkin may run (013-hobkin-access) would do it. It is off for now.
- Actions on GitHub from the page, such as approving or merging, are each a write and need a decision of their own.

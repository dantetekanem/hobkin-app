---
{
  "id": "024-github",
  "title": "GitHub through gh",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "019-keyboard", "023-integrations"],
  "updated": "2026-11-13"
}
---
# GitHub through gh

## Outcome

GitHub is the first integration that reads real data. It connects through gh, GitHub's command line tool, with the login gh already has, so connecting takes nothing in the app. A page under Pages, Pages › GitHub, shows the pull requests waiting for the user's review, the user's own open pull requests with where each one's review and checks stand, and the user's open issues. Each row opens its page on github.com. A row of project tabs narrows the whole page to one project hobkin works on. The Integrations screen shows GitHub as connected through gh, as which account, with a way to open the page.

## Decisions

- The host runs gh as a program of its own with execFile, never through a shell, with a 20 second limit. It runs one command only: `gh api graphql --hostname github.com` with one fixed query (`host/src/github-gh.ts`). The query only reads. The host never runs `gh auth token` and never sees a token. gh keeps its own.
- One query reads everything: the account (`viewer`) and four GitHub searches, each for the 50 most recently updated: `is:pr is:open review-requested:@me`, `is:pr is:open author:@me`, `is:issue is:open assignee:@me` and `is:issue is:open author:@me`, all with `archived:false`. An issue that is both assigned to the user and opened by them is listed once.
- Review state: GitHub's review decision when a review is required, otherwise the latest review of each reviewer (changes asked for outweigh an approval), otherwise waiting when a review is asked for, otherwise none. Checks state: the status rollup of the last commit, as passing, failing, pending or none.
- The connection is not known yet, gh missing, gh not signed in, or connected as a login. gh's exit code 4 and an HTTP 401 mean not signed in. The host looks for gh on the PATH, then in Homebrew's folders, because an app opened from the Finder has a short PATH.
- The host keeps what it read last and sends it as the `github` slice of the state messages, whole, when any of it changed and with every reset. It reads when it starts, on `github.refresh`, and every minute while a UI is connected. A pull request or an issue the host itself saw merge or close leaves the lists at once and stays out while GitHub's search catches up, and GitHub is read again right away and ten seconds later. Each item's own state is believed over the list it came in. A refresh during a read joins that read, so there is never more than one at a time. A failed read keeps the lists and says what went wrong in plain words. Anything shaped like a token is taken out of what gh says before it reaches the state or the log.
- The scripted host shows made-up data and never runs gh. `--github` makes it read the real GitHub through gh, read only. A `--live` host always reads the real GitHub. A host started in a test reads made-up data unless the test hands it a source of its own.
- A row is a link. In a browser tab it opens its page as any link does. The Mac window's web view opens no window for a link, and the shell has no opener, so there the host opens it: `github.open` runs `open <url>` with execFile, only for an address that starts with `https://github.com/`. Nothing opens a browser unless the host's entry hands it an opener. The app does. A test never does.
- The page sits under Pages, as Integrations sits under Settings: the menu's second row reads Pages › GitHub, and Escape goes back up to Pages. Keys: Up and Down walk the rows and Refresh, Enter opens a row, and `r` reads again. Left and Right change the page's tab or project tab that has the keyboard, and Tab is the frame's.
- Rows land one after another as the page arrives, and a row that a refresh brings rises in on its own. With Movement set to Still, or following a Mac that asks for less, nothing travels and only fades remain.
- In Integrations, GitHub is a full integration, apart from the MCP servers (023-integrations). Its card says how gh stands and as which account, what the page holds, has a button that opens the GitHub page, and holds the setting that shows GitHub in the menu. GitHub is not in the MCP catalog; a GitHub MCP server the user configured shows with their own servers.
- Project tabs (2026-11-13): one quiet row above the page's tabs, All first, then a tab for each project hobkin works on, its `chosen` projects with paused ones, in the Work screen's order (`trackedProjects`), each with how many open pull requests and issues it holds. It is a filter over the whole page, so it sits apart from Pull requests and Issues and narrows both. An item is a project's when its repository, `owner/name` in any case, is the project's own on GitHub as hobkin finds it (`repoOfProject`: its folder's origin, or the remote hobkin clones), never by name. A pull request the AI reviewed that GitHub no longer lists is matched by its review's repository.
- The host adds that repository to each project hobkin works on in the Work state (`WorkProject.repo`, in `host/src/work-items.ts`), with `git remote get-url origin`, only reading, once per folder for the host's life. Proposals are not asked about, as a look for projects can propose many folders. A project not on github.com has no tab, as nothing on the page can be its. One with nothing open keeps its tab with 0, so the row does not jump as lists change; with no project on GitHub the row does not show. What is in no project's repository shows under All only.
- Under a project tab the title, the page tabs' counts and the group headings count what it holds, the empty lines name the project, and a tab with nothing of the project's says so once ("Nothing open in storefront."). The count leaves out the others the AI reviewed, which are no longer open; under a project tab those are the 8 most recent of its own, not of all. The chosen project is kept as the page's tab is: a reload and Command+Left and Right bring it back, a new visit starts on All, and a project hobkin no longer works on falls back to All. The row is a radio group: Up and Down reach it, Left and Right, Home and End choose, and the pill under the chosen one moves on a spring, and does not travel under Still.

## Out of scope

- Writing to GitHub: commenting, reviewing, merging, closing. This version only reads.
- GitHub Enterprise and hosts other than github.com.
- Signing gh in from the app. The page names the command to run in Terminal.
- Notifications, and filters on the page other than the project tabs.

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

## Steps

- [x] S1 (A1, A2, A3, A4, A5, A13, A14, A15). Host: run gh, read its answer, the refresh rules, and a sample source, tested on a fake gh.
- [x] S2 (A6, A7, A12, A16). Wiring: the `github` state slice, the `github.refresh` and `github.open` commands, and `--github`.
- [ ] S3 (A8, A9, A10, A17, A18). The page, Pages › GitHub. Checked in a browser tab on 2026-11-10 with the real gh, in light and dark and with Movement set to Still. A row's link was taken with Enter there, and its opening was held back. Still to check: Enter on a row in the Mac window.
- [x] S4 (A11, A19). Integrations: GitHub's tile and detail follow gh. Replaced on 2026-11-12 by GitHub's card as a full integration (023-integrations, S5), not yet seen in the window.
- [ ] S5 (A20, A21, A22, A23, A24). Project tabs: the filter rule, the row, the remembered choice, and each project's repository from the host. Seen on 2026-11-13 in still renders of the sample (server render with the app's CSS), light and dark, All, a project, and one with nothing open. Still to check in the window: the keyboard, the spring and Still, and the user's own projects.

## Open questions

- Should hobkin itself read this list, so it can answer "what waits for my review?" Marking `github.refresh` as a command hobkin may run (013-hobkin-access) would do it. It is off for now.
- Actions on GitHub from the page, such as approving or merging, are each a write and need a decision of their own.

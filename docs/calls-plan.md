# Calls

The plan for the fight against meat proxying and decision fatigue, written on 2026-11-02 from four research briefs and the user's own data. A call is anything hobkin brings to the user to decide or do. This file is also the contract for the lanes that build it.

## What we are fighting

A meat proxy is a person who passes AI output along without reading it or adding anything. The earliest recorded use is from 31 March 2026, and Niklas Gruhn made it popular on 3 August 2026: "I can talk to Claude myself. It's going to be faster and I get to control the context. I don't need a meat proxy in between." Nobody has measured it yet, so everything about the term itself is essays and comment threads. Gruhn's harm falls on a human recipient. Our goal is wider than his term, and that widening is ours. hobkin must not make the user a pipe in either direction:

- Inward: carrying a call, a fact or a command that an agent could have settled.
- Outward: merging, pushing or sending what they could not explain if someone asked.

Decision fatigue is "the impaired ability to make decisions and control behavior as a consequence of repeated acts of decision-making" (Pignatiello 2020). The theory under it has not held up: large replications of ego depletion found d=0.04, 0.06 and 0.10, and the famous parole judges study is contested. So hobkin's docs say this: repeated low-value approvals appear to reduce the attention each one gets. The idea that decisions drain a limited mental resource has not held up in large replications, so we treat this as an attention problem and measure it.

Repetition has better support than volume. Among 112 clinicians, acceptance fell 30% per extra reminder per encounter and 10% per five-point rise in repeats, with no effect of workload (Ancker 2017).

## Where hobkin stands

Measured from real data on 2026-11-02. Work records cover about 31 hours and routine logs 3.3 days, so these show direction, not rates. Sorting calls into kinds was one agent's judgement.

| What | Number |
|---|---|
| Items finished, of 100 | 79 |
| Landed | 3 PRs, 162 added lines |
| Waiting on branches | about 14,000 added lines in 64 branches, estimated because branches can overlap |
| Open branches Done cannot show | 30 of 76 |
| `done` items that changed their default branch | 2 of 30 |
| Calls an agent could have settled | 12 of 37, mostly permission tickets |
| Calls needing real judgement, and only the user | 13 and 12 |
| Agent output pasted into another agent | 3 in 371 messages |
| Bare go-aheads, and events the user announced | 29 and 10 |
| Routine runs reaching Chat | 32 of 46, about 10 a day |
| Report opens under 3 seconds | 67 of 116, median 2.4 seconds |
| Routine questions | 0, because `hobkin decide` shipped today |
| Projects with an error tracker | 1 of 22, and none with a flag system |
| Anything that looks at a project after a merge | nothing |

The jam is landing more than questions. Literal copy and paste is rare. The bigger relay is the user acting as hobkin's merge detector and release manager.

hobkin also could not see itself that day. It did not record how a decision was answered, what the agent recommended, whether a diff was opened, who merged, or what happened after a merge.

## What the evidence changes

1. Learn from what happened next, never from the yes. Users accept 93% of manual prompts (Anthropic), and analysts matched an agent's coin-flipped lean 86% of the time. Meta's RADAR is the only system found that grows autonomy from a track record, and it scores outcomes: incidents, reverts, rejections.
2. Go after repeats first. The same question twice is the worst call hobkin can make.
3. A closed loop removes the copying and leaves the ignorance. Every shipped tool closes loops, and none found checks understanding.
4. A grade can raise acceptance without raising accuracy (Bansal 2021). So each offer names one specific risk. Asking reviewers to focus on security raised detection eightfold, where a checklist added nothing significant (N=150).
5. Small samples justify an offer a person confirms. They cannot show a change is safe: claiming under 5% bad takes 59 clean in a row.
6. End a watch on exposure, not on time alone, and compare sets of errors instead of rates. A new error class is a signal at n=1. Zero failures in 100 requests only rules out rates above about 3%.
7. Spot checks measure. They barely catch. Their use is a comparison group, and no fake branches are seeded.
8. Automate only what can be undone. Anthropic's own classifier misses 17% of real overeager actions.

## What stays

- hobkin never merges by itself. Every merge is the user's word, and saying yes to an offer is that word. Keeping the key is what these sample sizes allow.
- Merges stay on this machine. Pushing stays the user's.
- Agents never deploy, roll back, flip a flag in production or revert the default branch. They prepare branches and say what to do.
- Nothing waits. No run stops for a call, and a limit only moves a row. The one exception is the user's own: new work waits while finished work piles up. See Ship first.
- A PR closed without merging is a fact to keep, never a no.
- With learning off nothing is judged: no track records and no precedent offers. The plain `can land` question stays.
- With work mode off the code checks go on, and no model run starts.

## The design

### Every routine counts

The rules below cover every source of calls: work mode, all 18 routines, learning proposals, project proposals, allowance requests and `yours` or `left` steps. The pending card counts them together, and `hobkin telemetry` measures them together.

### 1. The record tells the truth

- An agent recording `done` on a branch with commits the default branch lacks is recorded as `branch`. `done` means no change was needed.
- Done lists finished branches whose item says `done`, under NOT LANDED, so the 30 hidden ones show. `m` lands one and `x` closes it for good. A user's `x` is recorded as `closedByUser` so it stays closed.
- A merge writes `landed` on the item, in code. Agents cannot set it. See the contract.

### 2. Agents settle what they can

`hobkin decide` takes three new fields: `key` (stable, and filled from the question's text when missing), `recommended` (a choice value) and `why` (why only the user can answer). The tab marks the recommended choice and never reorders the choices, because Enter takes the first and the first stays the harmless one.

For routines, a question whose key was answered in the last 30 days files nothing. The command returns the earlier answer, and the run goes on with it. `changed` with what is new files it again, the way `reopen` works for declined items. Work runs never get this, because their one use of `decide` is deleting what git cannot restore.

Prompts change too:

- `background.md`: carry the next step as far as the routine allows, and hand over a finished draft instead of a to-do. A check that found nothing to act on says `Nothing new.`, even when the news is good. When a report needs the user, a line after the triage line says `Next: <the one call>`.
- `v2-runtime.md`: never end on "want me to" for work that is authorized and reversible. Do it, then say so. State decisions as decisions. Run `sync` before saying what landed.
- `work-do.md`: one ticket per need, and search `items` first.

`reportTriage` reads `Next:`, and Chat shows it. Only reports with a `Next:` count as calls.

### 3. Offers

An offer replaces walking to a tab. It is one Decision with one key:

```text
finboard: Fix cashback rounding · safe A · 31 lines
Like "Fix fee rounding", merged Oct 30. Its watch closed after 2 days and 40 requests, nothing new.
Risk: the refund branch in app/models/cashback.rb:42.
Undo: kamal rollback.

1 Later   2 Merge it   3 Read it   4 Not this one
```

A pattern is `project/kind/area`. Kind plays the part of Meta's runbook, because each lens files its own kind. Area is the first two path segments holding the most changed lines, leaving out tests and docs, with `docs`, `tests` and `deps` for branches that touch nothing else, and `multi` past two areas. For `docs`, `tests` and `deps` alone, a precedent from another project counts, and the offer says so.

| Tier | Needs | What the user gets |
|---|---|---|
| new | no landed precedent | the normal Done walk |
| seen | at least one landed precedent, and no trouble since | one offer at a time, with counts |
| earned | clean weight of 8 or more | several alike on one key |
| standing | not built | merging with no key is left out on purpose |

A landed change is exposure. Its outcome is the label:

| Outcome | Means | Weight |
|---|---|---|
| held | exposure seen, nothing new, and 14 days with no revert | 1 |
| quiet | the project cannot show exposure, and nothing went wrong | 0.5 |
| unexercised | it could show exposure and none came within 7 days | 0 |
| trouble | a new error, a revert, a fix naming it, or the user's word | resets the pattern |

Weights halve every 90 days. An `n` or `w` takes one off the clean weight, down to zero. `severe` trouble (data loss or an outage) turns the pattern off until `hobkin work trust <pattern> on`. Offers show counts and never percentages. Eight clean is where a Beta(1,1) 5th percentile passes 0.70: 10 of 10 passes, 9 of 10 does not.

Whatever its history, a branch gets no offer if it is below safe A, has a stale grade, a quality below B, over 300 changed lines, `multi` area, a conflict, no proof, anything in `left`, deleted tests, an `undo` of `one-way` or `permanent`, or a path naming migrations, schema, auth, sessions, tokens, secrets, payments, billing, CI or deploy config.

One qualifying item in five, picked from a hash of its id, gets no offer and no precedent text. It goes through the normal walk, marked `spot` in `landed`, so hobkin can compare what offers cost.

Offers go at most one every two hours, as the `can land` question does, and an offer checks the branch tip at answer time: if it moved, the merge refuses and says so.

### Landing in bulk

On 2026-11-02 the user asked to merge and deploy what was rated A. The main agent started 26 sessions in two waves, built from item summaries, and answered yes when asked if it was sure. The user's own count was 4 projects, and they were right: 11 items in 4 projects. They stopped it, and nothing landed from those sessions. What came next is what the user called the right prompt, and it is now the rule in `v2-runtime.md`: `hobkin work sync` and `ready` as the only evidence, a table of exact items, what was left out and why, numbered steps, then a question. A yes covers those items at those commits. `hobkin session` refuses a fourth session in 30 minutes until the user has approved the list.

### 4. Launch: undo and flags

The review run records `launch` beside `quality`: how to undo it, the one risk, where to look first and any flag. The Done page and offers show these.

| `undo` | Means |
|---|---|
| `code` | a rollback or revert undoes it |
| `one-way` | drops, renames, type changes, emails, charges, external writes |
| `forward-fix` | data backfills |
| `two-phase` | serialized formats and job payloads |
| `permanent` | published packages and app store builds |

The rule for a flag: use one only if rollback cannot undo the harm, a real named audience exists for partial exposure, or a flaky dependency needs a kill switch. Skip it if a rollback takes a minute. Never flag schema changes, libraries or static sites. Use the project's own tool, or an env var or YAML in the repository. Every flag gets an expiry when it is made. When its watch closes, hobkin files the removal as a `chore`, and the user merges it like any other branch.

### 5. The watch

Merging opens a launch. The stages are `merged`, `pushed` (origin holds it), `live` and closed. A launch closes on the later of 48 hours live and exposure seen, and after 7 days at most.

A code pulse runs with the survey, every half hour, mode on or off, with no model: has origin got it, did CI pass on that commit, does the health URL answer, did a revert land. It runs no command an agent wrote, because a project's text could reach one. Only `git`, `gh` and an HTTP GET.

A watch look is a look with the focus `watch`, one per project however many changes it covers. It comes an hour after a change is pushed, then every 12 hours, and at once when the pulse sees trouble. It reads the project's signals, subtracts the error classes seen before the merge from those seen after, says whether the touched paths were exercised, and writes a summary, because Kamal logs roll over at about 10 MB. A project under signal 2 gets no watch look and closes as `quiet` at 48 hours.

On trouble hobkin files an urgent `fix` naming the merge, whose run fixes forward or prepares a revert branch. The look's report opens with `Critical:`, so Chat hears at once, and the pattern resets. For 14 days after a merge the pulse still looks for reverts. `hobkin work trouble <project> <item> [severe] [why]` is the user's word for the same thing.

### 6. Signals

Each project gets `work/<slug>/signals.json`, written by a `signals` look that runs each command before recording it.

| Signal | hobkin can |
|---|---|
| 0 | not tell what is live |
| 1 | see when a change goes live: deploy, CI, release |
| 2 | see it working: request or run outcomes |
| 3 | prove it is up with a real page or smoke test, not `/up` alone |
| 4 | see new errors grouped and tagged by release |

Its `type` sets what is wanted: `service` and `app` want 4, `site` wants 3, `package` and `tool` want 1. Under what is wanted, the look files what closes the gap with keys like `signal:errors`, `signal:deploy` and `signal:probe`. These rank as closing work do, at P1 or better, and `feature` and `improvement` items on that project step down one grade, the way shipping first does. Nothing waits.

Kamal projects start with no install: kamal-proxy already logs every request as JSON, `post-deploy` can mark a release, and `KAMAL_VERSION` names it. Sentry's free tier, Solid Errors and Bugsink cover grouped errors.

A project row shows `signal 2`. An offer on a project under signal 2 says what it cannot see, and its clean merges weigh half, so visibility is what earns trust.

### 7. The pending card

When calls pile up and the user is there, hobkin shows a short card and asks how to tackle them. The user is there when they typed or clicked in the last two minutes, or the terminal just gained focus. It never takes the screen from a draft: while they type it waits for an empty composer, and it stays out of a running turn.

```text
╭ hobkin ─────────────────────────────────────────────╮
│ 52 waiting. How do you want to tackle them?          │
│                                                      │
│ ●  3 ready        safe A, about 120 lines            │
│ ◐ 41 to read      14k lines across 12 projects       │
│ ▲  1 went wrong   finboard, new error since 14:02    │
│ ?  2 questions    oldest 3 days                      │
│ ◇  5 yours        rotate a key, renew Firebase       │
│                                                      │
│ 1 Not now                                            │
│ 2 Start with the 3 ready                             │
│ 3 Just what went wrong                               │
│ 4 Walk it all                                        │
╰──────────────────────────────────────────────────────╯
```

One row per group, five at most, each with a count, a label and one fact, each in its own color: green ready, amber read, red trouble, blue questions, dim yours. An empty group has no row. The bar is 8 calls. After a card it stays quiet for 4 hours, unless 5 more arrive or something went wrong. Typing an answer sends it to the main agent with the card attached, so "drop the old finboard branches" works.

### 8. hobkin looks after itself

A failure in hobkin's own harness is never a call. On 2026-11-02 the main agent reported that a model switch was rejected, and the user had to ask why and then say fix it. The cause was a catalog read once at startup. The main agent's rule is now to find the cause and fix what can be changed back in the same turn. Once a day a code pass reads a day of events, and a class seen 3 times or more files a `fix` on the hobkin project with the counts, so the next failure of its kind is already being worked on. It adds no wait, and if hobkin is not a chosen project it says so in one quiet line for each class.

### 9. The scoreboard

The weekly review and `hobkin telemetry` show what hobkin brought, what the user acted on, how much was answered in under 3 seconds, how many merges had the page or diff opened, and what hobkin settled alone. The fight is working when calls fall and the share read stays up.

### 10. Ship first

The user's words, on 2026-11-02: "the harness need to know when a lot is done and adding more work isnt the best to get things shipped, so it should propose reviewing 2 by 2 in order to get the queue in a healthy state first". That day 46 items sat finished on branches, 21 ungraded and 12 with a stale grade, about 14,000 lines. This overrides the older note that nothing should wait on a merge, and it only orders what starts.

The pile is every row in Done's order with the gap `land`, `rebase` or `unlanded`, so a stacked branch counts once. The bar is 8 across projects, above the per-project rule, which stays. While the pile is at or over the bar, `startsNewWork` holds new items, lens looks, `ideas`, `signals` looks, studies and discovery, each with the wait `shipping first`. A started item, what closes a gap, `urgent` and `attention` items, `watch` looks, the user's picks and routines still run. A held row is treated as one that cannot start, so closing work is never left waiting on a held study.

Two by two: one decision, key `pair`, one open at a time, from the top of the pile. A row with an open offer stays out.

| Row | Next step |
|---|---|
| conflict | its rebase, through `workNote` |
| safe A at its commit, bringing nothing weaker | land, through `mergeItem` with `route: 'pair'` and its `head` |
| anything else | a review, because a review run fixes what it finds and grades the result |
| safe A on top of work no review passed | that earlier branch takes the row's place, for its review |

Choices, harmless first because Enter takes it: `later` holds pairs for two hours, `go` carries out the steps, `read` opens Done, `new` lets new work start until the end of the day and stays quiet about pairs. `hobkin work ship off` is `new`, and it closes the open pair.

A row out for its review is not in `readyItems`, so it leaves the pile until it comes back. With a pile just over the bar, new work can start while a pair is in review. A row moved once no agent is on it after a yes, or once it left the list. After `read` a pair that never moved comes back in two hours, because nothing else would bring it. A project dropped or paused cannot hold the next pair. A yes remembers each row at its commit and step, so a failed merge or a review that changed nothing is not brought again until the commit changes, and the pair behind it comes up instead.

### 11. Agents report back

Nobody read what a background agent finished with. A session's report sat in `runtime/handoffs/`, its pane closed, and a work run's `Useful:` line stayed out of Chat.

`hobkin session` writes its title to `runtime/handoffs/sessions.jsonl` as it starts, and the follower, in its own process, appends the ending there. The owner posts each ending to Chat and copies its report into Reports, then marks it `posted` after the view is saved. A crash in between finds the notice by its id, and a lost view does not post it again. The main agent's note carries `sessions` until a message reaches it, then `heard`.

A work run's `Useful:` line is one quiet notice. Consecutive quiet notices fold into one that keeps the newest and counts the rest, so each run of them takes one of Chat's 100 places and the conversation cannot be pushed out. Reports holds every one. Session endings do not fold: each was asked for, and `hobkin session` already limits how many start.

## Contract

Agents cannot set anything marked code. Everything is append-only, as `items.jsonl` is.

| Field or file | Who writes it | Shape |
|---|---|---|
| item `landed` | code, at merge | `{ sha, at, route, read, readMs, safety, quality, size, area, spot }`. `route` is `key`, `offer`, `batch`, `pair`, `chat` or `remote`. `read` is `none`, `page` or `diff` |
| item `launch` | review run | `{ undo, how, risk, lookAt, flag: { name, expires } }` |
| item `causedBy` | code, or the watch run | the id of the merged item |
| item `closedByUser` | code, on `x` | true |
| `work/<slug>/launches.jsonl` | code and `hobkin work watch` | folded by `item`: `{ item, sha, stage, mergedAt, pushedAt, liveAt, closesAt, outcome, exercised, severe, note, ci, health }` |
| `work/<slug>/signals.json` | `hobkin work signals` | `{ type, signal, wants, deploy, logs, errors, health, flags, rollback, checkedAt }` |
| decision `recommended`, `why`, `changed` | `hobkin decide` | as above |
| decision `answerTo.kind` | code | `merge` with `slug`, `item` and `head`; `read`; `pending`; `pair` with `rows` of `{ slug, item, head, step }` |
| events | `recordEvent(root, type, facts)` in `src/cli/events.mjs` | facts only, never text |
| `work/mode.json` `ship` | code | `{ said, notice, newWorkOn, pairsAfter, last, tried }` |
| `work/mode.json` `upkeepAt`, `harnessLines`, `harnessTold` | code | the last daily pass, its Chat lines as `{ key, line, at }`, and every class told so far |
| `runtime/handoffs/sessions.jsonl` | `hobkin session`, its follower and the owner | folded by `name`: `{ name, title, report, startedAt, endedAt, posted, heard }` |

| Module | Owns |
|---|---|
| `src/cli/work/patterns.mjs` | pure: `patternOf`, `trackRecords`, `offerFor` |
| `src/cli/work/launches.mjs` | opening, the pulse, closing, outcomes |
| `src/cli/work/signals.mjs` | reading, checking and ranking signals |
| `src/cli/pending.mjs` | pure: what is waiting, as card rows, and when the card is due |
| `src/cli/pending-read.mjs` | gathering from disk what the card needs, with no writes, for the dashboard and `hobkin pending` |
| `src/cli/work/ship.mjs` | pure: the pile and whether it holds new work |
| `src/cli/work/pairs.mjs` | bringing the next two, and carrying out the answer |
| `src/cli/session-log.mjs` | session endings: recording, posting and telling the main agent |
| `src/cli/work/upkeep.mjs` | the daily pass over hobkin's own failures: classes, the `fix` on itself, or one quiet line |
| `src/cli/work/scoreboard.mjs` | pure: what hobkin brought, what came of it and what it settled alone, from events and `landed` |

Commands: `hobkin work offers`, `ready`, `watching`, `watch <slug>` and `signals <slug>` (JSON on stdin from a run), `trouble`, `trust`, `ship [on|off]`.

## Build order

Each step ships alone with its CHANGELOG, guide and README lines.

1. Events and deterministic moods, in flight, because everything below needs to be measured.
2. The record tells the truth, then patterns and offers.
3. Launches, the watch and signals.
4. Decisions recall, routine prompts, `Next:` and the pending card.
5. Ship first and agents reporting back.
6. hobkin looking after itself, the scoreboard, and a last read of every prompt against this file.

## Left for the user

- Should saying yes to an offer also push, per project? It stays local, so a watch only starts once the user pushes.
- Should a pattern ever merge with no key? It is not built, and the evidence says not at these sample sizes.

## Sources

Meat proxy:

- Gruhn, "Don't be a meat proxy": https://gruhn.me/blog/2026-08-03/
- Earliest use: https://not-an-llm.bearblog.dev/meat-based-llm-proxies
- Hacker News thread: https://news.ycombinator.com/item?id=49151933
- Cohen, on agent workflows: https://shmulc.substack.com/p/i-dont-want-to-become-a-meat-proxy
- He et al., 196,212 PRs, preprint: https://arxiv.org/abs/2607.01904
- Bansal et al., explanations raise acceptance regardless of correctness: https://arxiv.org/abs/2006.14779
- Buçinca et al., forcing functions: https://arxiv.org/abs/2102.09692

Decision fatigue and attention:

- Pignatiello 2020: https://pmc.ncbi.nlm.nih.gov/articles/PMC6119549/
- Hagger 2016: https://pubmed.ncbi.nlm.nih.gov/27474142/
- Vohs 2021: https://bura.brunel.ac.uk/bitstream/2438/28246/1/FullText.pdf
- Dang 2021: https://pmc.ncbi.nlm.nih.gov/articles/PMC8186735
- Ancker 2017: https://pmc.ncbi.nlm.nih.gov/articles/PMC5387195/
- Habituation at the Gate, preprint: https://arxiv.org/abs/2606.22721
- Anthropic on auto mode, the 93% and the 17%: https://www.anthropic.com/engineering/claude-code-auto-mode
- Anthropic on deference: https://anthropic.com/research/agents-judgment-calls
- Directing reviewers: https://arxiv.org/abs/2202.04586
- Low prevalence: https://pmc.ncbi.nlm.nih.gov/articles/PMC2701252
- Random rescreening: https://pubmed.ncbi.nlm.nih.gov/11127751/

Earned trust:

- Meta RADAR: https://arxiv.org/pdf/2605.30208
- Meta Diff Risk Score: https://arxiv.org/html/2410.06351v1
- Renovate Merge Confidence: https://docs.renovatebot.com/merge-confidence/
- Dependabot compatibility study: https://arxiv.org/html/2403.09012v1
- NIST skip-lot inspection: https://www.itl.nist.gov/div898/handbook/pmc/section2/pmc27.htm
- Rule of three: https://en.wikipedia.org/wiki/Rule_of_three_(statistics)

Launch and signals:

- AWS on safe deployments and bake time: https://builder.aws.com/content/3ErTKQOTKc5NIw031UePBPxTQ6I/automating-safe-hands-off-deployments
- AWS on rollback safety: https://builder.aws.com/content/3F04j2yRAAMBuPSPs50xwXZqg01/ensuring-rollback-safety-during-deployments
- Google on canarying: https://sre.google/workbook/canarying-releases/
- Hodgson on feature toggles: https://martinfowler.com/articles/feature-toggles.html
- Uber Piranha: https://www.uber.com/blog/piranha/
- kamal-proxy request logging: https://github.com/basecamp/kamal-proxy/blob/main/internal/server/logging_middleware.go
- Kamal post-deploy hook: https://kamal-deploy.org/docs/hooks/post-deploy/

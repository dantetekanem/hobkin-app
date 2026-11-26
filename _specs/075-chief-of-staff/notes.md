# Notes: hobkin as a chief of staff

Research for `spec.md`, 2026-11-26. Five read-only lanes read the sources and the lead checked hobkin's code. Grades: R replicated, S single study or one lab, C contested, F failed replication, P practitioner opinion, Doc vendor documentation (what a product does, not whether it works), Math proven math.

## 1. What hobkin is today

hobkin is a dispatcher for checks and coding agents. Its main prompt (`~/Poetry/hobkin/src/prompts/v2-runtime.md`) is 61 KB in 26 sections. Work mode takes 15.6 KB of it and landing and deploying another 8.3 KB. Most sections script one case and end by telling or asking the user.

What it knows about the user's day:

- It keeps no model of the day. The profile holds a name, what to call them, an email and the kind of computer (`cli/profile.mjs:13`). It has no working hours, focus blocks or time zone. Each routine file carries its own time zone.
- The main chat cannot read the calendar or mail (`cli/resource-catalog.mjs:110`, `no-mcp-in-the-main-chat`). Routines reach them through Pi's MCP servers, where `gmail` (inferred to also serve the calendar) and `homeassistant` are configured.
- Routines fire at fixed clock times. Only `meetings.md` and `meeting-prep.md` adapt to the day, by writing `once/` routines around meetings.
- Reminders take a day, never a time (`cli/inbox.mjs:14`).
- The rule against changing a calendar or sending is prompt-only (`routine-templates/RULES.md:3`). No tool-level block was found.

Presence and interruptions:

- The user counts as present when the window is focused and saw a key or click in the last 2 minutes (`cli/pending.mjs:8,119`). hobkin has no quiet hours, no Do Not Disturb, no macOS Focus and no awareness of meetings.
- Every report that is not `Nothing new.` posts a Chat line at once. The face reacts with a mood and sounds play. A routine's question opens on the sheet for 30 seconds while the user is present, and a Mac notification and chime fire when the window is in the background.
- Batching exists only in pieces: `brief me` on request, the daily catch-up at 08:00 or at 8 unread reports, "ship first" pairs, at most one land offer every 2 hours. A "pending card" was designed (`docs/calls-plan.md:173-194`), but its helper has no callers.

Decisions:

- About 14 sources can ask the user something: `ask_question`, routine `decide` and `action`, other sessions, reminders, routine care, learning proposals, work mode (pick-up, offers, pairs, merge, Deploy now?, allowance, proposals), Claude Code agents, durable hobkins, the crash-report offer, setup, Home cards and `Next:` calls.
- They share no budget and no time slot, and nothing happens by default when a question goes unanswered ("Silence never closes anything", `RULES.md:8`). `recommended` is only shown, never applied.
- The same question key answered in the last 30 days is not asked again (`cli/decisions.mjs:18`). That is the only precedent memory.
- "Wins" count each answered decision, so streaks reward answering more (`cli/work/wins.mjs:28-46`).

Life routines (`health`, `money`, `home`, `paperwork`, `important-dates`, `something-to-enjoy`, `reading`, `wins`, `priorities`) read and report. None looks at the schedule and none makes a plan. The outing suggestion does not check whether the weekend is free.

Delegation, from the earlier survey on the same day:

- After a job reports, the main agent tells the user what is left and stops, unless the user's own ask already covered the next step (`v2-runtime.md:144`). An "investigate" ask never covers the fix.
- A job's report has no list of next steps (`prompts/session-job.md:27-29`).
- Text in reports grants nothing by itself (`v2-runtime.md:7`).

Memory, from the earlier survey:

- At most 300 memories. The index is ordered by kind, then newest change, and cut at 8 KB for the main chat and 4 KB for runs. Nothing records which memories are used.
- Dedupe happens only on add. Nothing merges memories or handles contradictions.
- Recall strips accents from the query but not from fields (`cli/memories.mjs:99` against `:1057`).

Known bugs:

- `lookAfterRoutines` runs only in tests (`cli/routine-care.mjs:75`).
- `actionReportIds` is never called (`cli/decisions.mjs:143`).
- `hobkin pending` returns no report calls from `Next:` lines (`cli/pending.mjs:94`), while `v2-runtime.md:46` and `docs/guide.md` promise them. This is deliberate, not a bug: since 67abad4 a call is an explicit `hobkin action` carrying the report's id, and `test/cli-pending.test.mjs:74` keeps it that way. Only the leftovers and the stale prompt and doc lines are wrong.

## 2. Planning the day and the 80% question

- Planning fallacy (R). Students predicted 33.9 days for a thesis and took 55.5, and even their worst case was too short. Recalling relevant past tasks removed the bias but did not improve accuracy. https://bear.warrington.ufl.edu/brenner/mar7588/Papers/buehler-et-al-1994.pdf
- If-then plans (R, smaller than first reported): d = .65 over 94 tests in 2006, and .27 to .66 over 642 tests in 2024. https://doi.org/10.1080/10463283.2024.2334563
- Time management correlates with performance (r ≈ .25) and inversely with distress (r = −.36), across 158 studies. This is correlational only. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0245066
- Kingman's formula (Math): waiting ≈ ρ/(1−ρ) × variability × task size. With random arrivals, an urgent item waits about 2.3 times its own size at 70% load, 4 times at 80%, 9 times at 90% and 19 times at 95%. Lower variability moves the whole curve down. https://en.wikipedia.org/wiki/Kingman%27s_formula
- No study backs a fixed 70 to 85% planned load for a knowledge worker. The 85% figure comes from one hospital simulation (S/C). What holds is the shape of the curve, so the target should be calibrated from the person's own unplanned load. https://pubmed.ncbi.nlm.nih.gov/10406748
- Pooled buffers need less total time than padding each task (sound statistics). The 50% critical-chain sizing rule is contested. https://lirias.kuleuven.be/handle/123456789/202152
- Breaks between meetings (S, vendor, n = 14 EEG): stress rose across back-to-back meetings, and 10-minute breaks kept it flat. https://www.microsoft.com/en-us/worklab/work-trend-index/brain-research
- Maker's and manager's schedules (P): one meeting can cost a maker half a day. https://www.paulgraham.com/makersschedule.html
- Time-blocking, timeboxing, the daily highlight and the Ivy Lee method are all P. https://www.timeblockplanner.com/ and https://maketime.blog/article/choose-a-highlight-to-make-time-every-day/
- Weakly supported: 90-minute work cycles (C/P), chronotype scheduling (C, found in about 45% of studies), "4 hours of deep work" (P), a 0.6 to 0.8 focus factor (P).

How planners handle a day (Doc):

- Reclaim: priorities P1 to P4, and other events are never booked over. Flexible blocks start Free and turn Busy as their start nears or the day fills. It re-plans about 15 seconds after a change and never moves meetings with other people. Edits made through chat wait in Preview. https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically and https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq
- Sunsama: a workload counter turns yellow near the threshold and red above it. It tracks planned against actual time and runs a shutdown ritual. Its guide says to commit 5 to 6 of 8 hours. "You're out of time" picks an option itself if nobody answers within a couple of minutes, and it saves a rule only after repeating it back to the user. https://help.sunsama.com/docs/planned-and-actual-times and https://roadmap.sunsama.com/changelog
- Motion: orders tasks by deadline and priority, splits them into blocks, and marks a task "Could not fit". It has no overload cap, and tasks without a deadline keep slipping. https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes
- Morgen: inflates estimates by 20% and plans by previews the user confirms. Its own early versions scheduled work at 10 pm. https://www.morgen.so/guides/plan-your-day-using-the-ai-planner
- Clockwise shut down on 2026-03-27. https://www.getclockwise.com/

## 3. When something lands: interruptions, timing and openings

- Batching (S for attention, C for stress). In an RCT, notifications delivered 3 times a day made people more attentive and productive and less stressed. Hourly batches gave little, and no notifications at all raised anxiety. https://doi.org/10.1016/j.chb.2019.07.016 Mark et al. 2016 found no stress benefit from email batching, and self-chosen checking beat notification-driven checking. https://www.microsoft.com/en-us/research/wp-content/uploads/2016/06/Email20Duration20Camera20Ready20submission3-1.pdf
- Breakpoints (R). Delivering at a task boundary cuts frustration and reaction time. https://hci.rwth-aachen.de/materials/conferences/CHI2004/1p271.pdf and https://doi.org/10.1145/1357054.1357070
- After an alert (S), people spent about 10 minutes diverted plus 10 to 15 more before focused work resumed, and 27% of suspended tasks took over 2 hours to resume. https://www.erichorvitz.com/CHI_2007_Iqbal_Horvitz.pdf
- "23 minutes to refocus" is a misreading. That figure is the time to return to an interrupted project. https://www.interruptions.net/literature/Mark-CHI05-p321-mark.pdf
- A ready-to-resume note of under a minute (where I stopped, what comes next) removed the cost of switching away (S, one lab, four studies). https://ideas.repec.org/a/inm/ororsc/v29y2018i3p380-397.html
- Microbreaks (R, meta-analysis): more vigor and less fatigue, but no gain in performance on cognitive work. https://pmc.ncbi.nlm.nih.gov/articles/PMC9432722/
- Microtasks (S) took longer overall but held quality and survived interruptions. https://hci.stanford.edu/publications/paper.php?id=293
- Mixed-initiative (P, foundational): do nothing, ask or act by expected value, and do less when unsure. https://www.erichorvitz.com/chi99horvitz.pdf

## 4. Decisions and decision fatigue

- The willpower battery (ego depletion) failed replication: d = 0.04 across 23 labs and 0.06 across 36 labs (F). https://doi.org/10.1177/1745691616652873 and https://pubmed.ncbi.nlm.nih.gov/34520296/
- The parole-judges result is likely an artifact of case order (C). https://pmc.ncbi.nlm.nih.gov/articles/PMC3198355/
- What holds is a drift toward the easy option late in a run of decisions, seen in clinicians (observational), ballots and car buyers' defaults. Antibiotic prescribing: https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/1910546 Ballots: https://ideas.repec.org/a/oup/restud/v83y2016i2p460-480..html
- Defaults (R, varied, d = 0.68 over 58 studies) work best when read as an endorsement, so a default the assistant offers has to be good. https://www.cambridge.org/core/journals/behavioural-public-policy/article/when-and-why-defaults-influence-decisions-a-metaanalysis-of-default-effects/67AF6972CFB52698A60B6BD94B70C2C0
- Choice overload averages about zero, but it appears with complex options, hard tasks, unclear preferences and a wish to save effort, which describes a busy person. https://www.kellogg.northwestern.edu/faculty/research/detail/2015/when-product-assortment-leads-to-choice-overload-a-conceptual
- Over-reliance (S, several): explanations raise acceptance whether the advice is right or wrong. Showing confidence helps calibrate trust. https://arxiv.org/abs/2006.14779
- Executive practice (P, no outcome trials):
  - One-way and two-way doors: https://www.sec.gov/Archives/edgar/data/1018724/000119312516530910/d168744dex991.htm
  - Completed staff work, where the boss only approves or not: https://en.wikipedia.org/wiki/Completed_staff_work
  - Oncken and Wass's degrees of initiative: https://hbr.org/1999/11/management-time-whos-got-the-monkey
  - Lazy consensus, where silence after a deadline is agreement: https://www.apache.org/foundation/glossary.html
  - Decision hygiene: score criteria separately before the overall call. https://sloanreview.mit.edu/article/a-structured-approach-to-strategic-decisions/

## 5. Delegation

- Grove (P): task-relevant maturity belongs to the task, and delegating without monitoring is abdicating. https://wiki.opensourceecology.org/wiki/High_Output_Management
- Jagged frontier (S, preregistered, n = 758): inside the AI's frontier people worked 25% faster with over 40% better quality, and outside it they were 19 points less likely to be right. Autonomy belongs to a task class, not to an agent. https://papers.ssrn.com/abstract=4573321
- Perception gap (S): developers took 19% longer with AI and believed they were 20% faster. Measure review time, don't ask about it. https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- Autonomy in practice (S, vendor telemetry): auto-approve rose from about 20% to over 40% of sessions with experience, and oversight became targeted rather than dropped. https://www.anthropic.com/research/measuring-agent-autonomy
- Automation complacency (R): experts suffer it too, and it worsens under load, so checks must be built in. https://pubmed.ncbi.nlm.nih.gov/21077562/
- Levels of delegation (P): Appelo's 7 levels, applied to decision areas. https://medium.com/@jurgenappelo/the-7-levels-of-delegation-672ec2a48103 Levels of autonomy for agents: https://arxiv.org/abs/2506.12469
- A lead agent synthesizes results and decides whether more work is needed. Vague briefs duplicate work. https://www.anthropic.com/engineering/multi-agent-research-system

## 6. Chief-of-staff practice and products

- BCG (P, 94 firms): the calendar reflects 12 to 18 months of priorities with a rolling 4-week view, and saying no is among the hardest jobs. https://www.bcg.com/publications/2020/heart-ceo-effectiveness
- Porter and Nohria (S, 27 CEOs): keep time unscheduled and don't spend it on email. https://hbr.org/2018/07/how-ceos-manage-time
- Ciampa (P): a chief of staff settles problems before they reach the principal. https://hbr.org/2020/05/the-case-for-a-chief-of-staff
- ChatGPT Pulse (retired about 2026-07): 5 to 10 cards a morning, then "That's all for today". It learned from feedback. It broke by pushing dropped topics and tips for finished projects. https://openai.com/index/introducing-chatgpt-pulse/
- ChatGPT Scheduled Tasks: time, monitoring and event triggers, with permission levels from Always ask to Allow all. https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt
- Google CC: a "Your Day Ahead" email that prepares drafts and only ever emails the user. https://blog.google/technology/google-labs/cc-ai-agent/
- Outlook calendar instructions: confirm a standing rule once, then it acts and logs a reason each time. Auto-reschedule stops after 5 tries and says so. https://support.microsoft.com/en-us/topic/automatically-reschedule-events-with-copilot-in-microsoft-outlook-and-microsoft-teams-b07da559-387e-4b95-92eb-8c8f0be065a7
- Lindy: each tool is Always allow, Require approval or Don't offer, and "Approve once" is separate from "Always allow". https://docs.lindy.ai/integrations/overview.md
- Howie: refuses slots past 3 hours back-to-back. It broke by sending 147 emails to a customer's boss in 2 hours. https://www.usecarly.com/blog/howie-ai-review/
- OpenClaw's proactive check: `NO_REPLY` when there is nothing to say, idle-only and active hours. One user spent about $18.75 overnight on checks asking whether it was daytime. https://docs.openclaw.ai/gateway/heartbeat
- clawchief: P0 interrupts, P1 the same day, P2 the digest, P3 ignore. It resolves alone only when a mistake is cheap and a live source backs the action. https://github.com/snarktank/clawchief
- May Framework: "If it doesn't spend money or send information to someone else, just do it." https://krogsgard.github.io/may-framework
- "A chief of staff that only briefs you is a newspaper": put the work into free calendar gaps. https://dev.to/amitrix/the-missing-middle-why-ai-chiefs-of-staff-fail-without-calendar-materialization-13fi
- Common failures: acting without real consent ("continue" read as approval, 147 emails), noisy briefs that users learn to ignore, silent failure ("Succeeded" while nothing was done), memory drift, and schedule churn.

## 7. Memory and learning

From the earlier memory research the same day:

- Count the memories actually used, not only those injected.
- Close a contradicted fact with a validity date instead of deleting it (Zep). https://arxiv.org/abs/2501.13956
- Run consolidation as a nightly batch (sleep-time compute). https://arxiv.org/abs/2504.13171
- Score by recency and use with ACT-R's base-level activation, which needs no model call.
- PageRank over a graph (HippoRAG) is overkill below a few thousand memories. https://arxiv.org/abs/2502.14802

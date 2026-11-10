/**
 * Sample routines, shaped as hobkin's own data, until the host supplies the real ones (010-routines, S1).
 * Everything is built from the clock it is given, so there is always something that just ran, something
 * running, something held and something about to run, at any hour.
 *
 * The logs are written as hobkin writes them and read back with the same reader the host's data will use.
 */
import { logLine, parseLog } from './holds.ts'
import { addDays, dateText, occurrencesBetween, wallTime } from './timeline.ts'
import type { DefinitionError, Routine, RoutinesData, RoutineTemplate, RunLine, RunStatus } from './types.ts'

const SAMPLE_HOME = '/Users/sample/.hobkin'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How one past run went. */
interface PastRun {
  status: RunStatus
  summary: string
  seconds: number
  usd: number | null
}

/** A time the routine was due: the run it made, or null when it did not run. */
type Past = PastRun | null

const useful = (summary: string, seconds: number, usd: number): PastRun => ({ status: 'completed', summary: `Useful: ${summary}`, seconds, usd })
const critical = (summary: string, seconds: number, usd: number): PastRun => ({ status: 'completed', summary: `Critical: ${summary}`, seconds, usd })
const blocked = (summary: string, seconds: number, usd: number): PastRun => ({ status: 'completed', summary: `Blocked: ${summary}`, seconds, usd })
const quiet = (seconds: number, usd: number): PastRun => ({ status: 'no_change', summary: 'Nothing new.', seconds, usd })
const failed = (summary: string, seconds: number): PastRun => ({ status: 'failed', summary, seconds, usd: null })
const cutShort = (summary: string, seconds: number, usd: number): PastRun => ({ status: 'incomplete', summary, seconds, usd })
const interrupted = (seconds: number): PastRun => ({ status: 'interrupted', summary: 'Stopped when hobkin quit.', seconds, usd: null })

interface Seed extends Omit<Routine, 'path' | 'harness' | 'timezone' | 'enabled' | 'context' | 'model'> {
  timezone?: string
  enabled?: boolean
  context?: string[]
  model?: string | null
  memory: string
  report?: string
  /** Its past runs, newest first, one for each time it was due. */
  past: Past[]
  /** Runs started by hand, as hours before now, newest first. They replace `past`. */
  byHand?: { hoursAgo: number; run: PastRun }[]
}

const SEEDS: Seed[] = [
  {
    id: 'disk-space',
    title: 'Disk space',
    cadence: 'daily',
    at: '06:40',
    effort: 'low',
    model: 'openai-codex/gpt-6-luna',
    cwd: '/Users/sample',
    prompt:
      'Find what takes space on the main disk, in ~/Library/Caches, ~/dev and ~/Downloads, such as caches, build output and old worktrees. Say what could go and how much each would free.\n\nRemove only build output older than 30 days under ~/dev. Never touch anything in hobkin\'s data folder. Report the rest.',
    memory:
      '# Disk space\n\n- Main disk: 494 GB. Free on the last look: 61 GB.\n- Biggest three: ~/dev/storefront/node_modules (9.1 GB), Xcode DerivedData (7.4 GB), Docker.raw (38 GB, not mine to remove).\n- Said on Oct 28: leave Docker alone, ask before touching Downloads.\n- Removed so far this month: 14.2 GB of build output.\n',
    report:
      'Useful: 3.8 GB could go, and 1.2 GB of it is already gone.\n\n| What | Size | Now |\n| --- | --- | --- |\n| `~/dev/billing-api/dist`, 41 days old | 1.2 GB | removed |\n| Xcode DerivedData | 7.4 GB | ask first |\n| 12 disk images in `~/Downloads` | 2.6 GB | ask first |\n\nFree space is 61 GB, down 2 GB since yesterday. Nothing is urgent.',
    past: [quiet(38, 0.03), quiet(41, 0.03), useful('3.8 GB could go, and 1.2 GB of it is already gone.', 96, 0.09), quiet(36, 0.03), quiet(44, 0.04), useful('Free space fell under 70 GB.', 88, 0.08), quiet(39, 0.03), quiet(35, 0.03), interrupted(12), quiet(40, 0.03)],
  },
  {
    id: 'meeting-prep',
    title: 'Meeting prep',
    cadence: 'daily',
    at: '07:45',
    effort: 'medium',
    cwd: '/Users/sample/notes',
    context: ['people.md', 'projects/current.md'],
    prompt:
      "Read today's calendar. For each meeting with other people, say who is in it, what it is for, and what was left open the last time, from notes/people.md and the last report that mentions them.\n\nSkip focus blocks and anything declined. Keep each meeting to four lines.",
    memory:
      '# Meeting prep\n\n- Calendar: the work calendar only. The family calendar is out of scope.\n- The weekly 1:1 with Dana moved to Thursdays at 14:00.\n- Last good run listed 3 meetings. Since then the calendar tool answers 401.\n- Tried on four mornings. Signing in again needs the user, so I stopped guessing.\n',
    report:
      'Blocked: The calendar sign-in expired. Sign in again in Integrations.\n\nNext: After signing in, press Run now and I will prepare today from scratch.\n\nThe calendar tool has answered `401 invalid_grant` on four mornings. Nothing was read, so there is nothing to prepare from.',
    // Held: each blocked run made the wait longer, and the mornings in between did not run.
    past: [
      null,
      blocked('The calendar sign-in expired. Sign in again in Integrations.', 41, 0.05),
      null,
      null,
      blocked('The calendar sign-in expired. Sign in again in Integrations.', 38, 0.05),
      null,
      blocked('The calendar answered 401. I could not read today.', 44, 0.06),
      failed('The calendar tool timed out after 30 s.', 34),
      useful('3 meetings today. The 14:00 needs the rate limiter numbers.', 72, 0.14),
      useful('2 meetings today.', 61, 0.12),
      quiet(33, 0.04),
      useful('4 meetings today. Two overlap at 11:00.', 79, 0.15),
      useful('1 meeting today.', 52, 0.1),
      quiet(30, 0.04),
    ],
  },
  {
    id: 'inbox-watch',
    title: 'Inbox watch',
    cadence: 'daily',
    window: { start: '08:00', end: '18:00', everyMinutes: 60 },
    effort: 'low',
    model: 'openai-codex/gpt-6-luna',
    cwd: '/Users/sample/notes',
    context: ['people.md'],
    prompt:
      'Look at the mail that arrived since the last check. Tell me only about mail from a person that needs an answer from me today, with one line on what they need.\n\nNewsletters, receipts and anything automatic are never worth a report.',
    memory:
      '# Inbox watch\n\n- Last message seen: the one from Dana at 16:52, "Numbers for Thursday".\n- Never report: GitHub notifications, calendar invites, anything from no-reply addresses.\n- The user answers Lisbon mail first thing, so those can wait for the morning.\n- Waiting on an answer: Priya (contract dates), since Tuesday.\n',
    report: 'Useful: Dana needs the rate limiter numbers before Thursday 14:00.\n\nOne mail needs you today:\n\n- **Dana**, 16:52, "Numbers for Thursday". She wants p95 and p99 for the new limiter, before the 1:1.\n\nEverything else since 16:00 was automatic.',
    past: [
      quiet(21, 0.02),
      useful('Dana needs the rate limiter numbers before Thursday 14:00.', 47, 0.05),
      quiet(19, 0.02),
      quiet(22, 0.02),
      quiet(20, 0.02),
      useful('Priya asks for the contract dates today.', 44, 0.05),
      quiet(18, 0.02),
      quiet(23, 0.02),
      quiet(21, 0.02),
      quiet(19, 0.02),
      useful('2 people wait on you: Sam and Priya.', 51, 0.06),
      quiet(20, 0.02),
      quiet(22, 0.02),
      quiet(18, 0.02),
      quiet(24, 0.02),
      quiet(20, 0.02),
    ],
  },
  {
    id: 'review-queue',
    title: 'Review queue',
    cadence: 'daily',
    at: ['10:30', '15:30'],
    effort: 'medium',
    cwd: '/Users/sample/dev/storefront',
    prompt:
      'List the pull requests waiting on my review in storefront and billing-api, oldest first, with how long each has waited and how big it is.\n\nSay which one to do first and why. A review that has waited more than two days comes first.',
    memory: '# Review queue\n\n- Repos: storefront, billing-api.\n- Waiting longest: billing-api #412 "Retry webhooks with backoff", 3 days.\n- The user reviews small ones before lunch and large ones after.\n- #398 was approved on Monday. Do not list it again.\n',
    report: 'Useful: 3 reviews wait on you. Start with billing-api #412, it has waited 3 days.\n\n1. **billing-api #412** Retry webhooks with backoff. 3 days, 214 lines.\n2. **storefront #1187** Guard the login redirect. 1 day, 62 lines.\n3. **storefront #1190** Tidy the cart totals. 4 hours, 31 lines.',
    past: [
      useful('3 reviews wait on you. Start with billing-api #412, it has waited 3 days.', 58, 0.11),
      useful('2 reviews wait on you.', 49, 0.1),
      quiet(27, 0.04),
      useful('1 review waits on you.', 44, 0.09),
      quiet(26, 0.04),
      cutShort('Stopped after 40 turns without a report.', 312, 0.61),
      useful('4 reviews wait on you. Two are over two days old.', 66, 0.13),
      quiet(28, 0.04),
      useful('2 reviews wait on you.', 47, 0.1),
      quiet(25, 0.04),
      quiet(27, 0.04),
      useful('1 review waits on you.', 42, 0.09),
    ],
  },
  {
    id: 'end-of-day',
    title: 'End of day',
    cadence: 'daily',
    at: '18:30',
    effort: 'medium',
    cwd: '/Users/sample/notes',
    context: ['today.md'],
    prompt:
      "Read today's reports with `hobkin reports`, the notes in today.md and the day's commits under ~/dev. Say what got done, what is still open and what moves to tomorrow.\n\nKeep it to one screen. End with the one thing to start with tomorrow.",
    memory: '# End of day\n\n- Open since Friday: the invoice export review.\n- At most five lines under "done". The user asked twice.\n- Tomorrow starts with: reply to the Lisbon team about the rate limiter.\n',
    report:
      'Useful: 4 things done, 2 still open.\n\n**Done**\n\n- The login redirect fix is merged.\n- Webhook retries reviewed and sent back with two notes.\n- Contract dates sent to Priya.\n- Disk: 1.2 GB of old build output removed.\n\n**Still open**\n\n- The invoice export review, since Friday.\n- Numbers for Dana, due Thursday 14:00.\n\nStart tomorrow with the numbers for Dana.',
    past: [
      useful('4 things done, 2 still open.', 84, 0.18),
      useful('3 things done, 3 still open.', 79, 0.17),
      useful('5 things done, 1 still open.', 91, 0.19),
      failed('Pi exited with code 1.', 6),
      useful('2 things done, 4 still open.', 77, 0.16),
      useful('4 things done, 2 still open.', 82, 0.18),
      useful('6 things done, nothing open.', 88, 0.19),
      useful('3 things done, 2 still open.', 80, 0.17),
      useful('1 thing done, 5 still open.', 74, 0.16),
    ],
  },
  {
    id: 'lisbon-handoff',
    title: 'Lisbon handoff',
    cadence: 'daily',
    at: '17:30',
    timezone: 'Europe/Lisbon',
    effort: 'medium',
    cwd: '/Users/sample/dev/billing-api',
    prompt:
      'When the Lisbon team ends its day, read what they merged, what they left open and what they asked in the team channel. Say what needs me before they are back tomorrow.\n\nTimes in the report are Lisbon times.',
    memory: '# Lisbon handoff\n\n- Runs at 17:30 in Lisbon, the end of their day.\n- Team: Rui, Marta, Tiago.\n- Open question from Marta since Monday: which region gets the limiter first.\n- They deploy on Tuesdays and Thursdays before 16:00 their time.\n',
    report: 'Useful: Marta still waits for the region decision. Nothing else needs you tonight.\n\n- Merged today in Lisbon: the limiter config loader, the retry metrics.\n- Left open: the rollout plan, waiting on the region.\n- Asked in the channel at 16:40: "Which region first, EU or US?"',
    past: [
      useful('Marta still waits for the region decision. Nothing else needs you tonight.', 69, 0.13),
      quiet(31, 0.04),
      useful('Tiago asks for a review of the metrics change before Thursday.', 63, 0.12),
      useful('The Tuesday deploy went out. One alert fired and cleared.', 71, 0.14),
      quiet(29, 0.04),
      quiet(33, 0.04),
      useful('Rui left a question about the retry limits.', 60, 0.12),
      quiet(30, 0.04),
    ],
  },
  {
    id: 'morning-brief',
    title: 'Morning brief',
    cadence: 'weekly',
    weekday: [1, 2, 3, 4, 5],
    at: '08:15',
    effort: 'medium',
    cwd: '/Users/sample/notes',
    context: ['today.md', 'projects/current.md'],
    prompt:
      "Read my calendar for today's meetings and what each one needs, and the code host for the reviews waiting on me and my own work that is stuck. Read the notes the other routines keep for what is left from yesterday.\n\nKeep it all to one screen. End with at most two things I set aside that come due before the next brief. On Fridays, look ahead through Monday.",
    memory: '# Morning brief\n\n- One screen. The user reads it on the phone first.\n- Set aside: the muted disk alert (look again Friday), a promise to answer Priya by Wednesday.\n- Yesterday left open: the invoice export review.\n- Meeting prep is held, so meetings come from the calendar summary only until it is back.\n',
    report: 'Useful: 2 meetings, 3 reviews waiting, 1 thing stuck.\n\n**Today**\n\n- 11:00 Planning, 45 min. Bring the limiter rollout plan.\n- 14:00 Dana, 30 min. She wants p95 and p99.\n\n**Waiting on you**\n\n- billing-api #412, 3 days.\n- storefront #1187 and #1190.\n\n**Stuck**\n\n- The invoice export: the test database is missing two fixtures.\n\nDue before the next brief: answer Priya.',
    past: [
      useful('2 meetings, 3 reviews waiting, 1 thing stuck.', 102, 0.22),
      useful('1 meeting, 2 reviews waiting.', 94, 0.2),
      useful('3 meetings, 1 review waiting.', 99, 0.21),
      critical('The Thursday deploy is blocked by a failing check on main.', 108, 0.23),
      useful('2 meetings, nothing waiting.', 90, 0.19),
      useful('No meetings. 2 reviews waiting.', 86, 0.18),
      useful('4 meetings, 1 review waiting.', 104, 0.22),
      useful('1 meeting, 1 thing stuck.', 91, 0.19),
      useful('2 meetings, 2 reviews waiting.', 97, 0.2),
      useful('3 meetings, nothing waiting.', 95, 0.2),
    ],
  },
  {
    id: 'dependency-watch',
    title: 'Dependency watch',
    cadence: 'weekly',
    weekday: 2,
    at: '10:00',
    effort: 'medium',
    cwd: '/Users/sample/dev/billing-api',
    context: ['package.json'],
    prompt:
      "In billing-api, use the package manager's own commands, `pnpm outdated` and `pnpm audit`, to find packages that are outdated or have a known vulnerability.\n\nFor each one, give the upgrade that fixes it: the version to move to, and whether it is a major upgrade. Put vulnerable packages first.",
    memory: '# Dependency watch\n\n- Project: billing-api, pnpm.\n- Held back on purpose: typescript stays on 6.x until the build tooling moves.\n- Reported last week and not yet taken: ws 8.22.2 (fixes a denial of service).\n- The user takes minor upgrades in one batch on Fridays.\n',
    report: 'Useful: 1 vulnerable package, 4 outdated.\n\n**Vulnerable**\n\n- `ws` 8.21.0 to 8.22.2. Minor. Fixes a denial of service on large frames.\n\n**Outdated**\n\n- `zod` 4.1 to 4.3. Minor.\n- `vite` 8.2 to 8.3. Minor.\n- `pino` 9 to 10. Major: the transport options moved.\n- `typescript` 6.4 to 7.0. Major, held back on purpose.',
    past: [
      useful('1 vulnerable package, 4 outdated.', 143, 0.31),
      useful('5 outdated, none vulnerable.', 131, 0.28),
      quiet(74, 0.12),
      useful('2 outdated, none vulnerable.', 122, 0.26),
      useful('1 vulnerable package, 2 outdated.', 139, 0.3),
      quiet(70, 0.11),
      useful('3 outdated, none vulnerable.', 127, 0.27),
      quiet(72, 0.12),
    ],
  },
  {
    id: 'weekly-review',
    title: 'Weekly review',
    cadence: 'weekly',
    weekday: 5,
    at: '16:00',
    effort: 'high',
    model: 'openai-codex/gpt-6.1-sol',
    cwd: '/Users/sample/notes',
    context: ['weekly-plan.md'],
    prompt:
      "Read this week's reports with `hobkin reports` and my notes. Say what shipped, what I unblocked and what slipped, each with the report or link that shows it.\n\nIf the weekly plan named the outcome that matters most this week, start with how the week went against it.",
    memory: '# Weekly review\n\n- The plan named one outcome for this week: the rate limiter in one region.\n- Last week slipped: the invoice export, for the second week.\n- The user forwards this to Dana on Friday, so no private notes in it.\n',
    report: 'Useful: The limiter shipped to staging, not to a region. 6 things shipped, 2 slipped.\n\n**Against the plan**\n\nThe outcome was the limiter live in one region. It reached staging on Wednesday and waits on the region decision.\n\n**Shipped**\n\n- The login redirect fix.\n- Webhook retries with backoff.\n- The limiter config loader.\n\n**Slipped**\n\n- The invoice export, third week.\n- The install guide refresh.',
    past: [
      useful('The limiter shipped to staging, not to a region. 6 things shipped, 2 slipped.', 248, 0.84),
      useful('5 things shipped, 1 slipped.', 231, 0.79),
      useful('4 things shipped, 2 slipped.', 226, 0.77),
      cutShort('Ran out of turns while reading the reports.', 402, 1.32),
      useful('7 things shipped, nothing slipped.', 239, 0.81),
      useful('3 things shipped, 3 slipped.', 220, 0.75),
      useful('5 things shipped, 2 slipped.', 233, 0.8),
    ],
  },
  {
    id: 'money',
    title: 'Money check',
    cadence: 'monthly',
    day: 1,
    at: '09:30',
    effort: 'medium',
    cwd: '/Users/sample/notes/money',
    context: ['subscriptions.md'],
    prompt:
      'On the first of the month, read subscriptions.md and the card statement export in this folder. List every subscription that renews this month with its price, and anything that went up since last month.\n\nNever move money and never cancel anything. Only report.',
    memory: '# Money check\n\n- 14 subscriptions tracked. Total last month: $312.40.\n- Went up in October: the design tool, from $12 to $15.\n- Yearly ones this quarter: the domain (Nov 20), the password manager (Dec 3).\n- The statement export is a CSV dropped here by hand on the last day of the month.\n',
    report: 'Useful: 3 renewals this month, and one price went up.\n\n| Renews | What | Price |\n| --- | --- | --- |\n| Nov 4 | Music | $11.99 |\n| Nov 20 | Domain, yearly | $18.00 |\n| Nov 27 | Design tool | $15.00, was $12.00 |\n\nTotal for November so far: $327.39.',
    past: [
      useful('3 renewals this month, and one price went up.', 118, 0.24),
      useful('2 renewals this month.', 104, 0.21),
      useful('4 renewals this month. One yearly.', 121, 0.25),
      failed('No statement export found in the folder.', 9),
      useful('2 renewals this month.', 101, 0.21),
      useful('3 renewals this month.', 110, 0.22),
      useful('1 renewal this month.', 96, 0.2),
      useful('2 renewals this month.', 103, 0.21),
    ],
  },
  {
    id: 'paperwork',
    title: 'Paperwork',
    cadence: 'monthly',
    day: 15,
    at: '10:00',
    enabled: false,
    effort: 'low',
    cwd: '/Users/sample/notes/paperwork',
    prompt:
      'In the middle of the month, read the folder for forms and letters with a date on them. List the ones due in the next 30 days, soonest first, with what each one needs from me.\n\nOnly read. Never send or sign anything.',
    memory: '# Paperwork\n\n- Turned off in September: the user said the list was always the same three things.\n- Still true when it stopped: the passport expires in March, the lease renews in January.\n- If turned on again, start from the scans added since September.\n',
    report: 'Useful: 2 things due in the next 30 days.\n\n- **Sep 30** Car insurance renewal. Needs the mileage.\n- **Oct 10** Tax installment. Needs nothing, it is automatic.',
    // Off since the autumn: the last two times it was due, it did not run.
    past: [null, null, useful('2 things due in the next 30 days.', 64, 0.08), quiet(31, 0.04), useful('3 things due in the next 30 days.', 70, 0.09), quiet(29, 0.04), useful('1 thing due in the next 30 days.', 58, 0.07), quiet(30, 0.04), useful('2 things due in the next 30 days.', 62, 0.08)],
  },
  {
    id: 'launch-day',
    title: 'Launch day watch',
    cadence: 'once',
    window: { start: '09:00', end: '18:00', everyMinutes: 30 },
    effort: 'medium',
    cwd: '/Users/sample/dev/storefront',
    context: ['docs/launch-checklist.md'],
    prompt:
      'On launch day, every half hour, read the error log, the status page and the launch checklist. Say only what changed since the last check and what needs a person.\n\nIf the error rate doubles from one check to the next, start the report with "Critical:".',
    memory: '# Launch day watch\n\n- Not run for real yet. Six tries by hand while setting it up.\n- The error log needs the read-only token, which is in place since the fourth try.\n- Baseline from the tries: about 0.2% errors, 180 ms median.\n- The checklist has 11 lines, 7 checked.\n',
    report: 'Useful: Dry run. The log and the status page both read fine.\n\n- Error rate: 0.2%, steady.\n- Median response: 180 ms.\n- Checklist: 7 of 11 checked. Open: the rollback note, the announcement, two smoke tests.',
    past: [],
    byHand: [
      { hoursAgo: 2.6, run: useful('Dry run. The log and the status page both read fine.', 57, 0.11) },
      { hoursAgo: 3.1, run: quiet(34, 0.05) },
      { hoursAgo: 26.2, run: useful('Dry run. The checklist reads, 7 of 11 checked.', 61, 0.12) },
      { hoursAgo: 27, run: failed('The error log answered 403. The token has no read scope.', 8) },
      { hoursAgo: 50.5, run: failed('The error log answered 403. The token has no read scope.', 7) },
      { hoursAgo: 51, run: cutShort('Stopped before the status page loaded.', 95, 0.17) },
    ],
  },
]

const TEMPLATES: RoutineTemplate[] = [
  {
    id: 'morning-brief',
    title: 'Morning brief',
    summary: "Today's meetings and what each needs, the reviews waiting, stuck work and what is left from yesterday, on one screen.",
    recurrence: 'Weekday mornings',
    group: 'day',
    fits: 'Someone who wants one look in the morning to know what today holds.',
    needs: ['calendar', 'code host'],
    effort: 'medium',
    asks: null,
  },
  {
    id: 'end-of-day',
    title: 'End of day',
    summary: 'What got done today, what is still open and what moves to tomorrow.',
    recurrence: 'Weekday evenings',
    group: 'day',
    fits: 'Someone who wants to close the day knowing where things stand.',
    needs: [],
    effort: 'medium',
    asks: null,
  },
  {
    id: 'dependency-watch',
    title: 'Dependency watch',
    summary: 'Outdated or vulnerable packages in a project, and the upgrade that fixes each one.',
    recurrence: 'Weekly',
    group: 'code',
    fits: 'Someone who maintains a project and wants to hear about risky packages without checking by hand.',
    needs: [],
    effort: 'medium',
    asks: 'Which project should it watch?',
  },
  {
    id: 'weekly-review',
    title: 'Weekly review',
    summary: "What shipped, what got unblocked and what slipped this week, built from the week's reports and notes.",
    recurrence: 'The last working day of the week',
    group: 'week',
    fits: 'Someone who ends the week unsure what they got done, or who has to report on it.',
    needs: [],
    effort: 'high',
    asks: null,
  },
  {
    id: 'disk-space',
    title: 'Disk space',
    summary: 'What takes space on the machine, such as caches, build output and old worktrees, and what could go.',
    recurrence: 'Daily, early in the morning',
    group: 'machine',
    fits: 'Someone whose disk keeps filling up with things they forget to clear.',
    needs: [],
    effort: 'medium',
    asks: 'Which folders should it look at, and what may it remove on its own?',
  },
  {
    id: 'important-dates',
    title: 'Important dates',
    summary: 'Birthdays, renewals and deadlines coming up, early enough to do something about them.',
    recurrence: 'Weekly',
    group: 'life',
    fits: 'Someone who remembers a date the day after it passed.',
    needs: ['calendar'],
    effort: 'low',
    asks: null,
  },
]

/** The sample's one broken file: a setting hobkin does not know. hobkin's loader starts the message with the path. */
function sampleErrors(): DefinitionError[] {
  const path = `${SAMPLE_HOME}/routines/weekly/reading-list.md`
  return [{ path, message: `${path}: unknown setting: schedule` }]
}

/** One line of a log, for a run that finished at `finished`. */
function lineFor(run: PastRun, finished: number, trigger: 'scheduled' | 'manual'): RunLine {
  return {
    finishedAt: new Date(finished).toISOString(),
    trigger,
    status: run.status,
    seconds: run.seconds,
    usd: run.usd,
    summary: run.summary,
  }
}

/** A log from the times the routine was due before now, newest first, one outcome for each. */
function logFromPast(routine: Routine, past: Past[], now: number): RunLine[] {
  // Far enough back for a monthly routine's last dozen dates.
  const due = occurrencesBetween({ ...routine, enabled: true }, now - 400 * DAY, now).toReversed()
  const lines: RunLine[] = []

  for (const [index, run] of past.entries()) {
    const occurrence = due[index]
    if (!occurrence || !run) continue

    // hobkin starts a run on its next tick after the time, a few seconds late.
    const lateBy = (4 + ((index * 13) % 40)) * 1000
    const finished = occurrence.at + lateBy + run.seconds * 1000
    if (finished >= now) continue

    lines.push(lineFor(run, finished, 'scheduled'))
  }
  return lines.toReversed()
}

function logByHand(byHand: NonNullable<Seed['byHand']>, now: number): RunLine[] {
  return byHand.map(({ hoursAgo, run }) => lineFor(run, now - Math.round(hoursAgo * HOUR), 'manual')).toReversed()
}

/** A seed as hobkin's loader would return its file. */
function routineFrom(seed: Seed, now: number, homeZone: string): Routine {
  const { memory: _memory, report: _report, past: _past, byHand: _byHand, timezone = homeZone, enabled = true, context = [], model = null, ...definition } = seed
  const routine: Routine = {
    ...definition,
    timezone,
    enabled,
    harness: 'pi',
    model,
    context,
    path: `${SAMPLE_HOME}/routines/${definition.cadence}/${definition.id}.md`,
  }
  // The one-time routine is always three days ahead, on the calendar of its own timezone.
  if (routine.cadence === 'once') routine.date = dateText(addDays(wallTime(timezone, now), 3))
  return routine
}

/** The whole sample at a moment, for someone whose routines mostly run in `homeZone`. */
export function buildSample(now: number, homeZone: string): RoutinesData {
  const data: RoutinesData = {
    routines: [],
    errors: sampleErrors(),
    logs: {},
    memory: {},
    reports: {},
    running: {},
    changedAt: {},
    templates: TEMPLATES,
  }

  for (const seed of SEEDS) {
    const routine = routineFrom(seed, now, homeZone)
    const lines = seed.byHand ? logByHand(seed.byHand, now) : logFromPast(routine, seed.past, now)

    data.routines.push(routine)
    // Through hobkin's own format and back, as the host's data will come.
    data.logs[routine.id] = parseLog(lines.map(logLine).join('\n'))
    data.memory[routine.id] = seed.memory
    if (seed.report) data.reports[routine.id] = seed.report
  }

  // One is always in the middle of a run, started by hand a few minutes ago.
  data.running['dependency-watch'] = { startedAt: now - 3 * MINUTE - 14_000, trigger: 'manual' }
  return data
}

/** What a sample run brings back when it finishes, in turn, so pressing Run now a few times shows more than one outcome. */
export const SAMPLE_OUTCOMES: { status: RunStatus; usd: number | null; summary: string; report?: string }[] = [
  { status: 'completed', usd: 0.12, summary: 'Useful: Sample run. Two things changed since the last one.', report: 'Useful: Sample run. Two things changed since the last one.\n\nThis report is sample text. With the host wired, it is what the routine wrote on this run.' },
  { status: 'no_change', usd: 0.03, summary: 'Nothing new.' },
  { status: 'completed', usd: 0.14, summary: 'Useful: Sample run. One thing needs you today.', report: 'Useful: Sample run. One thing needs you today.\n\nThis report is sample text. With the host wired, it is what the routine wrote on this run.' },
  { status: 'failed', usd: null, summary: 'Sample failure: Pi exited with code 1.' },
]

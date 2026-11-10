import type { Report } from './report.ts'

/**
 * Sample reports, shaped as hobkin lists them, until the host supplies hobkin's own (012-reports-actions).
 * Scheduled reports come from routines. A `work.` schedule is work mode, so those count as work done.
 * Times are counted back from when the app opened, so the days read the same whenever it runs.
 */

const NOW = Date.now()
const MINUTE_MS = 60_000
const FENCE = '```'

/** A time `daysAgo` days back at the given hour. Earlier today than now, or moved to just before now. */
function when(daysAgo: number, hour: number, minute: number): string {
  const day = new Date(NOW)
  day.setDate(day.getDate() - daysAgo)
  day.setHours(hour, minute, 0, 0)
  // A sample time later than now would be from the future. It moves to the last minutes, in the same order.
  const latest = NOW - (24 * 60 - (hour * 60 + minute)) * (MINUTE_MS / 60)
  return new Date(Math.min(day.getTime(), latest)).toISOString()
}

export const sampleReports: Report[] = [
  {
    id: 'run-morning-recap-today',
    title: 'Morning recap',
    scheduleId: 'morning-recap',
    at: when(0, 7, 2),
    outcome: 'completed',
    body: `Useful: Three things are worth a look before the first meeting.
Next: Read the dependency look before the 10:00 standup.

## Overnight

- The status line change for **hobkin** finished with its tests passing. It waits in Action Items for a merge decision.
- A look at **billing-api** filed 4 items in the queue.
- The dependency look found a [security advisory](https://example.com/advisories/jsonwebtoken) that affects billing-api.

## Today

| Time | What | To prepare |
| --- | --- | --- |
| 10:00 | Standup | Nothing |
| 13:30 | Pricing review | Read the [pricing draft](https://example.com/docs/pricing-draft) |
| 16:00 | One to one | Two notes from last week are still open |

## Waiting on you

1. Merge the status line change, or read it first.
2. Say which Stripe test key the checkout test should use.`,
  },
  {
    id: 'run-inbox-sweep-today',
    title: 'Inbox sweep',
    scheduleId: 'inbox-sweep',
    at: when(0, 6, 40),
    outcome: 'completed',
    body: `Useful: Two emails need a reply today, and 14 were archived.

## Needs a reply

- **The venue** asks to confirm the room for Thursday by noon.
- **The accountant** needs the October receipts. They are in the shared folder, so the reply can be one line.

## Archived

| Sender | Count | Why |
| --- | ---: | --- |
| GitHub notifications | 9 | Already seen in the app |
| Newsletters | 4 | Not opened in a month |
| Calendar updates | 1 | The change is already on the calendar |

Nothing was deleted. Archived mail is under the **Swept** label.`,
  },
  {
    id: 'run-dependency-look-today',
    title: 'Dependency look',
    scheduleId: 'dependency-look',
    at: when(0, 5, 15),
    outcome: 'completed',
    body: `Critical: billing-api locks a version of jsonwebtoken with a known signature bypass.
Next: Upgrade to 9.0.3 and rerun the auth tests. It is a patch release.

## What was found

The advisory covers every version before **9.0.3**. billing-api locks **9.0.1**.

${FENCE}sh
$ pnpm why jsonwebtoken
billing-api 2.4.0
  jsonwebtoken 9.0.1
${FENCE}

## The fix

${FENCE}sh
pnpm up jsonwebtoken@9.0.3
pnpm test --filter auth
${FENCE}

The changelog lists no breaking changes between 9.0.1 and 9.0.3. Read the [advisory](https://example.com/advisories/jsonwebtoken) and the [changelog](https://example.com/jsonwebtoken/changelog).

## Not affected

- storefront does not use jsonwebtoken.
- docs-site has no server code.`,
  },
  {
    id: 'run-calendar-prep-today',
    title: 'Calendar prep',
    scheduleId: 'calendar-prep',
    at: when(0, 6, 0),
    outcome: 'completed',
    body: `Nothing new

Checked tomorrow's calendar against open threads. No meeting needs anything prepared.`,
  },
  {
    id: 'run-say-what-hobkin-is-doing',
    title: 'Say what the main agent is doing, above the input',
    scheduleId: 'work.hobkin.do',
    at: when(0, 3, 12),
    outcome: 'completed',
    body: `Useful: The main agent's doing word now shows above the input, with how long the turn has run.
Next: Read it in Change Review, then merge it from Action Items.

## What changed

- A status line above the input says in one word what hobkin is doing: thinking, writing, working or researching.
- The line shows how long the turn has run, and goes away when the turn ends.
- Nothing else in the chat moved.

## Proof

| Test | Result |
| --- | --- |
| \`the doing word follows the turn\` | passed |
| \`the clock stops when the turn ends\` | passed |
| \`no line while idle\` | passed |

${FENCE}ts
export function doingWord(turn: Turn): string | null {
  return turn.busy ? (WORDS[turn.kind] ?? 'working') : null
}
${FENCE}

Branch \`hobkin/7d02c9-say-what-hobkin-is-doing\`: 111 lines added and 2 removed, in 9 files.`,
  },
  {
    id: 'run-status-watch-yesterday',
    title: 'Status page watch',
    scheduleId: 'status-watch',
    at: when(1, 22, 10),
    outcome: 'completed',
    body: `Blocked: The vendor's status page now asks for a login, so the check cannot read it.
Next: Sign in once in the browser hobkin uses, or give the routine a read-only token.

## What happened

Since 21:00 the page at [status.example.com](https://status.example.com) answers with a sign-in form instead of the list of incidents. The routine stopped rather than report on a page it could not read.

## What it checks

- Open incidents for the payments API
- Maintenance planned for this week
- Uptime over the last 30 days`,
  },
  {
    id: 'run-redirect-loop',
    title: 'Fix the login redirect loop',
    scheduleId: 'work.storefront.do',
    at: when(1, 19, 40),
    outcome: 'completed',
    body: `Blocked: The checkout test needs a Stripe test key, and none is in the repo.
Next: Say which key to use. The question waits in Action Items.

## Where it stopped

The redirect fix itself is done, and its 14 tests pass. The checkout test covers the same flow, calls Stripe, and fails without a key:

${FENCE}text
Error: No API key provided. Set STRIPE_TEST_KEY.
    at checkout.test.ts:41
${FENCE}

## Two ways on

1. Use the team's shared test key from the password manager.
2. Create a restricted key for this repo only.`,
  },
  {
    id: 'run-billing-look',
    title: 'Look for work in billing-api',
    scheduleId: 'work.billing-api.look',
    at: when(1, 15, 20),
    outcome: 'completed',
    body: `Useful: Found 4 things worth doing in billing-api, and filed them in the queue.

## Filed

1. **Retry failed webhooks with backoff.** Three customers got duplicate emails last week.
2. **Upgrade jsonwebtoken to 9.0.3.** See this morning's dependency look.
3. **Split the invoices module.** It is 2,400 lines long, and every change touches it.
4. **Delete the unused v1 routes.** Nothing has called them in 90 days.

## Left alone

- The flaky \`refund settles\` test. It failed once in 200 runs, not enough to chase.`,
  },
  {
    id: 'run-weekly-spend',
    title: 'Weekly spend',
    scheduleId: 'weekly-spend',
    at: when(1, 9, 0),
    outcome: 'completed',
    body: `Useful: Routines used 18% fewer tokens than the week before.

| Routine | Runs | Tokens | Change |
| --- | ---: | ---: | ---: |
| Morning recap | 7 | 1.9M | 4% fewer |
| Inbox sweep | 14 | 3.2M | 22% fewer |
| Dependency look | 7 | 2.4M | 31% fewer |
| Status page watch | 42 | 0.6M | 2% more |

Inbox sweep got cheaper once it stopped reading newsletters in full. Work mode is not in this table: it has its own budget, in Settings.`,
  },
  {
    id: 'run-weekly-review',
    title: 'Weekly review',
    scheduleId: 'weekly-review',
    at: when(1, 18, 0),
    outcome: 'completed',
    body: `Useful: A good week for work mode, a slow one for the inbox, and one risk to settle before Friday.
Next: Decide on the webhook retry branch. It has waited three days.

## Work mode

Five items finished, two are waiting on you, and one stopped early.

| Project | Finished | Waiting on you | Stopped |
| --- | ---: | ---: | ---: |
| hobkin | 2 | 1 | 0 |
| billing-api | 1 | 1 | 0 |
| storefront | 1 | 0 | 0 |
| docs-site | 0 | 0 | 1 |
| orchard | 1 | 0 | 0 |

The two waiting on you are the status line change for **hobkin** and the webhook secret for **billing-api**. Both are in Action Items.

## Routines

- **Morning recap** ran every day. 5 of its 7 reports were opened.
- **Inbox sweep** archived 61 emails and asked about 3. None were wrong.
- **Status page watch** has been blocked since Monday night. It needs a login.
- **Reading list** found something on 2 of 7 days. hobkin asks in Action Items whether it should run weekly.

## Spend

Routines used 9.4M tokens and work mode 31M, inside the daily budget on every day but Tuesday:

${FENCE}text
Mon  4.1M  ######
Tue 12.8M  ####################
Wed  6.0M  #########
Thu  5.2M  ########
Fri  4.9M  #######
${FENCE}

Tuesday was the orchard change, which read every ledger file twice.

## Risks

1. **The webhook retry branch** charges twice when the provider answers late. It must not merge as it is.
2. **jsonwebtoken** in billing-api has a known bypass. The upgrade is queued, and it is a patch release.
3. **The backup check** failed once on Saturday. One failure is not a pattern yet.

## Next week

- Settle the two items waiting on you.
- Give the status page watch a read-only token.
- Let work mode take the jsonwebtoken upgrade first.

Read last week's review in [the archive](https://example.com/hobkin/reviews).`,
  },
  {
    id: 'run-morning-recap-yesterday',
    title: 'Morning recap',
    scheduleId: 'morning-recap',
    at: when(1, 7, 1),
    outcome: 'completed',
    body: `Useful: A quiet night, with one thing to decide.

- The status page watch is blocked. It needs a login.
- Nothing finished in work mode.

## Today

| Time | What |
| --- | --- |
| 09:30 | Design review |
| 15:00 | Dentist |`,
  },
  {
    id: 'run-backup-check',
    title: 'Backup check',
    scheduleId: 'backup-check',
    at: when(2, 3, 0),
    outcome: 'failed',
    body: `The run stopped: the backup bucket did not answer within 60 seconds.

It tries again at 03:00 tomorrow. If it fails twice in a row, hobkin says so in the conversation.

${FENCE}text
GET https://backups.example.com/nightly/latest.tar.zst
timed out after 60000 ms
${FENCE}`,
  },
  {
    id: 'run-orchard-books',
    title: "Keep the orchard's books by season",
    scheduleId: 'work.orchard.do',
    at: when(2, 16, 45),
    outcome: 'completed',
    body: `Useful: The orchard's ledger now groups income and costs by season, with a report for each.
Next: It is a large change. Review it before you merge it.

## What changed

- A season table with spring, summer, autumn and winter, and the dates each one covers.
- Every ledger entry gets its season when it is saved.
- A seasonal report shows income, costs and the balance side by side.

Branch \`hobkin/5e77a1-keep-the-orchard-books\`: 5,216 lines added and 55 removed, in 14 files.`,
  },
  {
    id: 'run-retry-webhooks',
    title: 'Retry failed webhooks',
    scheduleId: 'work.billing-api.do',
    at: when(3, 14, 5),
    outcome: 'completed',
    body: `Critical: In the sandbox, the retry charged one test customer twice.
Next: Do not merge this branch. It stays for you to read.

## What happened

The retry runs when the payment provider answers slowly. In one run the first attempt went through late, and the retry charged again.

| Attempt | Sent | Provider answered | Result |
| --- | --- | --- | --- |
| 1 | 14:02:11 | 14:02:41 | Charged |
| 2 | 14:02:31 | 14:02:33 | Charged again |

## What it needs

An idempotency key on each charge, so the provider drops the second one. That is a change to the payment client, which this item was not allowed to touch.`,
  },
  {
    id: 'run-release-watch',
    title: 'Release notes watch',
    scheduleId: 'release-watch',
    at: when(3, 11, 30),
    outcome: 'completed',
    body: `## Tauri 2.12

- Fixes the window drag region on macOS when the window has no title bar.
- Adds a way to move the traffic lights at runtime.

## Vite 8.3

- Faster cold starts for projects with many CSS files.

Release pages: [Tauri](https://example.com/tauri/releases) and [Vite](https://example.com/vite/releases).`,
  },
  {
    id: 'run-discover',
    title: 'Look for projects',
    scheduleId: 'work.discover',
    at: when(3, 9, 0),
    outcome: 'completed',
    body: `**Nothing new.**

No new project folder under ~/Projects since the last look.`,
  },
  {
    id: 'run-docs-links',
    title: 'Fix broken links on the docs site',
    scheduleId: 'work.docs-site.do',
    at: when(4, 17, 30),
    outcome: 'incomplete',
    body: `Fixed 31 of 38 broken links. The run reached its time limit before the rest.

## Still broken

- \`/guides/billing\` points to a page that was removed in March.
- Six links to the old API reference. The new reference has no matching pages yet.

The fixed links are on the branch \`hobkin/a41c07-fix-docs-links\`.`,
  },
  {
    id: 'run-reading-list',
    title: 'Reading list',
    scheduleId: 'reading-list',
    at: when(4, 8, 0),
    outcome: 'completed',
    body: `Nothing new.

None of the 12 followed blogs posted since Monday.`,
  },
]

/** What was already read when the sample opens. */
export const sampleRead: string[] = [
  'run-calendar-prep-today',
  'run-billing-look',
  'run-weekly-spend',
  'run-morning-recap-yesterday',
  'run-retry-webhooks',
  'run-release-watch',
  'run-discover',
  'run-docs-links',
  'run-reading-list',
]

// Demo shots only. Made-up agents at work, added on top of what the scripted demo host sends, because a scripted host
// runs no agent. They speak the host's own wire shapes (`shared/protocol`), so the window draws them as it would draw
// real ones: runs in `runs`, durable hobkins in `hobkins`, their steps as `activity`, and the answers their pages ask
// for (`hobkin.read`, `activity.before`, `agent.notes`). Every name, folder and line here is invented.
//
// A scripted host runs no change review either, so the finished changes the seed graded through hobkin's own door for
// a review's grades (`recordGrades`) would still say "Not reviewed yet". For those alone, and at the commit they were
// graded at, the host's own answer to `review.status` gets the finished change review those grades came from.
import type { ActivityEntry, ActivityStep } from '#shared/protocol/activity.ts'
import type { HobkinConversation, HobkinSummary, HobkinTurn } from '#shared/protocol/hobkins.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import type { FinishedGroup } from '#shared/protocol/work.ts'
import type { AssessmentStatus } from '#shared/review/assessment.ts'

const NOW = Date.now()
const MIN = 60_000
const ago = (minutes: number) => NOW - minutes * MIN
const iso = (ms: number) => new Date(ms).toISOString()
/** The throwaway projects the seed makes (`scripts/demo/seed.ts`). */
const CODE = '/private/tmp/hobkin-demo/code'

// ---------------------------------------------------------------------------------------------------------------
// Steps, in the shapes hobkin keeps them (`src/cli/job-activity.mjs`).

let counter = 0
const say = (text: string, minutesAgo: number): ActivityEntry => ({ id: `message:${counter++}:0`, kind: 'assistant', text, at: ago(minutesAgo) })
const tool = (name: string, args: object, output: string, minutesAgo: number, state: ActivityEntry['state'] = 'completed'): ActivityEntry => ({
  id: `tool:call_demo_${counter++}`,
  kind: 'tool',
  name,
  state,
  input: JSON.stringify(args, null, 2),
  output,
  at: ago(minutesAgo),
})

const taskList = (rows: [string, 'completed' | 'in_progress' | 'pending', string][], minutesAgo: number) =>
  tool('task_list', {}, `${rows.map(([id, state, title]) => `#${id} [${state}] ${title}`).join('\n')}\n\nExecution queue: ${rows.filter(([, state]) => state !== 'completed').map(([id]) => `#${id}`).join(', ')}`, minutesAgo)

const BUCKET_TS = `import type { Clock } from '../clock.ts'

export interface BucketOptions {
  /** Requests a key may make in one burst. */
  capacity: number
  /** Requests a key earns back each second. */
  refillPerSecond: number
}

export class TokenBucket {
  private tokens: number
  private updatedAt: number

  constructor(private readonly options: BucketOptions, private readonly clock: Clock) {
    this.tokens = options.capacity
    this.updatedAt = clock.now()
  }

  take(cost = 1): boolean {
    this.refill()
    if (this.tokens < cost) return false
    this.tokens -= cost
    return true
  }
}`

const LIMITS_TEST_OUT = ` RUN  v3.2.4 /atlas-api

 ✓ test/limits/bucket.test.ts (9 tests) 14ms
 ✓ test/limits/keys.test.ts (6 tests) 9ms
 ✓ test/limits/middleware.test.ts (11 tests) 41ms
 ✓ test/routes/orders.test.ts (23 tests) 188ms

 Test Files  4 passed (4)
      Tests  49 passed (49)
   Duration  1.31s`

const rateLimiter: ActivityEntry[] = [
  say('I will start from the routes that take the most traffic and work down. First the shape of the limiter, then the middleware, then the headers clients read.', 26),
  tool('load_skill', { name: 'api-design' }, 'Loaded skill api-design: conventions for HTTP APIs in this workspace (status codes, error bodies, headers).', 26),
  taskList(
    [
      ['1', 'completed', 'Read how requests reach the order routes'],
      ['2', 'completed', 'Token bucket per API key, with an injectable clock'],
      ['3', 'in_progress', 'Middleware that answers 429 with Retry-After'],
      ['4', 'pending', 'RateLimit-* headers on every response'],
      ['5', 'pending', 'Load test at 2,000 requests a second'],
    ],
    25,
  ),
  tool('read', { path: 'src/routes/orders.ts' }, "import { Router } from 'express'\nimport { requireKey } from '../auth/keys.ts'\n\nexport const orders = Router()\norders.use(requireKey)\norders.get('/', listOrders)\norders.post('/', createOrder)", 24),
  tool('grep', { pattern: 'requireKey', path: 'src' }, 'src/routes/orders.ts:5:orders.use(requireKey)\nsrc/routes/refunds.ts:7:refunds.use(requireKey)\nsrc/routes/webhooks.ts:12:webhooks.use(requireKey)', 23),
  tool('write', { path: 'src/limits/bucket.ts', content: BUCKET_TS }, 'Successfully wrote 812 bytes to src/limits/bucket.ts', 19),
  tool('bash', { command: 'pnpm vitest run test/limits' }, LIMITS_TEST_OUT, 16),
  say('The bucket holds a burst of 500 and refills exactly on time. Next: **429** with `Retry-After`.', 15),
  tool(
    'edit',
    { path: 'src/limits/middleware.ts', edits: [{ oldText: '  if (!bucket.take()) return next()', newText: "  if (!bucket.take()) {\n    response.set('Retry-After', String(bucket.secondsUntilNext()))\n    return response.status(429).json({ error: 'rate_limited', retryAfter: bucket.secondsUntilNext() })\n  }" }] },
    'Successfully replaced 1 block(s) in src/limits/middleware.ts.',
    9,
  ),
  tool('bash', { command: 'pnpm vitest run test/limits/middleware.test.ts' }, ' ✓ test/limits/middleware.test.ts (13 tests) 52ms\n\n Test Files  1 passed (1)\n      Tests  13 passed (13)', 6),
  say('Both new cases pass: a dry key gets 429 with the right wait, and a key that waits it out is let through again. Now checking the webhooks route, which must never be limited by a customer\'s burst.', 4),
  tool('read', { path: 'src/routes/webhooks.ts' }, "export const webhooks = Router()\nwebhooks.use(requireKey)\nwebhooks.post('/stripe', verifySignature, handleEvent)", 3),
  tool('bash', { command: 'pnpm vitest run test/routes' }, ' RUN  v3.2.4 /atlas-api\n\n ✓ test/routes/orders.test.ts (23 tests) 191ms\n ✓ test/routes/refunds.test.ts (8 tests) 77ms\n ❯ test/routes/webhooks.test.ts (5 tests)', 1, 'running'),
]

const checkout: ActivityEntry[] = [
  say("I'll keep the cart summary where it is and move payment into one step, so a returning customer pays in two taps.", 40),
  tool('Skill', { skill: 'frontend-design' }, 'Launching skill: frontend-design', 39),
  tool('Read', { file_path: 'src/checkout/CheckoutPage.tsx' }, 'export function CheckoutPage() {\n  const cart = useCart()\n  return (\n    <Steps>\n      <AddressStep />\n      <ShippingStep />\n      <PaymentStep />\n    </Steps>\n  )\n}', 37),
  tool('Grep', { pattern: 'useSavedCards', path: 'src' }, 'src/account/cards.ts\nsrc/checkout/PaymentStep.tsx', 35),
  tool('Read', { file_path: 'src/account/cards.ts' }, 'export function useSavedCards() {\n  return useQuery(["cards"], fetchCards)\n}', 34),
  tool('Read', { file_path: 'design/tokens.json' }, '{ "space": { "3": "12px", "4": "16px" }, "radius": { "card": "14px" } }', 33),
  say('Saved cards already load with the account, so the merged step can show them at once. I will build it from the existing tokens, without new colors.', 31),
  tool('Write', { file_path: 'src/checkout/ShippingAndPayment.tsx', content: 'export function ShippingAndPayment({ saved }: { saved: Card[] }) { /* one step */ }' }, 'File created successfully at: src/checkout/ShippingAndPayment.tsx', 27),
  tool('Bash', { command: 'pnpm typecheck' }, 'No errors.', 24),
  tool('Edit', { file_path: 'src/checkout/CheckoutPage.tsx', old_string: '      <ShippingStep />\n      <PaymentStep />', new_string: '      <ShippingAndPayment saved={savedCards} />' }, 'The file src/checkout/CheckoutPage.tsx has been updated.', 22),
  tool('Bash', { command: 'pnpm playwright test checkout --project=webkit' }, 'Running 14 tests using 4 workers\n\n  14 passed (38.2s)', 12),
  say('All 14 checkout journeys pass in WebKit, with saved cards shown first.', 10),
  tool('Edit', { file_path: 'src/checkout/ShippingAndPayment.tsx', old_string: 'const [step, setStep] = useState(0)', new_string: 'const [open, setOpen] = useState(!saved.length)' }, 'The file src/checkout/ShippingAndPayment.tsx has been updated.', 5),
  tool('Bash', { command: 'pnpm test src/checkout' }, ' ✓ src/checkout/ShippingAndPayment.test.tsx (12 tests) 230ms', 2, 'running'),
]

const flakyCart: ActivityEntry[] = [
  say('The cart total test fails about one run in twenty. Running it 200 times to catch it in the act.', 18),
  tool('bash', { command: 'for i in $(seq 200); do pnpm vitest run test/cart/total.test.ts --silent || echo FAIL $i; done | grep -c FAIL' }, '11', 15),
  tool('read', { path: 'test/cart/total.test.ts' }, "it('applies the weekend discount', () => {\n  const total = totalOf(cart, new Date())\n  expect(total).toBe(4410)\n})", 13),
  say('Found it: the test builds the discount from `new Date()`, so it fails whenever the suite runs on a weekend in UTC. Pinning the clock.', 11),
  tool('edit', { path: 'test/cart/total.test.ts', edits: [{ oldText: 'totalOf(cart, new Date())', newText: "totalOf(cart, new Date('2026-11-18T10:00:00Z'))" }] }, 'Successfully replaced 1 block(s) in test/cart/total.test.ts.', 8),
  tool('bash', { command: 'for i in $(seq 200); do pnpm vitest run test/cart/total.test.ts --silent || echo FAIL $i; done | grep -c FAIL' }, '0', 2, 'running'),
]

const driver: ActivityEntry[] = [
  say('Upgrading the Postgres driver from 8.11 to 8.13. Reading the changelog for anything that touches pooling first.', 21),
  tool('bash', { command: 'pnpm up pg@8.13.1 && git diff --stat' }, ' package.json   |  2 +-\n pnpm-lock.yaml | 14 +++++++-------\n 2 files changed, 8 insertions(+), 8 deletions(-)', 17),
  tool('bash', { command: 'pnpm vitest run test/db' }, ' ✓ test/db/pool.test.ts (7 tests) 410ms\n ✓ test/db/migrations.test.ts (12 tests) 1.2s\n\n Test Files  2 passed (2)\n      Tests  19 passed (19)', 9),
  say('Pool and migrations pass on the new driver. Running the whole suite against a fresh database before I mark it ready.', 6),
  tool('bash', { command: 'pnpm test' }, ' ✓ 41 test files so far', 1, 'running'),
]

const offline: ActivityEntry[] = [
  say('Drafts should save while offline and sync when the app comes back, without ever losing the newer copy.', 30),
  tool('Read', { file_path: 'src/drafts/store.ts' }, 'export async function saveDraft(draft: Draft) {\n  await api.put(`/drafts/${draft.id}`, draft)\n}', 28),
  tool('Write', { file_path: 'src/drafts/outbox.ts', content: 'export class Outbox { /* queued writes, replayed in order */ }' }, 'File created successfully at: src/drafts/outbox.ts', 20),
  tool('Bash', { command: 'pnpm test src/drafts' }, ' ✓ src/drafts/outbox.test.ts (8 tests) 64ms\n ✓ src/drafts/merge.test.ts (6 tests) 31ms', 7),
  say('Outbox and merge both pass. Writing the conflict case next: two devices edit the same draft offline.', 3),
]

const ledgerRetry: ActivityEntry[] = [
  say('The nightly sync gives up on the first ledger timeout and leaves the night unsynced. Retrying with backoff, and only the batch that failed.', 14),
  tool('read', { path: 'src/sync/nightly.ts' }, "export async function syncNight(day: string) {\n  for (const batch of batchesOf(day)) await ledger.post('/entries', batch)\n}", 12),
  tool('write', { path: 'src/sync/retry.ts', content: 'export async function withRetry<T>(run: () => Promise<T>, waits = [2_000, 8_000, 30_000]): Promise<T> { /* ... */ }' }, 'Successfully wrote 604 bytes to src/sync/retry.ts', 8),
  say('Each batch is posted with its own idempotency key, so a retry after a timeout cannot book it twice.', 5),
  tool('bash', { command: 'pnpm vitest run test/sync' }, ' ✓ test/sync/retry.test.ts (6 tests) 22ms\n ❯ test/sync/nightly.test.ts (4 tests)', 1, 'running'),
]

// ---------------------------------------------------------------------------------------------------------------
// The agents.

interface Durable {
  summary: HobkinSummary
  /** Finished turns before the one in flight: what was asked and answered. */
  earlier: [asked: string, reply: string, minutesAgo: number][]
  asked: string
  steps: ActivityEntry[]
}

const durable = (id: string, title: string, project: string, engine: HobkinSummary['engine'], createdMinutesAgo: number, run: string, turns: number): HobkinSummary => ({
  id,
  title,
  cwd: `${CODE}/${project}`,
  engine,
  state: 'working',
  turns,
  run,
  last: null,
  waiting: null,
  createdAt: iso(ago(createdMinutesAgo)),
})

const durables: Durable[] = [
  {
    summary: durable('a3f19c42', 'Rate limits for the public API', 'atlas-api', { kind: 'tier', tier: 'high' }, 95, 'run-a3f19c42-t2', 2),
    earlier: [["Partners hit us with bursts of a few thousand requests and the order routes fall over. Read how requests come in and tell me where a limiter should sit. Don't change anything yet.", 'A limiter belongs **after** the API key check and **before** the routes, so every route is covered and anonymous traffic is refused earlier by the key check. I would use a token bucket per key: bursts up to a ceiling, then a steady rate. The webhooks route must stay out of it.', 70]],
    asked: 'Go ahead: 300 requests a minute per key with bursts up to 500. Webhooks stay unlimited. Tests first, and send the usual RateLimit headers.',
    steps: rateLimiter,
  },
  {
    summary: durable('7c2e90b1', 'One-step checkout', 'storefront', { kind: 'claude', model: 'opus', effort: 'high' }, 60, 'run-7c2e90b1-t2', 2),
    earlier: [["Why do people drop out of checkout? Look at the steps and the funnel numbers in docs/funnel.md, and don't change anything yet.", 'Most of the drop is between **shipping** and **payment**: 31% of the people who reach shipping never see the payment step. Returning customers fill both again although their address and cards are saved. Merging the two into one step, with saved cards first, would remove a page and two forms for them.', 50]],
    asked: 'Merge shipping and payment into one step. Returning customers should see their saved cards first.',
    steps: checkout,
  },
]

const run = (id: string, title: string, project: string, startedMinutesAgo: number, extra: Partial<RunSummary> = {}): RunSummary => ({
  id,
  title,
  state: 'running',
  kind: 'background',
  model: 'openai/gpt-6.1-sol',
  effort: 'high',
  tier: 'high',
  cwd: `${CODE}/${project}`,
  startedAt: iso(ago(startedMinutesAgo)),
  work: { slug: project },
  ...extra,
})

const runs: { summary: RunSummary; steps: ActivityEntry[] }[] = [
  { summary: run('job-5d81c3', 'Fix the flaky cart total test', 'storefront', 19), steps: flakyCart },
  { summary: run('job-9e04ab', 'Update the Postgres driver to 8.13', 'atlas-api', 22, { effort: 'medium', tier: 'mid', model: 'openai/gpt-6.1-sol' }), steps: driver },
  { summary: run('job-2b77fd', 'Offline drafts that sync later', 'field-notes', 31, { onClaudeCode: true, model: 'claude/opus' }), steps: offline },
  { summary: run('job-c41e07', 'Retry the nightly sync on timeouts', 'ledger-sync', 14, { effort: 'medium', tier: 'mid' }), steps: ledgerRetry },
]

const fakeJobs = new Map<string, ActivityEntry[]>([...runs.map((each) => [each.summary.id!, each.steps] as const), ...durables.map((each) => [each.summary.run!, each.steps] as const)])
const fakeHobkins = new Map(durables.map((each) => [each.summary.id, each]))

function conversationOf({ summary, earlier, asked }: Durable): HobkinConversation {
  const turns: HobkinTurn[] = earlier.map(([question, reply, minutesAgo], index) => ({
    n: index + 1,
    run: `run-${summary.id}-t${index + 1}`,
    asked: question,
    from: { kind: 'user' },
    askedAt: iso(ago(minutesAgo + 6)),
    status: 'completed',
    reply,
    error: null,
    endedAt: iso(ago(minutesAgo)),
  }))
  const firstStep = fakeJobs.get(summary.run!)?.[0]?.at ?? ago(30)
  turns.push({ n: turns.length + 1, run: summary.run!, asked, from: { kind: 'user' }, askedAt: iso(firstStep - MIN), status: 'running', reply: null, error: null, endedAt: null })
  return { hobkin: summary, turns }
}

// ---------------------------------------------------------------------------------------------------------------
// The wire.

type Message = { type: string; set?: Record<string, unknown>; reset?: boolean; activity?: ActivityStep[]; [key: string]: unknown }

const withFake = (message: Message): Message => {
  const set = message.set
  if (set && Array.isArray(set.runs)) set.runs = [...(set.runs as RunSummary[]), ...runs.map((each) => each.summary)]
  if (set && Array.isArray(set.hobkins)) set.hobkins = [...(set.hobkins as HobkinSummary[]), ...durables.map((each) => each.summary)]
  if (set && 'busy' in set && message.reset) set.busy = false
  if (message.reset) message.activity = [...(message.activity ?? []), ...[...fakeJobs].map(([job, entries]): ActivityStep => ({ op: 'reset', job, entries }))]
  return message
}

/** The fake agent a command is about, by any of the ways commands name one. */
function aboutFake(args: Record<string, unknown>): string | null {
  for (const key of ['id', 'job', 'run', 'agent', 'agentId']) {
    const value = args[key]
    if (typeof value !== 'string') continue
    if (fakeJobs.has(value) || fakeHobkins.has(value) || value.startsWith('run-') && [...fakeHobkins.keys()].some((id) => value.startsWith(`run-${id}`))) return value
    if (value.startsWith('hobkin:') && fakeHobkins.has(value.slice(7))) return value
  }
  return null
}

function answer(name: string, args: Record<string, unknown>): unknown {
  if (name === 'hobkin.read') return conversationOf(fakeHobkins.get(String(args.id))!)
  if (name === 'activity.before') {
    const job = String(args.job)
    return { steps: args.before ? [] : (fakeJobs.get(job) ?? []), more: false, found: true }
  }
  if (name === 'agent.notes') return { notes: [] }
  if (name === 'schedule.runs') return { schedules: [] }
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------------------
// The change reviews behind the seed's grades.

/** Each graded finished change by its review id (`reviewIdOf` in `shared/review/ids.ts`): the commit graded, when, and whether a score is under its floor. */
const graded = new Map<string, { head: string; at: string; held: boolean }>()
/** The `review.status` commands on their way to the host for a graded change, by command id. */
const askedStatus = new Map<string, string>()

/** Work mode comes whole on a state message, beside its `set` (`ui/src/lib/host/state.ts`). */
function noteGraded(work: { finished?: FinishedGroup[] } | null): void {
  if (!work?.finished) return
  graded.clear()
  for (const change of work.finished.flatMap(({ changes }) => changes)) {
    if (change.scoring && change.head) graded.set(`change:${change.slug}:${change.item}`, { head: change.head, at: change.at ?? new Date(NOW).toISOString(), held: change.scoring.floors.length > 0 })
  }
}

/** A finished change review at the commit graded: nothing found that breaks, so safe to deploy, with one part shown by no test when a score is under its floor. */
function reviewed({ head, at, held }: { head: string; at: string; held: boolean }): AssessmentStatus {
  return { state: 'ready', head, summary: { level: held ? 'mid' : 'safe', critical: false, needsYou: 0, worthALook: held ? 1 : 0, safe: held ? 4 : 5, storyBy: 'model', at, deploy: 'safe' } }
}

function withReview(message: Message): Message {
  const about = askedStatus.get(String(message.id))
  if (!about) return message
  askedStatus.delete(String(message.id))
  const known = graded.get(about)
  const value = message.value as { head?: string | null } | undefined
  if (message.ok && known && value && (value.head ?? known.head) === known.head) message.value = { ...value, assessment: reviewed(known) }
  return message
}

let deliver: (text: string) => void = () => {}

export const overlay = {
  attach(to: (text: string) => void): void {
    deliver = to
  },
  fromHost(text: string): string[] {
    const message = JSON.parse(text) as Message
    if (message.type === 'state' && message.work !== undefined) noteGraded(message.work as { finished?: FinishedGroup[] } | null)
    if (message.type === 'result' && askedStatus.size) return [JSON.stringify(withReview(message))]
    return message.type === 'state' ? [JSON.stringify(withFake(message))] : [text]
  },
  /** What goes on to the host, or null when the answer came from here. */
  fromPage(text: string): string | null {
    const message = JSON.parse(text) as { type: string; id?: string; name?: string; args?: Record<string, unknown> }
    if (message.type === 'command' && message.name === 'review.status' && graded.has(String(message.args?.id))) askedStatus.set(String(message.id), String(message.args!.id))
    if (message.type !== 'command' || !aboutFake(message.args ?? {})) return text
    const value = answer(message.name!, message.args ?? {})
    setTimeout(() => deliver(JSON.stringify({ type: 'result', id: message.id, ok: true, value })), 5)
    return null
  },
}

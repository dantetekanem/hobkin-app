import type { ActivityEntry } from '#shared/protocol/activity.ts'

/**
 * Made-up activity for two of the frame's sample agents (ui/src/app/running-agents.ts), in hobkin's own shape
 * (`src/cli/job-activity.mjs`): the agent's words, and tool calls with their arguments as JSON text, their output
 * and their state. With no host the canvas draws this, so it can be seen and checked.
 */
export interface SampleActivity {
  /** The agent's folder, as a run's `cwd`. */
  cwd: string
  /** What the agent had done before its canvas first opened. */
  done: ActivityEntry[]
  /** What comes after, one frame every few seconds, so the canvas can be seen moving with no host. Each frame is what follows `done`. */
  next: ActivityEntry[][]
}

/** How long each frame of a sample's `next` stays. */
export const SAMPLE_FRAME_MS = 2600

const said = (id: string, text: string): ActivityEntry => ({ id: `message:${id}`, kind: 'assistant', text })
const call = (id: string, name: string, args: object, state: ActivityEntry['state'], output = ''): ActivityEntry => ({
  id: `tool:${id}`,
  kind: 'tool',
  name,
  state,
  // As hobkin keeps them: the arguments as indented JSON.
  input: JSON.stringify(args, null, 2),
  output,
})
const lines = (...text: string[]) => text.join('\n')

const REDIRECT_BEFORE = lines(
  "import { NextResponse } from 'next/server'",
  '',
  'export function redirectAfterSignIn(request: Request): NextResponse {',
  "  const returnTo = new URL(request.url).searchParams.get('returnTo')",
  "  return NextResponse.redirect(new URL(returnTo ?? '/account', request.url))",
  '}',
)
const REDIRECT_AFTER = lines(
  "import { NextResponse } from 'next/server'",
  '',
  "const SIGN_IN = '/sign-in'",
  '',
  'export function redirectAfterSignIn(request: Request): NextResponse {',
  "  const returnTo = new URL(request.url).searchParams.get('returnTo')",
  '  // Back to the sign-in page would sign the user in again, and again.',
  "  const next = returnTo && returnTo.startsWith('/') && !returnTo.startsWith(SIGN_IN) ? returnTo : '/account'",
  '  return NextResponse.redirect(new URL(next, request.url))',
  '}',
)

const REDIRECT_TEST = lines(
  "import { describe, expect, it } from 'vitest'",
  "import { redirectAfterSignIn } from './redirect.ts'",
  '',
  "const target = (returnTo: string) => redirectAfterSignIn(new Request(`https://shop.example/sign-in?returnTo=${encodeURIComponent(returnTo)}`)).headers.get('location')",
  '',
  "describe('redirectAfterSignIn', () => {",
  "  it('goes to the account page by default', () => {",
  "    expect(target('')).toBe('https://shop.example/account')",
  '  })',
  '',
  "  it('follows returnTo after sign-in', () => {",
  "    expect(target('/sign-in?step=2')).toBe('/sign-in?step=2')",
  '  })',
  '})',
)

const TEST_RUN = [
  '> storefront@4.2.0 test /Users/sample/code/storefront',
  '> vitest run',
  '',
  ' RUN  v3.2.4 /Users/sample/code/storefront',
  '',
  ' ✓ src/cart/total.test.ts (18 tests) 41ms',
  ' ✓ src/cart/discounts.test.ts (12 tests) 29ms',
  ' ✓ src/auth/redirect.test.ts (7 tests) 12ms',
  ' ✓ src/auth/session.test.ts (9 tests) 33ms',
  ' ✓ src/checkout/address.test.ts (21 tests) 58ms',
  ' ✓ src/checkout/payment.test.ts (16 tests) 64ms',
  ' ✓ src/catalog/search.test.ts (31 tests) 87ms',
  ' ✓ src/catalog/filters.test.ts (24 tests) 46ms',
  ' ✓ src/account/orders.test.ts (19 tests) 52ms',
  ' ✓ src/account/profile.test.ts (11 tests) 21ms',
  ' ✓ src/emails/receipt.test.ts (14 tests) 38ms',
  ' ✓ src/api/rate.test.ts (32 tests) 95ms',
]
const TEST_SUMMARY = ['', ' Test Files  12 passed (12)', '      Tests  214 passed (214)', '   Duration  2.84s']

const A1_DONE: ActivityEntry[] = [
  said('1:0', 'I will start where the loop shows up: the redirect after sign-in, in `src/auth`.'),
  call('call_k2f9a1', 'read', { path: '/Users/sample/code/storefront/src/auth/session.ts' }, 'completed', 'export async function session(request: Request) {\n  ...\n}'),
  call('call_k2f9a2', 'read', { path: '/Users/sample/code/storefront/src/auth/redirect.ts' }, 'completed', REDIRECT_BEFORE),
  call('call_k2f9a3', 'grep', { pattern: 'returnTo', path: 'src' }, 'completed', 'src/auth/redirect.ts:4:  const returnTo = ...\nsrc/auth/sign-in.tsx:12:  href={`/sign-in?returnTo=${path}`}'),
  said(
    '3:0',
    'Found it. `redirectAfterSignIn` sends people back to `returnTo` even when `returnTo` is the sign-in page itself, so signing in sends you to sign in again. I will make it fall back to `/account` for the sign-in page and for anything that is not a path on this site.',
  ),
  call('call_k2f9a4', 'edit', { path: '/Users/sample/code/storefront/src/auth/redirect.ts', edits: [{ oldText: REDIRECT_BEFORE, newText: REDIRECT_AFTER }] }, 'completed', 'Successfully replaced 1 block(s) in src/auth/redirect.ts.'),
  call('call_k2f9a5', 'bash', { command: 'pnpm install --frozen-lockfile' }, 'completed', 'Lockfile is up to date, resolution step is skipped\nAlready up to date\nDone in 812ms'),
  call(
    'call_k2f9a6',
    'bash',
    { command: 'pnpm test src/auth' },
    'failed',
    lines(
      ' RUN  v3.2.4 /Users/sample/code/storefront',
      '',
      ' ✓ src/auth/session.test.ts (9 tests) 31ms',
      ' ❯ src/auth/redirect.test.ts (7 tests | 1 failed) 14ms',
      '   × follows returnTo after sign-in 6ms',
      '',
      ' FAIL  src/auth/redirect.test.ts > follows returnTo after sign-in',
      "AssertionError: expected '/account' to be '/sign-in?step=2'",
      ' ❯ src/auth/redirect.test.ts:18:41',
      '',
      ' Test Files  1 failed | 1 passed (2)',
      '      Tests  1 failed | 15 passed (16)',
      '',
      'Command exited with code 1',
    ),
  ),
  said('5:0', 'One test expected the old behavior: it followed a `returnTo` that pointed back at the sign-in page. That was the bug, so the test changes with it.'),
  call('call_k2f9a6r', 'read', { path: '/Users/sample/code/storefront/src/auth/redirect.test.ts' }, 'completed', REDIRECT_TEST),
  call(
    'call_k2f9a7',
    'edit',
    {
      path: '/Users/sample/code/storefront/src/auth/redirect.test.ts',
      edits: [
        {
          oldText: "  it('follows returnTo after sign-in', () => {\n    expect(target('/sign-in?step=2')).toBe('/sign-in?step=2')",
          newText: "  it('never returns to the sign-in page', () => {\n    expect(target('/sign-in?step=2')).toBe('/account')",
        },
      ],
    },
    'completed',
    'Successfully replaced 1 block(s) in src/auth/redirect.test.ts.',
  ),
  call('call_k2f9a8', 'bash', { command: 'pnpm test src/auth' }, 'completed', lines(' ✓ src/auth/session.test.ts (9 tests) 30ms', ' ✓ src/auth/redirect.test.ts (7 tests) 12ms', '', ' Test Files  2 passed (2)', '      Tests  16 passed (16)')),
  call('call_k2f9a9', 'bash', { command: 'pnpm lint' }, 'completed', '(no output)'),
]

const suite = (state: ActivityEntry['state'], shown: number) => call('call_k2f9b1', 'bash', { command: 'pnpm test' }, state, lines(...TEST_RUN.slice(0, shown), ...(state === 'running' ? [] : TEST_SUMMARY)))
const typecheck = (state: ActivityEntry['state']) => call('call_k2f9b2', 'bash', { command: 'pnpm typecheck' }, state, state === 'running' ? '' : '(no output)')
const PASSED = suite('completed', TEST_RUN.length)
const CHECKED = typecheck('completed')
const ALL_PASS = said('7:0', 'All 214 tests pass, the auth ones included, and the types check.')

const A1: SampleActivity = {
  cwd: '/Users/sample/code/storefront',
  done: A1_DONE,
  next: [
    [suite('running', 4)],
    [suite('running', 9)],
    [suite('running', 15)],
    [PASSED],
    // The typecheck starts right after: the whole suite slides up into the folded row as it rises in.
    [PASSED, typecheck('running')],
    [PASSED, CHECKED],
    [PASSED, CHECKED, ALL_PASS],
    [
      PASSED,
      CHECKED,
      ALL_PASS,
      said('9:0', 'Done. The redirect never goes back to the sign-in page, and `src/auth/redirect.test.ts` proves it. It is on `hobkin/3fa9c1-fix-login-redirect`, ready for review.'),
    ],
  ],
}

const RECAP = lines(
  '# Morning recap',
  '',
  '## Work',
  '',
  '- **storefront**: the login redirect fix is on its branch with passing tests.',
  '- **billing-api**: one dependency update changes how invoices round. It waits for you.',
  '- **docs-site**: the install guide still names Node 20.',
  '',
  '## Deadlines',
  '',
  '- Passport renewal: December 3 at 9:40, at the consulate.',
  '- Car inspection: before November 30.',
  '- Quarterly taxes: January 15.',
  '',
  '## Reviews waiting',
  '',
  '- #482 Fix the login redirect loop',
  '- #479 Faster cart totals',
  '',
  'Nothing broke overnight.',
)

// A prose file, whose long lines wrap inside the diff.
const DEADLINES_BEFORE = lines(
  '- **Passport renewal**: the appointment at the consulate is on December 3 at 9:40. Bring the form, two photos and the old passport, or the slot is lost and the next free one is in February.',
  '- **Car inspection**: due before the end of November. The garage on Elm Street takes walk-ins on weekday mornings, and the last inspection report is in the glove box.',
  '- **Quarterly taxes**: the estimated payment is due on January 15. Last quarter it went out from the savings account, which needs a transfer two days ahead.',
  '- **Dentist**: a cleaning is booked for December 12 at 14:00, and the clinic asks for a call a day ahead to confirm, or it gives the time away.',
)
const DEADLINES_AFTER = lines(
  '- **Passport renewal**: the appointment at the consulate moved to December 4 at 10:20. Bring the form, two photos and the old passport, or the slot is lost and the next free one is in February.',
  '- **Car inspection**: booked for November 27 at 8:00 at the garage on Elm Street. The last inspection report is in the glove box, and the visit takes about forty minutes.',
  '- **Quarterly taxes**: the estimated payment is due on January 15. It now goes out from the checking account, so no transfer is needed ahead of it this time.',
  '- **Dentist**: the cleaning on December 12 at 14:00 is confirmed. The clinic sent a reminder to call only if the time no longer works.',
)

const A3: SampleActivity = {
  cwd: '/Users/sample/hobkin',
  done: [
    said('1:0', 'Reading what changed overnight.'),
    call('call_m4c1a1', 'bash', { command: 'gh pr list --state merged --search "merged:>=2026-11-09" --json title,number' }, 'completed', '[{"number":482,"title":"Fix the login redirect loop"},{"number":479,"title":"Faster cart totals"}]'),
    call('call_m4c1a2', 'read', { path: 'reports/2026-11-09.md' }, 'completed', '# Yesterday\n...'),
    call('call_m4c1a3', 'fetch_content', { url: 'https://status.example.com/history' }, 'completed', 'All systems operational.'),
    call('call_m4c1a4', 'read', { path: 'reports/missing-week.md' }, 'failed', 'ENOENT: no such file or directory, open reports/missing-week.md'),
    call('call_m4c1a4e', 'edit', { path: '/Users/sample/hobkin/routines/calendar-deadlines.md', edits: [{ oldText: DEADLINES_BEFORE, newText: DEADLINES_AFTER }] }, 'completed', 'Successfully replaced 1 block(s) in routines/calendar-deadlines.md.'),
    said('3:0', 'Three things are worth a look this morning. Writing the recap.'),
  ],
  next: [[call('call_m4c1a5', 'write', { path: 'reports/morning-recap.md', content: RECAP }, 'running')], [call('call_m4c1a5', 'write', { path: 'reports/morning-recap.md', content: RECAP }, 'completed', 'Successfully wrote 312 bytes to reports/morning-recap.md')]],
}

export const SAMPLE_ACTIVITY: Readonly<Record<string, SampleActivity>> = { a1: A1, a3: A3 }

const frames = new WeakMap<SampleActivity, (readonly ActivityEntry[])[]>()

/**
 * A sample's activity a while after its canvas first opened: what it had done, then one more frame of `next` every
 * few seconds. The same frame is the same list, so nothing draws again until the next frame.
 */
export function sampleAt(sample: SampleActivity, elapsedMs: number): readonly ActivityEntry[] {
  const frame = Math.min(sample.next.length, Math.max(0, Math.floor(elapsedMs / SAMPLE_FRAME_MS)))
  let built = frames.get(sample)
  if (!built) frames.set(sample, (built = [sample.done, ...sample.next.map((tail) => [...sample.done, ...tail])]))
  return built[frame]!
}

/** How long a sample takes to play through. */
export const sampleLength = (sample: SampleActivity) => sample.next.length * SAMPLE_FRAME_MS

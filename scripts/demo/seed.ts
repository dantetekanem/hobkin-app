/**
 * Seeds the demo home for the website shots with made-up work, in the formats hobkin itself writes, by hobkin's own
 * code: its work store for projects and their queue, its memory store, routine files as its README describes, and
 * then hobkin itself, opened on the home with a scripted model, runs the routines (their reports) and answers a few
 * chat messages. The model's words are written here, so nothing reaches a provider. Every name, project, path and
 * line is invented.
 *
 *   HOME=<demo>/user node scripts/demo/seed.ts <demo folder>
 *
 * Run it from `shoot.sh`, which makes the folder, the throwaway repositories under `<demo>/code` and the home first.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import * as workStore from 'hobkin/src/cli/work/store.mjs'
import * as memoryStore from 'hobkin/src/cli/memories.mjs'
import * as unmerged from 'hobkin/src/cli/work/unmerged.mjs'
import { createScriptedModel, type ScriptedCall, type ScriptedReply } from '../../host/src/scripted.ts'
import { after as refundAfter, before as refundBefore } from './refund-change.ts'

/** The parts of hobkin's work and memory stores the seed writes with. The host's declarations name only what it uses. */
interface WorkStore {
  proposeProject(root: string, proposal: Record<string, unknown>, now?: number): unknown
  chooseProject(root: string, slug: string, level: string, now?: number): unknown
  setProjectPriority(root: string, slug: string, priority: string): unknown
  fileItem(root: string, slug: string, item: Record<string, unknown>, now?: number): { id: string; title: string }
  updateItem(root: string, slug: string, id: string, change: Record<string, unknown>, now?: number): unknown
  workName(item: { id: string; title: string }): string
  writeMode(root: string, change: Record<string, unknown>): unknown
  recordTokens(root: string, entry: { slug: string; lane: string; tokens: number }, now?: number): unknown
  prFile(root: string, slug: string, id: string): string
}
interface Unmerged {
  surveyUnmerged(root: string): Promise<unknown>
}
interface MemoryStore {
  addMemory(root: string, fields: Record<string, unknown>, actor: { by: { kind: string }; now: number }): unknown
}
const { chooseProject, fileItem, prFile, proposeProject, recordTokens, setProjectPriority, updateItem, workName, writeMode } = workStore as unknown as WorkStore
const { surveyUnmerged } = unmerged as unknown as Unmerged
const { addMemory } = memoryStore as unknown as MemoryStore

const DEMO = process.argv[2]
if (!DEMO || !homedir().startsWith(DEMO)) throw Error('Run with HOME inside the demo folder: HOME=<demo>/user node scripts/demo/seed.ts <demo>')
const HOME = join(DEMO, 'home')
const CODE = join(DEMO, 'code')
const HOUR = 3_600_000
const NOW = Date.now()

/** git with a made-up author, and none of the Mac's own git settings. */
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Avery Park', GIT_AUTHOR_EMAIL: 'avery@example.com', GIT_COMMITTER_NAME: 'Avery Park', GIT_COMMITTER_EMAIL: 'avery@example.com' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV }).trim()

// ---------------------------------------------------------------------------------------------------------------
// The throwaway repositories the projects live in: a few files and a short history each.

const REPOS: Record<string, Record<string, string>> = {
  storefront: {
    'package.json': '{\n  "name": "storefront",\n  "private": true,\n  "scripts": { "test": "vitest run", "build": "vite build" }\n}\n',
    'README.md': '# storefront\n\nThe shop: catalog, cart and checkout.\n',
    'src/cart/total.ts': 'export function totalOf(cart: Cart, at: Date): number {\n  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0) - discountOf(cart, at)\n}\n',
    'src/checkout/CheckoutPage.tsx': 'export function CheckoutPage() {\n  return <Steps><AddressStep /><ShippingStep /><PaymentStep /></Steps>\n}\n',
    'src/auth/session.ts': "export const SESSION_COOKIE = { name: 'sid', httpOnly: true }\n",
    'test/cart/total.test.ts': "it('applies the weekend discount', () => {\n  expect(totalOf(cart, new Date())).toBe(4410)\n})\n",
  },
  'atlas-api': {
    'package.json': '{\n  "name": "atlas-api",\n  "private": true,\n  "scripts": { "test": "vitest run" }\n}\n',
    'README.md': '# atlas-api\n\nOrders, refunds and webhooks for partners.\n',
    'src/routes/orders.ts': "export const orders = Router()\norders.use(requireKey)\n",
    ...refundBefore,
    'src/routes/webhooks.ts': "export const webhooks = Router()\n",
  },
  'field-notes': {
    'package.json': '{\n  "name": "field-notes",\n  "private": true,\n  "scripts": { "test": "vitest run" }\n}\n',
    'README.md': '# field-notes\n\nA notes app that works on the train.\n',
    'src/drafts/store.ts': 'export async function saveDraft(draft: Draft) {\n  await api.put(`/drafts/${draft.id}`, draft)\n}\n',
    'src/search/index.ts': 'export const search = (notes: Note[], words: string) => notes.filter((note) => note.text.includes(words))\n',
  },
  'ledger-sync': {
    'package.json': '{\n  "name": "ledger-sync",\n  "private": true,\n  "scripts": { "test": "vitest run" }\n}\n',
    'README.md': '# ledger-sync\n\nNightly sync of orders into the ledger, and the month-end CSV.\n',
    'src/export/csv.ts': 'export async function exportMonth(entries: Entry[]) {\n  return entries.map(line).join("\\n")\n}\n',
  },
  'pulse-mobile': {
    'package.json': '{\n  "name": "pulse-mobile",\n  "private": true\n}\n',
    'README.md': '# pulse-mobile\n\nThe companion app.\n',
  },
}

function makeRepos() {
  for (const [name, files] of Object.entries(REPOS)) {
    const path = join(CODE, name)
    mkdirSync(path, { recursive: true })
    git(path, 'init', '-q', '-b', 'main')
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(join(path, file, '..'), { recursive: true })
      writeFileSync(join(path, file), content)
    }
    git(path, 'add', '-A')
    git(path, 'commit', '-q', '-m', `Start ${name}`)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Work: four projects at four priorities, their queues, and finished changes waiting on branches.

type Kind = 'security' | 'fix' | 'update' | 'chore' | 'improvement' | 'feature'
interface Item {
  key: string
  kind: Kind
  title: string
  brief: string
  grade: 'P0' | 'P1' | 'P2' | 'P3'
  impact?: 'high' | 'medium' | 'low'
  effort?: 'small' | 'medium' | 'large'
  /** Finished on a branch: the file it changed, what it says, and how it was shown to work. */
  finished?: { files: Record<string, string>; summary: string; proof: string }
  doing?: true
}

const PROJECTS: { slug: string; level: 'critical' | 'important' | 'casual'; priority: 'P0' | 'P1' | 'P2' | 'P3'; items: Item[] }[] = [
  {
    slug: 'storefront',
    level: 'critical',
    priority: 'P0',
    items: [
      { key: 'sf-samesite', kind: 'security', grade: 'P0', impact: 'high', effort: 'small', title: 'Session cookie is sent on cross-site requests', brief: 'The session cookie has no SameSite attribute, so a cross-site form can ride a signed-in session.', finished: { files: { ['src/auth/session.ts']: "export const SESSION_COOKIE = { name: 'sid', httpOnly: true, secure: true, sameSite: 'lax' as const }\n" }, summary: 'Sets SameSite=Lax and Secure on the session cookie, with a test that a cross-site POST arrives signed out.', proof: 'pnpm test src/auth: 31 passed; a cross-site POST from the test origin now arrives without the session.' } },
      { key: 'sf-weekend', kind: 'fix', grade: 'P0', impact: 'high', effort: 'small', title: 'Cart total ignores the weekend discount after midnight UTC', brief: 'Totals computed between midnight UTC and local midnight miss the weekend discount.', doing: true },
      { key: 'sf-images', kind: 'improvement', grade: 'P1', impact: 'medium', effort: 'medium', title: 'Lazy-load product images below the fold', brief: 'The category page loads 48 full-size images up front; only the first row is visible.' },
      { key: 'sf-coupons', kind: 'chore', grade: 'P2', impact: 'low', effort: 'small', title: 'Remove the unused coupon v1 endpoints', brief: 'Nothing has called /api/v1/coupons in 90 days.' },
      { key: 'sf-a11y', kind: 'fix', grade: 'P1', impact: 'medium', effort: 'small', title: 'Size picker cannot be used with the keyboard', brief: 'Arrow keys do nothing in the size picker on product pages.', finished: { files: { ['src/product/SizePicker.tsx']: "export const keys = { next: 'ArrowRight', previous: 'ArrowLeft' }\n" }, summary: 'Arrow keys move between sizes, Space picks one, and the picker announces the chosen size.', proof: 'pnpm playwright test product --project=webkit: 22 passed, including 3 new keyboard cases.' } },
    ],
  },
  {
    slug: 'atlas-api',
    level: 'important',
    priority: 'P1',
    items: [
      { key: 'aa-limits', kind: 'feature', grade: 'P1', impact: 'high', effort: 'medium', title: 'Rate limits for partner API keys', brief: 'Bursts from partners take the order routes down. Limit per key, leave webhooks alone.', doing: true },
      { key: 'aa-pg', kind: 'update', grade: 'P1', impact: 'medium', effort: 'small', title: 'Update the Postgres driver to 8.13', brief: 'pg 8.11 has a pooling fix we need in 8.13.', doing: true },
      { key: 'aa-refund', kind: 'fix', grade: 'P1', impact: 'high', effort: 'small', title: 'Refund webhook is retried twice on a timeout', brief: 'A slow refund answer makes the provider retry, and the refund is recorded twice.', finished: { files: refundAfter, summary: 'Refunds are recorded once per idempotency key; a retry gets the first answer back.', proof: 'pnpm vitest run test/routes/refunds.test.ts: 9 passed, including the double-delivery case.' } },
      { key: 'aa-rates', kind: 'improvement', grade: 'P2', impact: 'medium', effort: 'small', title: 'Cache currency rates for an hour', brief: 'Every order asks the rates service again.' },
      { key: 'aa-openapi', kind: 'chore', grade: 'P3', impact: 'low', effort: 'small', title: 'Publish the OpenAPI file with each release', brief: 'Partners ask for the spec by email.' },
    ],
  },
  {
    slug: 'field-notes',
    level: 'casual',
    priority: 'P2',
    items: [
      { key: 'fn-offline', kind: 'feature', grade: 'P2', impact: 'high', effort: 'large', title: 'Offline drafts that sync later', brief: 'Drafts written on the train are lost when the app closes offline.', doing: true },
      { key: 'fn-accents', kind: 'fix', grade: 'P2', impact: 'medium', effort: 'small', title: 'Search misses notes with accented words', brief: 'Searching "cafe" does not find "café".', finished: { files: { ['src/search/normalize.ts']: "export const fold = (text: string) => text.normalize('NFD').replace(/\\p{Diacritic}/gu, '').toLowerCase()\n" }, summary: 'Search folds accents on both sides, so "cafe" finds "café" and the other way round.', proof: 'pnpm test src/search: 18 passed; 4 new cases in French, Portuguese and German.' } },
      { key: 'fn-markdown', kind: 'update', grade: 'P3', impact: 'low', effort: 'small', title: 'Upgrade the Markdown renderer', brief: 'Two minor versions behind, with a table fix we want.' },
    ],
  },
  {
    slug: 'ledger-sync',
    level: 'casual',
    priority: 'P3',
    items: [
      { key: 'ls-stream', kind: 'improvement', grade: 'P3', impact: 'medium', effort: 'medium', title: 'Stream the CSV export instead of buffering it', brief: 'The month-end export holds 400 MB in memory.', finished: { files: { ['src/export/csv.ts']: 'export async function* rows(cursor: AsyncIterable<Entry>) {\n  for await (const entry of cursor) yield line(entry)\n}\n' }, summary: 'The export writes rows as the cursor reads them; peak memory falls from 410 MB to 38 MB.', proof: 'pnpm test src/export: 12 passed; month-end fixture exported in 9.1 s at 38 MB.' } },
      { key: 'ls-rename', kind: 'chore', grade: 'P3', impact: 'low', effort: 'small', title: 'Rename the nightly export job', brief: 'Its name still says "temp".' },
    ],
  },
]

function seedWork() {
  for (const [index, project] of PROJECTS.entries()) {
    const path = join(CODE, project.slug)
    proposeProject(HOME, { slug: project.slug, name: project.slug, path, level: project.level, first: [] }, NOW - (40 - index) * HOUR)
    chooseProject(HOME, project.slug, project.level, NOW - (39 - index) * HOUR)
    setProjectPriority(HOME, project.slug, project.priority)
    for (const [at, item] of project.items.entries()) {
      const filed = fileItem(HOME, project.slug, { key: item.key, kind: item.kind, title: item.title, brief: item.brief, impact: item.impact, effort: item.effort }, NOW - (30 - at) * HOUR)
      updateItem(HOME, project.slug, filed.id, { grade: item.grade }, NOW - (29 - at) * HOUR)
      if (item.doing) updateItem(HOME, project.slug, filed.id, { state: 'doing' }, NOW - HOUR)
      if (!item.finished) continue
      // The finished work is a real branch in the throwaway repository, named as hobkin names its branches.
      const branch = `hobkin/${workName(filed)}`
      git(path, 'checkout', '-q', '-b', branch)
      for (const [file, content] of Object.entries(item.finished.files)) {
        mkdirSync(join(path, file, '..'), { recursive: true })
        writeFileSync(join(path, file), content)
      }
      git(path, 'add', '-A')
      git(path, 'commit', '-q', '-m', item.title)
      git(path, 'checkout', '-q', 'main')
      updateItem(HOME, project.slug, filed.id, { state: 'branch', branch, summary: item.finished.summary, proof: item.finished.proof }, NOW - (3 + at) * HOUR)
      // Its description, as the agent that made it writes one. Without it, hobkin would send an agent to write it.
      const description = prFile(HOME, project.slug, filed.id)
      mkdirSync(join(description, '..'), { recursive: true })
      writeFileSync(description, `# ${item.title}\n\n${item.finished.summary}\n\n## Proof\n\n${item.finished.proof}\n`)
    }
  }
  // Work mode is on and starts nothing by itself (auto-pick off), so the scripted host's runner, which runs nothing,
  // is never asked to. What it spent today is what agents would have.
  writeMode(HOME, { enabled: true, folder: CODE, autoPick: false, autoPickChoice: false, agents: 4, lastDiscoveryAt: new Date(NOW).toISOString() })
  for (const [slug, lane, tokens, hoursAgo] of [['storefront', 'do', 9_400_000, 9], ['atlas-api', 'do', 12_100_000, 7], ['atlas-api', 'look', 2_300_000, 6], ['field-notes', 'do', 8_800_000, 4], ['ledger-sync', 'do', 5_600_000, 2]] as const) {
    recordTokens(HOME, { slug, lane, tokens }, NOW - hoursAgo * HOUR)
  }
  // One more project hobkin found and proposes, for the user to take or skip.
  proposeProject(HOME, { slug: 'pulse-mobile', name: 'pulse-mobile', path: join(CODE, 'pulse-mobile'), level: 'important', why: 'Active this week, with 14 open issues and no tests on the sync code.', first: [] }, NOW - 2 * HOUR)
}

// ---------------------------------------------------------------------------------------------------------------
// Memories, as the user and hobkin saved them.

const MEMORIES: { name: string; kind: string; description: string; text: string; by: 'user' | 'main'; until?: string; hoursAgo: number }[] = [
  { name: 'release-freeze', kind: 'date', description: 'Storefront release freeze from December 15 to January 5', text: 'No storefront deploys from December 15 to January 5. Fixes for P0 bugs still ship, with a second review.', by: 'user', until: '2027-01-05', hoursAgo: 2 },
  { name: 'tests-before-merge', kind: 'preference', description: 'Every change needs a passing test run before it merges', text: 'Say which command proved it, at the last commit.', by: 'user', hoursAgo: 300 },
  { name: 'pnpm-only', kind: 'preference', description: 'Use pnpm in every JavaScript project, never npm or yarn', text: 'Install, run and add packages with pnpm.', by: 'user', hoursAgo: 520 },
  { name: 'webhooks-unlimited', kind: 'decision', description: 'atlas-api webhooks are never rate limited', text: 'Payment and refund webhooks come from providers, not partners. Limits apply to partner API keys only.', by: 'main', hoursAgo: 1 },
  { name: 'checkout-target', kind: 'decision', description: 'Checkout is measured by time to pay, target under 40 seconds', text: 'Measured from the cart page to the payment confirmation, median of the last 7 days.', by: 'user', hoursAgo: 96 },
  { name: 'small-prs', kind: 'preference', description: 'Keep pull requests under 400 changed lines', text: 'Split anything bigger into a stack, each layer with its own tests.', by: 'user', hoursAgo: 410 },
  { name: 'design-tokens', kind: 'pointer', description: 'Storefront colors and spacing live in design/tokens.json', text: 'Never hard-code a color or a spacing value in storefront components.', by: 'main', hoursAgo: 150 },
  { name: 'on-call-week', kind: 'user', description: 'On call the first week of every month', text: 'Keep those mornings light: no long reviews before noon.', by: 'user', hoursAgo: 700 },
  { name: 'finance-export', kind: 'project', description: "ledger-sync's CSV export is read by finance every Monday at 8:00", text: 'Its columns and their order are a contract. Ask before changing either.', by: 'main', hoursAgo: 60 },
  { name: 'staging', kind: 'pointer', description: 'Storefront staging is at staging.storefront.example', text: 'Deploys from main every 30 minutes.', by: 'main', hoursAgo: 220 },
]

function seedMemories() {
  for (const memory of MEMORIES) {
    const { name, kind, description, text, by, until, hoursAgo } = memory
    addMemory(HOME, { name, kind, description, text, ...(until ? { until } : {}) }, { by: { kind: by }, now: NOW - hoursAgo * HOUR })
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Routines, as files in the home, and what each one reports when it runs.

interface Routine {
  id: string
  title: string
  folder: 'daily' | 'weekly' | 'monthly'
  when: Record<string, unknown>
  effort: string
  instructions: string
  report: string
  short?: string
  /** How long ago it ran, in hours. */
  ranHoursAgo: number
}

const ROUTINES: Routine[] = [
  {
    id: 'morning-brief',
    ranHoursAgo: 13,
    title: 'Morning brief',
    folder: 'daily',
    when: { at: '08:00' },
    effort: 'medium',
    instructions: 'Morning brief. Read what changed overnight in every project, the pull requests waiting on me and anything due today. Lead with what needs me.',
    report: [
      '**Useful:** three finished changes are ready to merge, and one P0 fix is still running.',
      '',
      '## Needs you',
      '- **Session cookie is sent on cross-site requests** (storefront, P0): finished with proof, ready to merge.',
      '- **Refund webhook is retried twice on a timeout** (atlas-api, P1): ready, 9 tests passing.',
      '- #212 *Add Apple Pay to checkout* waits for your review since yesterday.',
      '',
      '## Overnight',
      '| Project | Merged | Running | Waiting |',
      '| --- | --- | --- | --- |',
      '| storefront | 2 | 1 | 2 |',
      '| atlas-api | 1 | 2 | 1 |',
      '| field-notes | 0 | 1 | 1 |',
      '| ledger-sync | 1 | 0 | 1 |',
      '',
      '## Today',
      '- Storefront release freeze starts **December 15**: 19 days left.',
      '- The finance export runs Monday at 8:00; the streaming change is ready before then.',
      '',
      'Next: merge the two ready security and refund fixes before the 10:00 deploy window.',
    ].join('\n'),
    short: 'Three changes ready to merge, one P0 still running, and a pull request waits on you.',
  },
  {
    id: 'dependency-watch',
    ranHoursAgo: 14,
    title: 'Dependency watch',
    folder: 'weekly',
    when: { weekday: 1, at: '09:15' },
    effort: 'medium',
    instructions: 'Dependency watch. Check every project for security advisories and updates worth taking. File work for anything that matters.',
    report: [
      '**Critical:** `jsonwebtoken` 9.0.1 in atlas-api has a published advisory for key confusion. The fix is 9.0.3.',
      '',
      '| Package | Project | Now | Fixed in | Why |',
      '| --- | --- | --- | --- | --- |',
      '| jsonwebtoken | atlas-api | 9.0.1 | 9.0.3 | advisory, high |',
      '| pg | atlas-api | 8.11.3 | 8.13.1 | pool leak on reconnect |',
      '| marked | field-notes | 12.0.0 | 12.2.1 | table rendering |',
      '',
      'Filed **Update jsonwebtoken to 9.0.3** as P0 in atlas-api. The Postgres update is already running.',
    ].join('\n'),
    short: 'A high advisory in atlas-api: jsonwebtoken needs 9.0.3. Filed as P0.',
  },
  {
    id: 'flaky-tests',
    ranHoursAgo: 3,
    title: 'Flaky test hunt',
    folder: 'daily',
    when: { at: '18:30' },
    effort: 'high',
    instructions: 'Flaky test hunt. Read the last day of test runs in every project and find tests that pass and fail on the same commit.',
    report: [
      '**Useful:** one flaky test found in storefront, and an agent is already fixing it.',
      '',
      '`test/cart/total.test.ts` failed 11 times in 200 runs on the same commit. It builds the weekend discount from the real clock, so it fails whenever the suite runs between midnight UTC and local midnight on a Saturday.',
      '',
      'Filed **Fix the flaky cart total test** (P0 with the bug it hides). Nothing else flaked in atlas-api, field-notes or ledger-sync.',
    ].join('\n'),
    short: 'The cart total test fails 1 run in 20 because of the clock. A fix is running.',
  },
  {
    id: 'pr-sweep',
    ranHoursAgo: 5,
    title: 'Pull request sweep',
    folder: 'daily',
    when: { window: { start: '09:00', end: '17:00', everyMinutes: 120 } },
    effort: 'low',
    instructions: 'Pull request sweep. List pull requests that wait on me or went quiet for more than a day.',
    report: '**Useful:** 2 pull requests wait for your review, and #198 has had no answer for 3 days.\n\n- #212 Add Apple Pay to checkout (storefront)\n- #87 Partner sandbox keys (atlas-api)\n- #198 Dark mode for the editor (field-notes), quiet since Monday',
    short: 'Two pull requests wait on you, and one went quiet three days ago.',
  },
  {
    id: 'standup-notes',
    ranHoursAgo: 12,
    title: 'Standup notes',
    folder: 'weekly',
    when: { weekday: [1, 2, 3, 4, 5], at: '09:45' },
    effort: 'low',
    instructions: 'Standup notes. Say in five lines what merged yesterday, what runs today and what is stuck, for the team channel. Do not post it.',
    report: '**Useful:** the notes for today are ready to paste.\n\n- Merged: coupon cleanup in storefront, the Postgres pool fix in atlas-api.\n- Running: rate limits, one-step checkout, offline drafts.\n- Stuck: nothing.',
    short: 'Standup notes ready: two merges yesterday, three changes running, nothing stuck.',
  },
  {
    id: 'release-notes',
    ranHoursAgo: 6,
    title: 'Release notes draft',
    folder: 'weekly',
    when: { weekday: 4, at: '16:00' },
    effort: 'medium',
    instructions: 'Release notes draft. Write the notes for this week from what merged, in the voice of the changelog, grouped by project.',
    report: '**Useful:** a draft of this week\'s notes, 9 changes in 3 projects.\n\n### storefront\n- Checkout keeps your cart between visits.\n- Product images load as you scroll.\n\n### atlas-api\n- Faster order lists for partners with many orders.',
    short: "This week's release notes are drafted: 9 changes in 3 projects.",
  },
  {
    id: 'mac-cleanup',
    ranHoursAgo: 27,
    title: 'Mac cleanup',
    folder: 'weekly',
    when: { weekday: 5, at: '17:00' },
    effort: 'low',
    instructions: 'Mac cleanup. Find build output and caches older than a month in the projects and say how much space they take.',
    report: '**Nothing new.** 2.1 GB of build output is older than a month, the same as last week. Nothing was removed.',
  },
]

function seedRoutines() {
  for (const routine of ROUTINES) {
    const folder = join(HOME, 'routines', routine.folder)
    mkdirSync(folder, { recursive: true })
    const head = { id: routine.id, title: routine.title, ...routine.when, timezone: 'America/Toronto', enabled: true, harness: 'pi', model: null, effort: routine.effort, cwd: CODE, context: [] }
    writeFileSync(join(folder, `${routine.id}.md`), `---\n${JSON.stringify(head, null, 2)}\n---\n${routine.instructions}\n`)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// hobkin itself, on the home: the routines run and report, and the chat has a morning's talk.

const CHAT: { ask: string; reply: string }[] = [
  {
    ask: 'What needs me today?',
    reply: [
      'Three things, most urgent first:',
      '',
      '1. **Session cookie fix** in storefront is finished and proved. It is P0, so I would merge it before the 10:00 deploy.',
      '2. **Refund webhook fix** in atlas-api is ready too: 9 tests pass, including the double delivery.',
      '3. **#212 Add Apple Pay to checkout** waits for your review since yesterday.',
      '',
      'Six agents are at work: two you started, three from the queue and the pull request sweep. Nothing is blocked.',
    ].join('\n'),
  },
]

const reply = ({ prompt }: ScriptedCall): ScriptedReply => {
  const typed = prompt.trim().split('\n').at(-1)?.trim() ?? ''
  const turn = CHAT.find(({ ask }) => typed.endsWith(ask))
  return { text: turn?.reply ?? 'Done.', chunkMs: 0 }
}

/** The job runner: each routine answers with its report, and a short version with its short words. */
async function harness(request: { id: string; prompt?: string; purpose?: string; model?: string; effort?: string }) {
  const prompt = request.prompt ?? ''
  const routine = ROUTINES.find(({ instructions }) => prompt.includes(instructions.slice(0, 40)))
  const short = request.purpose === 'short-report' ? ROUTINES.find(({ report }) => prompt.includes(report.slice(0, 60)))?.short : undefined
  const text = request.purpose === 'short-report' ? (short ?? '') : (routine?.report ?? 'Done.')
  await pause(300)
  return { id: request.id, harness: 'pi', status: short === '' ? 'failed' : 'completed', text, cost: null, model: request.model, effort: request.effort, sessionId: request.id, freshSession: true }
}

/** How far this process's clock is set back, in milliseconds: only while the seed runs the routines. */
let shift = 0
const RealDate = Date
globalThis.Date = class extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + shift)
    else super(...(args as [string]))
  }

  static override now() {
    return RealDate.now() + shift
  }
} as DateConstructor

async function seedHobkin() {
  const { HobkinApplication } = await import('hobkin/src/cli/application.mjs')
  const model = await createScriptedModel(HOME, { reply })
  const refuseNetwork = async () => {
    throw Error('The demo seed reaches no network.')
  }
  const app = await HobkinApplication.open(HOME, { createMain: model.createMain, runHarness: harness, sessionDependencies: model.dependencies, fetch: refuseNetwork })
  try {
    // This process's clock is set back while each routine runs, so its run and report say when it would have come in.
    for (const routine of ROUTINES.toSorted((left, right) => right.ranHoursAgo - left.ranHoursAgo)) {
      shift = -routine.ranHoursAgo * HOUR
      await (app.runner as unknown as { trigger(id: string, request: string): Promise<unknown> }).trigger(routine.id, `seed:${routine.id}`)
      await pause(2000)
    }
    shift = 0
    for (const { ask } of CHAT) await app.send(ask)
    // Long enough for the runs to finish, their reports to be listed and their short versions made.
    await pause(8000)
  } finally {
    await app.close()
  }
}

makeRepos()
seedWork()
// What hobkin's half-hourly survey of unmerged branches would have found, so the finished changes are listed now.
await surveyUnmerged(HOME)
seedMemories()
seedRoutines()
await seedHobkin()
console.log('seeded', HOME)

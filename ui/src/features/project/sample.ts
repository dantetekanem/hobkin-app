import { DECIDED_MAX, type DecidedChange, type WorkMetrics } from '#shared/protocol/metrics.ts'
import type { ModelFact, RunGuide, WorkState } from '#shared/protocol/work.ts'
import { dateOf } from '../numbers/format.ts'

/**
 * What a project's page adds to the samples for a window with no host: the list of each change merged or declined,
 * made from the numbers' own sample days so the list and the charts agree, and the models of the two sample projects
 * whose numbers count proofs. Nothing here came from hobkin.
 */

const TITLES: Record<string, readonly string[]> = {
  storefront: [
    'Keep the cart total between page loads',
    'Show stock on the product page',
    'Make the order confirmation email say which items ship separately and when each one is expected to arrive',
    'Fix the coupon field on mobile',
    'Cache the category menu',
    'Trim the checkout bundle',
    'Remember the last search',
    'Add alt text to product images',
    'Retry a failed payment once',
    'Fix the sort on sale items',
    'Speed up the order history page',
  ],
  'billing-api': [
    'Log each webhook delivery',
    'Round tax once per invoice',
    'Add an index for invoice lookups',
    'Fix the currency on credit notes',
    'Retry a failed export once',
    'Reject a refund larger than its charge',
  ],
  'docs-site': ['Fix the broken links in the API guide', 'Add a page on rate limits', 'Explain the new sign-in steps', 'Shorten the install guide'],
}

const HOUR_MS = 3_600_000

/** A short commit from words, the same for the same words. FNV-1a. */
function headOf(words: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < words.length; index += 1) {
    hash = Math.imul(hash ^ words.charCodeAt(index), 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 7)
}

/**
 * The numbers' sample with the list of each change merged or declined in it, newest first: on each day, its merges by
 * itself, then by the user, then its declines, the first of them sent back when the day counts some not first pass.
 */
export function withSampleDecided(metrics: WorkMetrics): WorkMetrics {
  if (metrics.decided) return metrics
  const decided: DecidedChange[] = []
  for (const { slug, days } of metrics.projects) {
    const titles = TITLES[slug] ?? []
    if (!titles.length) continue
    let count = 0
    for (const day of days) {
      const outcomes = [
        ...Array<DecidedChange['outcome']>(day.mergedByItself).fill('merged-by-itself'),
        ...Array<DecidedChange['outcome']>(day.mergedByYou).fill('merged-by-you'),
        ...Array<DecidedChange['outcome']>(day.declined).fill('declined'),
      ]
      const sentBack = Math.max(0, outcomes.length - day.firstPass)
      outcomes.forEach((outcome, index) => {
        const item = headOf(`${slug}:${day.day}:${index}:item`).slice(0, 6)
        const at = new Date(dateOf(day.day).getTime() + (9 + index * 2) * HOUR_MS).toISOString()
        decided.push({
          slug,
          item,
          title: titles[count % titles.length]!,
          at,
          outcome,
          sentBack: index < sentBack ? 1 + (index % 2) : 0,
          ...(outcome === 'declined' ? {} : { head: headOf(`${slug}:${day.day}:${index}`) }),
        })
        count += 1
      })
    }
  }
  const newestFirst = decided.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return { ...metrics, decided: newestFirst.slice(0, DECIDED_MAX) }
}

/** The sample projects' models on the default branch. They open the proof sample's runs. */
const SAMPLE_MODELS: Record<string, ModelFact[]> = {
  storefront: [
    { spec: '_specs/tla/Checkout.tla', state: 'holds', run: 'sample-proved', line: 'TLAPS: 9 of 9 steps proved · TLC: 4 of 4 hold in 48,211 states' },
    { spec: '_specs/tla/Cart.tla', state: 'holds', run: 'sample-holds', line: 'TLC: 3 of 3 hold in 12,940 states' },
  ],
  'billing-api': [{ spec: '_specs/tla/Invoice.tla', state: 'unchecked' }],
}

/** Work's sample with the sample projects' models, for the page alone: Work's own sample has none. */
export function withSampleModels(work: WorkState): WorkState {
  const projects = work.projects.map((project) => {
    const models = SAMPLE_MODELS[project.slug]
    if (project.models || !models) return project
    return { ...project, models }
  })
  return { ...work, projects }
}

const DAY_MS = 24 * HOUR_MS

const STOREFRONT_GUIDE = `## What you need

- Node 22 and pnpm 11 (\`package.json\` › engines)
- Postgres 16 running on this Mac (\`README.md\` › Requirements)
- A Stripe test key in \`STRIPE_SECRET_KEY\`: Stripe's dashboard, Developers › API keys, in test mode (\`.env.example\`)

## Set up once

1. \`pnpm install\` (\`README.md\` › Setup)
2. \`cp .env.example .env\`, then fill in \`STRIPE_SECRET_KEY\`. The README leaves this step out. (\`.env.example\`)

## Database

1. \`pnpm db:create\` and \`pnpm db:migrate\` (\`package.json\` › scripts)
2. \`pnpm db:seed\` makes a shop with 40 products and a login, \`demo@storefront.test\` with the password \`demo\` (\`db/seed.ts\`)

## Run it

1. In its own terminal: \`pnpm dev\`, which starts the app on port 3000 (\`package.json\` › scripts)
2. Open http://localhost:3000 and sign in with the seed's login.

## Try a change

Switch to the change's branch. When it changes \`package.json\` or \`db/migrations\`, run \`pnpm install\` and \`pnpm db:migrate\` again, then start \`pnpm dev\` again.

## Stop

Control-C in the \`pnpm dev\` terminal. Postgres keeps running: \`brew services stop postgresql@16\` stops it.
`

const BILLING_GUIDE = `## What you need

- Ruby 3.4 and Bundler (\`.ruby-version\`, \`Gemfile\`)
- Postgres 16 and Redis 7 (\`docker-compose.yml\`)

## Set up once

1. \`bin/setup\`, which installs the gems and copies \`.env.example\` to \`.env\` (\`bin/setup\`)
2. Fill in \`STRIPE_WEBHOOK_SECRET\` in \`.env\`: Stripe's dashboard, Developers › Webhooks (\`.env.example\`)

## Database

1. \`docker compose up -d db redis\` (\`docker-compose.yml\`)
2. \`bin/rails db:prepare\` creates, migrates and seeds it (\`README.md\` › Database)

## Run it

1. In its own terminal: \`bin/dev\`, on port 4000 (\`Procfile.dev\`)
2. Open http://localhost:4000/up, which answers OK.

## Try a change

Switch to the change's branch, run \`bin/rails db:migrate\`, and start \`bin/dev\` again.

## Stop

Control-C in the \`bin/dev\` terminal, then \`docker compose stop\`.
`

/**
 * The sample projects' run guides (_specs/068-run-guide): storefront's worked three days ago, billing-api's stopped at
 * its database nine days ago, docs-site has none yet, and the goal has none by hobkin's refusal.
 */
export function sampleRunGuide(slug: string, now: number): RunGuide {
  const none: RunGuide = { slug, text: null, writtenAt: null, commit: null, sources: [], lastRun: null, pending: null, refused: null }
  const ago = (days: number) => new Date(now - days * DAY_MS).toISOString()
  if (slug === 'storefront') {
    return {
      ...none,
      text: STOREFRONT_GUIDE,
      writtenAt: ago(3.1),
      commit: headOf('storefront:guide'),
      sources: ['README.md', 'package.json', '.env.example', 'db/seed.ts'],
      lastRun: { at: ago(3), by: 'guide', item: null, worked: true, reached: null, note: 'http://localhost:3000 answered with the shop’s home page.' },
    }
  }
  if (slug === 'billing-api') {
    return {
      ...none,
      text: BILLING_GUIDE,
      writtenAt: ago(9.2),
      commit: headOf('billing-api:guide'),
      sources: ['README.md', 'bin/setup', 'docker-compose.yml', 'Procfile.dev'],
      lastRun: { at: ago(9), by: 'item', item: '0f6a3b', worked: false, reached: 'Set up once', note: 'db:prepare failed: the seeds need a currency table the migrations no longer make.' },
    }
  }
  if (slug === 'marathon-plan') return { ...none, refused: 'A goal has no run guide: there is no app to run.' }
  return none
}

/** What hobkin says to a press on the sample. Nothing is filed. */
export function sampleGuideAsked(slug: string): string {
  return `A guide look waits at the front of ${slug}'s queue. It runs when work mode lets it.`
}

import { DECIDED_MAX, type DecidedChange, type WorkMetrics } from '#shared/protocol/metrics.ts'
import type { ModelFact, WorkState } from '#shared/protocol/work.ts'
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

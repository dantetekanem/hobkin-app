import { emptyMetricsDay, METRICS_DAYS_MAX, type MetricsDay, type MetricsSpan, type MetricsSpans, type ProjectMetrics, type WorkMetrics } from '#shared/protocol/metrics.ts'
import { localDay, sumDays } from './format.ts'

/**
 * Made-up numbers for a window with no host, for Work's sample projects (`features/work/sample.ts`, same slugs and
 * names): 90 days drawn from one fixed seed, so every read is the same. Work mode started 90 days ago, so a longer
 * read is empty before that. There are three empty days, one bad week three weeks ago (tests broke, changes were sent
 * back, reviews said risky, a proof broke and one change merged by itself regressed), and design-kit, just taken,
 * has nothing yet. Today matches Work's sample: 7 merged, 4 by itself, 38M tokens. Nothing here came from hobkin.
 */

/** The days the sample has numbers for. */
export const SAMPLE_DAYS = 90

const SEED = 5
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

interface Profile {
  slug: string
  /** Changes merged on an ordinary day, on average. */
  pace: number
  tokensPerRun: number
  /** Has TLA+ models, so proofs run. */
  models: boolean
  /** Ready for YOLO mode once it is on. */
  yolo: boolean
}

const PROFILES: readonly Profile[] = [
  { slug: 'storefront', pace: 1.2, tokensPerRun: 5_200_000, models: true, yolo: true },
  { slug: 'billing-api', pace: 0.6, tokensPerRun: 6_800_000, models: true, yolo: true },
  { slug: 'docs-site', pace: 0.25, tokensPerRun: 1_800_000, models: false, yolo: false },
  { slug: 'design-kit', pace: 0, tokensPerRun: 0, models: false, yolo: false },
]

/** Days by index from the oldest (0) to today (89). */
const EMPTY = new Set([12, 13, 47])
const BAD_WEEK = { from: 62, to: 68 }
const YOLO_FROM = 40
const REGRESSION = { index: 64, slug: 'storefront' }
/** Today, as Work's sample has it. */
const TODAY: Record<string, { itself: number; you: number; tokens: number }> = {
  storefront: { itself: 3, you: 1, tokens: 24_000_000 },
  'billing-api': { itself: 1, you: 1, tokens: 12_500_000 },
  'docs-site': { itself: 0, you: 1, tokens: 1_500_000 },
}

/** What one project did on one day, with the spans measured that day. */
interface SampleDay {
  counts: MetricsDay
  waits: number[]
  startToMerge: number[]
  reviews: number[]
}

/** mulberry32: a small generator that gives the same numbers for the same seed. */
function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** A seed of its own for each project and day, so one day's draws never shift another's. FNV-1a over the words. */
function seedOf(words: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < words.length; index += 1) hash = Math.imul(hash ^ words.charCodeAt(index), 0x01000193)
  return hash >>> 0
}

function generate(): Map<string, SampleDay[]> {
  let random = generator(SEED)
  const poisson = (mean: number) => {
    const floor = Math.exp(-mean)
    let count = 0
    for (let product = random(); product > floor; product *= random()) count += 1
    return count
  }
  const binomial = (trials: number, chance: number) => {
    let hits = 0
    for (let trial = 0; trial < trials; trial += 1) if (random() < chance) hits += 1
    return hits
  }
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  const spread = (base: number, width: number) => Math.round((base * Math.exp(normal() * width)) / 1000) * 1000

  const model = new Map<string, SampleDay[]>(PROFILES.map((profile) => [profile.slug, []]))
  for (let index = 0; index < SAMPLE_DAYS; index += 1) {
    const bad = index >= BAD_WEEK.from && index <= BAD_WEEK.to
    for (const profile of PROFILES) {
      const counts = emptyMetricsDay('')
      const sample: SampleDay = { counts, waits: [], startToMerge: [], reviews: [] }
      model.get(profile.slug)!.push(sample)
      if (profile.pace === 0 || EMPTY.has(index)) continue
      random = generator(seedOf(`${SEED}:${profile.slug}:${index}`))

      const today = index === SAMPLE_DAYS - 1 ? TODAY[profile.slug] : undefined
      const merged = today ? today.itself + today.you : poisson(profile.pace * (bad ? 0.5 : 1))
      const yoloShare = profile.yolo && index >= YOLO_FROM ? Math.min(0.6, 0.2 + (index - YOLO_FROM) * 0.01) : 0
      counts.mergedByItself = today ? today.itself : bad ? 0 : binomial(merged, yoloShare)
      counts.mergedByYou = merged - counts.mergedByItself
      if (index === REGRESSION.index && profile.slug === REGRESSION.slug) {
        counts.mergedByItself = Math.max(1, counts.mergedByItself)
        counts.regressed = 1
      }
      counts.declined = poisson((bad ? 0.5 : 0.08) * profile.pace)
      const decided = counts.mergedByItself + counts.mergedByYou + counts.declined
      counts.sentBack = poisson((bad ? 2.2 : 0.25) * profile.pace)
      counts.firstPass = decided - binomial(decided, bad ? 0.55 : 0.1)
      counts.finished = decided + poisson(0.3)
      counts.started = counts.finished + poisson(0.4 * profile.pace)
      const answered = counts.finished
      counts.reviewsSafe = binomial(answered, bad ? 0.45 : 0.85)
      counts.reviewsRisky = answered - counts.reviewsSafe
      counts.reviewsFailed = random() < 0.06 ? 1 : 0
      counts.proofsHold = profile.models ? poisson(0.7 * profile.pace) : 0
      counts.proofsBroken = profile.models && (bad ? random() < 0.5 : random() < 0.03) ? 1 : 0
      counts.questions = poisson(0.2)
      counts.stops = random() < 0.05 ? 1 : 0
      if (today) {
        counts.tokens = today.tokens
      } else {
        const spent = counts.started * profile.tokensPerRun * (0.6 + 0.8 * random())
        counts.tokens = Math.round(spent / 10_000) * 10_000
      }

      for (let change = 0; change < counts.mergedByYou + counts.declined; change += 1) {
        sample.waits.push(spread((bad ? 6 : 2.5) * HOUR_MS, 0.9))
      }
      for (let change = 0; change < counts.mergedByItself + counts.mergedByYou; change += 1) {
        sample.startToMerge.push(spread((bad ? 11 : 5) * HOUR_MS, 0.7))
      }
      for (let review = 0; review < answered; review += 1) {
        sample.reviews.push(spread(7 * MINUTE_MS, 0.5))
      }
    }
  }
  return model
}

const MODEL = generate()

/** The nearest-rank quantile of measured spans. */
function quantile(sorted: readonly number[], share: number): number | null {
  return sorted.length ? sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)]! : null
}

function spanOf(values: readonly number[]): MetricsSpan {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), count: sorted.length }
}

function spansOf(days: readonly SampleDay[]): MetricsSpans {
  return {
    waitForYou: spanOf(days.flatMap((day) => day.waits)),
    startToMerge: spanOf(days.flatMap((day) => day.startToMerge)),
    aiReview: spanOf(days.flatMap((day) => day.reviews)),
  }
}

const EMPTY_DAY: SampleDay = { counts: emptyMetricsDay(''), waits: [], startToMerge: [], reviews: [] }

/**
 * The sample's numbers for the last `days` local days, ending on the day of `today`, in the shape `work.metrics`
 * answers. Days before the sample's 90 are empty; `days` is held between 1 and 180.
 */
export function sampleMetrics(days = 30, today: Date = new Date()): WorkMetrics {
  const count = Math.min(METRICS_DAYS_MAX, Math.max(1, Math.round(days)))
  const names = Array.from({ length: count }, (_, index) => {
    const daysBefore = count - 1 - index
    return localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBefore))
  })
  const window = (slug: string): SampleDay[] => {
    const held = MODEL.get(slug)!.slice(-count)
    return [...Array<SampleDay>(count - held.length).fill(EMPTY_DAY), ...held]
  }

  const projects: ProjectMetrics[] = PROFILES.map(({ slug }) => {
    const sample = window(slug)
    return {
      slug,
      name: slug,
      days: sample.map((day, index) => ({ ...day.counts, day: names[index]! })),
      spans: spansOf(sample),
    }
  })
  const every = PROFILES.flatMap(({ slug }) => window(slug))

  return {
    from: names[0]!,
    to: names.at(-1)!,
    at: today.toISOString(),
    all: {
      days: names.map((day, index) => ({ ...sumDays(projects.map((project) => project.days[index]!)), day })),
      spans: spansOf(every),
    },
    projects,
    gaps: [],
  }
}

import type { YoloPart, YoloProject, YoloState } from '#shared/protocol/work.ts'

/**
 * What the YOLO mode tile says (049-yolo-mode). The switch, the rate and each project's readiness are hobkin's, read
 * from its work status. These are only the words.
 */

const LABELS: Record<string, string> = {
  tests: 'Tests',
  errors: 'Error tracking',
  slowQueries: 'Slow queries',
  performance: 'Performance metrics',
  logs: 'Searchable logs',
  alerts: 'Alerts',
  rollback: 'Rollback',
  deploy: 'Deploy',
  models: 'Models',
}
const NEEDED = ['tests', 'rollback', 'models']

/** A sample project's parts: every one done, but for the ones given. */
const sampleParts = (change: Record<string, Partial<YoloPart>> = {}): YoloPart[] =>
  Object.entries(LABELS).map(([name, label]): YoloPart => {
    const needed = NEEDED.includes(name)
    const part: Omit<YoloPart, 'blocks'> = { name, label, state: 'done', line: 'In place on the default branch.', needed, ...change[name] }
    return { ...part, blocks: needed && name !== 'models' && part.state !== 'done' }
  })

const SAMPLE_PR = 'https://github.com/acme/billing-api/pull/42'

const STEP_TAKEN = 'You took its step, "Verify the Sentry alert route", and the next check confirms it.'
const WORK_LEFT = 'it still has work left: The independent review still needs to cover the committed range.'

/** What the page draws with no host: a few projects, so what YOLO mode does on each, what holds it back and each part can be seen. */
export const SAMPLE_YOLO: YoloState = {
  on: true,
  rate: 8,
  lowest: 6,
  highest: 10,
  ready: 2,
  waits: null,
  projects: [
    {
      slug: 'storefront',
      name: 'storefront',
      on: true,
      ready: true,
      needs: [],
      work: 'landed',
      checkedAt: '2026-11-18T16:20:00Z',
      parts: sampleParts({
        errors: { state: 'doing', line: STEP_TAKEN, action: 'sample-action' },
        alerts: { state: 'doing', line: STEP_TAKEN, action: 'sample-action' },
        deploy: { state: 'user', line: 'Make space for the release build', action: 'sample-action' },
      }),
      changes: [
        { item: 's2', title: 'Selling more than owned returns an error', kind: 'a bug fix', rate: 7.6, why: WORK_LEFT },
        { item: 's3', title: 'Difficulty multipliers apply to rewards', kind: 'a state machine fix', rate: 7.4, why: WORK_LEFT },
      ],
      merged: [],
    },
    {
      slug: 'search-api',
      name: 'search-api',
      on: true,
      ready: true,
      needs: [],
      work: 'landed',
      checkedAt: '2026-11-19T08:10:00Z',
      parts: sampleParts({ performance: { state: 'pr', line: 'Request timings with last week as the baseline.', pr: 'https://github.com/acme/search-api/pull/12', branch: 'hobkin/q1-metrics', item: 'q1' } }),
      changes: [{ item: 'q4', title: 'Cache the facet counts', kind: 'performance work', rate: 9.2, why: null }],
      merged: [
        { at: '2026-11-19T15:30:00Z', item: 'q3', title: 'Drop the N+1 on saved searches', kind: 'performance work', rate: 9, head: '4be71c2', deploy: 'It deployed and held for 30 minutes: No new errors. No slow queries. p95 112 ms against a baseline of 140 ms.', held: true },
        { at: '2026-11-18T11:05:00Z', item: 'q2', title: 'Bump the HTTP client', kind: 'a package update', rate: 8.4, head: '9a0d3f1', deploy: 'It deployed and held for 30 minutes: No new errors. No slow queries. p95 139 ms against a baseline of 140 ms.', held: true },
      ],
    },
    {
      slug: 'billing-api',
      name: 'billing-api',
      on: true,
      ready: false,
      needs: ['Tests: its PR waits for your merge.'],
      work: 'landed',
      checkedAt: '2026-11-19T10:05:00Z',
      parts: sampleParts({
        tests: { state: 'pr', line: 'bin/test runs the suite again.', pr: SAMPLE_PR, branch: 'hobkin/b1-tests', item: 'b1' },
        slowQueries: { state: 'pr', line: 'Queries over 100 ms are logged, and the suite fails on an N+1.', pr: SAMPLE_PR, branch: 'hobkin/b1-tests', item: 'b1' },
        deploy: { state: 'todo', line: 'No deploy path is written down yet.' },
      }),
      changes: [{ item: 'b4', title: 'Round invoice totals once', kind: 'a bug fix', rate: 8.8, why: null }],
      merged: [],
    },
    {
      slug: 'docs-site',
      name: 'docs-site',
      // The user turned YOLO mode off here, so the page shows it as one line.
      on: false,
      ready: false,
      needs: ['Tests: its branch waits for your merge.'],
      work: 'waiting',
      checkedAt: '2026-11-19T14:40:00Z',
      parts: sampleParts({
        tests: { state: 'pr', line: 'pnpm test runs the link checker.', branch: 'hobkin/d1', item: 'd1' },
        slowQueries: { state: 'done', line: 'It has no database.' },
        deploy: { state: 'done', line: 'Nothing deploys: the site is built by its host.', deploys: false },
      }),
      changes: [
        { item: 'd4', title: 'Fix the broken anchor links', kind: 'a bug fix', rate: 9, why: 'YOLO mode is off on its project' },
        { item: 'd5', title: 'Bump the link checker', kind: 'a package update', rate: 9.4, why: 'YOLO mode is off on its project' },
      ],
      merged: [],
    },
  ],
}

/** "3 of 5 projects ready". */
export function readyCount({ ready, projects }: YoloState): string {
  if (!projects.length) return 'No projects yet'
  return `${ready} of ${projects.length} ${projects.length === 1 ? 'project' : 'projects'} ready`
}

/** The tile's heading: off, or how far along the projects are. */
export const yoloValue = (yolo: YoloState): string => (yolo.on ? `On · ${readyCount(yolo)}` : 'Off')

/** What the switch means as it stands. */
export function yoloSays(yolo: YoloState): string {
  if (!yolo.on) return 'Every merge and deploy asks you. Turning this on merges nothing: hobkin first files one feature on each project it is on for to get it ready.'
  return `On a ready project it is on for, a small change its review rates ${yolo.rate} or more merges and deploys by itself, and hobkin reports it. Features and everything else still ask you.`
}

/** The rates the user may pick, lowest first. */
export const rateChoices = ({ lowest, highest }: YoloState): number[] => Array.from({ length: highest - lowest + 1 }, (_, index) => lowest + index)

/** The projects where every change still asks, each with what it needs first. */
export const stillNeeded = ({ projects }: YoloState): YoloProject[] => projects.filter(({ ready }) => !ready)

/** The sample state after a click, so the tile answers with no host as hobkin would. */
export const sampleAfter = (yolo: YoloState, change: { on?: boolean; rate?: number }): YoloState => ({ ...yolo, ...change })

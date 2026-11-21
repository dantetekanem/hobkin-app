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

/** What the page draws with no host: a few projects, so the count, what holds them back and each part can be seen. */
export const SAMPLE_YOLO: YoloState = {
  on: true,
  rate: 8,
  lowest: 6,
  highest: 10,
  ready: 1,
  projects: [
    {
      slug: 'storefront',
      name: 'storefront',
      ready: true,
      needs: [],
      work: 'landed',
      checkedAt: '2026-11-18T16:20:00Z',
      parts: sampleParts({
        errors: { state: 'pr', line: 'Sentry takes every exception.', pr: 'https://github.com/acme/storefront/pull/18', branch: 'hobkin/r1-monitoring', item: 's1' },
        alerts: { state: 'user', line: 'Put SENTRY_DSN in production', action: 'sample-action', pr: 'https://github.com/acme/storefront/pull/18' },
        models: { state: 'doing', line: 'Its state machines have not been looked for with TLC yet.' },
      }),
    },
    {
      slug: 'billing-api',
      name: 'billing-api',
      ready: false,
      needs: ['Tests: its PR waits for your merge.'],
      work: 'landed',
      checkedAt: '2026-11-19T10:05:00Z',
      parts: sampleParts({
        tests: { state: 'pr', line: 'bin/test runs the suite again.', pr: SAMPLE_PR, branch: 'hobkin/b1-tests', item: 'b1' },
        slowQueries: { state: 'pr', line: 'Queries over 100 ms are logged, and the suite fails on an N+1.', pr: SAMPLE_PR, branch: 'hobkin/b1-tests', item: 'b1' },
        deploy: { state: 'todo', line: 'No deploy path is written down yet.' },
      }),
    },
    {
      slug: 'docs-site',
      name: 'docs-site',
      ready: false,
      needs: ['Tests: its branch waits for your merge.'],
      work: 'waiting',
      checkedAt: '2026-11-19T14:40:00Z',
      parts: sampleParts({
        tests: { state: 'pr', line: 'pnpm test runs the link checker.', branch: 'hobkin/d1', item: 'd1' },
        slowQueries: { state: 'done', line: 'It has no database.' },
      }),
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
  if (!yolo.on) return 'Every merge and deploy asks you. Turning this on merges nothing: hobkin first files one feature on each project to get it ready.'
  return `On a ready project, a small change its review rates ${yolo.rate} or more merges and deploys by itself, and hobkin reports it. Features and everything else still ask you.`
}

/** The rates the user may pick, lowest first. */
export const rateChoices = ({ lowest, highest }: YoloState): number[] => Array.from({ length: highest - lowest + 1 }, (_, index) => lowest + index)

/** The projects where every change still asks, each with what it needs first. */
export const stillNeeded = ({ projects }: YoloState): YoloProject[] => projects.filter(({ ready }) => !ready)

/** The sample state after a click, so the tile answers with no host as hobkin would. */
export const sampleAfter = (yolo: YoloState, change: { on?: boolean; rate?: number }): YoloState => ({ ...yolo, ...change })

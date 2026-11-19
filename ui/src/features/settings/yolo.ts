import type { YoloProject, YoloState } from '#shared/protocol/work.ts'

/**
 * What the YOLO mode tile says (049-yolo-mode). The switch, the rate and each project's readiness are hobkin's, read
 * from its work status. These are only the words.
 */

/** What the tile draws with no host: a few projects, so the count and what is still needed can be seen. */
export const SAMPLE_YOLO: YoloState = {
  on: true,
  rate: 8,
  lowest: 6,
  highest: 10,
  ready: 1,
  projects: [
    { slug: 'storefront', name: 'storefront', ready: true, needs: [] },
    { slug: 'billing-api', name: 'billing-api', ready: false, needs: ['Slow queries: No slow query log, and nothing catches an N+1.', 'Alerts: No alert reaches you.'] },
    { slug: 'docs-site', name: 'docs-site', ready: false, needs: ['Its readiness work waits for your yes.'] },
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

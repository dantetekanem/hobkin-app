import type { ChangeChoice, FinishedChange, FinishedGroup, FinishedGroupName, Landing, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { whenText } from '../routines/words.ts'

/**
 * What the YOLO mode page and the button that opens it say (049-yolo-mode). Where each project's readiness work stands
 * and what it still needs are hobkin's, read from its work status. These are only the words, and which button can be pressed.
 */

/** The button on Work's header, at a glance: "Off", or "On · 2 of 5 ready". */
export function yoloAtAGlance({ on, ready, projects }: YoloState): string {
  if (!on) return 'Off'
  return projects.length ? `On · ${ready} of ${projects.length} ready` : 'On'
}

export type ReadinessTone = 'ok' | 'live' | 'warn' | 'quiet'

/** The branch a project's readiness waits on, as its card on Work shows it, and the group hobkin put that card in. */
export interface WaitingChange {
  change: FinishedChange
  group: FinishedGroupName
}

/** The finished card of a project's readiness work that waits for the user's yes. A hobkin older than `item` does not say which it is. */
export function waitingChange(project: YoloProject, finished: FinishedGroup[]): WaitingChange | null {
  if (project.work !== 'waiting' || !project.item) return null
  for (const { name, changes } of finished) {
    const change = changes.find(({ slug, item }) => slug === project.slug && item === project.item)
    if (change) return { change, group: name }
  }
  return null
}

/** The row's button for each yes that lands a branch, short enough for it. Its card's own words are the button's title. */
const ROW_YES: Record<Landing | 'rebase', string> = { merge: 'Merge', mergePr: 'Merge PR', refreshMerge: 'Refresh, merge', rebase: 'Rebase' }
const landsIt = (choice: { value: ChangeChoice; label: string }): choice is { value: Landing | 'rebase'; label: string } => choice.value in ROW_YES

/** What the row's button does: run readiness, say yes to its branch as its card on Work would, or open that card. */
export type ReadinessPress = { do: 'run' } | { do: 'yes'; change: FinishedChange; choice: Landing | 'rebase' } | { do: 'open'; key: string | null }

/** One project's row on the page. */
export interface ReadinessRow {
  /** Where it stands, in a word or three. */
  state: string
  tone: ReadinessTone
  /** When its readiness was last recorded, or that it never was. */
  checked: string
  /** What is happening, or what the last check found missing, in hobkin's words. */
  detail: string
  /** Run readiness before any check and Check again after one. While its branch waits, the yes or Open on Work. */
  action: string
  press: ReadinessPress
  /** Its card's own words for a yes, when the button is one. */
  title?: string
  /** Not while it runs: hobkin would refuse. */
  canRun: boolean
}

/** A project's row. A hobkin older than the page does not say where the work stands, and its row can still start it. */
export function readinessRow(
  project: YoloProject,
  { workOn, now, zone, waiting = null }: { workOn: boolean; now: number; zone: string; waiting?: WaitingChange | null },
): ReadinessRow {
  const checked = project.checkedAt ? `Checked ${whenText(Date.parse(project.checkedAt), zone, now)}` : 'Not checked yet'
  const action = project.checkedAt ? 'Check again' : 'Run readiness'
  const base = { checked, action, press: { do: 'run' }, canRun: true } as const
  switch (project.work) {
    case 'running':
      return {
        ...base,
        state: 'Running',
        tone: 'live',
        detail: 'An agent is checking it now, on a branch of its own. Nothing merges or deploys.',
        canRun: false,
      }
    case 'queued':
      return {
        ...base,
        state: 'Queued',
        tone: 'live',
        detail: workOn ? `In the queue. ${action} starts it now.` : 'In the queue. It starts once work mode is on.',
      }
    case 'waiting':
      return { ...base, state: 'Waits for your yes', tone: 'warn', ...waitingYes(waiting) }
    case 'none':
      return {
        ...base,
        state: 'Not ready',
        tone: 'quiet',
        detail: 'An agent checks its tests, monitoring, way back and deploy, and builds what is missing on a branch for your yes.',
      }
  }

  // Landed, closed, or a hobkin that does not say: the last check's result stands.
  if (project.ready) return { ...base, state: 'Ready', tone: 'ok', detail: 'Every part is in place.' }
  return { ...base, state: 'Not ready', tone: 'quiet', detail: project.needs.join(' ') }
}

/**
 * The yes on the row itself when hobkin rates the branch ready to merge, or ready once it is brought up to date. When
 * its card needs the user, or the window cannot find it, the button opens it on Work to be read there first.
 */
function waitingYes(waiting: WaitingChange | null): Pick<ReadinessRow, 'action' | 'press' | 'detail' | 'title'> {
  if (!waiting) return { action: 'Open on Work', press: { do: 'open', key: null }, detail: 'Its branch is under Finished changes on Work, and it counts once you merge it.' }
  const { change, group } = waiting
  const yes = group === 'merge' || group === 'refresh' ? change.choices.find(landsIt) : undefined
  if (!yes) return { action: 'Open on Work', press: { do: 'open', key: change.key }, detail: change.reason }
  return { action: ROW_YES[yes.value], press: { do: 'yes', change, choice: yes.value }, detail: change.yes, title: yes.label }
}

/** The sample after Run readiness, so the page answers with no host as hobkin would: the work is queued. */
export const sampleReadiness = (yolo: YoloState, slug: string): YoloState => ({
  ...yolo,
  projects: yolo.projects.map((project) => (project.slug === slug ? { ...project, work: 'queued' } : project)),
})

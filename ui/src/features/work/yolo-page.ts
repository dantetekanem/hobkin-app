import type { YoloProject, YoloState } from '#shared/protocol/work.ts'
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

/** One project's row on the page. */
export interface ReadinessRow {
  /** Where it stands, in a word or three. */
  state: string
  tone: ReadinessTone
  /** When its readiness was last recorded, or that it never was. */
  checked: string
  /** What is happening, or what the last check found missing, in hobkin's words. */
  detail: string
  /** Run readiness before any check, Check again after one. */
  action: 'Run readiness' | 'Check again'
  /** Not while it runs, nor while its branch waits for the user's yes: hobkin would refuse. */
  canRun: boolean
}

/** A project's row. A hobkin older than the page does not say where the work stands, and its row can still start it. */
export function readinessRow(project: YoloProject, { workOn, now, zone }: { workOn: boolean; now: number; zone: string }): ReadinessRow {
  const checked = project.checkedAt ? `Checked ${whenText(Date.parse(project.checkedAt), zone, now)}` : 'Not checked yet'
  const action = project.checkedAt ? 'Check again' : 'Run readiness'
  const base = { checked, action, canRun: true } as const
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
      return {
        ...base,
        state: 'Waits for your yes',
        tone: 'warn',
        detail: 'Its branch is under Finished changes on Work, and it counts once you merge it.',
        canRun: false,
      }
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

/** The sample after Run readiness, so the page answers with no host as hobkin would: the work is queued. */
export const sampleReadiness = (yolo: YoloState, slug: string): YoloState => ({
  ...yolo,
  projects: yolo.projects.map((project) => (project.slug === slug ? { ...project, work: 'queued' } : project)),
})

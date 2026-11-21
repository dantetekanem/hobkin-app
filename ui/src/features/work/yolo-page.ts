import type { ChangeChoice, FinishedChange, FinishedGroup, FinishedGroupName, Landing, YoloPart, YoloPartState, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { whenText } from '../routines/words.ts'

/**
 * What the YOLO mode page and the button that opens it say (049-yolo-mode). Where each project's readiness work stands,
 * what holds it back and where each of its parts stands are hobkin's, read from its work status. These are only the words,
 * and which button can be pressed.
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
        detail: 'An agent is setting it up now: a PR for each part it builds, and an Action Item for what only you can give. Nothing merges or deploys.',
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
        state: 'Not started',
        tone: 'quiet',
        detail: 'An agent sets up its tests, monitoring, way back and deploy, opens a PR for each part, and asks you only for what you alone can give.',
      }
  }

  // Landed, closed, or a hobkin that does not say: the last check's result stands.
  if (project.ready) return { ...base, state: 'Ready', tone: 'ok', detail: stillSetUp(project.parts ?? []) }
  return { ...base, state: 'Getting ready', tone: 'warn', detail: project.needs.join(' ') }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
const STILL: [YoloPartState, (count: number) => string][] = [
  ['pr', (count) => `${count} waiting for your merge`],
  ['user', (count) => plural(count, 'step for you', 'steps for you')],
  ['doing', (count) => `${count} in progress`],
  ['todo', (count) => `${count} to do`],
]

/** On a ready project, the improvements still being set up, by where they stand. */
function stillSetUp(parts: readonly YoloPart[]): string {
  const said = STILL.flatMap(([state, words]) => {
    const count = parts.filter((part) => part.state === state).length
    return count ? [words(count)] : []
  })
  return said.length ? `YOLO mode can run here. Still being set up: ${said.join(', ')}.` : 'Every part is in place.'
}

/** Where a part's button goes: its PR on GitHub, its Action Item, or its branch's card on Work. */
export type PartOpen = { to: 'pr'; url: string; label: 'Open PR' } | { to: 'action'; id: string; label: 'Open item' } | { to: 'work'; key: string; label: 'On Work' }

/** One part's line under its project. */
export interface PartRow {
  name: string
  label: string
  /** Where it stands, in a word or three. */
  state: string
  tone: ReadinessTone
  /** hobkin's line for it, or why its PR did not open. */
  line: string
  open: PartOpen | null
}

const prOf = ({ pr }: YoloPart): PartOpen | null => (pr ? { to: 'pr', url: pr, label: 'Open PR' } : null)

function partRow(slug: string, part: YoloPart): PartRow {
  const row = { name: part.name, label: part.label, line: part.line }
  switch (part.state) {
    case 'done':
      return { ...row, state: 'Done', tone: 'ok', open: null }
    case 'pr':
      if (part.pr) return { ...row, state: 'PR open', tone: 'live', open: prOf(part) }
      return { ...row, state: 'Branch for your yes', tone: 'warn', line: part.problem ?? part.line, open: part.item ? { to: 'work', key: `${slug}:${part.item}`, label: 'On Work' } : null }
    case 'user':
      return { ...row, state: 'Waiting on you', tone: 'warn', open: part.action ? { to: 'action', id: part.action, label: 'Open item' } : prOf(part) }
    case 'doing':
      return { ...row, state: 'In progress', tone: 'live', open: prOf(part) }
    case 'todo':
      return { ...row, state: 'To do', tone: 'quiet', open: null }
  }
}

/**
 * A project's parts in two groups: what YOLO mode needs, then the improvements. Before its first check, and with no run
 * under way, there is nothing to say of them yet, so there are none.
 */
export function partGroups(project: YoloProject): { heading: string; rows: PartRow[] }[] {
  const parts = project.parts ?? []
  const underWay = project.work === 'running' || project.work === 'queued'
  if (!parts.length || (!project.checkedAt && !underWay)) return []
  const rows = (needed: boolean) => parts.filter((part) => part.needed === needed).map((part) => partRow(project.slug, part))
  return [
    { heading: 'Needed for YOLO mode', rows: rows(true) },
    { heading: 'Improvements', rows: rows(false) },
  ]
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

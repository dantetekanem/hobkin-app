import type { ChangeChoice, FinishedChange, FinishedGroup, FinishedGroupName, Landing, PrMode, YoloChange, YoloPart, YoloPartState, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { dateLabel, dayName, whenText } from '../routines/words.ts'

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

/**
 * The report hobkin keeps on a project while YOLO mode is on: ready or what holds it, the plan, what will merge and what
 * merged and deployed. Reports lists it as that project's `yolo` work. Null before its first.
 */
export function yoloReportId({ slug }: YoloProject, reports: ReadonlyArray<{ id: string; scheduleId?: string }>): string | null {
  return reports.find(({ scheduleId }) => scheduleId === `work.${slug}.yolo`)?.id ?? null
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

export type VerdictTone = ReadinessTone | 'bad'

/** One line of what YOLO mode does on a project: where it stands in a word or two, and why, in a sentence or two. */
export interface StatusLine {
  state: string
  tone: VerdictTone
  text: string
}

/**
 * The one press that moves YOLO mode on a project: its readiness row's own press, an Action Item, a PR, Work itself or a card
 * there, a change's review, or the rate a change would pass at.
 */
export type VerdictPress =
  | { do: 'readiness' }
  | { do: 'action'; id: string }
  | { do: 'pr'; url: string }
  | { do: 'work'; key: string | null }
  | { do: 'review'; slug: string; item: string }
  | { do: 'rate'; rate: number }

export interface VerdictAction {
  label: string
  press: VerdictPress
  title?: string
}

/** What YOLO mode does on a project, at a glance: whether it merges there, whether it deploys, and the one press that moves it. */
export interface YoloVerdict {
  merges: StatusLine
  deploys: StatusLine
  action: VerdictAction | null
}

/** What the verdict reads besides the project: the switch and the rate, why work mode holds every merge, and the project as Work knows it. */
export interface VerdictContext {
  on: boolean
  rate: number
  lowest: number
  /** hobkin's words for why nothing merges anywhere: work mode off or paused. */
  waits: string | null
  paused: boolean
  prMode: PrMode
  readiness: ReadinessRow
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)
const tenths = (value: number) => Math.round(value * 10) / 10

/** The waiting change that would merge first: one that merges by itself on the next pass, else the highest rated, in hobkin's order among equals. */
function firstChange(changes: readonly YoloChange[]): YoloChange | undefined {
  return changes.find(({ why }) => !why) ?? changes.toSorted((a, b) => (b.rate ?? -1) - (a.rate ?? -1))[0]
}

/** The press that sets a part up: its Action Item, its PR, its branch's card on Work, or readiness itself to confirm a step or redo it. */
function partPress(project: YoloProject, part: YoloPart, readiness: ReadinessRow): VerdictAction | null {
  if (part.state === 'user' && part.action) return { label: 'Answer item', press: { do: 'action', id: part.action } }
  if (part.pr) return { label: 'Open PR', press: { do: 'pr', url: part.pr } }
  if (part.state === 'pr' && part.item) return { label: 'Open on Work', press: { do: 'work', key: `${project.slug}:${part.item}` } }
  // A step the user took is confirmed by the next check, and a part still to do is redone by one.
  const checks = part.state === 'todo' || (part.state === 'doing' && part.action)
  return checks && readiness.canRun ? { label: readiness.action, press: { do: 'readiness' } } : null
}

/** Whether its deploys run: by the recorded path, never on this project, or not yet, with what that waits on. */
function deploysOf(deploy: YoloPart | undefined): StatusLine {
  if (!deploy) return { state: 'Not said', tone: 'quiet', text: 'This hobkin does not say how it deploys.' }
  if (deploy.state === 'done' && deploy.deploys === false) return { state: 'None', tone: 'quiet', text: 'Nothing deploys on this project.' }
  if (deploy.state === 'done') return { state: 'Ready', tone: 'ok', text: 'Each merge goes to the main agent to deploy by its recorded path.' }
  const waits = { user: `It waits on you: ${sentence(deploy.line)}`, pr: deploy.pr ? 'Its PR waits for your merge.' : 'Its branch waits for your merge.' }[deploy.state as 'user' | 'pr']
  return { state: 'Not set up', tone: 'warn', text: `Nothing deploys yet. ${waits ?? sentence(deploy.line)}` }
}

/** Whether changes merge by itself there, or the exact reason none does. */
function mergesOf(project: YoloProject, context: VerdictContext): StatusLine {
  const stuck = (text: string): StatusLine => ({ state: 'Stuck', tone: 'warn', text })
  if (!context.on) return { state: 'Off', tone: 'quiet', text: 'YOLO mode is off, so every change here asks you.' }
  if (context.waits) return stuck(`Nothing merges by itself while ${context.waits}.`)
  if (context.paused) return stuck(`Nothing merges by itself while ${project.name} is paused on Work.`)
  if (!project.ready) return { state: 'Getting ready', tone: 'warn', text: `Nothing merges by itself until it is ready. ${context.readiness.detail}` }

  const next = firstChange(project.changes ?? [])
  if (next && !next.why) return { state: 'Merging', tone: 'live', text: `"${next.title}" merges by itself on the next pass: ${next.kind} rated ${next.rate}.` }
  if (next?.why) return stuck(`Nothing can merge by itself. "${next.title}" asks you: ${sentence(next.why)}`)
  if (context.prMode !== 'off') return stuck('PR mode is on here, so each change goes up as a PR for your merge, and YOLO mode merges no PR.')
  return { state: 'Idle', tone: 'quiet', text: `Nothing waits to merge. The next small change rated ${context.rate} or more merges by itself.` }
}

/** The one press: what holds every merge first, then what holds this project, then the change that waits, then its deploys. */
function actionOf(project: YoloProject, context: VerdictContext): VerdictAction | null {
  const { readiness } = context
  const parts = project.parts ?? []
  const readinessPress = readiness.canRun ? { label: readiness.action, press: { do: 'readiness' }, ...(readiness.title ? { title: readiness.title } : {}) } as const : null
  if (!context.on) return project.ready ? null : readinessPress
  if (context.waits || context.paused) return { label: 'Open Work', press: { do: 'work', key: null } }
  if (!project.ready) {
    // Readiness work under way, or waiting for the user's yes, is the readiness row's to press. Otherwise the part that holds it.
    if (project.work && project.work !== 'landed' && project.work !== 'closed') return readinessPress
    const held = parts.filter(({ blocks }) => blocks).map((part) => partPress(project, part, readiness)).find(Boolean)
    return held ?? readinessPress
  }

  const next = firstChange(project.changes ?? [])
  const deploy = parts.find(({ name }) => name === 'deploy')
  const deployPress = deploy && deploy.state !== 'done' ? partPress(project, deploy, readiness) : null
  const review = next ? ({ label: 'Open review', press: { do: 'review', slug: project.slug, item: next.item } } as const) : null
  if (next && !next.why) return deployPress ?? review
  if (next?.why && next.rate !== null && next.why === `its general rate is ${next.rate}, under ${context.rate}`) {
    const passes = Math.floor(next.rate)
    if (passes >= context.lowest) return { label: `Set rate to ${passes}`, press: { do: 'rate', rate: passes }, title: `Lower your rate to ${passes}, so "${next.title}" merges by itself` }
  }
  return review ?? deployPress
}

export function yoloVerdict(project: YoloProject, context: VerdictContext): YoloVerdict {
  const deploy = project.parts?.find(({ name }) => name === 'deploy')
  return { merges: mergesOf(project, context), deploys: deploysOf(deploy), action: actionOf(project, context) }
}

/** One change waiting on a project, with its rate against the user's. */
export interface ChangeRow {
  item: string
  title: string
  kind: string
  rate: string
  against: string
  tone: ReadinessTone
  why: string
}

/** The changes waiting on a project, the ones that merge by themselves on the next pass first, then by rate. */
export function changeRows(project: YoloProject, rate: number): ChangeRow[] {
  const changes = project.changes ?? []
  const ordered = [...changes.filter(({ why }) => !why), ...changes.filter(({ why }) => why).toSorted((a, b) => (b.rate ?? -1) - (a.rate ?? -1))]
  return ordered.map((change) => {
    const scored = change.rate !== null
    const under = scored ? tenths(rate - change.rate!) : 0
    const against = !change.why ? 'merges next pass' : !scored ? 'no rate yet' : under > 0 ? `${under} under ${rate}` : `at or above ${rate}`
    return {
      item: change.item,
      title: change.title,
      kind: change.kind ?? 'no review yet',
      rate: scored ? String(change.rate) : '–',
      against,
      tone: change.why ? 'warn' : 'ok',
      why: change.why ? `It asks you: ${sentence(change.why)}` : 'It merges by itself on the next pass.',
    }
  })
}

export interface MergedRow {
  item: string
  title: string
  what: string
  deploy: string
  held: 'Held' | 'Regressed' | null
  tone: VerdictTone
}

/** What YOLO mode merged by itself on a project, by day, newest first, each with how its deploy held when a reading says. */
export function mergedDays(project: YoloProject, { zone, now }: { zone: string; now: number }): { day: string; rows: MergedRow[] }[] {
  const days = new Map<string, MergedRow[]>()
  for (const merge of project.merged ?? []) {
    const at = Date.parse(merge.at)
    const name = dayName(at, zone, now)
    const day = name === 'Today' || name === 'Yesterday' ? name : dateLabel(at, zone)
    const held = merge.held === null ? null : merge.held ? 'Held' : 'Regressed'
    const row: MergedRow = { item: merge.item, title: merge.title, what: `${merge.kind} rated ${merge.rate} at ${merge.head}`, deploy: merge.deploy, held, tone: held === 'Held' ? 'ok' : held ? 'bad' : 'quiet' }
    days.set(day, [...(days.get(day) ?? []), row])
  }
  return [...days].map(([day, rows]) => ({ day, rows }))
}

/** The sample after Run readiness, so the page answers with no host as hobkin would: the work is queued. */
export const sampleReadiness = (yolo: YoloState, slug: string): YoloState => ({
  ...yolo,
  projects: yolo.projects.map((project) => (project.slug === slug ? { ...project, work: 'queued' } : project)),
})

import type { MetricsDay } from '#shared/protocol/metrics.ts'
import type { ChangeChoice, FinishedChange, FinishedGroup, FinishedGroupName, Landing, PrMode, YoloChange, YoloPart, YoloPartState, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { SERIES_COLOR, type DaySeries, type FunnelStep } from '../numbers/chart-kit.ts'
import { countWords, lastDays, NO_DATA, shareWords, sumDays, TILE_DAYS } from '../numbers/format.ts'
import { finishedReviewId } from '../review/entry.ts'
import { dateLabel, dayName, whenText } from '../routines/words.ts'

/**
 * What the YOLO mode page and the button that opens it say (049-yolo-mode). Where each project's readiness work stands,
 * what holds it back and where each of its parts stands are hobkin's, read from its work status. These are only the words,
 * and which button can be pressed.
 */

/** Whether hobkin sends this project's own switch. One older than the switch sends none, and the page then shows none. */
export const hasSwitch = (project: YoloProject): boolean => typeof project.on === 'boolean'

/** Whether YOLO mode works on this project by its own switch. A project with no switch is as the main switch says. */
export const isOn = (project: YoloProject): boolean => project.on !== false

/**
 * The projects in the order the page shows them: those YOLO mode is on for first, then the ones it is off for, each group in
 * hobkin's order. `kept` is the order the page opened with, which holds while it is open, so a project whose switch was just
 * pressed stays under the pointer and moves to its group on the next visit. A project new since goes at the end, in its group.
 */
export function projectOrder(projects: readonly YoloProject[], kept: readonly string[] | null): YoloProject[] {
  const grouped = [...projects.filter(isOn), ...projects.filter((project) => !isOn(project))]
  if (!kept) return grouped
  const place = new Map(kept.map((slug, index) => [slug, index]))
  const known = projects.filter(({ slug }) => place.has(slug)).toSorted((a, b) => place.get(a.slug)! - place.get(b.slug)!)
  return [...known, ...grouped.filter(({ slug }) => !place.has(slug))]
}

/** The one quiet line a project YOLO mode is off for shows in place of its card, with its count of waiting changes when hobkin sends them. */
export function offLine({ changes }: YoloProject): string {
  const count = changes?.length ?? 0
  if (!count) return 'YOLO mode is off here: its changes wait for you.'
  return `YOLO mode is off here: its ${count} finished ${count === 1 ? 'change waits' : 'changes wait'} for you.`
}

/** What a project's switch is before the user touched it, said once over the projects while hobkin sends switches. */
export function switchesSay({ projects }: YoloState): string | null {
  if (!projects.some(hasSwitch)) return null
  return 'Each project has its own switch. A project YOLO mode was already working on stays on until you turn it off, and one taken on Work later starts off.'
}

/** The sample after a project's switch is pressed, so the page answers with no host as hobkin would. */
export const sampleSwitch = (yolo: YoloState, slug: string, on: boolean): YoloState => ({
  ...yolo,
  projects: yolo.projects.map((project) => (project.slug === slug ? { ...project, on } : project)),
})

/** What the gates count, for their title and a reader. Only the projects YOLO mode is on for pass through them. */
export const GATES_COUNTS = (rate: number): string =>
  `Of the finished changes waiting now on the projects YOLO mode is on for, how many are rated ${rate} or more, and how many of those nothing holds. hobkin keeps no history of each gate, so this counts now.`

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

/** A project's parts that still need work, in the same two groups, with the groups that have none left out. */
export function stillToSetUp(project: YoloProject): { heading: string; rows: PartRow[] }[] {
  const done = new Set((project.parts ?? []).filter(({ state }) => state === 'done').map(({ name }) => name))
  return partGroups(project)
    .map(({ heading, rows }) => ({ heading, rows: rows.filter(({ name }) => !done.has(name)) }))
    .filter(({ rows }) => rows.length)
}

/** The parts in place, in a line: "In place: Tests, Slow queries and Rollback." Null when none is. */
export function inPlace({ parts = [] }: YoloProject): string | null {
  const labels = parts.filter(({ state }) => state === 'done').map(({ label }) => label)
  if (!labels.length) return null
  return `In place: ${labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels[0]}.`
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

// The readiness row's own press, named apart from a model's Check again on the same card.
const readinessLabel = ({ action }: ReadinessRow) => (action === 'Check again' ? 'Check readiness' : action)

/** The press that sets a part up: its Action Item, its PR, its branch's card on Work, or readiness itself to confirm a step or redo it. */
function partPress(project: YoloProject, part: YoloPart, readiness: ReadinessRow): VerdictAction | null {
  if (part.state === 'user' && part.action) return { label: 'Answer item', press: { do: 'action', id: part.action } }
  if (part.pr) return { label: 'Open PR', press: { do: 'pr', url: part.pr } }
  if (part.state === 'pr' && part.item) return { label: 'Open on Work', press: { do: 'work', key: `${project.slug}:${part.item}` } }
  // A step the user took is confirmed by the next check, and a part still to do is redone by one.
  const checks = part.state === 'todo' || (part.state === 'doing' && part.action)
  return checks && readiness.canRun ? { label: readinessLabel(readiness), press: { do: 'readiness' } } : null
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
  if (context.prMode !== 'off') {
    return { state: 'Idle', tone: 'quiet', text: `Nothing waits to merge. Each change goes up as a PR, and the next small one rated ${context.rate} or more merges there by itself once its checks pass.` }
  }
  return { state: 'Idle', tone: 'quiet', text: `Nothing waits to merge. The next small change rated ${context.rate} or more merges by itself.` }
}

/** The one press: what holds every merge first, then what holds this project, then the change that waits, then its deploys. */
function actionOf(project: YoloProject, context: VerdictContext): VerdictAction | null {
  const { readiness } = context
  const parts = project.parts ?? []
  const readinessPress = readiness.canRun ? ({ label: readinessLabel(readiness), press: { do: 'readiness' }, ...(readiness.title ? { title: readiness.title } : {}) } as const) : null
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

/** Where a change that passes every rule stands: it merges on the next pass, once its project is ready, or when what holds every merge lets go. */
function passes(project: YoloProject, holds: string | null): Pick<ChangeRow, 'against' | 'why'> {
  if (holds) return { against: 'held', why: `It would merge by itself, but nothing merges while ${holds}.` }
  if (!project.ready) return { against: 'once ready', why: `It merges by itself once ${project.name} is ready.` }
  return { against: 'merges next pass', why: 'It merges by itself on the next pass.' }
}

/**
 * The changes waiting on a project, the ones that pass every rule first, then by rate. `holds` is why nothing merges by itself
 * anywhere or on this project, such as YOLO mode being off, and null when nothing does.
 */
export function changeRows(project: YoloProject, { rate, holds }: { rate: number; holds: string | null }): ChangeRow[] {
  const changes = project.changes ?? []
  const ordered = [...changes.filter(({ why }) => !why), ...changes.filter(({ why }) => why).toSorted((a, b) => (b.rate ?? -1) - (a.rate ?? -1))]
  return ordered.map((change) => {
    const scored = change.rate !== null
    const under = scored ? tenths(rate - change.rate!) : 0
    const asks = { against: !scored ? 'no rate yet' : under > 0 ? `${under} under ${rate}` : `at or above ${rate}`, why: `It asks you: ${sentence(change.why ?? '')}` }
    return {
      item: change.item,
      title: change.title,
      kind: change.kind ?? 'no review yet',
      rate: scored ? String(change.rate) : '–',
      // The rate's own tone: at or above the user's, under it, or none yet.
      tone: !scored ? 'quiet' : under > 0 ? 'warn' : 'ok',
      ...(change.why ? asks : passes(project, holds)),
    }
  })
}

/** Why nothing merges by itself on a project whatever its changes say: YOLO mode off, work mode waiting, or the project paused. Null when nothing holds. */
export function mergesHeld(project: YoloProject, { on, waits, paused }: Pick<VerdictContext, 'on' | 'waits' | 'paused'>): string | null {
  if (!on) return 'YOLO mode is off'
  if (waits) return waits
  return paused ? `${project.name} is paused on Work` : null
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

/** One figure of the trust row under the switchboard, in the shape of a tile of Work's (`StatTile`). */
export interface TrustTile {
  key: 'by-itself' | 'regressed' | 'held'
  label: string
  /** The figure, or "no data yet". */
  figure: string
  /** Smaller words after the figure: "of 12". */
  after?: string
  /** The one plain line under the figure that says what it counts. */
  context: string
  /** What it counts, in a sentence, for its title and a reader. */
  counts: string
  /** One value for each of the 30 days, oldest first. Null where a share has nothing under it. */
  series: (number | null)[]
  most?: number
}

const shareOf = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null)

/**
 * Whether merging by itself can be trusted, over the last 30 days of the numbers (053, "YOLO mode"): the share of merges
 * made by itself, how many of those regressed after their deploy ("0 of 12", and "no data yet" with none made by itself),
 * and how many changes were held for the user, merged on their yes or declined. `known` is null while there are no
 * numbers, and `note` then says why on each tile's line.
 */
export function trustTiles(known: readonly MetricsDay[] | null, note: string | null = null): TrustTile[] {
  const days = known ? lastDays(known, TILE_DAYS) : []
  // Days the numbers do not reach are empty at the start, so each tile has a bar for every one of the 30.
  const unknownDays = Array<null>(TILE_DAYS - days.length).fill(null)
  const series = (pick: (day: MetricsDay) => number | null) => [...unknownDays, ...days.map(pick)]
  const total = sumDays(days)
  const byItself = total.mergedByItself
  const merged = byItself + total.mergedByYou
  const held = total.mergedByYou + total.declined
  const missing = note ?? ''
  return [
    {
      key: 'by-itself',
      label: 'By itself',
      figure: known ? shareWords(shareOf(byItself, merged)) : NO_DATA,
      context: !known ? missing : merged ? `${countWords(byItself)} of ${countWords(merged)} merges in 30 days` : 'nothing merged in 30 days',
      counts: 'Of the changes merged over 30 days on every project, the share hobkin merged by itself in YOLO mode. The bars are that share for each day.',
      series: series((day) => shareOf(day.mergedByItself, day.mergedByItself + day.mergedByYou)),
      most: 1,
    },
    {
      key: 'regressed',
      label: 'Regressed after deploy',
      ...(known && byItself ? { figure: countWords(total.regressed), after: `of ${countWords(byItself)}` } : { figure: NO_DATA }),
      context: !known ? missing : byItself ? 'merged by itself in 30 days' : 'nothing by itself in 30 days',
      counts: 'Of the changes hobkin merged by itself over 30 days on every project, those whose reading after their deploy regressed. The bars are those regressions by day.',
      series: series((day) => day.regressed),
    },
    {
      key: 'held',
      label: 'Held for you',
      figure: known ? countWords(held) : NO_DATA,
      context: !known ? missing : 'decided by you in 30 days',
      counts: 'Changes on every project that waited for your yes or no over 30 days instead of merging by themselves: merged on your yes, or declined. The bars are those of each day.',
      series: series((day) => day.mergedByYou + day.declined),
    },
  ]
}

/** One reason that holds finished changes for the user, in hobkin's words, and how many it holds. */
export interface GateHold {
  reason: string
  count: number
}

/** The gates, as the changes finished now pass them. */
export interface Gates {
  /** Finished, then rated at or above the user's rate, then free to merge by itself: nothing holds it. */
  steps: FunnelStep[]
  /** The finished changes something holds for the user. */
  waiting: number
  /** What holds them, the reason that holds the most first. Their counts add up to `waiting`. */
  holds: GateHold[]
  /** The three lines a card has room for: the holds, or the two that hold the most and the rest together. */
  shown: GateHold[]
}

const SHOWN_HOLDS = 3
const RATE_WHY = /^its general rate is \d+(?:\.\d+)?, under (\d+(?:\.\d+)?)\.?$/

/** Why a change waits by its own account, or null when it passes and says nothing. A rate under the user's is one reason, whatever the rate. */
function ownReason(change: YoloChange, passes: boolean, rate: number): string | null {
  const why = change.why ?? (passes ? null : change.rate === null ? 'it has no rate yet' : `its general rate is ${change.rate}, under ${rate}`)
  return why === null ? null : why.replace(RATE_WHY, 'its general rate is under $1')
}

/** The holds a card has room for: all of them when they fit, or the two that hold the most and the rest together. */
function shownHolds(holds: GateHold[]): GateHold[] {
  if (holds.length <= SHOWN_HOLDS) return holds
  const rest = holds.slice(SHOWN_HOLDS - 1)
  const restCount = rest.reduce((total, { count }) => total + count, 0)
  return [...holds.slice(0, SHOWN_HOLDS - 1), { reason: `${rest.length} other reasons`, count: restCount }]
}

/**
 * How the changes finished now pass YOLO mode's gates (053, "YOLO mode"). The window knows each waiting change's rate and
 * what holds it, not a history of each gate, so this counts now: the changes finished, those rated at or above the user's
 * rate, and those of them nothing holds. What holds the rest is counted in the words the state gives: what holds every
 * merge first (YOLO mode off, work mode waiting, the project paused on Work), then a project still getting ready, then the
 * change's own reason. A rate under the user's is one reason, whatever the rate. A project YOLO mode is off for passes no
 * gate, so its changes are not counted here: its own line on the page says how many wait.
 */
export function gates(yolo: YoloState, { waits, paused }: { waits: string | null; paused: ReadonlySet<string> }): Gates {
  const counts = new Map<string, number>()
  let finished = 0
  let rated = 0
  let free = 0
  for (const project of yolo.projects.filter(isOn)) {
    // What holds every change of the project comes before a change's own reason.
    const projectHold =
      mergesHeld(project, { on: yolo.on, waits, paused: paused.has(project.slug) }) ?? (project.ready ? null : `${project.name} is getting ready`)
    for (const change of project.changes ?? []) {
      finished += 1
      const passes = change.rate !== null && change.rate >= yolo.rate
      if (passes) rated += 1

      const reason = projectHold ?? ownReason(change, passes, yolo.rate)
      if (reason === null) {
        free += 1
        continue
      }
      const said = sentence(reason)
      counts.set(said, (counts.get(said) ?? 0) + 1)
    }
  }
  const holds = [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
  return {
    steps: [
      { key: 'finished', label: 'Finished', count: finished },
      { key: 'rated', label: `Rated ${yolo.rate} or more`, count: rated },
      { key: 'free', label: 'Free to merge', count: free },
    ],
    waiting: finished - free,
    holds,
    shown: shownHolds(holds),
  }
}

/** Where a click on the page goes: a project's own page, a change's review, or the change's card on Work. */
export type YoloOpen = { to: 'project'; slug: string } | { to: 'review'; id: string } | { to: 'work'; target: string }

/** A project card's name opens the project's page (053). */
export const projectOpens = (slug: string): YoloOpen => ({ to: 'project', slug })

/** A change opens its review. With no host, or when the window cannot name its review, its card on Work opens instead. */
export function changeOpens(slug: string, item: string, live: boolean): YoloOpen {
  const id = finishedReviewId({ slug, item }, live)
  return id && live ? { to: 'review', id } : { to: 'work', target: `[data-change="${slug}:${item}"]` }
}

/** A chart of merges by itself, as `DayBars` draws it. */
export interface ByItselfBars {
  /** The 30 days, oldest first; the newest is today. */
  days: string[]
  series: DaySeries[]
  figure: string
}

/** Merges by itself for each of the last 30 days of `known`, all projects' or one's. Null with no numbers. */
export function byItselfBars(known: readonly MetricsDay[] | null): ByItselfBars | null {
  if (!known) return null
  const days = lastDays(known, TILE_DAYS)
  const values = days.map((day) => day.mergedByItself)
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    days: days.map(({ day }) => day),
    series: [{ key: 'itself', label: 'by itself', color: SERIES_COLOR.itself, values }],
    figure: total ? `${countWords(total)} in 30 days` : 'none in 30 days',
  }
}

/** What merged over the last 30 days of the numbers, by itself and on the user's yes, in a line beside the gates. Without numbers, why. */
export function mergedLine(known: readonly MetricsDay[] | null, note: string | null = null): string {
  if (!known) return note ?? NO_DATA
  const total = sumDays(lastDays(known, TILE_DAYS))
  return `Over 30 days: ${countWords(total.mergedByItself)} merged by itself, ${countWords(total.mergedByYou)} on your yes.`
}

/** The sample after Run readiness, so the page answers with no host as hobkin would: the work is queued. */
export const sampleReadiness = (yolo: YoloState, slug: string): YoloState => ({
  ...yolo,
  projects: yolo.projects.map((project) => (project.slug === slug ? { ...project, work: 'queued' } : project)),
})

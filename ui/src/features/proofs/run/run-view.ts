import type { ProofAction, ProofLogLine, ProofRule, ProofRun, ProofRunSummary, ProofStep } from '#shared/protocol/proofs.ts'

/**
 * What the Run tab of a proof run draws (_specs/050-tla-proofs, screen 1), worked out from the run alone: its steps,
 * TLC's four counters, the new-states chart, what must stay true, which actions ran, what hobkin is doing and where
 * each action lives. Pure, so its rules are tested without a window. The page keeps every area one height whatever
 * these say, so a run moving from checking to broken or holds moves no button.
 */

export type Tone = 'ok' | 'bad' | 'warn' | 'live' | 'quiet'

const count = (value: number) => value.toLocaleString('en-US')

/** Minutes and seconds: 0:41, 2:37, 12:05. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** How long the run has gone on, or went on: to `finished`, or to now while it checks. */
export function elapsedOf(run: Pick<ProofRunSummary, 'started' | 'finished'>, now: number): number {
  const started = Date.parse(run.started)
  const end = run.finished ? Date.parse(run.finished) : now
  return Number.isNaN(started) || Number.isNaN(end) ? 0 : Math.max(0, end - started)
}

const stepOf = (run: Pick<ProofRunSummary, 'steps'>, id: ProofStep['id']) => run.steps.find((step) => step.id === id)

/** The actions that never fired: a model that never reaches one checks nothing it guards. */
export const neverFired = (run: Pick<ProofRunSummary, 'actions'>): string[] => run.actions.filter((action) => action.count === 0).map((action) => action.name)

/** Names in a sentence: "Decline", "Decline and Fix", "Start, Fix and Decline". */
export function namesOf(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** Steps in the counterexample: one fewer than its states, since the first is where it starts. */
export const stepsToBreak = (run: Pick<ProofRunSummary, 'traceLength' | 'stats'>): number => (run.traceLength ? run.traceLength - 1 : run.stats.depth)

/** Where the run stands, in a pill: a word or three and its tone. */
export function phaseOf(run: ProofRunSummary): { label: string; tone: Tone } {
  switch (run.outcome) {
    case 'checking': {
      const running = run.steps.find((step) => step.state === 'running')?.id
      if (running === 'parse') return { label: 'Parsing the spec', tone: 'live' }
      if (running === 'prove') return { label: 'Proving it for every size', tone: 'live' }
      return { label: 'Checking the model', tone: 'live' }
    }
    case 'broken':
      return { label: run.broken && run.rules.find((rule) => rule.name === run.broken)?.kind === 'deadlock' ? 'Found a deadlock' : 'Found a counterexample', tone: 'bad' }
    case 'holds': {
      const missed = neverFired(run)
      if (missed.length) return { label: `Holds, but ${namesOf(missed)} never ran`, tone: 'warn' }
      if (stepOf(run, 'prove')?.state === 'failed') return { label: 'Holds, the proof fails', tone: 'warn' }
      return { label: stepOf(run, 'prove')?.state === 'done' ? 'Holds, and proved' : 'Model holds', tone: 'ok' }
    }
    case 'error':
      return { label: 'Could not check', tone: 'bad' }
    case 'stopped':
      return { label: 'Stopped', tone: 'quiet' }
  }
}

/** The run's time, beside its spec: "0:41 so far", "Finished in 2:37". */
export function elapsedLine(run: ProofRunSummary, now: number): string {
  const time = clock(elapsedOf(run, now))
  switch (run.outcome) {
    case 'checking':
      return `${time} so far`
    case 'holds':
      return `Finished in ${time}`
    case 'error':
      return `Ended at ${time}`
    default:
      return `Stopped at ${time}`
  }
}

/** The page's one control: Stop while it runs, Run again once it ended. */
export const controlOf = (run: Pick<ProofRunSummary, 'outcome'>): { label: 'Stop check' | 'Run again'; command: 'proof.stop' | 'proof.again' } =>
  run.outcome === 'checking' ? { label: 'Stop check', command: 'proof.stop' } : { label: 'Run again', command: 'proof.again' }

// The steps.

const STEP_NAMES: Readonly<Record<ProofStep['id'], string>> = { parse: 'Parse', check: 'Model check', prove: 'Proof' }
const STEP_TOOLS: Readonly<Record<ProofStep['id'], string>> = { parse: 'SANY', check: 'TLC', prove: 'TLAPS · optional' }

export type StepLook = 'done' | 'running' | 'waiting' | 'failed'

export interface StepRow {
  id: ProofStep['id']
  name: string
  note: string
  look: StepLook
}

const LOOKS: Readonly<Record<ProofStep['state'], StepLook>> = { done: 'done', running: 'running', waiting: 'waiting', skipped: 'waiting', failed: 'failed' }

/** Parse, Model check and Proof, always all three in that order, so the row never reflows. */
export function stepRows(run: Pick<ProofRunSummary, 'steps'>): StepRow[] {
  return (['parse', 'check', 'prove'] as const).map((id) => {
    const step = stepOf(run, id)
    return { id, name: STEP_NAMES[id], note: step?.note || STEP_TOOLS[id], look: LOOKS[step?.state ?? 'waiting'] }
  })
}

// The four counters.

export interface Counter {
  label: string
  value: string
  sub: string
}

export function countersOf(run: ProofRunSummary): Counter[] {
  const { distinct, generated, queue, depth } = run.stats
  const checking = run.outcome === 'checking'
  const done = run.outcome === 'holds'
  const last: Counter = run.outcome === 'broken' ? { label: 'Counterexample', value: count(stepsToBreak(run)), sub: 'Steps, the shortest' } : { label: 'Deepest path', value: count(depth), sub: 'Steps from the start' }
  return [
    { label: 'Distinct states', value: count(distinct), sub: done ? 'All of them' : 'Each one checked' },
    { label: 'States found', value: count(generated), sub: 'Including repeats' },
    { label: 'Waiting', value: count(queue), sub: checking ? 'Still to explore' : done ? 'Nothing left' : 'Left when it stopped' },
    last,
  ]
}

// The chart.

/** The chart's own box, in its viewBox units: the line keeps two units clear of the top and the floor. */
export const CHART = { width: 600, height: 110, floor: 108, top: 6 } as const
/** Every line has this many points, so one line can turn into the next. */
export const CHART_POINTS = 40
/** While it checks, the newest count sits this far along, leaving room for the states still to come. */
const LIVE_REACH = 0.62
/** And this far up, since more are coming. */
const LIVE_HEIGHT = 0.88

export interface Chart {
  line: string
  area: string
  tone: Tone
  aria: string
  /** Beside the caption: how fast new states come in, or how the check ended. */
  caption: string
}

/** Distinct states at `at`, read off the samples in a straight line between two of them. */
function distinctAt(samples: ProofRun['samples'], at: number): number {
  const after = samples.findIndex((sample) => sample.at >= at)
  if (after === -1) return samples.at(-1)?.distinct ?? 0
  if (after === 0) return samples[0]!.distinct
  const before = samples[after - 1]!
  const next = samples[after]!
  const share = next.at === before.at ? 1 : (at - before.at) / (next.at - before.at)
  return before.distinct + share * (next.distinct - before.distinct)
}

const round = (value: number) => Math.round(value * 10) / 10

/** How fast new states come in now, a second: the run's own rate, or the last two samples'. */
export function rateOf(run: Pick<ProofRun, 'rate' | 'samples'>): number | null {
  if (run.rate !== undefined) return run.rate
  const [before, after] = run.samples.slice(-2)
  if (!before || !after || after.at <= before.at) return null
  return Math.max(0, Math.round(((after.distinct - before.distinct) * 1000) / (after.at - before.at)))
}

/** Whether new states come in slower in the second half of the run than in the first. */
function slowing(samples: ProofRun['samples']): boolean {
  const end = samples.at(-1)
  if (!end || end.at <= 0) return false
  const half = distinctAt(samples, end.at / 2)
  return end.distinct - half < half
}

export function chartOf(run: Pick<ProofRun, 'samples' | 'outcome' | 'rate' | 'traceLength' | 'stats'>): Chart {
  const checking = run.outcome === 'checking'
  const samples = run.samples.length ? run.samples : [{ at: 0, distinct: 0 }]
  const end = samples.at(-1)!.at
  const most = Math.max(1, ...samples.map((sample) => sample.distinct))
  const reach = checking ? LIVE_REACH : 1
  const height = checking ? LIVE_HEIGHT : 1
  const rise = CHART.floor - CHART.top
  const points = Array.from({ length: CHART_POINTS }, (_, index) => {
    const share = index / (CHART_POINTS - 1)
    const x = round(share * reach * CHART.width)
    const y = round(CHART.floor - (distinctAt(samples, share * end) / most) * height * rise)
    return `${x} ${y}`
  })
  const line = `M${points.join(' L')}`
  const area = `${line} L${round(reach * CHART.width)} ${CHART.floor} L0 ${CHART.floor} Z`
  const tone: Tone = run.outcome === 'broken' || run.outcome === 'error' ? 'bad' : run.outcome === 'holds' ? 'ok' : checking ? 'live' : 'quiet'
  const rate = rateOf(run)

  switch (run.outcome) {
    case 'checking':
      return { line, area, tone, aria: slowing(samples) ? 'New states are still rising, but more slowly.' : 'New states are still rising fast.', caption: rate === null ? 'Counting states' : `${count(rate)} states a second` }
    case 'holds':
      return { line, area, tone, aria: 'New states rose fast, then flattened to none: the whole model was explored.', caption: 'Every reachable state looked at' }
    case 'broken':
      return { line, area, tone, aria: 'The check stopped early, at the counterexample.', caption: `Stopped at depth ${stepsToBreak(run)}` }
    case 'stopped':
      return { line, area, tone, aria: 'The check was stopped before it looked at every state.', caption: 'Stopped before the end' }
    case 'error':
      return { line, area, tone, aria: 'The check ended with an error.', caption: 'Ended with an error' }
  }
}

// The result.

export type ResultIcon = 'clock' | 'alert' | 'check' | 'stop'

export interface Result {
  tone: Tone
  icon: ResultIcon
  title: string
  line: string
  /** The first of the two buttons: where to look next. Strong only when there is a counterexample to step through. */
  primary: { label: string; strong: boolean }
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)
const plural = (value: number, one: string, many = `${one}s`) => `${count(value)} ${value === 1 ? one : many}`

/** What the run found, in a title and two lines at most. It always has the same two buttons beside it. */
export function resultOf(run: ProofRunSummary): Result {
  const { generated, queue, distinct } = run.stats
  const look = { label: 'Explore the graph', strong: false }
  switch (run.outcome) {
    case 'checking':
      if (stepOf(run, 'parse')?.state === 'running') return { tone: 'quiet', icon: 'clock', title: 'Nothing checked yet', line: 'SANY reads the spec first, and TLC starts once it parses.', primary: { label: 'Watch the graph grow', strong: false } }
      return {
        tone: 'quiet',
        icon: 'clock',
        title: 'Nothing broken yet',
        line: `${count(generated)} states looked at, ${count(queue)} still waiting. You can leave: hobkin keeps checking and tells you what it finds.`,
        primary: { label: 'Watch the graph grow', strong: false },
      }
    case 'broken': {
      const steps = stepsToBreak(run)
      const rule = run.rules.find((candidate) => candidate.name === run.broken)
      const title = rule?.kind === 'deadlock' ? `The model gets stuck after ${plural(steps, 'step')}` : `${run.broken ?? 'A rule'} breaks after ${plural(steps, 'step')}`
      const line = rule?.words ? `It should be that ${lowerFirst(rule.words)}. TLC found the shortest way to break it.` : 'TLC found the shortest way there. Step through it to see each change.'
      return { tone: 'bad', icon: 'alert', title, line, primary: { label: 'Step through it', strong: true } }
    }
    case 'holds': {
      const missed = neverFired(run)
      const size = run.model ? `${run.model}. ` : ''
      if (missed.length) {
        const them = missed.length === 1 ? 'it' : 'them'
        return { tone: 'warn', icon: 'alert', title: `Holds, but ${namesOf(missed)} never ran`, line: `A model that never reaches an action checks nothing ${them} guards, so this run is not evidence. ${size}`.trim(), primary: look }
      }
      const prove = stepOf(run, 'prove')
      if (prove?.state === 'failed') return { tone: 'warn', icon: 'alert', title: 'Holds here, but the proof fails', line: `It holds for ${run.model ?? 'this size'}, not yet for every size. ${prove.note}`.trim(), primary: look }
      if (prove?.state === 'done') return { tone: 'ok', icon: 'check', title: 'Holds, and is proved for every size', line: `TLC looked at all ${count(distinct)} states of ${run.model ?? 'this model'}. ${prove.note}.`, primary: look }
      return { tone: 'ok', icon: 'check', title: 'Holds in every state this model can reach', line: `${size}That is a check of this size, not a proof for every size: the Proof step does that.`, primary: look }
    }
    case 'stopped':
      return { tone: 'quiet', icon: 'stop', title: 'Stopped before the end', line: `${count(generated)} states looked at, ${count(queue)} not yet. A stopped check says nothing of the states it did not reach.`, primary: look }
    case 'error':
      return { tone: 'bad', icon: 'alert', title: 'The check could not run', line: run.message ?? 'What hobkin is doing says where it stopped.', primary: look }
  }
}

// What must stay true.

export interface RuleRow {
  name: string
  words: string
  status: string
  tone: Tone
  /** The row itself stands out: the rule that broke. */
  marked: boolean
}

export function ruleRows(run: Pick<ProofRunSummary, 'rules' | 'outcome'>): RuleRow[] {
  const checking = run.outcome === 'checking'
  return run.rules.map((rule) => {
    const { status, tone } = ruleStatus(rule, checking)
    return { name: rule.name, words: rule.words ?? '', status, tone, marked: rule.status === 'broken' }
  })
}

function ruleStatus(rule: ProofRule, checking: boolean): { status: string; tone: Tone } {
  switch (rule.status) {
    case 'holds':
      return { status: 'Holds', tone: 'ok' }
    case 'broken':
      return { status: 'Broken', tone: 'bad' }
    case 'holding':
      return checking ? { status: 'Holding so far', tone: 'live' } : { status: 'Holding', tone: 'ok' }
    case 'unchecked':
      return checking && rule.kind === 'property' ? { status: 'Checked at the end', tone: 'quiet' } : { status: 'Not reached', tone: 'quiet' }
  }
}

// Which actions ran.

export interface ActionRow {
  name: string
  count: string
  /** The bar's length, as a share of the action that fired most, from 0 to 100. One that fired at all shows at least a sliver. */
  width: number
  /** `bad` is the action that took the last step into the broken state. `none` never fired. */
  tone: 'text' | 'bad' | 'none'
}

/** The action of the counterexample's last state, without its arguments: `YoloMerge(i1)` is YoloMerge. */
const lastActionOf = (run: Pick<ProofRun, 'trace'>) => run.trace?.at(-1)?.action.replace(/\(.*$/, '')

export function actionRows(run: Pick<ProofRun, 'actions' | 'outcome' | 'trace'>): ActionRow[] {
  const most = Math.max(1, ...run.actions.map((action) => action.count))
  const culprit = run.outcome === 'broken' ? lastActionOf(run) : undefined
  return run.actions.map((action: ProofAction) => ({
    name: action.name,
    count: count(action.count),
    width: action.count ? Math.max(3, Math.round((action.count / most) * 100)) : 0,
    tone: action.count === 0 ? 'none' : action.name === culprit ? 'bad' : 'text',
  }))
}

/** The line under the actions, which always takes two lines' room: every action ran, or which have not. */
export function coverageNote(run: Pick<ProofRunSummary, 'actions' | 'outcome'>): { text: string; tone: 'quiet' | 'warn' } {
  const missed = neverFired(run)
  if (!run.actions.length) return { text: 'TLC says which actions ran once it has counted them.', tone: 'quiet' }
  if (!missed.length) return { text: 'Every action ran. A check where one never runs proves nothing about it.', tone: 'quiet' }
  const names = namesOf(missed)
  const one = missed.length === 1
  if (run.outcome === 'checking') return { text: `${names} ${one ? 'has' : 'have'} not run yet. If ${one ? 'it never does' : 'they never do'}, the model cannot reach ${one ? 'it' : 'them'}, and nothing ${one ? 'it guards' : 'they guard'} is checked.`, tone: 'warn' }
  return { text: `${names} never ran. The model cannot reach ${one ? 'it' : 'them'}, so nothing ${one ? 'it guards' : 'they guard'} was checked, and this run is not evidence.`, tone: 'warn' }
}

// What hobkin is doing.

/** The log shows the newest this many lines, in a box of their height. */
export const LOG_LINES = 6

export interface LogRow {
  key: string
  at: string
  text: string
  detail: string
  tone: 'done' | 'live' | 'ok' | 'bad'
}

const LOG_TONES: Readonly<Record<ProofLogLine['tone'], LogRow['tone']>> = { done: 'done', running: 'live', ok: 'ok', bad: 'bad' }

/** The newest lines, oldest first, each with its time of day on the 24-hour clock in `zone`. */
export function logRows(run: Pick<ProofRun, 'log'>, zone: string): LogRow[] {
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone })
  const first = Math.max(0, run.log.length - LOG_LINES)
  return run.log.slice(first).map((line, index) => {
    const at = Date.parse(line.at)
    return { key: `${first + index}:${line.at}:${line.text}`, at: Number.isNaN(at) ? '' : time.format(at), text: line.text, detail: line.detail ?? '', tone: LOG_TONES[line.tone] ?? 'done' }
  })
}

// Where each action lives.

export interface CodeRow {
  action: string
  /** `path:line` in the project, as the spec's `\* code:` says. */
  where: string
  path: string
}

export function codeRows(run: Pick<ProofRunSummary, 'actions'>): CodeRow[] {
  return run.actions.flatMap((action) => (action.code ? [{ action: action.name, where: action.code, path: action.code.replace(/:\d+$/, '') }] : []))
}

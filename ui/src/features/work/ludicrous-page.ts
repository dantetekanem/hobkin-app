import type { LudicrousFolder, LudicrousRun, LudicrousState, LudicrousStep, LudicrousTier, LudicrousTierAgents } from '#shared/protocol/ludicrous.ts'

/**
 * What the Ludicrous page says and allows (_specs/076-ludicrous-mode), apart from how it is drawn: the opening's words with their bold,
 * the run's path, the two controls and why one is disabled, the phase line, the tiers and the numbers.
 */

/** A piece of a paragraph: plain words, or words in bold. */
export interface Words {
  text: string
  bold?: true
}

const b = (text: string): Words => ({ text, bold: true })
const plain = (text: string): Words => ({ text })

/** The opening, in the spec's words: the first line large and bold, then the key phrases in bold, before the box. */
export const OPENING: { lead: string; paragraphs: Words[][] } = {
  lead: 'Ludicrous builds a whole project at once, as fast as your computer allows and at the best quality it can reach.',
  paragraphs: [
    [
      plain('Tell it what you want. '),
      b('Five planning agents'),
      plain(" pull your idea apart, challenge each other's drafts, and come back with "),
      b('a plan and a spec for every part of the project'),
      plain('. When you approve it, '),
      b('a swarm of agents'),
      plain(" starts building and keeps going until it's done."),
    ],
    [
      b('It holds nothing back.'),
      plain(' It spends '),
      b('every token you have'),
      plain(' and runs your computer at '),
      b('full power'),
      plain(', so expect the fan to spin like crazy. Your other work keeps going, only slower. If your subscription runs out, Ludicrous waits for the reset and carries on by itself.'),
    ],
    [
      b('Nothing waits for your review.'),
      plain(' Agents commit to one branch as they go, and you get '),
      b('a single pull request'),
      plain(" at the end, maybe a million lines long. You won't see what each agent is doing. You'll see how many are working in each part of the project, and how far each part has come."),
    ],
    [b('Stop kills every agent instantly.'), plain(' hobkin keeps what they finished and puts it in the pull request.')],
    [b('Save it for your most ambitious work. Don\'t think "add a feature". Think "create the whole platform".')],
  ],
}

export const BOX_LABEL = 'Write what you want. Be as clear as possible.'
export const BOX_UNDER = 'Five agents plan it first, and nothing gets built until you approve their plan.'
export const TIER_LABEL = 'How hard to push your computer'

/** The warning on a project Work already has, said before any planning (A2). */
export const NOBODY_ELSE =
  "While Ludicrous runs here, nobody else should work on this project: not you, not another agent, and not hobkin's own Work, because anything else that changes these files will conflict with the run's agents. hobkin pauses its own Work here until the run's pull request is merged or closed. Ludicrous works in this folder, on its own branch, so the folder must have no uncommitted changes."

// The run's path: the steps along one line, and the two detours off Building, one above and one below.
export type PathStep = 'idea' | 'planning' | 'plan' | 'building' | 'done'
export type Detour = 'waiting' | 'stopped'
export const PATH_STEPS: readonly { id: PathStep; label: string }[] = [
  { id: 'idea', label: 'Your idea' },
  { id: 'planning', label: 'Planning' },
  { id: 'plan', label: 'Plan ready' },
  { id: 'building', label: 'Building' },
  { id: 'done', label: 'Done' },
]
export const DETOURS: readonly { id: Detour; label: string }[] = [
  { id: 'waiting', label: 'Waiting for the subscription' },
  { id: 'stopped', label: 'Stopped' },
]

export interface Path {
  /** Where the run is: a step on the line or one of the detours. */
  at: PathStep | Detour
  /** The steps of the line already passed. */
  passed: PathStep[]
  /** Agents work on the step now, so its line flows. */
  working: boolean
}

const before = (step: PathStep) => PATH_STEPS.slice(0, PATH_STEPS.findIndex(({ id }) => id === step)).map(({ id }) => id)

/** Where a run is on its path. A run stopped while it planned is back at its idea, since Let's plan this picks up from its round files. */
export function pathOf(run: LudicrousRun | null): Path {
  if (!run) return { at: 'idea', passed: [], working: false }
  switch (run.phase) {
    case 'planning':
      return { at: 'planning', passed: before('planning'), working: true }
    case 'plan-ready':
      return { at: 'plan', passed: before('plan'), working: false }
    case 'building':
      return { at: 'building', passed: before('building'), working: true }
    case 'waiting':
      return { at: 'waiting', passed: before('building'), working: false }
    case 'compiling':
      return run.compiling === 'done' ? { at: 'done', passed: before('done'), working: true } : { at: 'stopped', passed: before('building'), working: true }
    case 'stopped':
      return run.planned ? { at: 'stopped', passed: before('building'), working: false } : { at: 'idea', passed: [], working: false }
    case 'done':
      return { at: 'done', passed: before('done'), working: false }
  }
}

const ROUND_WORDS: Record<LudicrousStep, string> = {
  drafts: 'round 1 of 4: each planner drafts alone',
  critiques: 'round 2 of 4: each reads the other four and answers them',
  plan: 'round 3 of 4: one plan',
  specs: 'round 3 of 4: a spec for every area',
  checks: 'round 4 of 4: each checks the whole set against its lens',
  settle: 'round 4 of 4: the delivery planner settles what they raised',
  answers: 'the plan takes your answers',
}

const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** The phase line at the top once a run exists: what it is doing, in one sentence. */
export function phaseLine(run: LudicrousRun): string {
  switch (run.phase) {
    case 'planning':
      return `Planning, ${ROUND_WORDS[run.step ?? 'drafts']}.`
    case 'plan-ready':
      return 'The plan is ready. Read it, answer the questions you want to, and press Go Ludicrous.'
    case 'building':
      return `Building, with ${run.running} of ${run.tier} agents at work.`
    case 'waiting':
      return run.waitingUntil ? `Waiting for the subscription. Ludicrous starts again at ${clock(run.waitingUntil)}.` : 'Waiting for the subscription.'
    case 'compiling':
      return 'Compiling what the agents finished into the pull request.'
    case 'stopped':
      return run.planned ? 'Stopped. Go Ludicrous carries on from where it stopped.' : "Planning stopped. Let's plan this picks up from what the planners wrote."
    case 'done':
      return 'Done. The pull request is ready for your review.'
  }
}

export type MainAction = 'plan' | 'go'

export interface Controls {
  main: { label: "Let's plan this" | 'Go Ludicrous'; action: MainAction; disabled: boolean; reason: string | null }
  stop: { disabled: boolean }
  /** The box for the user's words shows. */
  box: boolean
}

export interface ControlsInput {
  state: LudicrousState | null
  /** The project picked on the page, or null before one is. */
  slug: string | null
  idea: string
  /** The picked project's folder, as the host read it, or null while it is being read. */
  folder: LudicrousFolder | null
}

const RUNNING_PHASES = ['planning', 'building', 'waiting', 'compiling']
const STOPPABLE_PHASES = ['planning', 'plan-ready', 'building', 'waiting']

/**
 * The two controls. The main button says Let's plan this before a plan exists and Go Ludicrous once it is ready or after a stop; while
 * planners or builders run it is disabled and keeps its place. With a stopped run on the page, another project opens the box for a new
 * run there, and Go Ludicrous resumes the stopped one on its own project. Stop works while anything of the run is running or waiting.
 */
const GO = { label: 'Go Ludicrous', action: 'go' } as const
const PLAN = { label: "Let's plan this", action: 'plan' } as const

export function controlsOf({ state, slug, idea, folder }: ControlsInput): Controls {
  const run = state?.run ?? null
  const stop = { disabled: !run || !STOPPABLE_PHASES.includes(run.phase) }

  if (run && RUNNING_PHASES.includes(run.phase)) {
    const main = run.planned ? GO : PLAN
    return { main: { ...main, disabled: true, reason: null }, stop, box: false }
  }

  const resumes = run?.phase === 'stopped' && run.planned && (slug === null || slug === run.slug)
  if (run?.phase === 'plan-ready' || resumes) {
    return { main: { ...GO, disabled: false, reason: null }, stop, box: false }
  }

  const reason = planWaitsFor({ slug, idea, folder })
  return { main: { ...PLAN, disabled: reason !== null, reason }, stop, box: true }
}

/** What Let's plan this still waits for, in the order the user meets it, or null when it can run. */
function planWaitsFor({ slug, idea, folder }: Pick<ControlsInput, 'slug' | 'idea' | 'folder'>): string | null {
  if (!slug) return 'Pick a project first.'
  if (folder && !folder.clean) return folder.reason
  if (!idea.trim()) return 'Write what you want first.'
  if (!folder) return 'Reading the folder…'
  return null
}

/** The tier the page starts on: the run's own, or the largest this computer fits. */
export const startingTier = (state: LudicrousState | null): LudicrousTierAgents => state?.run?.tier ?? state?.machine.picked ?? 30

/** A tier's line for the page, and what it risks when it is above the computer's measure (A13). */
export function tierWords(tier: LudicrousTier, picked: LudicrousTierAgents): { label: string; pick: boolean; line: string; risk: string | null } {
  return { label: String(tier.agents), pick: tier.agents === picked, line: tier.line, risk: tier.fits ? null : tier.risk }
}

const compact = (value: number) => (value >= 1e9 ? `${(value / 1e9).toFixed(1)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}K` : String(value))
const duration = (ms: number) => {
  const minutes = Math.floor(ms / 60000)
  return minutes < 60 ? `${minutes} m` : `${Math.floor(minutes / 60)} h ${minutes % 60} m`
}

/** The four numbers above the map: agents running of the tier, spawned this run, tokens used and time running. */
export function numbersOf(run: LudicrousRun): { label: string; figure: string; after?: string }[] {
  return [
    { label: 'Running now', figure: String(run.running), after: `/ ${run.tier}` },
    { label: 'Spawned this run', figure: String(run.spawned) },
    { label: 'Tokens used', figure: compact(run.tokens) },
    { label: 'Running for', figure: duration(run.buildingMs) },
  ]
}

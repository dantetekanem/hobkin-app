/**
 * Ludicrous mode as the host sends it to the window (_specs/076-ludicrous-mode), at most once a second: the one run, its phase, its counts
 * and its areas, and the machine tiers the computer fits. Nothing in it says what any single agent is doing.
 */

export type LudicrousPhase = 'planning' | 'plan-ready' | 'building' | 'waiting' | 'compiling' | 'stopped' | 'done'
export type LudicrousTierAgents = 30 | 50 | 100
/** Planning's steps in order: round 1 is drafts, 2 critiques, 3 the plan and the specs, 4 the checks and the settling. */
export type LudicrousStep = 'drafts' | 'critiques' | 'plan' | 'specs' | 'checks' | 'settle' | 'answers'

/** One area of the plan as the map draws it: its agents now, whether its leader runs, and its spec's steps done of total. */
export interface LudicrousArea {
  id: string
  name: string
  depends: string[]
  open: boolean
  done: boolean
  steps: { done: number; total: number }
  agents: number
  leader: boolean
}

/** A question the planners ask the user, with their pick. Go Ludicrous takes the pick for one left unanswered. */
export interface LudicrousQuestion {
  id: string
  question: string
  options: { id: string; label: string }[]
  pick: string
  why: string | null
}

/** The plan the page shows once it is ready: its areas and its questions. */
export interface LudicrousPlan {
  areas: { id: string; name: string; depends: string[]; summary: string | null }[]
  questions: LudicrousQuestion[]
}

/** One minute of the run's history: the most agents that ran in it, and how many had been spawned by its end. */
export interface LudicrousMinute {
  at: string
  running: number
  spawned: number
}

export interface LudicrousRun {
  id: string
  slug: string
  name: string
  branch: string
  idea: string
  tier: LudicrousTierAgents
  phase: LudicrousPhase
  step: LudicrousStep | null
  /** Planning's round, or `answers` for the short step the user's answers ask for. */
  round: number | 'answers' | null
  /** A plan was made, so Go Ludicrous builds, or carries on after a stop. */
  planned: boolean
  /** When a used-up subscription lets the run start again, while it waits. */
  waitingUntil: string | null
  pr: { url: string; draft: boolean } | null
  /** What hobkin says about the run: no remote, a planner that could not write, how the pull request went. */
  lines: string[]
  running: number
  spawned: number
  tokens: number
  buildingMs: number
  areas: LudicrousArea[]
  plan: LudicrousPlan | null
  history: LudicrousMinute[]
}

/** A machine tier on this computer: what its agents need, whether it fits, its line for the page, and what it risks when it does not fit. */
export interface LudicrousTier {
  agents: LudicrousTierAgents
  needsMb: number
  fits: boolean
  line: string
  risk: string | null
}

export interface LudicrousMachine {
  picked: LudicrousTierAgents
  checks: number
  perAgentMb: number
  spareMb: number
  tiers: LudicrousTier[]
}

export interface LudicrousState {
  run: LudicrousRun | null
  machine: LudicrousMachine
}

/** Whether a project's folder can take a run now, and why not. */
export interface LudicrousFolder {
  clean: boolean
  reason: string | null
}

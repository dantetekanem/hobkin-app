import type { GitHubState } from '#shared/protocol/github.ts'
import type { PendingQuestion } from '#shared/protocol/question.ts'
import type { FinishedChange, WorkState } from '#shared/protocol/work.ts'
import type { RunningAgent } from '../../app/running-agents.ts'
import type { Mood } from '../../avatar/moods.tsx'
import type { WaitingRow } from '../actions/items.ts'
import type { OutcomeDay } from '../reports/briefing.ts'
import type { Report } from '../reports/report.ts'
import type { RoutineFacts } from '../routines/rules.ts'

/**
 * Home, the main screen: a smart stack that puts the one thing that matters most right now on top, and fixed widgets
 * around it. Everything here is read from what the app already holds; `homeModel` (model.ts) turns it into what the
 * screen draws, and is pure so its rules can be tested without a window.
 */

/** Everything Home reads. The screen gathers it from the stores; tests build it by hand. */
export interface HomeInput {
  now: number
  /** Reports, newest first, and the ids the user has read. */
  reports: readonly Report[]
  read: ReadonlySet<string>
  /** hobkin's read rollup (`snapshot.reportAttention`), for what came since the user last looked. Untrusted shape. */
  attention: unknown
  /** What waits on the user, as Action Items lists it. */
  waiting: readonly WaitingRow[]
  /** The question hobkin is asking in the conversation now. */
  question: PendingQuestion | null
  work: WorkState | null
  /** A live host: finished changes can open in Review. */
  live: boolean
  github: GitHubState
  routines: readonly RoutineFacts[]
  agents: readonly RunningAgent[]
  /** `snapshot.wins`: `{ today: { merged, decided }, streak }` from hobkin, or anything else. Untrusted shape. */
  wins: unknown
}

/** Where a button or row goes. Home only navigates: it never answers, merges, runs or stops anything itself. */
export type HomeTarget =
  | { to: 'screen'; screen: 'actions' | 'reports' | 'routines' | 'work' | 'github' }
  | { to: 'report'; id: string }
  /** An Action Items row. One that hobkin handles elsewhere (`row.opens`) is resolved by the model, not here. */
  | { to: 'action'; id: string }
  | { to: 'review'; change: FinishedChange }
  | { to: 'agent'; id: string }
  | { to: 'routine'; id: string }
  | { to: 'url'; url: string }
  /** The question hobkin is asking in the conversation. */
  | { to: 'question' }

export interface HomeAction {
  label: string
  target: HomeTarget
}

/** The colors a mark can take. They map to the app's tokens: accent yellow, bad, warn, ok, info, and quiet grey. */
export type HomeTone = 'accent' | 'bad' | 'warn' | 'ok' | 'info' | 'quiet'

export type CardKind = 'question' | 'decision' | 'review' | 'github' | 'problem' | 'away' | 'agent' | 'upnext' | 'today'

/** One card in the smart stack. */
export interface StackCard {
  /** Stable across snapshots for the same thing: `<kind>:<source id>`. */
  id: string
  kind: CardKind
  /** The eyebrow: "Decision", "Problem · rpsleague". */
  label: string
  /** Why it is on top, in a few words: "waiting 2 hours", "new 12 minutes ago". */
  reason: string
  tone: HomeTone
  /** hobkin's face on the card. */
  mood: Mood
  title: string
  detail: string | null
  /** A report's own next step, when it gave one. */
  next: string | null
  primary: HomeAction
  secondary: HomeAction | null
}

/** A row in a widget. */
export interface HomeRow {
  id: string
  title: string
  detail: string | null
  tone: HomeTone
  /** A short note on the right, such as "12 min ago" or "3 runs". */
  aside: string | null
  /** What the row opens. A row with a button shows the action's label on it. */
  action: HomeAction
}

export type NeedKind = 'question' | 'decision' | 'review' | 'github' | 'proposal'

export interface NeedRow extends HomeRow {
  kind: NeedKind
}

export interface DayMark {
  at: number
  state: 'done' | 'failed' | 'next'
}

/** Today from midnight to midnight: the runs that ended, now, and the runs still to come. */
export interface DayStrip {
  start: number
  end: number
  now: number
  marks: DayMark[]
}

export interface HomeModel {
  header: {
    /** "5 things need you", or "Nothing needs you". */
    title: string
    /** What came since the user last looked, in one sentence. Null when there is nothing to say. */
    line: string | null
    chips: { tone: HomeTone; label: string }[]
    /** hobkin's face in the header. */
    mood: Mood
  }
  /** Most relevant first. */
  stack: StackCard[]
  needs: { rows: NeedRow[]; more: number }
  running: {
    rows: HomeRow[]
    /** Why work mode is not starting anything, in plain words. */
    held: string | null
    /** "2 of 4 slots · 3 queued". Null without work mode. */
    slots: string | null
  }
  upcoming: {
    rows: HomeRow[]
    day: DayStrip
    /** "9 runs · 2 failed" for today. */
    summary: string
  }
  problems: { rows: HomeRow[]; more: number }
  projects: { rows: HomeRow[] }
  github: {
    /** False when gh is not connected or not known yet: the widget says so instead of counting. */
    known: boolean
    reviews: number
    failing: number
    rows: HomeRow[]
  }
  week: {
    days: OutcomeDay[]
    completed: number
    unfinished: number
    wins: { merged: number; decided: number; streak: number } | null
  }
}

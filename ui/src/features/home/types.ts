import type { IntegrationsState } from '#shared/integrations/wire.ts'
import type { GitHubState } from '#shared/protocol/github.ts'
import type { PendingQuestion } from '#shared/protocol/question.ts'
import type { FinishedChange, WorkState } from '#shared/protocol/work.ts'
import type { RunningAgent } from '../../app/running-agents.ts'
import type { Mood } from '../../avatar/moods.tsx'
import type { WaitingRow } from '../actions/items.ts'
import type { OutcomeDay } from '../reports/briefing.ts'
import type { Report } from '../reports/report.ts'
import type { RoutineFacts } from '../routines/rules.ts'
import type { MarkLook } from '../integrations/marks.ts'

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
  /** Explicit existing-reminder occurrences, published by the host; never inferred from reports. */
  reminders?: unknown
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
  /** The host's reading of Pi's servers. Null before it has looked, or from a host that does not read Pi. */
  integrations: IntegrationsState | null
  /** Card and row ids the user has dismissed ("seen it / not now"). They are dropped everywhere they would show. */
  dismissed: ReadonlySet<string>
  /**
   * An optional ordering an hourly hobkin job can emit to reorganize the widgets (`snapshot.homeLayout`). Null, the
   * shipping default, lets the client order itself deterministically by urgency. Untrusted shape: `layoutOf` validates it.
   */
  layout: unknown
  /** Custom widgets hobkin authored and keeps (`snapshot.homeCustom`). Untrusted shape: `customWidgetsOf` validates it. */
  custom: unknown
  /** Proactive thoughts hobkin surfaces in the tip strip (`snapshot.homeThoughts`). Untrusted shape: `thoughtsOf` validates it. */
  thoughts: unknown
}

/** Where a button or row goes. Reminder completion uses its separate user-only control, never a navigation target. */
export type HomeTarget =
  | { to: 'screen'; screen: 'actions' | 'reports' | 'routines' | 'work' | 'github' | 'integrations' }
  | { to: 'report'; id: string }
  /** An Action Items row. One that hobkin handles elsewhere (`row.opens`) is resolved by the model, not here. */
  | { to: 'action'; id: string }
  | { to: 'review'; change: FinishedChange }
  | { to: 'agent'; id: string }
  | { to: 'routine'; id: string }
  /** A pull request on github.com, opened in the app's own Review. */
  | { to: 'pull'; url: string }
  /** A page on github.com, opened in the browser. */
  | { to: 'url'; url: string }
  /** The question hobkin is asking in the conversation. */
  | { to: 'question' }

export interface HomeAction {
  label: string
  target: HomeTarget
}

/** The colors a mark can take. They map to the app's tokens: accent yellow, bad, warn, ok, info, and quiet grey. */
export type HomeTone = 'accent' | 'bad' | 'warn' | 'ok' | 'info' | 'quiet'

export type CardKind = 'reminder' | 'question' | 'decision' | 'review' | 'github' | 'problem' | 'away' | 'agent' | 'upnext' | 'today'

/** A short labelled fact on a card, such as "Size: 120 lines · 4 files". */
export interface CardFact {
  label: string
  value: string
  tone: HomeTone
}

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
  facts: CardFact[]
  /** The answers the place it opens will offer, in their own words. Home shows them; it never picks one. */
  choices: string[]
  /** The answer hobkin or the asker recommends, and why the user is the one to decide. */
  pick: string | null
  why: string | null
  primary: HomeAction
  secondary: HomeAction | null
  /** Only these cards offer user-only Done/Dismissed; report navigation remains a separate action. */
  reminder?: { home: string; id: string }
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
  /** A running agent's own face: its hue and mood, and whether it is asking something. */
  face?: { hue: number; mood: Mood; asking: boolean }
}

export type NeedKind = 'question' | 'decision' | 'review' | 'github' | 'connection' | 'proposal'

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

/** gh, or one of Pi's servers, as the Connections widget draws it. */
export interface ConnectionTile {
  key: string
  name: string
  /** "Connected", "Sign in", "Failed", "Off", "Connecting". */
  status: string
  tone: HomeTone
  /** What went wrong, or who gh is signed in as. */
  note: string | null
  mark: MarkLook
  target: HomeTarget
}

/** The widgets Home draws around the smart stack, each a self-contained card the screen renders by kind. GitHub's counts live inside Connections, so it is not a widget of its own. */
export type WidgetKind = 'needs' | 'running' | 'upcoming' | 'problems' | 'projects' | 'connections' | 'week'

/** A short, friendly hint that teaches the app. Several rotate through the strip at the top; the user can dismiss any. */
export interface Tip {
  id: string
  text: string
  /** A real keyboard shortcut the tip is about, shown as a key chip. Only bindings that exist today (see `key-list.ts`). */
  kbd?: string
}

/**
 * A short proactive idea hobkin has, surfaced among the tips so the strip reads as hobkin thinking, not a canned hint.
 * hobkin authors these; the client only renders them. Arrives in the host snapshot (`homeThoughts`), so the shape is
 * untrusted and `thoughtsOf` validates it at the boundary.
 */
export interface Thought {
  id: string
  text: string
  /** When hobkin had the thought, ISO 8601. Optional; carried for a future "just now" treatment. */
  at?: string
}

/** One thing in the top strip: a built-in tip or a hobkin thought. `id` is its dismissal key (`tip:…` / `thought:…`). */
export type StripItem =
  | { kind: 'tip'; id: string; text: string; kbd?: string }
  | { kind: 'thought'; id: string; text: string }

/**
 * One widget's place in the dashboard: an ordered, data-driven slot the screen renders generically. The client sets
 * `weight` deterministically from how much the widget needs the user right now, so the dashboard reorganizes itself as
 * state changes. An hourly hobkin job could instead emit a `HomeLayout` to drive the order; the screen just renders it.
 */
export interface HomeWidget {
  /** Stable React key and manifest id: the kind itself for a built-in, `custom:<id>` for a hobkin-authored one. */
  id: string
  /** 'custom' is a widget hobkin authored and keeps; the rest are the client's own. */
  kind: WidgetKind | 'custom'
  /** Higher floats up. Carried for debugging and so a driver can reason about the client's own ranking. */
  weight: number
  /** The spec to render, present only when `kind` is 'custom'. */
  custom?: CustomWidget
}

/**
 * A widget hobkin authors and keeps up to date. hobkin fetches the values (a city's weather and time, a figure to
 * watch) and writes them into the spec; the client only renders them, through the same manifest, ordering, animation
 * and dismissal as the built-in widgets, and never fetches anything itself. The shape is untrusted, as it arrives in
 * the host snapshot; `customWidgetsOf` validates it at the boundary and drops anything malformed.
 */
export interface CustomWidget {
  /** Stable and hobkin-assigned, so the widget keeps its place and its dismissal across refreshes. */
  id: string
  title: string
  /** Explicit urgency; without one the widget sits in the ambient band, among the day's cards. */
  weight?: number
  body: CustomBody
  /** When hobkin last wrote the values, ISO 8601. Shown as "updated 3 min ago". */
  updatedAt?: string
}

/** How a custom widget draws its values: one figure, a short list of facts, or a line of prose. */
export type CustomBody =
  | { kind: 'stat'; value: string; label?: string }
  | { kind: 'keyvalue'; rows: { k: string; v: string }[] }
  | { kind: 'text'; text: string }

/** What an hourly hobkin job (or any external driver) emits to reorganize the widgets. Validated by `layoutOf`. */
export interface HomeLayout {
  /** Widget kinds in the order they should appear. Kinds left out keep the client's own order after these. */
  order: WidgetKind[]
  /** Kinds to hide entirely, whatever their content. */
  hidden: WidgetKind[]
}

export interface HomeModel {
  /** The widgets to draw, most relevant first. The screen maps over this and renders each by its kind. */
  widgets: HomeWidget[]
  /** The live strip items (tips and hobkin thoughts), dismissed ones removed. The top strip rotates through them. */
  strip: StripItem[]
  header: {
    /** "5 things need you", or "Nothing needs you". */
    title: string
    /** What came since the user last looked, in one sentence. Null when there is nothing to say. */
    line: string | null
    chips: { tone: HomeTone; label: string; target: HomeTarget }[]
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
    /** What work mode starts next, so an idle widget still says what is coming. */
    queue: HomeRow[]
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
  connections: {
    /** False until the host has said anything about gh or Pi's servers. */
    known: boolean
    tiles: ConnectionTile[]
    /** "3 connected · 1 needs sign-in". */
    summary: string | null
  }
  week: {
    days: OutcomeDay[]
    completed: number
    unfinished: number
    wins: { merged: number; decided: number; streak: number } | null
  }
}

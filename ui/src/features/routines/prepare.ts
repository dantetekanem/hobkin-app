/**
 * Everything the Routines screen draws, worked out ahead. The store does this as data arrives, on each minute and
 * when the sky's width changes, so opening the screen only draws what is ready: no timeline or occurrence math,
 * no holds or next runs, no marks and no sky scene is worked out while the screen travels in.
 */
import { factsOf, type RoutineFacts } from './rules.ts'
import { rollingSpan, skyMarks, spanOf, type SkyMark, type Span } from './sky-math.ts'
import { sceneOf, type Scene } from './sky-scene.ts'
import { nextSevenDays, type TimelineDay } from './timeline.ts'
import type { Hold, RoutinesData } from './types.ts'

/** The rolling day in the sky: these hours behind now, and these ahead. */
const HOURS_BEHIND = 8
const HOURS_AHEAD = 16

/** One view of the sky, ready to draw. */
export interface PreparedSky {
  span: Span
  marks: SkyMark[]
  /** Null until the sky's width is known. */
  scene: Scene | null
}

export interface PreparedRoutines {
  /** The moment it was worked out for. The screen counts its times from it. */
  now: number
  facts: RoutineFacts[]
  holds: Record<string, Hold | null>
  /** The rolling day, close up: what ran, what is still to come, and each check of a window. */
  day: PreparedSky
  /** The next seven days: the sky pulled back, and the list of each day's runs in time order. */
  week: PreparedSky & { days: TimelineDay[] }
}

function sceneFor(sky: Omit<PreparedSky, 'scene'>, view: 'hours' | 'days', width: number, now: number, zone: string): Scene | null {
  if (width <= 0) return null
  return sceneOf({ span: sky.span, width, zone, labels: view, now, marks: sky.marks })
}

/** Works out the screen for the data at `now`, in the user's timezone, for a sky `width` pixels wide (0 when not known yet). */
export function prepareRoutines(data: RoutinesData, now: number, zone: string, width: number): PreparedRoutines {
  const facts = factsOf(data, now)
  const holds = Object.fromEntries(facts.map((item) => [item.routine.id, item.hold]))

  const daySpan = rollingSpan(now, zone, HOURS_BEHIND, HOURS_AHEAD)
  const day = { span: daySpan, marks: skyMarks({ span: daySpan, now, routines: data.routines, logs: data.logs, holds, detail: true }) }
  const weekSpan = spanOf(now, zone, 7)
  const week = { span: weekSpan, marks: skyMarks({ span: weekSpan, now, routines: data.routines, logs: data.logs, holds, detail: false }) }

  return {
    now,
    facts,
    holds,
    day: { ...day, scene: sceneFor(day, 'hours', width, now, zone) },
    week: { ...week, scene: sceneFor(week, 'days', width, now, zone), days: nextSevenDays(data.routines, now, zone, holds) },
  }
}

/** The same screen with the sky drawn again for a new width. Nothing else is worked out again. */
export function selectPreparedView(prepared: PreparedRoutines, view: 'all' | 'week') {
  const sky = view === 'all' ? prepared.day : prepared.week
  return {
    facts: prepared.facts,
    holds: prepared.holds,
    span: sky.span,
    marks: sky.marks,
    scene: sky.scene,
    days: view === 'week' ? prepared.week.days : [],
  }
}

export function withSkyWidth(prepared: PreparedRoutines, width: number, zone: string): PreparedRoutines {
  if (prepared.day.scene?.width === width || (width <= 0 && prepared.day.scene === null)) return prepared
  return {
    ...prepared,
    day: { ...prepared.day, scene: sceneFor(prepared.day, 'hours', width, prepared.now, zone) },
    week: { ...prepared.week, scene: sceneFor(prepared.week, 'days', width, prepared.now, zone) },
  }
}

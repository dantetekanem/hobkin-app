/**
 * The reports catch-up (069-report-catch-up): one short report hobkin writes over the unread reports no catch-up has
 * covered, daily and when they pile up. The settings live in hobkin's home; the host passes them on.
 */
export interface CatchUpState {
  /** The daily time, `HH:MM` local, or null when the daily catch-up is off. */
  daily: string | null
  /** How many uncovered unread reports start one, or null when that trigger is off. */
  pileUp: number | null
  running: boolean
  /** When the last catch-up finished, as an ISO time. Null before the first. */
  lastAt: string | null
  /** Unread reports no catch-up has covered yet, leaving out those that said nothing new and earlier catch-ups. */
  uncovered: number
}

/** A report's read state as hobkin sends it: read in the reader, counted by a catch-up, or neither when unread. */
export type ReportReadState = 'read' | 'caught-up'

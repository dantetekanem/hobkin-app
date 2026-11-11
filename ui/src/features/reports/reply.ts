import { create } from 'zustand'
import type { Report } from './report.ts'

/** The report a reply is about: enough to name it on the message and for the host to find it. */
export interface ReplyTo {
  id: string
  title: string
  /** What it is about. A report when left out. */
  kind?: 'report' | 'routine'
  /** A routine's file, from the routines folder down. */
  file?: string
}

interface ReportReplyState {
  /** The report that goes with the next message, if any. One at a time, as in the terminal app. */
  report: ReplyTo | null
  attach: (report: ReplyTo) => void
  clear: () => void
}

/**
 * "Reply in chat": the report the user's next message is about. The composer reads this to show the report on
 * the input and to send it along (hobkin's `send(text, report)`), and clears it once the message goes or the
 * user drops it. Until the composer is wired, the Reports screen is the only place that shows it.
 */
export const useReportReply = create<ReportReplyState>()((set) => ({
  report: null,
  attach: (report) => set({ report }),
  clear: () => set({ report: null }),
}))

/** Puts a report on the next message, as `r` does in the terminal app. */
export function replyToReport(report: Report): void {
  useReportReply.getState().attach({ id: report.id, title: report.title })
}

/** Puts a routine on the next message. hobkin's `about` only knows reports, so it goes as a line of words (below). */
export function replyToRoutine(routine: { id: string; title: string; file: string }): void {
  useReportReply.getState().attach({ id: routine.id, title: routine.title, kind: 'routine', file: routine.file })
}

const REFERENCE = /^About the routine “(.+?)” \((.+?)\):\n\n/

/** The line that begins a routine reply, so hobkin's chat can read the routine's file: the text sent is this and the user's words. */
export function withRoutineReference(reply: Pick<ReplyTo, 'title' | 'file'>, words: string): string {
  return `About the routine “${reply.title}” (${reply.file}):\n\n${words}`
}

/** A message that begins with that line, shown as the words with "About <title>" above them. Other text is returned as it is. */
export function splitRoutineReference(text: string): { about?: string; text: string } {
  const match = REFERENCE.exec(text)
  return match ? { about: match[1], text: text.slice(match[0].length) } : { text }
}

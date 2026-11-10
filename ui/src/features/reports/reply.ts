import { create } from 'zustand'
import type { Report } from './report.ts'

/** The report a reply is about: enough to name it on the message and for the host to find it. */
export interface ReplyTo {
  id: string
  title: string
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

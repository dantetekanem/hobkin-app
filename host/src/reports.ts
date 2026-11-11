import { Unavailable, type HostHandlers } from './commands.ts'

interface ReportApp {
  snapshot: { reports?: unknown[] }
  recordReportRead(read: { id: string; dwellMs: number }): void
}

export function reportHandlers({ app }: { app: () => ReportApp }): HostHandlers {
  return {
    'report.read': ({ id, dwellMs }) => {
      const current = app()
      const listed = current.snapshot.reports?.some(report =>
        report !== null && typeof report === 'object' && 'id' in report && report.id === id)
      if (!listed) throw new Unavailable("That report is not in hobkin's list any more.")
      current.recordReportRead({ id, dwellMs })
      return { ok: true }
    },
  }
}

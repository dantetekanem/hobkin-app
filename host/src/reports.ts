import { deleteReports } from 'hobkin/src/cli/reports.mjs'
import { readShortReports, setShortReports } from 'hobkin/src/cli/short-reports.mjs'
import { Unavailable, type HostHandlers } from './commands.ts'

interface ReportApp {
  snapshot: { reports?: unknown[] }
  runtime: { directory: string }
  recordReportRead(read: { id: string; dwellMs: number }): void
}

const isListed = (current: ReportApp, id: string) =>
  current.snapshot.reports?.some(report => report !== null && typeof report === 'object' && 'id' in report && report.id === id)

export function reportHandlers({ app }: { app: () => ReportApp }): HostHandlers {
  return {
    // hobkin's own `reports delete`: the report leaves every list, and hobkin's watcher refreshes the snapshot.
    'report.delete': ({ id }) => {
      const current = app()
      if (!isListed(current, id)) throw new Unavailable("That report is not in hobkin's list any more.")
      deleteReports(current.runtime.directory, [id])
      return { id, deleted: true }
    },
    'report.read': ({ id, dwellMs }) => {
      const current = app()
      if (!isListed(current, id)) throw new Unavailable("That report is not in hobkin's list any more.")
      current.recordReportRead({ id, dwellMs })
      return { ok: true }
    },
    // Short reports (051-short-reports): hobkin keeps the switch in its config.json and reads it for each new report.
    'short-reports.read': () => ({ on: readShortReports(app().runtime.directory).on }),
    'short-reports.set': ({ on }) => setShortReports(app().runtime.directory, on),
  }
}

/**
 * A report that found nothing new is no report, so no list, count or notification keeps it. It opens with the triage
 * line hobkin's prompts ask a run that found nothing for, "Nothing new.", whatever follows on later lines: bold and the
 * final period are optional, and letter case does not matter. A run that failed, stopped short or was stopped still says
 * so. hobkin's runtime reads a report the same way and keeps none for such a run (`saysNothingNew` in
 * `src/cli/reports.mjs`).
 */
const nothingNew = /^(?:\*\*)?nothing new\.?(?:\*\*)?\.?$/i
const wentWrong = new Set(['failed', 'incomplete', 'interrupted'])

/** The first line with words on it, trimmed, read without splitting the rest of a long report. */
function firstLineOf(text: string): string {
  const start = text.trimStart()
  const end = start.indexOf('\n')
  return (end === -1 ? start : start.slice(0, end)).trim()
}

/** Whether a report row found nothing new. A row that is not an object with a text is not judged. */
export function isNothingNewReport(row: unknown): boolean {
  if (row === null || typeof row !== 'object') return false
  const { body, outcome } = row as { body?: unknown; outcome?: unknown }
  return typeof body === 'string' && !wentWrong.has(String(outcome)) && nothingNew.test(firstLineOf(body))
}

/** The reports that say something, in their order. */
export const withoutNothingNew = <Row>(rows: readonly Row[]): Row[] => rows.filter((row) => !isNothingNewReport(row))

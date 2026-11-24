/**
 * A report whose whole text is "Nothing new." says nothing, so no list, count or notification keeps it. hobkin's
 * prompts ask a run that found nothing for exactly that line, and its runtime keeps no report for one it started
 * itself (`isQuietRun` in `src/cli/reports.mjs`, where the first line is read the same way: bold and the final period
 * are optional, letter case does not matter). Here the whole text must be that line, so a report that says more is kept.
 */
const nothingNew = /^(?:\*\*)?nothing new\.?(?:\*\*)?\.?$/i

export const isNothingNewReport = (body: unknown): boolean => typeof body === 'string' && nothingNew.test(body.trim())

/** The reports that say something, in their order. A row that is not an object with a text is not judged. */
export const withoutNothingNew = <Row>(rows: readonly Row[]): Row[] =>
  rows.filter((row) => !(row !== null && typeof row === 'object' && isNothingNewReport((row as { body?: unknown }).body)))

/**
 * A link from one report to another (069-report-catch-up): hobkin's catch-up names each report it covers as
 * `[title](hobkin-report:<id>)`, and the reader opens that report instead of sending the address to the browser.
 */
export const REPORT_LINK = 'hobkin-report:'

/** The id of the report a link opens, or null when the address is not a report link. */
export function reportLinkOf(href: string | undefined): string | null {
  if (!href?.startsWith(REPORT_LINK)) return null
  const id = href.slice(REPORT_LINK.length)
  if (!id) return null
  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}

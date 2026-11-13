/**
 * hobkin's rules for what Chat shows of a message (`chatMessage` in its `src/cli/application.mjs`), which History
 * applies to earlier conversations. Typed here because hobkin ships plain JavaScript. Paths and signatures are those
 * of `~/Poetry/hobkin` at commit 3b6a085.
 */

declare module 'hobkin/src/cli/holds.mjs' {
  /** A turn hobkin started for a hold. Chat does not show it. */
  export function isHoldBrief(text: string): boolean
}

declare module 'hobkin/src/cli/wake.mjs' {
  /** A turn hobkin started by itself. Chat does not show it. */
  export function isWakeBrief(text: string): boolean
}

declare module 'hobkin/src/cli/brief.mjs' {
  export function withoutBriefNote(text: string): string
}

declare module 'hobkin/src/cli/learning/note.mjs' {
  export function withoutLearningNote(text: string): string
}

declare module 'hobkin/src/cli/work/chat.mjs' {
  export function withoutWorkNote(text: string): string
}

declare module 'hobkin/src/cli/reports.mjs' {
  /** The user's words, and the title of the report they were about. */
  export function splitReportReference(text: string): { text: string; about: string | null }
  /** Text without hobkin's hidden markers. */
  export function reportText(text: unknown): string
  /** Hides the reports from every inventory and removes their saved text. hobkin's own delete; it cannot be undone. */
  export function deleteReports(root: string, ids: readonly string[]): Set<string>
  export function deletedReportIds(root: string): Set<string>
}

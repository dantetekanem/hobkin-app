/** What the window says when the running host is older than the window and does not know a command yet. */
export const RESTART_NEEDED = 'This needs hobkin to restart once: the running host is older than this window.'

// The registry's own words for a name it does not have (`shared/commands/registry.ts`).
const UNKNOWN_COMMAND = /^There is no command named "/

/** A host's refusal as the user should read it. An older host refusing a command by name says what fixes it; any other refusal stays hobkin's own words. */
export function explainRefusal(error: unknown): unknown {
  if (!(error instanceof Error) || !UNKNOWN_COMMAND.test(error.message)) return error
  const explained = new Error(RESTART_NEEDED, { cause: error })
  return 'code' in error ? Object.assign(explained, { code: error.code }) : explained
}

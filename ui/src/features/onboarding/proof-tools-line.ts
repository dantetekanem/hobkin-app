/** What the quiet line says while the tools are set up. */
export const SETTING_UP = 'Setting up the TLA+ tools in the background.'
/** Said after a failure. hobkin's own report names folders and versions, so the story never shows it. */
export const FAILED = "I couldn't set up the TLA+ tools. Check this Mac can try again."

/**
 * The quiet line once the setup of the tools has answered: nothing when it worked, one short line when it did not.
 * Whatever hobkin reported stays out of the story; Check this Mac shows what is there.
 */
export function lineAfterProofTools(said: { ok: boolean; message: string }): string | null {
  return said.ok ? null : FAILED
}

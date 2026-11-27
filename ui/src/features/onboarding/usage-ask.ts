import type { Mood } from '../../avatar/moods.tsx'

/**
 * The setup's question about usage counts (025-onboarding), on the user's word of 2026-11-26: "Nothing until yes". A
 * new home sends and enrolls nothing until the person says yes here, a skipped setup leaves it off, and Settings can
 * turn it on later. Pure rules: `story.ts` asks it, and `Storyteller.tsx` keeps the answer through the host.
 */

/** The beat's id in the story. */
export const USAGE_BEAT = 'usage'

export const USAGE_MOOD: Mood = 'wink'

/**
 * What hobkin says: what goes, what never goes, where to change it, and then the question, with the last bubble as
 * every beat asks. Each bubble fits the story's, at most 110 characters.
 */
export const USAGE_LINES: readonly string[] = [
  'One more thing. Usage counts hold fixed words and numbers, like which parts you used and how runs ended.',
  'They never hold your messages, names or file paths, and Settings changes this any time.',
  "May I send them to hobkin's server?",
]

/** No sits where the person's eye lands first, so saying nothing is never a yes. */
export const USAGE_CHOICES = [
  { value: 'no', label: 'No, keep them here' },
  { value: 'yes', label: 'Yes, send counts' },
] as const

/** The answer a picked bubble gives: only yes sends anything. */
export const usageAnswer = (value: string): boolean => value === 'yes'

/** Only with a host to keep the answer: a browser tab on sample data has nowhere to keep it, so it is not asked. */
export const asksUsage = (facts: { host?: boolean }): boolean => facts.host === true

/** Runs `setup.telemetry`, as the window's `runCommand` does. */
export type KeepUsage = (name: 'setup.telemetry', args: { upload: boolean }) => Promise<{ upload: boolean }>

/**
 * Keeps the answer through the host, which makes it hobkin's own setting on the real home. Answers with what to say
 * when it could not, or null. The story goes on either way, and the setting is then as it was: off for a new home.
 */
export async function keepUsage(upload: boolean, run: KeepUsage): Promise<string | null> {
  try {
    await run('setup.telemetry', { upload })
    return null
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return `I could not keep your answer about usage counts: ${reason}`
  }
}

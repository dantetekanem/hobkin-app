import { COMPUTER_KINDS, type ComputerKind, type UserProfile } from '#shared/protocol/setup.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * Who the user is, as the first-run setup asks (025-onboarding). hobkin keeps it in `profile.json` in its home and
 * checks every value, so it is read and saved through hobkin's own profile code and nothing is checked twice here.
 */

export type ProfileChange = Partial<Record<'name' | 'email', string>> & { computer?: ComputerKind }

const said = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const computerOf = (value: unknown): ComputerKind | null => (COMPUTER_KINDS.find((kind) => kind === value) ?? null)

/** What the window gets of hobkin's profile. What to call them stays hobkin's. */
const wire = (saved: { name?: string; email?: string; computer?: string }): UserProfile => ({
  name: said(saved.name),
  email: said(saved.email),
  computer: computerOf(saved.computer),
})

export async function readUserProfile(root: string): Promise<UserProfile> {
  const { readProfile } = await import('hobkin/src/cli/profile.mjs')
  return wire(readProfile(root))
}

/** Saves what is given in one write. When hobkin refuses a value nothing is saved, and hobkin's words say why. */
export async function saveUserProfile(root: string, change: ProfileChange): Promise<UserProfile> {
  const { updateProfile } = await import('hobkin/src/cli/profile.mjs')
  try {
    return wire(updateProfile(root, change))
  } catch (error) {
    throw new Unavailable(error instanceof Error ? error.message : String(error))
  }
}

export interface ProfileHandlerOptions {
  /** The folder the home's data is in. */
  root: () => string
  /** Reads hobkin's state again, so the window greets the user by the name just saved. */
  saved: () => Promise<unknown>
}

export function profileHandlers({ root, saved }: ProfileHandlerOptions): HostHandlers {
  return {
    'profile.read': () => readUserProfile(root()),
    'profile.set': async (change) => {
      const profile = await saveUserProfile(root(), change)
      // The profile is saved either way. Without the read the window catches up at hobkin's next change.
      await saved().catch(() => {})
      return profile
    },
  }
}

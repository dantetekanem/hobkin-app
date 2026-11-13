/**
 * What the first-run setup reads and changes outside the window: who the user is, and Pi on this Mac.
 * See _specs/025-onboarding.
 */

export const COMPUTER_KINDS = ['personal', 'work'] as const
/** Whose computer this is, as the user said in the setup. hobkin asks different things for each. */
export type ComputerKind = (typeof COMPUTER_KINDS)[number]

/** What hobkin keeps about the user, in `profile.json` in its home. Null is "not said yet". */
export interface UserProfile {
  name: string | null
  email: string | null
  computer: ComputerKind | null
}

/** The most a name or an email may hold, as hobkin's own profile allows. */
export const PROFILE_TEXT_MAX = 120

/** A Pi package hobkin's agents use, and whether Pi has it on this Mac. */
export interface PiPackageState {
  /** Its name, such as `pi-coder`. The setup installs by this name, never by a source from the window. */
  name: string
  /** What it adds, in one short line. */
  adds: string
  installed: boolean
}

/** Pi on this Mac. Checks, agents and work mode start the `pi` program, so they need it installed. */
export interface PiSetup {
  /** A `pi` program was found. */
  installed: boolean
  /** Its version, such as "1.5.0". Null when there is none or it did not say. */
  version: string | null
  /** The version hobkin runs on. */
  pinned: string
  /** The installed Pi is the pinned one. */
  matches: boolean
  /** npm was found, so the window can install Pi. When false the user runs `installCommand` themselves. */
  canInstall: boolean
  /** The command that installs the pinned Pi, for a person to read or run. */
  installCommand: string
  /** The packages hobkin's agents use. All `installed: false` while Pi itself is missing. */
  packages: PiPackageState[]
}

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

/** The oldest Pi major version the setup accepts. */
export const PI_MIN_MAJOR = 1

/** A Pi version passes when it is 1.0 or newer. The pinned one is only what a Mac without Pi gets installed. */
export const piVersionPasses = (version: string | null): boolean => {
  const major = Number(version?.match(/^\d+/)?.[0])
  return Number.isInteger(major) && major >= PI_MIN_MAJOR
}

/** Pi on this Mac. Checks, agents and work mode start the `pi` program, so they need it installed. */
export interface PiSetup {
  /** A `pi` program was found. */
  installed: boolean
  /** Its version, such as "1.5.0". Null when there is none or it did not say. */
  version: string | null
  /** The version hobkin runs on. */
  pinned: string
  /** The installed Pi is one hobkin runs on: any Pi from `PI_MIN_MAJOR` on (`piVersionPasses`), not only the pinned one. */
  matches: boolean
  /** npm was found, so the window can install Pi. When false the user runs `installCommand` themselves. */
  canInstall: boolean
  /** The command that installs the pinned Pi, for a person to read or run. */
  installCommand: string
  /** The packages hobkin's agents use. All `installed: false` while Pi itself is missing. */
  packages: PiPackageState[]
  /** The Node npm runs on. Left out by a host from before this was sent. */
  node?: PiNodeState
  /** hobkin can install a Node of its own here (`setup.install-node`): a live host on a Mac with Apple silicon or an Intel chip. Left out by a host from before. */
  canInstallNode?: boolean
}

/** Node on this Mac, which npm and Pi run on. */
export interface PiNodeState {
  /** A Node was found. The one the app carries for its host has no npm, and does not count. */
  found: boolean
  /** Its version, such as "22.19.0". Null when there is none or it did not say. */
  version: string | null
  /** The version hobkin installs for itself, the one its host runs on. */
  installs: string
}

/** A folder inside the user's projects folder. */
export interface ProjectFolder {
  /** The folder's own name, such as `my-blog`. */
  name: string
  /** Where it is, written out in full. */
  path: string
  /** It is a git repository. */
  git: boolean
}

/** The most project folders the host sends for one folder. The setup shows fewer at once and filters the rest. */
export const PROJECTS_MAX = 300

/** What the host found in a folder the user named as where their projects live. It reads names only, never a file. */
export interface ProjectsFound {
  /** The folder that was looked in, written out in full, with `~` as the home it stands for. */
  folder: string
  /** The folder is there and can be read. */
  found: boolean
  /** The folders in it, the ones changed most recently first, at most `PROJECTS_MAX`. */
  projects: ProjectFolder[]
  /** How many more there are than were sent. */
  more: number
}

/** The most a question's words, and an answer to it, may hold in what the setup saves. */
export const SETUP_ASK_MAX = 1000
export const SETUP_ANSWER_MAX = 20_000
/** The most answers one save holds. More than any computer's questions. */
export const SETUP_ANSWERS_MAX = 12

/** One of the setup's questions as it was answered: its id, the words it was asked with, and the answer. */
export interface SetupAnswer {
  id: string
  ask: string
  answer: string
}

/** What the setup saves after each answer. Each save replaces the one before. */
export interface SetupAnswers {
  /** Whose computer this is. Left out while it was not said. */
  computer?: ComputerKind
  answers: SetupAnswer[]
  /** The projects picked, with where each is and whether it is a git repository, as `setup.projects` found them. */
  projects: ProjectFolder[]
}

/** What the app keeps of the setup in `client/setup.json` in hobkin's home, so a setup run again starts from it. */
export interface SetupSaved {
  computer: ComputerKind | null
  answers: SetupAnswer[]
  projects: ProjectFolder[]
  /** When it was saved, as an ISO time. */
  savedAt: string
}

/**
 * What became of a project picked in the setup. `taken`: work mode has it now, which starts nothing. `proposed`:
 * it waits in Work for the user to take, since a running work mode that picks by itself would start on it at once.
 * `left`: work mode knew it already, and it is as it was. `skipped`: it could not be added, and `reason` says why.
 */
export type SetupProjectOutcome = 'taken' | 'proposed' | 'left' | 'skipped'

/** Why a project was left or skipped, as a word the window can count by. */
export type SetupProjectWhy = 'known' | 'not-folder' | 'not-git' | 'namesake' | 'refused'

export interface SetupProjectDone {
  path: string
  name: string
  outcome: SetupProjectOutcome
  /** Null when it was taken or proposed. */
  why: SetupProjectWhy | null
  /** The same in plain words, hobkin's own when it refused. Null when it was taken or proposed. */
  reason: string | null
}

/** What `setup.work` did with the folder and with each project picked. */
export interface SetupWorkDone {
  folder: {
    /** As the user typed it. */
    typed: string
    /** The folder work mode starts from now. Null when it has none. */
    saved: string | null
    /** This call saved it. */
    changed: boolean
    /** Why it was not saved, in plain words, or null. */
    problem: string | null
  }
  /** Work mode as it was found. It is never turned on or off here. */
  workMode: { enabled: boolean; autoPick: boolean }
  /** Each project picked, in the order it was given. */
  projects: SetupProjectDone[]
}

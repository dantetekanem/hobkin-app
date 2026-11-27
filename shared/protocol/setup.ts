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
  /** The launcher the hobkin config names, as its command reads. Pi is read and its packages installed through it. Left out when there is none. */
  launcher?: string
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

/**
 * Where a need sits in the setup's review: what hobkin needs to run at all, what Work and Change Review need for
 * code, what one feature needs, and what only makes something better.
 */
export const SETUP_NEED_GROUPS = ['run', 'code', 'features', 'optional'] as const
export type SetupNeedGroup = (typeof SETUP_NEED_GROUPS)[number]

/** The programs the setup installs for the user on a press (`setup.install-program`), so no one needs Terminal. */
export const SETUP_PROGRAMS = ['git', 'gh', 'claude', 'qmd'] as const
export type SetupProgram = (typeof SETUP_PROGRAMS)[number]

/** The programs whose own web sign-in the setup runs on a press (`setup.sign-in-program`). */
export const SIGN_IN_PROGRAMS = ['gh', 'claude'] as const
export type SignInProgram = (typeof SIGN_IN_PROGRAMS)[number]

/**
 * How a missing need is fixed: one of the setup's own installs, its sign-in, a program's own sign-in, or a command
 * for the user to copy and run. The setup installs only on the user's press. A program's install and sign-in say what
 * the press does (`says`), and keep the line to copy (`byHand`) for when it fails.
 */
export type SetupFix =
  | { kind: 'install'; what: 'node' | 'pi' | 'proof-tools' }
  | { kind: 'install-package'; name: string }
  | { kind: 'sign-in' }
  | { kind: 'command'; command: string }
  | { kind: 'install-program'; name: SetupProgram; says: string; byHand: string }
  | { kind: 'sign-in-program'; name: SignInProgram; says: string; byHand: string }

/**
 * What `setup.install-program` did. `finished` is false when the press opened an installer of the Mac's own, Apple's
 * for its command line tools, which goes on in its own window: Look again finds what it installed once it is done.
 */
export interface ProgramInstalled {
  finished: boolean
}

/** The most a code pasted back into a program's sign-in may hold. */
export const SIGN_IN_CODE_MAX = 2000

/**
 * A program's web sign-in under way (`setup.sign-in-program`): the page to open in the browser, the one-time code to
 * enter there (gh's), and whether the page may give a code to paste back instead (Claude Code's). The program itself
 * waits for the answer until `setup.sign-in-program-wait` says it ended.
 */
export interface ProgramSignIn {
  name: SignInProgram
  url: string
  code: string | null
  pastes: boolean
}

/** How a program's sign-in ended: signed in, or not, with the program's own last words. */
export interface ProgramSignInEnd {
  signedIn: boolean
  message: string | null
}

/** One thing hobkin needs on this Mac, as the setup's review shows it. */
export interface SetupNeed {
  /** Its own id, such as `git` or `package:pi-coder`. */
  id: string
  group: SetupNeedGroup
  name: string
  /** What needs it, in a few words. */
  neededBy: string
  found: boolean
  /** Its version, where one applies and it said. */
  version: string | null
  /** Why it is missing, in a few words. Null when it is found. */
  problem: string | null
  /** How to fix it. Null when it is found. */
  fix: SetupFix | null
}

/** What `setup.needs` read: every need, in the order the review shows them. */
export interface SetupNeeds {
  needs: SetupNeed[]
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

/**
 * What the person is working toward, asked in the setup (044-goal-first-setup), in the order its questions are asked
 * and its cards shown. hobkin's runtime has the same list (`TEMPLATE_GOALS`), and a host test holds the two equal.
 */
export const GOALS = ['job', 'business', 'project', 'life', 'code'] as const
export type Goal = (typeof GOALS)[number]

/** What a routine made from a template gives the person. */
export const TEMPLATE_GIVES = ['report', 'action', 'critical', 'follow-up'] as const
export type TemplateGift = (typeof TEMPLATE_GIVES)[number]

/** A routine template as a card in the setup, as hobkin's `goalCards` reads it. A part a template leaves out is null or empty. */
export interface TemplateCard {
  id: string
  version: number
  source: 'hobkin' | 'yours'
  title: string
  /** What it watches. */
  summary: string
  /** Where it looks. */
  needs: string[]
  recurrence: string
  /** What is worth telling. */
  tells: string | null
  /** What it leaves out unless the person says otherwise. */
  skips: string | null
  gives: TemplateGift[]
  /** What closes an item. */
  closes: string | null
  /** It reads the person's own accounts. */
  private: boolean
  /** The template's own question, for what it needs to know. */
  asks: string | null
  effort: 'low' | 'medium' | 'high'
}

/** One picked goal's cards: the ones it starts with, and the rest that name it. Each template is one card in all of them. */
export interface GoalCards {
  goal: Goal
  starters: TemplateCard[]
  more: TemplateCard[]
}

/** What `setup.watchers` answers: the cards of each goal asked for, in the goals' order. */
export interface SetupWatchers {
  goals: GoalCards[]
}

/** What the person changed on a card before keeping or dropping it. Each is left out while it says what the template says. */
export interface SetupCardChanges {
  recurrence?: string
  /** Empty leaves nothing out. */
  skips?: string
  /** The answer to the template's own question. */
  answer?: string
}

/** A card the person kept or turned down in the setup, by its template and version, with their changes. One left alone is not kept. */
export interface SetupCardPick {
  id: string
  version: number
  title: string
  mark: 'kept' | 'dropped'
  changes: SetupCardChanges
}

/** The most cards one save keeps, kept and dropped together. More than any goals' cards. */
export const SETUP_CARDS_MAX = 80

/** What the setup saves after each answer. Each save replaces the one before. */
export interface SetupAnswers {
  /** Whose computer this is. Left out while it was not said. */
  computer?: ComputerKind
  answers: SetupAnswer[]
  /** The projects picked, with where each is and whether it is a git repository, as `setup.projects` found them. */
  projects: ProjectFolder[]
  /** What the person is working toward. Left out by a window from before goals. */
  goals?: Goal[]
  /** The cards kept and turned down. Left out by a window from before cards. */
  cards?: SetupCardPick[]
}

/** What the app keeps of the setup in `client/setup.json` in hobkin's home, so a setup run again starts from it. */
export interface SetupSaved {
  computer: ComputerKind | null
  answers: SetupAnswer[]
  projects: ProjectFolder[]
  goals: Goal[]
  cards: SetupCardPick[]
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

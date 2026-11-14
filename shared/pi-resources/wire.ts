/**
 * Skills and Pi extensions as the host reads them from Pi, the way they travel to the window
 * (_specs/039-skills-and-extensions). Every list is Pi's own: what `pi config` lists for the user, with whether Pi
 * loads each one. Paths that are shown write the home folder as ~. A path that is an id is Pi's own, and every
 * command names a skill or an extension by it.
 */

/** A Pi package by its source as Pi's settings write it, and its short name. */
export interface PackageRef {
  source: string
  name: string
}

export interface SkillEntry {
  /** The skill's file as Pi resolves it. */
  path: string
  /** The file to read or change, with ~ for the home folder: where a link leads, when Pi reaches the skill through one. */
  file: string
  name: string
  /** Empty when Pi skips the file. */
  description: string
  on: boolean
  /** Pi's own folder, the Agent Skills folder (~/.agents/skills), a path in Pi's settings, or a package. */
  from: 'folder' | 'agents' | 'settings' | 'package'
  package: PackageRef | null
  /** Pi loads only the first skill of a name. The file of the one it uses instead, or null. */
  shadowedBy: string | null
  /** It runs only when named, with /skill:name (`disable-model-invocation`). */
  commandOnly: boolean
  /** Why Pi does not load the file as a skill, in its own words, or null. */
  problem: string | null
}

export interface SkillsState {
  /** Pi's settings file, which turning a skill off or on writes. Null until the host has looked. */
  settings: string | null
  skills: SkillEntry[]
  /** What Pi could not read, in its own words. */
  problems: string[]
  /** When the host last read Pi's list, as an ISO time. */
  readAt: string | null
  /** What kept the host from reading Pi at all, or null. */
  error: string | null
}

export const SKILLS_UNKNOWN: SkillsState = { settings: null, skills: [], problems: [], readAt: null, error: null }

/** One skill in full, for View more. */
export interface SkillFile {
  path: string
  name: string
  description: string
  /** The file after its frontmatter, as Markdown. */
  body: string
  /** The file is longer than the host reads, so its end is left out. */
  cut: boolean
}

export interface ExtensionEntry {
  /** Pi's path for it: its file, or builtin:<name> for one built into Pi. */
  path: string
  /** Its name as `pi config` shows it. */
  name: string
  /** Its file with ~ for the home folder. Null for one built into Pi. */
  file: string | null
  on: boolean
  /** Pi's own extensions folder, a path in Pi's settings, a package, or Pi itself. */
  from: 'folder' | 'settings' | 'package' | 'built-in'
}

export interface PiPackage {
  /** As Pi's settings write it. */
  source: string
  /** The npm name, the git repository, or the folder's name. */
  name: string
  kind: 'npm' | 'git' | 'local'
  /** From its own package.json. Null when it has none or is not installed. */
  version: string | null
  /** Where it is on this Mac, with ~ for the home folder. Null while it is not installed. */
  folder: string | null
  /** Pi installs a missing package itself when it next starts. Until then it brings nothing. */
  installed: boolean
  /** An exact npm version or a pinned git ref: Pi never updates it. */
  pinned: boolean
  /** What Pi's own check found: an update, none, or null when it was not checked, as Pi never checks a folder or a pinned package. */
  update: 'available' | 'none' | null
  extensions: ExtensionEntry[]
  /** How many of Pi's skills it brings. */
  skills: number
}

export interface ExtensionsState {
  /** Pi's settings file, which turning an extension off or on writes. Null until the host has looked. */
  settings: string | null
  /** In the order of Pi's settings. */
  packages: PiPackage[]
  /** The extensions in Pi's own extensions folder and in its settings. */
  own: ExtensionEntry[]
  /** The extensions built into Pi, by Pi's own list of them. */
  builtIn: ExtensionEntry[]
  /** Pi's check for updates: under way, and when it last finished, as an ISO time. */
  updates: { checking: boolean; checkedAt: string | null }
  problems: string[]
  readAt: string | null
  error: string | null
}

export const EXTENSIONS_UNKNOWN: ExtensionsState = {
  settings: null,
  packages: [],
  own: [],
  builtIn: [],
  updates: { checking: false, checkedAt: null },
  problems: [],
  readAt: null,
  error: null,
}

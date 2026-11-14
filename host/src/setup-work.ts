import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { runWorkCommand } from 'hobkin/src/cli/work/commands.mjs'
import { proposeProject, readMode, readProjects, setFolder, slugOf } from 'hobkin/src/cli/work/store.mjs'
import type { SetupProjectDone, SetupProjectOutcome, SetupProjectWhy, SetupWorkDone } from '#shared/protocol/setup.ts'
import type { HostHandlers } from './commands.ts'

/**
 * What the first-run setup hands work mode (025-onboarding, 011-work): the folder the user named, and the projects
 * they picked there. Everything is written by hobkin's own work functions. The setup never turns work mode on and
 * never starts anything that spends: while work mode runs and picks by itself, a project taken would start a paid
 * study at once, so there a pick is only offered in Work for the user to take.
 */

/** What is known of one picked project when the setup decides what to do with it. */
export interface PickedFacts {
  /** How work mode knows this very folder, by the project's state, or null when it does not. */
  known: string | null
  /** Where the project work mode has under this folder's name lives, when that is another folder. */
  namesake: string | null
  /** It is a folder. */
  folder: boolean
  /** It is a git repository. */
  git: boolean
}

export interface WorkModeFacts {
  enabled: boolean
  autoPick: boolean
}

export interface Fate {
  outcome: SetupProjectOutcome
  why: SetupProjectWhy | null
  reason: string | null
}

const settled = (outcome: SetupProjectOutcome): Fate => ({ outcome, why: null, reason: null })
const skipped = (why: SetupProjectWhy, reason: string): Fate => ({ outcome: 'skipped', why, reason })

/**
 * What the setup does with a picked project. One work mode knows is left exactly as it is, since taking a skipped
 * or dropped one again would undo the user's own word. One that cannot be a project is skipped. The rest are taken,
 * which starts nothing, unless work mode runs and picks by itself: then they are only proposed.
 */
export function fateOf(project: PickedFacts, mode: WorkModeFacts): Fate {
  if (project.known) return { outcome: 'left', why: 'known', reason: `Work mode already has it as ${project.known}, so it was left as it is.` }
  if (!project.folder) return skipped('not-folder', 'It is not a folder.')
  if (!project.git) return skipped('not-git', 'It is not a git repository.')
  // hobkin refuses a second folder by a known project's name, so a proposal is held to the same.
  if (project.namesake) return skipped('namesake', `Work mode already has a project by its name, at ${project.namesake}.`)
  return settled(mode.enabled && mode.autoPick ? 'proposed' : 'taken')
}

/** hobkin's work functions the setup uses. Tests hand in others. */
export interface SetupWorkRuntime {
  readMode: (root: string) => { enabled: boolean; autoPick: boolean; folder?: string | null }
  readProjects: (root: string) => { slug: string; path?: string; remote?: string; state?: string }[]
  setFolder: (root: string, requested: string) => { folder: string | null; changed: boolean }
  /** Offers the project in Work for the user to take. */
  propose: (root: string, project: { name: string; path: string }) => unknown
  /** Takes the project, with hobkin's own checks of a folder added by hand. */
  take: (root: string, path: string) => Promise<unknown>
}

export const HOBKIN_WORK: SetupWorkRuntime = {
  readMode,
  readProjects,
  setFolder,
  propose: (root, { name, path }) => proposeProject(root, { name, path, level: 'important', reason: 'Picked in the setup.', first: [] }),
  take: (root, path) => runWorkCommand(root, ['add', 'project', path]),
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The folder as it is on disk, and the ways it can be written, since hobkin keeps the real one. */
function onDisk(path: string): { folder: boolean; git: boolean; spellings: string[] } {
  try {
    const folder = statSync(path).isDirectory()
    const git = folder && existsSync(join(path, '.git'))
    return { folder, git, spellings: [path, realpathSync(path)] }
  } catch {
    return { folder: false, git: false, spellings: [path] }
  }
}

function factsOf(root: string, path: string, runtime: SetupWorkRuntime): PickedFacts {
  const { folder, git, spellings } = onDisk(path)
  const projects = runtime.readProjects(root)
  const known = projects.find((project) => project.path !== undefined && spellings.includes(project.path))
  const named = known ? undefined : projects.find(({ slug }) => slug === slugOf(basename(path)))
  return {
    known: known ? (known.state ?? 'known') : null,
    namesake: named ? (named.path ?? named.remote ?? named.slug) : null,
    folder,
    git,
  }
}

function saveFolder(root: string, typed: string, before: string | null, runtime: SetupWorkRuntime): SetupWorkDone['folder'] {
  try {
    const { folder, changed } = runtime.setFolder(root, typed)
    // A work mode that runs keeps what it has, and turning it on again with a folder is the user's own word, not the setup's.
    if (folder === null) return { typed, saved: null, changed: false, problem: 'Work mode is running without a folder, so its folder was not changed.' }
    return { typed, saved: folder, changed, problem: null }
  } catch (error) {
    return { typed, saved: before, changed: false, problem: messageOf(error) }
  }
}

/** Saves the folder, then does with each picked project what `fateOf` says, in the order they were picked. */
export async function putInWork(root: string, { folder, projects }: { folder: string; projects: readonly string[] }, runtime: SetupWorkRuntime = HOBKIN_WORK): Promise<SetupWorkDone> {
  const mode = runtime.readMode(root)
  const workMode = { enabled: mode.enabled === true, autoPick: mode.autoPick === true }
  const saved = saveFolder(root, folder, mode.folder ?? null, runtime)

  const done: SetupProjectDone[] = []
  for (const path of new Set(projects)) {
    const name = basename(path)
    const fate = fateOf(factsOf(root, path, runtime), workMode)
    try {
      if (fate.outcome === 'taken') await runtime.take(root, path)
      if (fate.outcome === 'proposed') runtime.propose(root, { name, path })
      done.push({ path, name, ...fate })
    } catch (error) {
      done.push({ path, name, outcome: 'skipped', why: 'refused', reason: messageOf(error) })
    }
  }
  return { folder: saved, workMode, projects: done }
}

export interface SetupWorkOptions {
  /** The folder the home's data is in. Throws, with the reason, while hobkin is not open in this host. */
  root: () => string
  /** Reads hobkin's state again, so the Work screen shows the projects at once. */
  refresh: () => Promise<unknown>
  runtime?: SetupWorkRuntime
}

export function setupWorkHandlers({ root, refresh, runtime = HOBKIN_WORK }: SetupWorkOptions): HostHandlers {
  return {
    'setup.work': async (picked) => {
      const done = await putInWork(root(), picked, runtime)
      // What was done is in hobkin's files either way. Without the read the window catches up at hobkin's next change.
      await refresh().catch(() => {})
      return done
    },
  }
}

import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import * as hobkinControls from 'hobkin/src/cli/work/controls.mjs'
import { readProjects } from 'hobkin/src/cli/work/store.mjs'
import type { FolderLook, NewProjectDone, ProjectKind, ProjectState } from '#shared/protocol/work.ts'
import { Unavailable, type HostHandlers } from './commands.ts'
import { projectsAt, type SetupWorkRuntime } from './setup-work.ts'

/**
 * New project (059-new-project): what hobkin sees at a folder the user typed, and the add. The add is hobkin's own
 * `newProject`, which starts a git repository in a folder that has none, writes the user's words to the project's
 * directions and takes the project at the level for one added by hand. Nothing here starts a study.
 */

export interface NewProjectRequest {
  path: string
  kind: ProjectKind
  wants?: string
  level: string
}

/** hobkin's answer to an add: the project as it took it, and its own line about what happens next. */
export interface ProjectAdded {
  ok: true
  message: string
  slug: string
  name: string
  kind: ProjectKind
}

/** hobkin's functions the New project popup uses. Tests hand in others. */
export interface NewProjectRuntime {
  readProjects: SetupWorkRuntime['readProjects']
  /** Only a hobkin that has the add has it. Looked up on the module, never imported by name, so an older hobkin still loads. */
  newProject?: (root: string, request: NewProjectRequest) => Promise<ProjectAdded> | ProjectAdded
}

export const HOBKIN_NEW_PROJECT: NewProjectRuntime = {
  readProjects,
  newProject: (hobkinControls as { newProject?: NewProjectRuntime['newProject'] }).newProject,
}

const PROJECT_STATES: readonly ProjectState[] = ['chosen', 'proposed', 'skipped', 'dropped']

/** A project's state in the words the window uses for it. */
const STATE_WORDS: Record<ProjectState, string> = {
  chosen: 'taken',
  proposed: 'proposed',
  skipped: 'skipped',
  dropped: 'dropped',
}

type KnownRecord = ReturnType<SetupWorkRuntime['readProjects']>[number]

/** The project work mode has for the folder, as the window reads it. A record with no state hobkin knows reads as proposed. */
function knownProject(record: KnownRecord): NonNullable<FolderLook['known']> {
  const state = PROJECT_STATES.find((known) => known === record.state) ?? 'proposed'
  return { slug: record.slug, name: record.name ?? record.slug, state }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** The path as typed, with `~` for the home folder. A path that is not absolute after that is nothing. */
function absolute(typed: string, home: string): string | null {
  const path = typed.trim()
  const expanded = path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path
  return isAbsolute(expanded) ? resolve(expanded) : null
}

export function lookAt(root: string, typed: string, runtime: Pick<NewProjectRuntime, 'readProjects'>, home: string): FolderLook {
  const nothing = { typed, folder: null, name: null, git: false, known: null, namesake: null }
  const path = absolute(typed, home)
  if (!path) return { ...nothing, found: 'missing' }
  const { disk, known, named } = projectsAt(root, path, runtime)
  if (!disk.folder) return { ...nothing, found: isFile(path) ? 'file' : 'missing' }

  // The folder's spellings end with the one it has on disk, with links resolved.
  const folder = disk.spellings.at(-1) ?? path
  return {
    typed,
    folder,
    found: 'folder',
    git: disk.git,
    name: basename(folder),
    known: known ? knownProject(known) : null,
    namesake: named ? (named.path ?? named.remote ?? named.slug) : null,
  }
}

export interface NewProjectSeat {
  /** The folder the home's data is in. Throws, with the reason, while hobkin is not open in this host. */
  root: () => string
  /** Reads hobkin's state again, so the window shows the project at once. */
  refresh: () => Promise<unknown>
  runtime?: NewProjectRuntime
  home?: string
}

/** Why a look says the folder cannot be added, in plain words, or null when it can. Either kind goes in any folder: hobkin starts a repository where there is none. */
function refusalFor(look: FolderLook): string | null {
  if (look.found === 'missing') return `There is no folder at ${look.typed}.`
  if (look.found === 'file') return `${look.typed} is a file, not a folder.`
  if (look.known) return `Work already has this folder as ${look.known.name}, ${STATE_WORDS[look.known.state]}.`
  if (look.namesake) return `Work already has a project named ${look.name}, at ${look.namesake}.`
  return null
}

export function newProjectHandlers({ root, refresh, runtime = HOBKIN_NEW_PROJECT, home = homedir() }: NewProjectSeat): Pick<HostHandlers, 'work.project.look' | 'work.project.new'> {
  return {
    'work.project.look': ({ folder }) => lookAt(root(), folder, runtime, home),
    'work.project.new': async ({ folder, kind, wants }): Promise<NewProjectDone> => {
      const base = root()
      const look = lookAt(base, folder, runtime, home)
      const refusal = refusalFor(look)
      if (refusal) throw Error(refusal)
      if (!runtime.newProject) throw new Unavailable('This hobkin cannot add a project from here yet. Update hobkin.')
      // hobkin's refusal is passed on as it said it.
      // A look that is not refused found a folder.
      const path = look.folder ?? folder
      const request: NewProjectRequest = { path, kind, level: 'important', ...(wants === undefined ? {} : { wants }) }
      const added = await runtime.newProject(base, request)

      // The project is in hobkin's files either way. Without the read the window catches up at hobkin's next change.
      await refresh().catch(() => {})
      return { slug: added.slug, name: added.name, kind: added.kind, message: added.message }
    },
  }
}

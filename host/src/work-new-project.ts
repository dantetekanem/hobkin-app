import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import * as hobkinControls from 'hobkin/src/cli/work/controls.mjs'
import { readProjects } from 'hobkin/src/cli/work/store.mjs'
import type { FolderLook, NewProjectDone, ProjectKind, ProjectState } from '#shared/protocol/work.ts'
import { Unavailable, type HostHandlers } from './commands.ts'
import { projectsAt, type SetupWorkRuntime } from './setup-work.ts'

/**
 * New project (059-new-project): what hobkin sees at a folder the user typed, and the add. The add is hobkin's own
 * `newProject`, which writes the user's words to the project's directions and takes the project at the level for one
 * added by hand. Nothing here starts a study.
 */

export interface NewProjectRequest {
  path: string
  kind: ProjectKind
  wants?: string
  level: string
}

/** hobkin's functions the New project popup uses. Tests hand in others. */
export interface NewProjectRuntime {
  readProjects: SetupWorkRuntime['readProjects']
  /** Only a hobkin that has the add has it. Looked up on the module, never imported by name, so an older hobkin still loads. */
  newProject?: (root: string, request: NewProjectRequest) => Promise<{ ok: true; message: string; slug: string; name: string; kind: ProjectKind }> | { ok: true; message: string; slug: string; name: string; kind: ProjectKind }
}

export const HOBKIN_NEW_PROJECT: NewProjectRuntime = {
  readProjects,
  newProject: (hobkinControls as { newProject?: NewProjectRuntime['newProject'] }).newProject,
}

const PROJECT_STATES: readonly string[] = ['chosen', 'proposed', 'skipped', 'dropped']

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
  if (!disk.folder) {
    let isFile = false
    try {
      isFile = statSync(path).isFile()
    } catch {}
    return { ...nothing, found: isFile ? 'file' : 'missing' }
  }
  const folder = disk.spellings[disk.spellings.length - 1] as string
  return {
    typed,
    folder,
    found: 'folder',
    git: disk.git,
    name: folder.split('/').filter(Boolean).pop() ?? folder,
    known: known ? { slug: known.slug, name: known.name ?? known.slug, state: (PROJECT_STATES.includes(known.state ?? '') ? known.state : 'proposed') as ProjectState } : null,
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

/** Why a look says the folder cannot be added as `kind`, in plain words, or null when it can. */
function refusalFor(look: FolderLook, kind: ProjectKind): string | null {
  if (look.found === 'missing') return `There is no folder at ${look.typed}.`
  if (look.found === 'file') return `${look.typed} is a file, not a folder.`
  if (look.known) return `Work already has this folder as ${look.known.name} (${look.known.state}).`
  if (look.namesake) return `Work already has a project named ${look.name}, at ${look.namesake}.`
  if (kind === 'code' && !look.git) return `${look.typed} is not a git repository, so it can only be added as a goal.`
  return null
}

export function newProjectHandlers({ root, refresh, runtime = HOBKIN_NEW_PROJECT, home = homedir() }: NewProjectSeat): Pick<HostHandlers, 'work.project.look' | 'work.project.new'> {
  return {
    'work.project.look': ({ folder }) => lookAt(root(), folder, runtime, home),
    'work.project.new': async ({ folder, kind, wants }): Promise<NewProjectDone> => {
      const base = root()
      const look = lookAt(base, folder, runtime, home)
      const refusal = refusalFor(look, kind)
      if (refusal) throw Error(refusal)
      if (!runtime.newProject) throw new Unavailable('This hobkin cannot add a project from here yet. Update hobkin.')
      // hobkin's refusal is passed on as it said it.
      const added = await runtime.newProject(base, { path: look.folder as string, kind, ...(wants === undefined ? {} : { wants }), level: 'important' })
      await refresh().catch(() => {})
      return { slug: added.slug, name: added.name, kind: added.kind, message: added.message }
    },
  }
}

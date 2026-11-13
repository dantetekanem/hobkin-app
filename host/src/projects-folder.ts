import { existsSync, readdirSync, statSync, type Dirent, type Stats } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { PROJECTS_MAX, type ProjectFolder, type ProjectsFound } from '#shared/protocol/setup.ts'
import type { HostHandlers } from './commands.ts'

/**
 * The folders in the one the user says their projects live in (025-onboarding). It reads names and modification
 * times only: it never opens a file and never looks inside a repository, so setup cannot start work mode.
 */

export interface ProjectsOptions {
  /** What `~` stands for. */
  home?: string
  readdir?: (folder: string) => Dirent[]
  /** Follows a symlink, so a link to a folder counts as a folder. */
  stat?: (path: string) => Stats
  exists?: (path: string) => boolean
}

const SKIPPED = new Set(['node_modules'])

/** `~` and `~/...` become the home. Anything else must already be absolute, or it is not a place we can name. */
function written(folder: string, home: string): string | null {
  if (folder === '~') return home
  if (folder.startsWith('~/')) return resolve(home, folder.slice(2))
  return isAbsolute(folder) ? resolve(folder) : null
}

type Listed = ProjectFolder & { changed: number }

/** The folders directly inside `full`, with when each changed. Hidden ones, `node_modules` and anything unreadable are left out. */
function foldersIn(full: string, { readdir, stat, exists }: Required<Omit<ProjectsOptions, 'home'>>): Listed[] {
  const folders: Listed[] = []
  for (const entry of readdir(full)) {
    if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue
    const path = join(full, entry.name)
    try {
      const info = stat(path)
      if (info.isDirectory()) folders.push({ name: entry.name, path, git: exists(join(path, '.git')), changed: info.mtimeMs })
    } catch {
      // A broken link or a folder we may not look at is not a project to show.
    }
  }
  return folders
}

export function findProjects(folder: string, { home = homedir(), readdir = (path) => readdirSync(path, { withFileTypes: true }), stat = statSync, exists = existsSync }: ProjectsOptions = {}): ProjectsFound {
  const missing: ProjectsFound = { folder, found: false, projects: [], more: 0 }
  const full = written(folder, home)
  if (full === null) return missing
  try {
    if (!stat(full).isDirectory()) return { ...missing, folder: full }
    const all = foldersIn(full, { readdir, stat, exists })
    all.sort((a, b) => b.changed - a.changed || a.name.localeCompare(b.name))
    const projects = all.slice(0, PROJECTS_MAX).map(({ name, path, git }) => ({ name, path, git }))
    return { folder: full, found: true, projects, more: Math.max(0, all.length - PROJECTS_MAX) }
  } catch {
    return { ...missing, folder: full }
  }
}

export function projectsHandlers(options: ProjectsOptions = {}): HostHandlers {
  return { 'setup.projects': ({ folder }) => findProjects(folder, options) }
}

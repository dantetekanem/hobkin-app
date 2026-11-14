import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

/**
 * The two versions the app shows about itself, in Settings and in Nerd stats: its own, and that of the hobkin core
 * it runs. Vite reads them once, as it starts (`vite.config.ts`), so a bump restarts the dev server. Without that
 * the app keeps showing the version it started with.
 */

const repo = path.resolve(import.meta.dirname, '..')

/** The core is linked into node_modules, which the dev server never watches, so each file is named by its real place. */
function fileAt(relative: string): string {
  const file = path.join(repo, relative)
  try {
    return realpathSync(file)
  } catch {
    return file
  }
}

/** Where each version is kept. */
export const VERSION_FILES = {
  app: fileAt('package.json'),
  core: fileAt('node_modules/hobkin/package.json'),
}

/** A package's version, or `unknown` when its file cannot be read. */
export function versionOf(file: string): string {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { version?: string }).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** The part of Vite's dev server this uses. */
interface DevServer {
  watcher: {
    add: (files: string[]) => unknown
    on: (event: 'change', changed: (file: string) => void) => unknown
  }
  restart: () => Promise<void>
}

/** Restarts the dev server when a version changes, so the app shows the new one. */
export function restartOnBump(server: DevServer): void {
  const files = [VERSION_FILES.app, VERSION_FILES.core]

  server.watcher.add(files)
  server.watcher.on('change', (file) => {
    if (files.includes(file)) void server.restart()
  })
}

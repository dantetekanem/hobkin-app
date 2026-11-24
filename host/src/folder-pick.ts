import { execFile } from 'node:child_process'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * The Mac's own folder chooser, for New project's Open button. The app's shell has none, so the host shows it with
 * `osascript`, run with execFile and never through a shell. It stays open as long as the user takes: no command in
 * the host or the window has a time limit, so none is added here.
 */

/** What the chooser runs: execFile's shape, which a test replaces with a fake. */
export type PickRun = (file: string, args: string[], done: (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void) => unknown

const SCRIPT = 'POSIX path of (choose folder with prompt "Choose the project\'s folder")'

/** The folder picked, or null when the user closed the chooser (osascript exits 1 with -128). */
export function chooseFolder(run: PickRun = execFile as PickRun, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  if (platform !== 'darwin') return Promise.reject(new Unavailable("The folder chooser is only on a Mac. Type the folder's path instead."))
  return new Promise((resolve, reject) => {
    run('osascript', ['-e', SCRIPT], (error, stdout, stderr) => {
      if (error) {
        if (error.code === 1 && /-128/.test(stderr)) return resolve(null)
        return reject(new Unavailable("hobkin could not show the folder chooser. Type the folder's path instead."))
      }
      const picked = stdout.trim().replace(/(?<=.)\/+$/, '')
      if (!picked) return reject(new Unavailable('The chooser answered with no folder. Type the folder\'s path instead.'))
      resolve(picked)
    })
  })
}

export interface FolderPickSeat {
  /** Shows the chooser. The host passes the real one only from its entry; a test or a scripted host shows none. */
  pick: () => Promise<string | null>
}

/** `work.folder.pick`. A press while a chooser is open gets that chooser's answer, so two never show at once. */
export function folderPickHandlers({ pick }: FolderPickSeat): Pick<HostHandlers, 'work.folder.pick'> {
  let open: Promise<{ folder: string | null }> | null = null
  return {
    'work.folder.pick': () => {
      open ??= pick()
        .then((folder) => ({ folder }))
        .finally(() => {
          open = null
        })
      return open
    },
  }
}

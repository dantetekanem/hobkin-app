import { DEV_PORT } from './access.ts'
import { parseArguments, USAGE } from './arguments.ts'
import { ghSource } from './github-gh.ts'
import { resolveHome } from './home.ts'
import { startHost } from './host.ts'
import { openGitHubPage } from './github.ts'
import { openFileInSystem, openInSystem } from './open.ts'
import { openInBrowser } from './signin.ts'
import { spawnGh } from './review/gh.ts'

/** The host's entry. The shell starts it, reads `client/host.json` in the home for the port and the token, and stops it with a signal. */
async function main(args: readonly string[]): Promise<void> {
  const options = parseArguments(args)
  if (options.help) {
    console.log(USAGE)
    return
  }

  const home = resolveHome({ home: options.home })
  if (home.notice) console.log(home.notice)
  if (home.real && !options.live) {
    console.log('The model is scripted: a message sent here gets a scripted reply, and both stay in the real conversation.')
  }

  // A scripted sign-in has no page to approve on, so nothing is ever opened in the browser for it.
  // Only a live host, started on purpose, opens pages in the browser: a real provider's sign-in page.
  const scripted = options.live
    ? { openUrl: openInBrowser }
    : { openUrl: () => {}, ...(options.signedOut ? { access: async () => (await import('./scripted-access.ts')).scriptedModelAccess({ connected: [] }) } : {}) }
  const host = await startHost({
    root: home.root,
    real: home.real,
    live: options.live,
    dev: options.dev,
    port: options.port ?? (options.dev ? DEV_PORT : 0),
    log: (line) => console.log(line),
    // A GitHub row the user chose opens in the browser, in the scripted host too: the user asked for it.
    openGitHub: openGitHubPage,
    // A link or a file the user clicked opens in the Mac's default app, in the scripted host too.
    openSystem: openInSystem,
    openFile: openFileInSystem,
    ...scripted,
    // A live host always reads the real GitHub, read only. The scripted one shows made-up data unless asked.
    // Change Review reads pull requests the same way, and only a live host posts a verdict the user confirmed.
    ...(options.live || options.github ? { github: ghSource(), reviewGh: spawnGh() } : {}),
  })
  if (options.github && !options.live) console.log('The GitHub page reads the real GitHub through gh, read only.')
  // The token is never printed. It is in the home, readable by the user only.
  console.log(`hobkin host listening on 127.0.0.1:${host.port} for ${home.root} with the ${options.live ? 'live' : 'scripted'} model`)

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    void host.close().finally(() => process.exit(0))
  }
  // These stay registered for good. hobkin's lock ends the process on a signal as soon as nobody else listens
  // for it, and a listener that removed itself would let that happen before hobkin had closed.
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`hobkin host: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

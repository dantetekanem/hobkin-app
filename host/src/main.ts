import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { DEV_PORT } from './access.ts'
import { originsFor, parseArguments, USAGE, type HostArguments } from './arguments.ts'
import { ghSource } from './github-gh.ts'
import { actual, resolveHome, type ResolvedHome } from './home.ts'
import { startHost } from './host.ts'
import { openGitHubPage } from './github.ts'
import { openFileInSystem, openInSystem } from './open.ts'
import { watchParent } from './parent-watch.ts'
import { installPackage, installPi, piAgentFolder } from './pi/install.ts'
import { refreshPath } from './pi/login-path.ts'
import { addOwnNode, installNode, nodeBin } from './pi/node.ts'
import { openInBrowser } from './signin.ts'
import { spawnGh } from './review/gh.ts'

const isFolder = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Why this host may not also talk to the page `--origin` names, or null when it may. A scripted host may. A live host
 * signs in for real and runs a real model, so it may only on a throwaway home and a throwaway Pi folder: then a page
 * beyond the app's own can never reach the user's hobkin, or the accounts in Pi's real folder.
 */
export function whyNotOrigin({ home: named, live, origin }: Pick<HostArguments, 'home' | 'live' | 'origin'>, home: Pick<ResolvedHome, 'root' | 'real'>, env: NodeJS.ProcessEnv, userHome: string): string | null {
  if (!origin || !live) return null
  const words = `A live host talks to ${origin} only on a throwaway home with a throwaway Pi folder`
  if (named === null) return `${words}. Name a new folder with --home.`
  if (home.real) return `${words}, and ${home.root} is the real hobkin home.`
  // Pi's own rule finds both folders, so the one compared is the one Pi will use.
  if (!env.PI_CODING_AGENT_DIR) return `${words}. Set PI_CODING_AGENT_DIR to a new folder, so a sign-in never reaches Pi's real one.`
  const piFolder = piAgentFolder(env, userHome)
  if (!isFolder(piFolder)) return `${words}, and PI_CODING_AGENT_DIR names ${piFolder}, which is not a folder. Create it first.`
  const realPiFolder = piAgentFolder({}, userHome)
  if (actual(piFolder) === actual(realPiFolder)) return `${words}, and PI_CODING_AGENT_DIR names Pi's real folder, ${realPiFolder}.`
  return null
}

/** The host's entry. The shell starts it, reads `client/host.json` in the home for the port and the token, and stops it with a signal. */
async function main(args: readonly string[]): Promise<void> {
  const options = parseArguments(args)
  if (options.help) {
    console.log(USAGE)
    return
  }

  const home = resolveHome({ home: options.home })
  // Before anything opens: a host that may not talk to the page never starts.
  const refusal = whyNotOrigin(options, home, process.env, homedir())
  if (refusal) throw Error(`${refusal}\n${USAGE}`)
  if (home.notice) console.log(home.notice)
  if (home.real && !options.live) {
    console.log('The model is scripted: a message sent here gets a scripted reply, and both stay in the real conversation.')
  }

  // A Node hobkin installed for itself on an earlier run goes on the PATH before anything starts, so its npm, the Pi
  // that npm installed, and everything hobkin starts find them.
  if (options.live) addOwnNode(home.root)

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
    // Only --origin changes the pages a host talks to. Without it the host keeps its usual ones.
    origins: originsFor(options),
    log: (line) => console.log(line),
    // A GitHub row the user chose opens in the browser, in the scripted host too: the user asked for it.
    openGitHub: openGitHubPage,
    // A link or a file the user clicked opens in the Mac's default app, in the scripted host too.
    openSystem: openInSystem,
    openFile: openFileInSystem,
    ...scripted,
    // Installing Pi or a Pi package changes the Mac outside the app: only a live host may, on the user's word in the window.
    // A live host may also install a Node of hobkin's own for a Mac without npm, and asks the login shell for its PATH
    // again when the setup finds no Pi or no npm.
    ...(options.live
      ? {
          installPi: () => installPi({ ownNode: nodeBin(home.root) }),
          installPiPackage: (name: string) => installPackage(name, { agentDir: piAgentFolder, ownNode: nodeBin(home.root) }),
          installNode: () => installNode({ root: home.root }),
          refreshPath: () => refreshPath(),
        }
      : {}),
    // A live host always reads the real GitHub, read only. The scripted one shows made-up data unless asked.
    // Change Review reads pull requests the same way, and only a live host posts a verdict the user confirmed.
    ...(options.live || options.github ? { github: ghSource(), reviewGh: spawnGh() } : {}),
  })
  if (options.github && !options.live) console.log('The GitHub page reads the real GitHub through gh, read only.')
  if (options.origin) console.log(`It also talks to the page at ${options.origin}.`)
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
  // The app that started this host passes its own process id: a host it left behind would hold the home and the port.
  if (options.parent) watchParent(options.parent, stop)
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`hobkin host: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

import { APP_ORIGIN, DEV_UI_ORIGIN, isLoopbackPage } from './access.ts'

export interface HostArguments {
  /** The home named with `--home`, or null for the default. */
  home: string | null
  /** Use the real model. Without it the model is scripted and nothing is spent. */
  live: boolean
  /** Serve the development UI in a plain browser: a fixed port and the handshake that hands it the token. */
  dev: boolean
  /** Start signed out, with a scripted sign-in, so the sign-in screen can be seen without an account. */
  signedOut: boolean
  /** With the scripted model, the GitHub page reads the real GitHub through gh, read only. Without it the page shows made-up data. Set only when given. */
  github?: boolean
  port: number | null
  /** The process that started this host. The host stops once it is gone. Set only when given. */
  parent?: number
  /** One more page the host talks to, such as a demo tab at http://localhost:5187. Set only when given. */
  origin?: string
  help: boolean
}

export const USAGE = [
  'Usage: node host/src/main.ts [--home <folder>] [--live] [--dev] [--signed-out] [--github] [--port <number>] [--origin <url>]',
  '  --home <folder>  the hobkin home to open. Default: .dev-home in this repository, never ~/.hobkin',
  '  --live           use the real model. Default: a scripted model that spends nothing',
  '  --dev            serve the development UI at http://127.0.0.1:5187 on port 5188',
  '  --signed-out     with the scripted model, start with no provider connected',
  '  --github         with the scripted model, read the real GitHub through gh, read only. Default: sample GitHub data',
  '  --port <number>  listen on this port. Default: a free port, or 5188 with --dev',
  '  --parent <pid>   stop once this process has gone, as the app passes its own',
  '  --origin <url>   also talk to this page: http://localhost:<port> or http://127.0.0.1:<port>. With --live, only on a new --home and a new folder in PI_CODING_AGENT_DIR',
].join('\n')

export function parseArguments(args: readonly string[]): HostArguments {
  const options: HostArguments = { home: null, live: false, dev: false, signedOut: false, port: null, help: false }
  const values = [...args]
  while (values.length) {
    const flag = values.shift()!
    const value = () => {
      const next = values.shift()
      if (next === undefined || next.startsWith('-')) throw Error(`${flag} needs a value.\n${USAGE}`)
      return next
    }
    if (flag === '--home') options.home = value()
    else if (flag === '--port') {
      const port = Number(value())
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error(`--port needs a number from 0 to 65535.\n${USAGE}`)
      options.port = port
    } else if (flag === '--parent') {
      const parent = Number(value())
      if (!Number.isInteger(parent) || parent < 1) throw Error(`--parent needs a process id.\n${USAGE}`)
      options.parent = parent
    } else if (flag === '--origin') {
      const origin = value()
      if (!isLoopbackPage(origin)) throw Error(`--origin takes a page on this Mac with its port, such as http://localhost:5187, not ${origin}.\n${USAGE}`)
      options.origin = origin
    } else if (flag === '--live') options.live = true
    else if (flag === '--dev') options.dev = true
    else if (flag === '--signed-out') options.signedOut = true
    else if (flag === '--github') options.github = true
    else if (flag === '--help' || flag === '-h') options.help = true
    else throw Error(`Unknown option: ${flag}\n${USAGE}`)
  }
  // A real sign-in is Pi's. Only the scripted model has a scripted one.
  if (options.live && options.signedOut) throw Error(`--signed-out is for the scripted model. With --live, Pi decides who is signed in.\n${USAGE}`)
  // --origin with --live depends on the home and Pi's folder, which only the entry can see: `whyNotOrigin` in main.ts decides.
  return options
}

/** The pages a host started this way talks to: its usual ones and the one `--origin` adds. Without it, undefined, so the host keeps its own list. */
export function originsFor({ dev, origin }: HostArguments): string[] | undefined {
  return origin ? [APP_ORIGIN, ...(dev ? [DEV_UI_ORIGIN] : []), origin] : undefined
}

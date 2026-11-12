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
  help: boolean
}

export const USAGE = [
  'Usage: node host/src/main.ts [--home <folder>] [--live] [--dev] [--signed-out] [--github] [--port <number>]',
  '  --home <folder>  the hobkin home to open. Default: .dev-home in this repository, never ~/.hobkin',
  '  --live           use the real model. Default: a scripted model that spends nothing',
  '  --dev            serve the development UI at http://127.0.0.1:5187 on port 5188',
  '  --signed-out     with the scripted model, start with no provider connected',
  '  --github         with the scripted model, read the real GitHub through gh, read only. Default: sample GitHub data',
  '  --port <number>  listen on this port. Default: a free port, or 5188 with --dev',
  '  --parent <pid>   stop once this process has gone, as the app passes its own',
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
    } else if (flag === '--live') options.live = true
    else if (flag === '--dev') options.dev = true
    else if (flag === '--signed-out') options.signedOut = true
    else if (flag === '--github') options.github = true
    else if (flag === '--help' || flag === '-h') options.help = true
    else throw Error(`Unknown option: ${flag}\n${USAGE}`)
  }
  // A real sign-in is Pi's. Only the scripted model has a scripted one.
  if (options.live && options.signedOut) throw Error(`--signed-out is for the scripted model. With --live, Pi decides who is signed in.\n${USAGE}`)
  return options
}

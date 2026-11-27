import { basename, join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { resolveDataRoot } from 'hobkin/src/cli/migration/admission.mjs'
import type { ClaudeCodeStatus } from '#shared/protocol/claude-code.ts'
import type { ProofTools } from '#shared/protocol/proofs.ts'
import type { ProgramInstalled, ProgramSignIn, ProgramSignInEnd, SetupProgram, SignInProgram } from '#shared/protocol/setup.ts'
import { PI_PACKAGES } from '#shared/setup/pi-packages.ts'
import { ClaudeCodeSettingsFile } from './claude-code/settings.ts'
import { Unavailable, type HostHandlers } from './commands.ts'
import type { HostOptions } from './host.ts'
import type { ModelAccess } from './model-access.ts'
import { installPackage, installPi, pinnedPi, piSetup, piSetupHandlers, type PiRun } from './pi/install.ts'
import { nodeBin } from './pi/node.ts'
import { SCRIPTED_SIGN_IN_PAGE, scriptedModelAccess } from './scripted-access.ts'
import { setupNeedsHandlers } from './setup-needs.ts'
import { proofToolsHandlers } from './setup-proof.ts'
import { GH_VERSION, ghBin } from './setup/gh.ts'
import { installCommandLineTools, installQmd, QMD_VERSION } from './setup/programs.ts'

/**
 * A Mac with nothing on it, for walking the first-run setup (025-onboarding) as a new person would, on the scripted
 * host started with `--simulate-new-mac`. It has no Node with npm, no Pi and no packages, Apple's git stand-in without
 * the command line tools, no gh, Claude Code, qmd or TLA+ tools, and no model connected. The setup's own readers and
 * installers run on it as they are: only the programs are pretend. Each install and sign-in takes a moment, then the
 * next read finds what it brought. Nothing here runs a program, reaches the network, opens a page or writes outside
 * the home.
 */

/** A program with a sign-in of its own: not there, there, or signed in. */
type Program = 'absent' | 'installed' | 'signed-in'

/** What is on the pretend Mac. It starts with nothing. */
interface Mac {
  /** hobkin's own Node, with its npm. */
  node: boolean
  pi: boolean
  packages: Set<string>
  /** Apple's command line tools, which bring git. */
  git: boolean
  gh: Program
  claude: Program
  qmd: boolean
  proofTools: boolean
}

/** How long an install or a sign-in takes when nothing else is said: 1 to 3 seconds. */
const aMoment = () => 1000 + Math.random() * 2000

const APPLE_GIT = '/usr/bin/git'
const XCODE_SELECT = '/usr/bin/xcode-select'
const DEVELOPER = '/Library/Developer/CommandLineTools'
const CLAUDE_VERSION = '2.1.332'
const NAMES: Record<SignInProgram, string> = { gh: 'gh', claude: 'Claude Code' }

/** What each sign-in shows. The pages are on a reserved name that never resolves, so nothing can load them. */
const SIGN_IN_PAGES: Record<SignInProgram, ProgramSignIn> = {
  gh: { name: 'gh', url: `${SCRIPTED_SIGN_IN_PAGE}github`, code: 'SIMU-LATE', pastes: false },
  claude: { name: 'claude', url: `${SCRIPTED_SIGN_IN_PAGE}claude`, code: null, pastes: true },
}

const versionOf = (name: string) => PI_PACKAGES.find((known) => known.name === name)?.source.split('@').at(-1) ?? null

/** Where each program would be, or null while it is not there. hobkin's own Node keeps npm and what npm installs. */
function finder(mac: Mac, root: string): (name: string) => string | null {
  const own = (name: string, there: boolean) => (there ? join(nodeBin(root), name) : null)
  return (name) => {
    switch (name) {
      case 'node':
      case 'npm':
        return own(name, mac.node)
      case 'pi':
        return own(name, mac.pi)
      case 'qmd':
        return own(name, mac.qmd)
      case 'agentic-search':
        return own(name, mac.packages.has('pi-agentic-search'))
      case 'gh':
        return mac.gh === 'absent' ? null : join(ghBin(root), 'gh')
      // Every Mac has these two. The git is Apple's stand-in, which asks for the command line tools.
      case 'git':
        return APPLE_GIT
      case 'xcode-select':
        return XCODE_SELECT
      default:
        return null
    }
  }
}

/** What a program prints when asked, or null when it fails. */
function said(mac: Mac, file: string, args: readonly string[]): string | null {
  switch ([basename(file), ...args].join(' ')) {
    case 'xcode-select -p':
      return mac.git ? `${DEVELOPER}\n` : null
    case 'git --version':
      return file === APPLE_GIT ? null : 'git version 2.39.5 (Apple Git-154)\n'
    case 'gh --version':
      return `gh version ${GH_VERSION}\n`
    case 'gh auth status':
      return mac.gh === 'signed-in' ? 'github.com\n  Logged in to github.com\n' : null
    case 'agentic-search --version':
      return `${versionOf('pi-agentic-search')}\n`
    case 'qmd --version':
      return `qmd ${QMD_VERSION}\n`
    case 'pi --version':
      return `${pinnedPi()}\n`
    case 'pi list':
      return PI_PACKAGES.filter(({ name }) => mac.packages.has(name))
        .map(({ source }) => `${source}\n`)
        .join('')
    default:
      return null
  }
}

/** An install the setup runs, and what the Mac has after it. */
function install(mac: Mac, file: string, args: readonly string[]): void {
  const [verb, ...rest] = args
  const program = basename(file)
  const what = rest.at(-1) ?? ''
  const piPackage = PI_PACKAGES.find(({ source }) => source === what)
  if (program === 'npm' && verb === 'install' && what.startsWith('@earendil-works/pi-coding-agent@')) mac.pi = true
  else if (program === 'npm' && verb === 'install' && what.startsWith('@tobilu/qmd@')) mac.qmd = true
  else if (program === 'pi' && verb === 'install' && piPackage) mac.packages.add(piPackage.name)
  else if (file === XCODE_SELECT && verb === '--install') mac.git = true
  else throw Error(`The simulated Mac has no ${[program, ...args].join(' ')}.`)
}

/** The setup's sign-in, with no page and no question: the account connects a moment later, as after a person approved it. */
async function signsInAfter(delay: () => number): Promise<ModelAccess> {
  const scripted = await scriptedModelAccess({ connected: [] })
  return {
    ...scripted,
    // The scripted sign-in shows a page and waits for "ok". Here nothing is shown, and the "ok" comes after a while.
    login: (provider, interaction) => {
      interaction.notify({ type: 'info', message: 'This Mac is simulated, so no page opens. The account connects in a moment.' })
      return scripted.login(provider, {
        signal: interaction.signal,
        notify: (event) => {
          if (event.type === 'progress') interaction.notify(event)
        },
        prompt: async () => {
          await pause(delay(), undefined, { signal: interaction.signal })
          return 'ok'
        },
      })
    },
  }
}

export interface SimulatedMacOptions {
  /** The home the host serves, which hobkin's own installs would use. */
  root: string
  /** It is the real hobkin home, which a simulation never runs on. */
  real?: boolean
  /** How long each install and sign-in takes, in milliseconds. 1 to 3 seconds at random when not given. */
  delay?: () => number
}

/** What the scripted host takes to answer as the new Mac (`main.ts`, for --simulate-new-mac). */
export type SimulatedMac = Required<Pick<HostOptions, 'access' | 'claudeStatus' | 'simulation'>>

export function simulatedNewMac({ root, real = false, delay = aMoment }: SimulatedMacOptions): SimulatedMac {
  if (real) throw Error(`${root} is the real hobkin home. A simulated new Mac runs only on a new folder named with --home.`)

  const mac: Mac = { node: false, pi: false, packages: new Set(), git: false, gh: 'absent', claude: 'absent', qmd: false, proofTools: false }
  const slowly = async <T>(change: () => T): Promise<T> => {
    await pause(delay())
    return change()
  }
  const find = finder(mac, root)
  const exec = async (file: string, args: readonly string[]) => {
    const words = said(mac, file, args)
    if (words === null) throw Object.assign(Error(`${basename(file)} ${args.join(' ')} failed.`), { code: 1 })
    return words
  }
  // Pi's reads answer at once. Anything else is an install, which takes a moment.
  const run: PiRun = (file, args, _options, done) => {
    const words = said(mac, file, args)
    if (words !== null) return done(null, words, '')
    slowly(() => install(mac, file, args)).then(
      () => done(null, '', ''),
      (error: Error) => done(error, '', error.message),
    )
  }

  let opened: Promise<ModelAccess> | null = null
  const access = () => (opened ??= signsInAfter(delay))

  const claudeStatus = async (): Promise<ClaudeCodeStatus> => {
    if (mac.claude === 'absent') return { installed: false, version: null, signedIn: null, authMethod: null, plan: null }
    const signedIn = mac.claude === 'signed-in'
    return { installed: true, version: CLAUDE_VERSION, signedIn, authMethod: signedIn ? 'claude.ai' : null, plan: signedIn ? 'pro' : null }
  }
  const proofTools = (): ProofTools => (mac.proofTools ? { java: join(root, 'tools', 'java'), tlc: join(root, 'tools', 'tla', 'tla2tools.jar'), tlaps: null } : { java: null, tlc: null, tlaps: null })

  // Every install here is pretend, so the setup may run each one, as on a live host.
  const pi = piSetupHandlers({
    live: true,
    read: () => piSetup({ findPi: () => find('pi'), findNpm: () => find('npm'), findNode: () => find('node'), run }),
    installPi: () => installPi({ findNpm: () => find('npm'), run }),
    installPackage: (name) => installPackage(name, { findPi: () => find('pi'), run }),
    installNode: () =>
      slowly(() => {
        mac.node = true
      }),
  })

  const programs: Record<SetupProgram, () => Promise<ProgramInstalled>> = {
    // Apple's installer finishes in its own window, so the press says it opened it, and the next read finds git.
    git: () => installCommandLineTools({ run }),
    gh: () =>
      slowly(() => {
        mac.gh = 'installed'
        return { finished: true }
      }),
    claude: () =>
      slowly(() => {
        mac.claude = 'installed'
        return { finished: true }
      }),
    qmd: () => installQmd({ findNpm: () => find('npm'), run }),
  }
  const signingIn = new Map<SignInProgram, Promise<ProgramSignInEnd>>()

  const simulation: HostHandlers = {
    ...pi,
    ...proofToolsHandlers({
      live: true,
      home: () => root,
      install: () =>
        slowly(() => {
          mac.proofTools = true
          return { ok: true, message: 'The TLA+ tools are ready.' }
        }),
      found: async () => {},
    }),
    ...setupNeedsHandlers({
      pi: async () => pi['setup.pi']!({}),
      models: async () => (await access()).list(),
      proofTools,
      claude: async () => ({ settings: new ClaudeCodeSettingsFile(resolveDataRoot(root)).read(), status: await claudeStatus() }),
      find,
      exec,
      platform: 'darwin',
      ownNode: nodeBin(root),
      presses: { install: () => true, signIn: () => true },
    }),
    'setup.install-program': ({ name }) => programs[name](),
    // A sign-in ends by itself a moment after it starts. A pasted code is taken and changes nothing.
    'setup.sign-in-program': ({ name }) => {
      if (mac[name] === 'absent') throw new Unavailable(`${NAMES[name]} is not installed, so it cannot sign in. Install it first.`)
      signingIn.set(
        name,
        slowly(() => {
          mac[name] = 'signed-in'
          return { signedIn: true, message: null }
        }),
      )
      return { ...SIGN_IN_PAGES[name] }
    },
    'setup.sign-in-program-code': () => ({ ok: true as const }),
    'setup.sign-in-program-wait': ({ name }) => signingIn.get(name) ?? { signedIn: false, message: null },
  }

  return { access, claudeStatus, simulation }
}

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { ProgramInstalled, SetupProgram, SignInProgram } from '#shared/protocol/setup.ts'
import { Unavailable, type HostHandlers } from '../commands.ts'
import type { PiRun } from '../pi/install.ts'
import type { NodeFetch } from '../pi/node.ts'
import type { ProgramSignIns } from './sign-in.ts'
import { download, failure, ran, realFetch, realRun } from './run.ts'

/**
 * The setup's own installs of the programs Work, Change Review and agents use (025-onboarding), each on the user's
 * press in the setup's review, so no one needs Terminal: Apple's command line tools for git, a gh of hobkin's own
 * (`gh.ts`), Claude Code by Anthropic's own installer, and qmd with npm. Only a live host installs anything.
 */

const INSTALL_MS = 10 * 60_000
const READ_MS = 30_000

/** The qmd version the setup was tried with. It moves up with hobkin's releases, once the new one has been tried. */
export const QMD_VERSION = '2.9.0'
const QMD_PACKAGE = '@tobilu/qmd'
/** Anthropic's own installer for Claude Code, which checks the build it downloads against Anthropic's checksums. */
export const CLAUDE_INSTALLER = 'https://claude.ai/install.sh'

/**
 * Asks the Mac to install its command line tools, which bring git. `xcode-select --install` opens Apple's own installer
 * window and returns at once, so the install goes on there and Look again finds git once it is done.
 */
export async function installCommandLineTools({ run = realRun }: { run?: PiRun } = {}): Promise<ProgramInstalled> {
  const asked = await ran(run, '/usr/bin/xcode-select', ['--install'], READ_MS)
  if (asked.error) throw failure("Apple's installer for the command line tools did not open.", asked, READ_MS)
  return { finished: false }
}

export interface ClaudeInstallOptions {
  fetch?: NodeFetch
  run?: PiRun
  env?: NodeJS.ProcessEnv
}

/**
 * Installs Claude Code by Anthropic's own installer, as `curl -fsSL https://claude.ai/install.sh | bash` does, without
 * a shell pipe: the script is downloaded, then run by bash. It puts `claude` in `~/.local/bin`, where hobkin looks.
 */
export async function installClaude({ fetch: fetcher = realFetch, run = realRun, env = process.env }: ClaudeInstallOptions = {}): Promise<ProgramInstalled> {
  const script = await download(fetcher, CLAUDE_INSTALLER, 'claude.ai', INSTALL_MS, (answer) => answer.text())
  if (!script.startsWith('#!')) throw Error("claude.ai did not answer with Claude Code's installer, so nothing was installed.")

  const work = mkdtempSync(join(tmpdir(), 'hobkin-claude-install-'))
  try {
    const file = join(work, 'install.sh')
    writeFileSync(file, script, { mode: 0o700 })
    const installed = await ran(run, '/bin/bash', [file], INSTALL_MS, env)
    if (installed.error) throw failure("Anthropic's installer could not install Claude Code.", installed, INSTALL_MS)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  return { finished: true }
}

export interface QmdInstallOptions {
  /** Finds npm: the one the Pi setup finds, which is hobkin's own on a Mac that had none. */
  findNpm: () => string | null
  run?: PiRun
  version?: string
}

/** Installs the qmd version hobkin was tried with, globally, with the npm found, as Pi is installed. */
export async function installQmd({ findNpm, run = realRun, version = QMD_VERSION }: QmdInstallOptions): Promise<ProgramInstalled> {
  const npm = findNpm()
  if (!npm) throw new Unavailable('npm is not on this Mac, so qmd cannot be installed from here. Install Node first.')
  // npm, and the qmd it installs, start `node` from the PATH, so the Node beside npm comes first.
  const env = { ...process.env, PATH: [dirname(npm), process.env.PATH ?? ''].filter(Boolean).join(delimiter) }
  const installed = await ran(run, npm, ['install', '-g', '--ignore-scripts', `${QMD_PACKAGE}@${version}`], INSTALL_MS, env)
  if (installed.error) throw failure('npm could not install qmd.', installed, INSTALL_MS)
  return { finished: true }
}

/** The installs a host was handed. Only the entry hands them in, for a live host. */
export type ProgramInstallers = Partial<Record<SetupProgram, () => Promise<ProgramInstalled>>>

export interface ProgramSetupOptions {
  /** The host runs the real model. A scripted development host installs nothing, so a check never changes the Mac. */
  live: boolean
  installers: ProgramInstallers
  /** Whether this Mac can take the program's install, such as gh's build for its chip. Every one when not given. */
  installable?: (name: SetupProgram) => boolean
  /** The sign-ins the setup runs. Without them it runs none. */
  signIns?: ProgramSignIns
}

/** What the setup's review may offer as a press, and what a press runs. */
export interface ProgramSetup {
  offers: {
    install: (name: SetupProgram) => boolean
    signIn: (name: SignInProgram) => boolean
  }
  handlers: Pick<HostHandlers, 'setup.install-program' | 'setup.sign-in-program' | 'setup.sign-in-program-code' | 'setup.sign-in-program-wait'>
}

export function programSetup({ live, installers, installable = () => true, signIns }: ProgramSetupOptions): ProgramSetup {
  const mayChange = () => {
    if (!live) throw new Unavailable('This is the scripted development host, so nothing is installed or signed in on this Mac. Start the host with --live for that.')
  }
  const offers = {
    install: (name: SetupProgram) => live && installers[name] !== undefined && installable(name),
    signIn: (_name: SignInProgram) => live && signIns !== undefined,
  }
  const signInsHere = () => {
    mayChange()
    if (!signIns) throw new Unavailable('This host runs no sign-ins.')
    return signIns
  }

  return {
    offers,
    handlers: {
      'setup.install-program': async ({ name }) => {
        mayChange()
        const install = installers[name]
        if (!install || !installable(name)) throw new Unavailable(`This host does not install ${name}.`)
        return install()
      },
      'setup.sign-in-program': ({ name }) => signInsHere().start(name),
      'setup.sign-in-program-code': ({ name, code }) => {
        signInsHere().paste(name, code)
        return { ok: true as const }
      },
      'setup.sign-in-program-wait': ({ name }) => signInsHere().wait(name),
    },
  }
}

import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { scrubText } from '#shared/integrations/redact.ts'
import { Unavailable } from '../commands.ts'
import type { PiRun } from '../pi/install.ts'
import { withFolders } from '../pi/login-path.ts'
import { checksumOf, type NodeFetch } from '../pi/node.ts'
import { download, failure, ran, realFetch, realRun } from './run.ts'

/**
 * A gh of hobkin's own (025-onboarding), for a Mac without GitHub's command line tool, so no one needs Homebrew or
 * Terminal. hobkin downloads GitHub's official macOS build of the gh version it was tried with, for this Mac's chip,
 * from the cli/cli release on GitHub, checks it against the checksums file of that same release, and unpacks it into
 * its own home. Then its `bin` folder goes on the host's PATH, where Change Review and everything else hobkin starts
 * find it. It needs no admin password and changes nothing else on the Mac.
 */

/** The gh version the setup was tried with. It moves up with hobkin's releases, once the new one has been tried. */
export const GH_VERSION = '2.105.0'

const DOWNLOAD_MS = 10 * 60_000
const UNPACK_MS = 5 * 60_000

/** Where hobkin keeps its own gh, in its home. */
export const ghFolder = (root: string) => join(root, 'client', 'gh')
/** Its `bin` folder, where its `gh` is. */
export const ghBin = (root: string) => join(ghFolder(root), 'bin')

export interface GhBuild {
  version: string
  /** The archive's name, as the release's checksums file names it, and the folder inside it. */
  file: string
  folder: string
  url: string
  /** The release's checksums file. */
  sums: string
}

/** GitHub's macOS build of a gh version for this Mac's chip, or null when GitHub has none for this computer. */
export function ghBuild(version = GH_VERSION, platform: string = process.platform, arch: string = process.arch): GhBuild | null {
  if (platform !== 'darwin') return null
  const chip = { arm64: 'arm64', x64: 'amd64' }[arch]
  if (!chip) return null
  const release = `https://github.com/cli/cli/releases/download/v${version}/`
  const folder = `gh_${version}_macOS_${chip}`
  return { version, file: `${folder}.zip`, folder, url: `${release}${folder}.zip`, sums: `${release}gh_${version}_checksums.txt` }
}

const isProgram = (file: string) => {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

export interface GhInstallOptions {
  /** hobkin's home. */
  root: string
  version?: string
  platform?: string
  arch?: string
  fetch?: NodeFetch
  run?: PiRun
  /** The environment whose PATH gets the new gh. The host's own when not given, so everything it starts finds it. */
  env?: NodeJS.ProcessEnv
  /** The carried Node's folder, which stays last on the PATH. */
  carried?: string
}

/**
 * Installs hobkin's own gh into `client/gh` in its home. The archive is checked before anything is unpacked, and
 * unpacked beside its place first, then moved in, so a failure leaves nothing half-made and a second install replaces
 * the first. Then its `bin` folder goes on the PATH, after the folders there, so a gh the user has keeps coming first.
 */
export async function installGh({
  root,
  version,
  platform,
  arch,
  fetch: fetcher = realFetch,
  run = realRun,
  env = process.env,
  carried = dirname(process.execPath),
}: GhInstallOptions): Promise<void> {
  const build = ghBuild(version, platform, arch)
  if (!build) throw new Unavailable('hobkin installs its own gh only on a Mac, with Apple silicon or an Intel chip.')

  const sums = await download(fetcher, build.sums, 'GitHub', DOWNLOAD_MS, (answer) => answer.text())
  const expected = checksumOf(sums, build.file)
  if (!expected) throw Error(`GitHub's checksums for gh ${build.version} list no ${build.file}, so nothing was installed.`)
  const archive = Buffer.from(await download(fetcher, build.url, 'GitHub', DOWNLOAD_MS, (answer) => answer.arrayBuffer()))
  if (createHash('sha256').update(archive).digest('hex') !== expected) {
    throw Error(`The gh download did not match its checksum from GitHub's release, so nothing was installed.`)
  }

  mkdirSync(join(root, 'client'), { recursive: true, mode: 0o700 })
  const work = mkdtempSync(join(root, 'client', 'gh-install-'))
  try {
    const file = join(work, build.file)
    const unpacked = join(work, 'unpacked')
    writeFileSync(file, archive)
    mkdirSync(unpacked)
    const unzipped = await ran(run, '/usr/bin/unzip', ['-q', file, '-d', unpacked], UNPACK_MS)
    if (unzipped.error) throw failure('The gh download could not be unpacked, so nothing was installed.', unzipped, UNPACK_MS)
    const made = join(unpacked, build.folder)
    if (!isProgram(join(made, 'bin', 'gh'))) throw Error(`The unpacked gh download has no bin/gh in ${build.folder}, so nothing was installed.`)

    const target = ghFolder(root)
    const previous = join(work, 'previous')
    const had = existsSync(target)
    if (had) renameSync(target, previous)
    try {
      renameSync(made, target)
    } catch (error) {
      if (had) renameSync(previous, target)
      throw Error(scrubText(`gh could not be moved into place, so nothing was installed: ${error instanceof Error ? error.message : String(error)}`))
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  env.PATH = withFolders(env.PATH ?? '', [ghBin(root)], carried)
}

/** Puts hobkin's own gh on the PATH when it is installed, as a live host starts. True when it is there. */
export function addOwnGh(root: string, env: NodeJS.ProcessEnv = process.env, carried: string = dirname(process.execPath)): boolean {
  if (!isProgram(join(ghBin(root), 'gh'))) return false
  env.PATH = withFolders(env.PATH ?? '', [ghBin(root)], carried)
  return true
}

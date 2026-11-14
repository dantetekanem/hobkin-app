import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { scrubText } from '#shared/integrations/redact.ts'
import { Unavailable } from '../commands.ts'
import type { PiRun } from './install.ts'
import { withFolders } from './login-path.ts'

/**
 * A Node of hobkin's own, for a Mac without npm (025-onboarding). The app carries a Node binary for its host but no
 * npm, and Pi installs, and adds its packages, through npm. hobkin downloads the official build of the Node its host
 * runs on, for this Mac's chip, checks it against the checksums nodejs.org lists beside it, and unpacks it into its own
 * home. It needs no admin password and changes nothing else on the Mac.
 */

const DOWNLOAD_MS = 10 * 60_000
const UNPACK_MS = 5 * 60_000
const LAST_LINES = 8

/** Where hobkin keeps its own Node, in its home. */
export const nodeFolder = (root: string) => join(root, 'client', 'node')
/** Its `bin` folder, where its node and npm are, and where npm puts Pi. */
export const nodeBin = (root: string) => join(nodeFolder(root), 'bin')

export interface NodeBuild {
  version: string
  /** The archive's name, as nodejs.org's list of checksums names it. */
  file: string
  url: string
  /** The list of checksums in the same folder. */
  sums: string
}

/** The official build of a Node version for this Mac's chip, or null when hobkin has none for this computer. */
export function nodeBuild(version = process.versions.node, platform: string = process.platform, arch: string = process.arch): NodeBuild | null {
  if (platform !== 'darwin' || (arch !== 'arm64' && arch !== 'x64')) return null
  const folder = `https://nodejs.org/dist/v${version}/`
  const file = `node-v${version}-darwin-${arch}.tar.gz`
  return { version, file, url: `${folder}${file}`, sums: `${folder}SHASUMS256.txt` }
}

/** A file's SHA-256 from SHASUMS256.txt, one `<checksum>  <file>` line each, or null when no line names it. */
export function checksumOf(sums: string, file: string): string | null {
  for (const line of sums.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim())
    if (match && match[2] === file) return match[1]!.toLowerCase()
  }
  return null
}

interface Fetched {
  ok: boolean
  status: number
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}
export type NodeFetch = (url: string, init: { signal: AbortSignal }) => Promise<Fetched>

const realFetch: NodeFetch = (url, init) => fetch(url, init)
const realRun: PiRun = (file, args, options, done) => execFile(file, [...args], options, done)

const isProgram = (file: string) => {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** Why a download failed, in plain words, with anything shaped like a secret hidden. */
function downloadFailure(error: unknown): Error {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return Error(`The Node download took longer than ${DOWNLOAD_MS / 60_000} minutes, so it was stopped and nothing was installed.`)
  }
  const message = error instanceof Error ? error.message : String(error)
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ''
  return Error(scrubText(`Node could not be downloaded from nodejs.org, so nothing was installed. This Mac may be offline, or nodejs.org did not answer. (${message}${cause})`))
}

async function download<T>(fetcher: NodeFetch, url: string, name: string, body: (answer: Fetched) => Promise<T>): Promise<T> {
  let answer: Fetched
  try {
    answer = await fetcher(url, { signal: AbortSignal.timeout(DOWNLOAD_MS) })
  } catch (error) {
    throw downloadFailure(error)
  }
  if (!answer.ok) throw Error(`nodejs.org answered ${answer.status} for ${name}, so nothing was installed.`)
  try {
    return await body(answer)
  } catch (error) {
    throw downloadFailure(error)
  }
}

function unpack(run: PiRun, archive: string, into: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error, printed: string) => {
      const lines = printed.split('\n').map((line) => line.trimEnd()).filter(Boolean).slice(-LAST_LINES)
      const said = lines.length ? `\n${lines.join('\n')}` : ` ${error.message}`
      reject(Error(scrubText(`The Node download could not be unpacked, so nothing was installed.${said}`)))
    }
    try {
      run('/usr/bin/tar', ['-xzf', archive, '-C', into, '--strip-components', '1'], { timeout: UNPACK_MS, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', env: process.env }, (error, stdout, stderr) =>
        error ? failed(error, String(stderr ?? '').trim() ? String(stderr) : String(stdout ?? '')) : resolve(),
      )
    } catch (error) {
      failed(error instanceof Error ? error : Error(String(error)), '')
    }
  })
}

export interface NodeInstallOptions {
  /** hobkin's home. */
  root: string
  /** The version to install. The host's own when not given. */
  version?: string
  platform?: string
  arch?: string
  fetch?: NodeFetch
  run?: PiRun
  /** The environment whose PATH gets the new Node. The host's own when not given, so everything it starts finds it. */
  env?: NodeJS.ProcessEnv
  /** The carried Node's folder, which stays last on the PATH. */
  carried?: string
}

/**
 * Installs hobkin's own Node into `client/node` in its home. The archive is checked before anything is unpacked, and
 * unpacked beside its place first, then moved in, so a failure leaves nothing half-made and a second install replaces
 * the first. Then its `bin` folder goes on the PATH, so npm, and the Pi it installs, are found at once.
 */
export async function installNode({
  root,
  version,
  platform,
  arch,
  fetch: fetcher = realFetch,
  run = realRun,
  env = process.env,
  carried = dirname(process.execPath),
}: NodeInstallOptions): Promise<void> {
  const build = nodeBuild(version, platform, arch)
  if (!build) throw new Unavailable('hobkin installs its own Node only on a Mac, with Apple silicon or an Intel chip.')

  const sums = await download(fetcher, build.sums, 'SHASUMS256.txt', (answer) => answer.text())
  const expected = checksumOf(sums, build.file)
  if (!expected) throw Error(`nodejs.org lists no checksum for ${build.file}, so nothing was installed.`)
  const archive = Buffer.from(await download(fetcher, build.url, build.file, (answer) => answer.arrayBuffer()))
  if (createHash('sha256').update(archive).digest('hex') !== expected) {
    throw Error('The Node download did not match its checksum from nodejs.org, so nothing was installed.')
  }

  mkdirSync(join(root, 'client'), { recursive: true, mode: 0o700 })
  const work = mkdtempSync(join(root, 'client', 'node-install-'))
  try {
    const file = join(work, build.file)
    const unpacked = join(work, 'node')
    writeFileSync(file, archive)
    mkdirSync(unpacked)
    await unpack(run, file, unpacked)
    const lacking = ['node', 'npm'].filter((name) => !isProgram(join(unpacked, 'bin', name)))
    if (lacking.length) throw Error(`The unpacked Node download has no ${lacking.join(' and no ')} in it, so nothing was installed.`)

    const target = nodeFolder(root)
    const previous = join(work, 'previous')
    const had = existsSync(target)
    if (had) renameSync(target, previous)
    try {
      renameSync(unpacked, target)
    } catch (error) {
      if (had) renameSync(previous, target)
      throw Error(scrubText(`Node could not be moved into place, so nothing was installed: ${error instanceof Error ? error.message : String(error)}`))
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  env.PATH = withFolders(env.PATH ?? '', [nodeBin(root)], carried)
}

/** Puts hobkin's own Node on the PATH when it is installed, as a live host starts. True when it is there. */
export function addOwnNode(root: string, env: NodeJS.ProcessEnv = process.env, carried: string = dirname(process.execPath)): boolean {
  if (!isProgram(join(nodeBin(root), 'node'))) return false
  env.PATH = withFolders(env.PATH ?? '', [nodeBin(root)], carried)
  return true
}

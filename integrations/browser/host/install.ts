import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { engineEnv, type Exec } from './engine.ts'

/**
 * Putting the browser engine on this computer, on the user's word. The engine is agent-browser, one binary, taken
 * from the npm registry at a pinned version: the bytes must have the size and the sha512 written here, or nothing is
 * installed. It goes into a folder named by its version, put in place whole or not at all. The binary then fetches
 * Chrome for Testing itself, into its own folder in the user's home, unless one is already there.
 */

export const ENGINE_VERSION = '0.45.0'

/** One platform's build: where it is, and what its bytes must be. `sha512` is base64, as npm's `integrity` has it. */
export interface Build {
  url: string
  size: number
  sha512: string
}

/** The builds this version installs, by `<platform>-<arch>` as Node names them. */
export const BUILDS: Readonly<Record<string, Build>> = {
  'darwin-arm64': {
    url: 'https://registry.npmjs.org/@agent-browser/cli-darwin-arm64/-/cli-darwin-arm64-0.45.0.tgz',
    size: 9352726,
    sha512: '5oXJso0waXDJ4JhRlf0HMFWPfzCVGCDsAmQKrN05cDluqCCUj55ImWK0XEtiFkjwdJDpHJIJV3f6OOJD+K85Bg==',
  },
  'darwin-x64': {
    url: 'https://registry.npmjs.org/@agent-browser/cli-darwin-x64/-/cli-darwin-x64-0.45.0.tgz',
    size: 9877277,
    sha512: 'ILY9co+hxsupMFvKsh+qi3+5I2QiDM44eEgf/3S8scKpP4rVX/vXEk6gScJQ9fw4qQyg37A58JLqbVSZbKUsbw==',
  },
}

/** What a person calls each kind of computer a build is for. */
const COMPUTERS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'a Mac with Apple silicon',
  'darwin-x64': 'a Mac with an Intel chip',
}

/** The binary inside the registry's archive. */
const BINARY_IN_ARCHIVE = 'package/bin/agent-browser'
/** Chrome for Testing's own binary inside its app, as agent-browser unpacks it on a Mac. */
const CHROME_IN_APP = join('Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')

/** What a download answers: enough of `fetch`'s response for a test to stand in for it. */
export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>

export interface Chrome {
  path: string
  version: string
}

const engineFolder = (root: string, version: string): string => join(root, `agent-browser-${version}`)

/** Where a version's binary is kept under the tools folder. */
export const engineBinary = (root: string, version = ENGINE_VERSION): string => join(engineFolder(root, version), 'agent-browser')

/** The build for this computer, or why there is none, in words for the user. */
export function buildFor(platform: string, arch: string, builds: Readonly<Record<string, Build>> = BUILDS): Build {
  const build = builds[`${platform}-${arch}`]
  if (build) return build

  const installsOn = Object.keys(builds).map((key) => COMPUTERS[key] ?? key)
  throw Error(`The browser engine has no build for this computer (${platform} ${arch}). It installs on ${installsOn.join(' or ')}.`)
}

/** The version a binary says it is, such as 0.45.0. Throws when it does not run or does not say. */
export async function engineVersion(exec: Exec, binary: string): Promise<string> {
  const { stdout, code } = await exec(binary, ['--version'], { env: engineEnv() })
  const version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(stdout)?.[1]
  if (code !== 0 || !version) throw Error('agent-browser did not say its version.')
  return version
}

/** Whether the binary there runs and is this version. One that does not run is as good as none. */
async function runsAs(exec: Exec, binary: string, version: string): Promise<boolean> {
  try {
    return (await engineVersion(exec, binary)) === version
  } catch {
    return false
  }
}

function chromeIn(folder: string): string | null {
  const direct = join(folder, CHROME_IN_APP)
  if (existsSync(direct)) return direct

  // Chrome's own archive keeps the app one folder down, such as chrome-mac-arm64.
  let inside: string[]
  try {
    inside = readdirSync(folder)
  } catch {
    // Not a folder: nothing is there.
    return null
  }
  const holder = inside.find((name) => existsSync(join(folder, name, CHROME_IN_APP)))
  return holder ? join(folder, holder, CHROME_IN_APP) : null
}

/** The newest Chrome for Testing in agent-browser's own folder (`chrome-<version>` each), or null. It only looks. */
export function findChrome(browsersDir: string): Chrome | null {
  let names: string[]
  try {
    names = readdirSync(browsersDir)
  } catch {
    return null
  }

  const found: Chrome[] = []
  for (const name of names) {
    const version = /^chrome-(\d[\w.]*)$/.exec(name)?.[1]
    if (!version) continue

    const path = chromeIn(join(browsersDir, name))
    if (path) found.push({ path, version })
  }

  const newestFirst = (a: Chrome, b: Chrome) => b.version.localeCompare(a.version, undefined, { numeric: true })
  return found.sort(newestFirst)[0] ?? null
}

// Where a tar header keeps what is read here. Each header is one block, and a file's bytes fill whole blocks after it.
const TAR_BLOCK = 512
const TAR_NAME = { at: 0, length: 100 }
const TAR_SIZE = { at: 124, length: 12 }
const TAR_KIND = { at: 156, length: 1 }
/** The folders above a file whose full name does not fit in the name field. */
const TAR_PREFIX = { at: 345, length: 155 }
/** An ordinary file, as new and as old archives mark it. */
const TAR_FILE_KINDS = ['0', '']

/** One file out of a tar archive, by its full name, or null. Enough of the format for the registry's archives. */
export function fileFromTar(tar: Buffer, name: string): Buffer | null {
  const field = (header: number, { at, length }: { at: number; length: number }): string => {
    const text = tar.subarray(header + at, header + at + length).toString('utf8')
    return text.replace(/\0.*$/s, '')
  }

  let header = 0
  while (header + TAR_BLOCK <= tar.length) {
    const shortName = field(header, TAR_NAME)
    // An empty block ends the archive.
    if (!shortName) return null

    const size = Number.parseInt(field(header, TAR_SIZE).trim() || '0', 8)
    if (!Number.isFinite(size) || size < 0) return null

    const prefix = field(header, TAR_PREFIX)
    const fullName = prefix ? `${prefix}/${shortName}` : shortName
    const isFile = TAR_FILE_KINDS.includes(field(header, TAR_KIND))
    const content = header + TAR_BLOCK
    if (isFile && fullName === name) return tar.subarray(content, content + size)

    header = content + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
  }
  return null
}

const megabytes = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} MB`
const lastLine = (...outputs: string[]): string => outputs.join('\n').trim().split('\n').at(-1)?.trim() ?? ''

export interface InstallOptions {
  /** The tools folder the engine lives in, `<data root>/tools/browser`. */
  root: string
  build: Build
  fetch: Fetch
  exec: Exec
  /** agent-browser's own folder of browsers, where Chrome for Testing goes. */
  browsersDir: string
  /** What the install is doing now, in plain words. */
  note: (words: string) => void
  version?: string
}

/** The bytes of a build, once they are known to be the pinned ones. */
async function downloadPinned(build: Build, version: string, fetch: Fetch): Promise<Buffer> {
  const response = await fetch(build.url)
  if (!response.ok) throw Error(`The download of agent-browser ${version} failed: the registry answered ${response.status}.`)

  const bytes = Buffer.from(await response.arrayBuffer())
  // The pin: bytes of another size or another hash are not this build, whoever sent them.
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  if (bytes.length !== build.size || sha512 !== build.sha512) {
    throw Error(`The download of agent-browser ${version} does not match its pinned hash, so it was not installed.`)
  }
  return bytes
}

/** The engine's binary out of a build's archive, or null when the archive holds none. */
function binaryIn(archive: Buffer): Buffer | null {
  try {
    return fileFromTar(gunzipSync(archive), BINARY_IN_ARCHIVE)
  } catch {
    return null
  }
}

/**
 * Puts a binary in its version's folder. It is built in a folder beside its final place, so putting it there is one
 * rename and never half a folder, and that folder is gone again whether or not the binary turned out to run.
 */
async function putInPlace(binary: Buffer, root: string, version: string, exec: Exec): Promise<void> {
  mkdirSync(root, { recursive: true })
  const staging = mkdtempSync(join(root, '.installing-'))

  try {
    const staged = join(staging, 'agent-browser')
    writeFileSync(staged, binary)
    chmodSync(staged, 0o755)

    if (!(await runsAs(exec, staged, version))) {
      throw Error(`The downloaded agent-browser does not run as version ${version} on this computer, so it was not installed.`)
    }

    const folder = engineFolder(root, version)
    rmSync(folder, { recursive: true, force: true })
    renameSync(staging, folder)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

async function installBinary({ root, build, fetch, exec, note }: InstallOptions, version: string): Promise<void> {
  note(`Downloading agent-browser ${version}, ${megabytes(build.size)}.`)
  const archive = await downloadPinned(build, version, fetch)

  note(`Putting agent-browser ${version} in place.`)
  const binary = binaryIn(archive)
  if (!binary) throw Error(`The download of agent-browser ${version} holds no binary, so it was not installed.`)

  await putInPlace(binary, root, version, exec)
  if (!existsSync(engineBinary(root, version))) throw Error(`agent-browser ${version} could not be put in ${root}.`)
}

/** Has the engine fetch Chrome for Testing into its own folder, and answers where it is. */
async function installChrome(binary: string, browsersDir: string, exec: Exec): Promise<Chrome> {
  const { stdout, stderr, code } = await exec(binary, ['install'], { env: engineEnv() })
  if (code !== 0) {
    const why = lastLine(stderr, stdout).slice(0, 300) || `agent-browser install ended with code ${code}`
    throw Error(`Chrome for Testing did not install: ${why}`)
  }

  const chrome = findChrome(browsersDir)
  if (!chrome) throw Error(`Chrome for Testing was not found in ${browsersDir} after the install.`)
  return chrome
}

/**
 * Downloads the pinned build, checks it, puts its binary in place, and has it fetch Chrome for Testing when none is
 * there. Answers what is installed. When a step fails it throws the reason in plain words and leaves nothing new
 * behind in the tools folder.
 */
export async function installEngine(options: InstallOptions): Promise<{ binary: string; version: string; chrome: Chrome }> {
  const { root, exec, browsersDir, note, version = ENGINE_VERSION } = options
  const binary = engineBinary(root, version)

  const alreadyThere = existsSync(binary) && (await runsAs(exec, binary, version))
  if (!alreadyThere) await installBinary(options, version)

  let chrome = findChrome(browsersDir)
  if (!chrome) {
    note('Downloading Chrome for Testing, about 400 MB. This can take a few minutes.')
    chrome = await installChrome(binary, browsersDir, exec)
  }

  return { binary, version, chrome }
}

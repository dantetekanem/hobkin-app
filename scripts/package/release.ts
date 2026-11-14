import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CHIPS, FEED, releaseNames, updateFeed, type Chip } from './feed.ts'

/**
 * Gathers what the finished `tauri build`s made into `dist/release/`, under the names the files are published with,
 * and writes the updater's feed beside them. Run it after the builds:
 *
 *   node scripts/package/release.ts "What changed in this version."
 *
 * The version is the one the built apps carry, not the one in package.json, which may have moved on since the build.
 * A chip that was not built is left out, and says so. It uploads nothing: hobkin-api's `docs/operations.md` says how
 * the folder's files reach the server.
 */

const repo = path.resolve(import.meta.dirname, '../..')
const target = path.join(repo, 'src-tauri/target')
const out = path.join(repo, 'dist/release')
const notes = process.argv[2] ?? ''

/**
 * Where each chip's build leaves its bundle, and the chip's name in the DMG Tauri writes. Apple silicon is built
 * without `--target` on this Mac, so its bundle is not under a folder named for the chip.
 */
const BUILDS: Record<Chip, { bundle: string; dmgChip: string }> = {
  aarch64: { bundle: path.join(target, 'release/bundle'), dmgChip: 'aarch64' },
  x86_64: { bundle: path.join(target, 'x86_64-apple-darwin/release/bundle'), dmgChip: 'x64' },
}

interface Built {
  version: string
  dmg: string
  archive: string
  signature: string
}

/** The version a built app carries, from its Info.plist. */
function versionIn(bundle: string): string | null {
  const plist = path.join(bundle, 'macos', 'hobkin.app', 'Contents', 'Info.plist')
  if (!existsSync(plist)) return null
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(readFileSync(plist, 'utf8'))?.[1] ?? null
}

/** What one chip's build made, or null when it was not built. The archive and its signature need `createUpdaterArtifacts`. */
function builtFor(chip: Chip): Built | null {
  const { bundle, dmgChip } = BUILDS[chip]
  const version = versionIn(bundle)
  if (!version) return null

  const built = {
    version,
    dmg: path.join(bundle, 'dmg', `hobkin_${version}_${dmgChip}.dmg`),
    archive: path.join(bundle, 'macos', 'hobkin.app.tar.gz'),
    signature: path.join(bundle, 'macos', 'hobkin.app.tar.gz.sig'),
  }
  for (const file of [built.dmg, built.archive, built.signature]) {
    if (!existsSync(file)) throw Error(`The ${chip} build of ${version} is not whole: ${file} is missing.`)
  }
  return built
}

const builds = new Map<Chip, Built>()
for (const chip of CHIPS) {
  const built = builtFor(chip)
  if (built) builds.set(chip, built)
  else console.log(`No ${chip} build was found, so it is left out.`)
}

const versions = new Set([...builds.values()].map((built) => built.version))
if (versions.size > 1) throw Error(`The builds are of different versions (${[...versions].join(', ')}). Build every chip from the same commit.`)
const [version] = versions
if (!version) throw Error('No build was found. Run the release build first.')

// Only now is the old folder replaced, so a run that fails above leaves the last release's files where they were.
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const published: string[] = []
const signatures: Partial<Record<Chip, string>> = {}

for (const [chip, built] of builds) {
  const names = releaseNames(version, chip)
  copyFileSync(built.dmg, path.join(out, names.dmg))
  copyFileSync(built.archive, path.join(out, names.archive))
  signatures[chip] = readFileSync(built.signature, 'utf8')
  published.push(names.dmg, names.archive)
}

const feed = updateFeed({ version, notes, publishedAt: new Date().toISOString(), signatures })
writeFileSync(path.join(out, FEED), `${JSON.stringify(feed, null, 2)}\n`)

for (const name of [...published, FEED]) {
  const file = path.join(out, name)
  const megabytes = (statSync(file).size / 1024 / 1024).toFixed(1)
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
  console.log(`${name}  ${megabytes} MB  sha256 ${sha256}`)
}
console.log(`\nVersion ${version}, in ${out}. Upload the other files first, and ${FEED} last.`)

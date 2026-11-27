import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CHIPS, DOWNLOADS, FEED, releaseNames, updateFeed, type Chip } from './feed.ts'

/**
 * Gathers what `build.ts` made for each chip into `dist/release/`, under the names the files are published with,
 * and writes the updater's feed beside them. Run it after the builds:
 *
 *   node scripts/package/release.ts "What changed in this version."
 *
 * `build.ts` copies a chip's DMG, updater archive and signature to `dist/built/<chip>/` only once they are signed,
 * notarized, stapled and checked, so nothing else can reach a release. A chip that was not built is left out, and
 * says so. It uploads nothing: every file goes to the downloads folder the release config's updater endpoint names.
 */

const repo = path.resolve(import.meta.dirname, '../..')
const built = path.join(repo, 'dist/built')
const out = path.join(repo, 'dist/release')
const notes = process.argv[2] ?? ''

interface Built {
  version: string
  commit: string
  dmg: string
  archive: string
  signature: string
}

/** What `build.ts` left for one chip, or null when that chip was not built. */
function builtFor(chip: Chip): Built | null {
  const folder = path.join(built, chip)
  const record = path.join(folder, 'build.json')
  if (!existsSync(record)) return null
  const { version, commit, dmg, notarized } = JSON.parse(readFileSync(record, 'utf8')) as { version: string; commit: string; dmg: string; notarized?: boolean }
  if (notarized !== true) throw Error(`The ${chip} build of ${version} was not notarized, so it cannot go out.`)

  const files = {
    version,
    commit,
    dmg: path.join(folder, dmg),
    archive: path.join(folder, 'hobkin.app.tar.gz'),
    signature: path.join(folder, 'hobkin.app.tar.gz.sig'),
  }
  for (const file of [files.dmg, files.archive, files.signature]) {
    if (!existsSync(file)) throw Error(`The ${chip} build of ${version} is not whole: ${file} is missing.`)
  }
  return files
}

const builds = new Map<Chip, Built>()
for (const chip of CHIPS) {
  const found = builtFor(chip)
  if (found) builds.set(chip, found)
  else console.log(`No ${chip} build was found, so it is left out.`)
}

const versions = new Set([...builds.values()].map((found) => `${found.version} at ${found.commit}`))
if (versions.size > 1) throw Error(`The builds are of different versions or commits (${[...versions].join(', ')}). Build every chip from the same commit.`)
const version = [...builds.values()][0]?.version
if (!version) throw Error('No build was found. Run build.ts for each chip first.')

// Only now is the old folder replaced, so a run that fails above leaves the last release's files where they were.
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const published: string[] = []
const signatures: Partial<Record<Chip, string>> = {}

for (const [chip, found] of builds) {
  const names = releaseNames(version, chip)
  copyFileSync(found.dmg, path.join(out, names.dmg))
  copyFileSync(found.archive, path.join(out, names.archive))
  signatures[chip] = readFileSync(found.signature, 'utf8')
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
console.log(`\nVersion ${version}, in ${out}. Upload them to ${DOWNLOADS}/: the other files first, and ${FEED} last.`)

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { releaseNames, updateFeed } from './feed.ts'

/**
 * Gathers what a finished `tauri build` made into `dist/release/`, under the names the files are published with,
 * and writes the updater's feed beside them. Run it after the build:
 *
 *   node scripts/package/release.ts "What changed in this version."
 *
 * It uploads nothing. hobkin-api's `docs/operations.md` says how the folder's files reach the server.
 */

const repo = path.resolve(import.meta.dirname, '../..')
// Where the build left its bundle. HOBKIN_BUNDLE_DIR names another place, for a build made with its own target folder.
const bundle = process.env.HOBKIN_BUNDLE_DIR ?? path.join(repo, 'src-tauri/target/release/bundle')
const out = path.join(repo, 'dist/release')

const { version } = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')) as { version: string }
const notes = process.argv[2] ?? ''
const names = releaseNames(version)

/** Where the build leaves each file. The archive and its signature exist only with `createUpdaterArtifacts`. */
const built = {
  dmg: path.join(bundle, 'dmg', `hobkin_${version}_aarch64.dmg`),
  archive: path.join(bundle, 'macos', 'hobkin.app.tar.gz'),
  signature: path.join(bundle, 'macos', 'hobkin.app.tar.gz.sig'),
}

for (const [what, file] of Object.entries(built)) {
  if (!existsSync(file)) throw Error(`The build left no ${what} at ${file}. Run the release build for ${version} first.`)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

copyFileSync(built.dmg, path.join(out, names.dmg))
copyFileSync(built.archive, path.join(out, names.archive))

const feed = updateFeed({
  version,
  notes,
  publishedAt: new Date().toISOString(),
  signature: readFileSync(built.signature, 'utf8'),
})
writeFileSync(path.join(out, names.feed), `${JSON.stringify(feed, null, 2)}\n`)

for (const name of [names.dmg, names.archive, names.feed]) {
  const file = path.join(out, name)
  const megabytes = (statSync(file).size / 1024 / 1024).toFixed(1)
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
  console.log(`${name}  ${megabytes} MB  sha256 ${sha256}`)
}
console.log(`\nIn ${out}. Upload the two files first, and ${names.feed} last.`)

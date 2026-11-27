/**
 * The names a release is published under, and the feed Tauri's updater reads to learn there is a newer one
 * (`latest.json`). Pure rules. The one setting is the updater endpoint in `tauri.release.conf.json`: the feed of the
 * latest release on a GitHub repository. Each version is that repository's release `v<version>`, with both DMGs, both
 * update archives and the feed as its assets, so the feed's archive links name that release.
 */
import releaseConfig from './tauri.release.conf.json' with { type: 'json' }

/** The feed's file name. It is the one name that stays the same from version to version. */
export const FEED = 'latest.json'

interface UpdaterConfig {
  plugins?: { updater?: { endpoints?: readonly string[] } }
}

// GitHub answers /releases/latest with the newest release that is neither a draft nor a pre-release.
const LATEST_FEED = new RegExp(`^https://github\\.com/([\\w.-]+/[\\w.-]+)/releases/latest/download/${FEED.replace('.', '\\.')}$`)

/** The repository (`owner/name`) whose latest release carries the feed the config's one updater endpoint reads. */
export function repositoryFrom(config: UpdaterConfig): string {
  const endpoints = config.plugins?.updater?.endpoints ?? []
  if (endpoints.length !== 1) throw Error(`The release config must name one endpoint for the updater, not ${endpoints.length}: every release is found from it.`)
  const [endpoint] = endpoints as [string]
  const repository = LATEST_FEED.exec(endpoint)?.[1]
  if (!repository) throw Error(`The updater endpoint must be https://github.com/<owner>/<name>/releases/latest/download/${FEED}, not ${endpoint}.`)
  return repository
}

export const REPOSITORY = repositoryFrom(releaseConfig)

/** The chips the app is built for, as Rust and the updater name them: Apple silicon and Intel. */
export type Chip = 'aarch64' | 'x86_64'

export const CHIPS: readonly Chip[] = ['aarch64', 'x86_64']

/** A version is three numbers, as in package.json. It becomes part of a file name, so nothing else is taken. */
function checked(version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error(`A release version is three numbers, such as 0.1.19, not "${version}".`)
  return version
}

/** The tag of a version's release. */
export const releaseTag = (version: string) => `v${checked(version)}`

/** Where a file of a version's release is downloaded from. */
const assetUrl = (repository: string, version: string, file: string) => `https://github.com/${repository}/releases/download/${releaseTag(version)}/${file}`

/**
 * The file names of one version for one chip. The Apple silicon DMG has the plain name, since most Macs take it, and
 * the Intel one says so. The archive is what an installed app downloads to update itself.
 */
export function releaseNames(version: string, chip: Chip): { dmg: string; archive: string } {
  const number = checked(version)
  return {
    dmg: chip === 'x86_64' ? `hobkin-alpha-${number}-intel.dmg` : `hobkin-alpha-${number}.dmg`,
    archive: `hobkin-${number}-${chip}.app.tar.gz`,
  }
}

interface Archive {
  url: string
  signature: string
}

export interface UpdateFeed {
  version: string
  notes: string
  pub_date: string
  platforms: Partial<Record<`darwin-${Chip}`, Archive>>
}

interface Published {
  /** The GitHub repository (`owner/name`) the release goes to. */
  repository: string
  version: string
  notes: string
  /** When the release was made, as an ISO time. Given by the caller, so the rule itself reads no clock. */
  publishedAt: string
  /** For each chip that was built, the text of its archive's `.sig` file, as the build wrote it. */
  signatures: Partial<Record<Chip, string>>
}

/**
 * The feed for a version: for each chip built, where its archive is and the signature the installed app checks the
 * download against. An app on a chip the feed leaves out finds no update.
 */
export function updateFeed({ repository, version, notes, publishedAt, signatures }: Published): UpdateFeed {
  const platforms: UpdateFeed['platforms'] = {}

  for (const chip of CHIPS) {
    const signature = signatures[chip]
    if (signature === undefined) continue

    const signed = signature.trim()
    if (!signed) throw Error(`The ${chip} update archive has no signature, so no installed app would accept it.`)

    platforms[`darwin-${chip}`] = { url: assetUrl(repository, version, releaseNames(version, chip).archive), signature: signed }
  }

  if (Object.keys(platforms).length === 0) throw Error('A feed for no chip at all would tell every app there is nothing to install.')

  return { version: checked(version), notes, pub_date: publishedAt, platforms }
}

interface ReleaseFiles {
  repository: string
  version: string
  /** The commit the version was built from, which the release's tag is made at. */
  commit: string
  notesFile: string
  /** Both DMGs, both update archives, and the feed. */
  files: readonly string[]
}

/**
 * The command that publishes a version: release `v<version>` at the commit it was built from, marked the latest so
 * the updater's endpoint finds its feed. gh uploads every file to a draft and publishes it once they are all there,
 * so an installed app never reads a feed whose archives are missing.
 */
export function releaseCommand({ repository, version, commit, notesFile, files }: ReleaseFiles): string[] {
  return [
    ...['gh', 'release', 'create', releaseTag(version)],
    ...['--repo', repository],
    ...['--target', commit],
    ...['--title', `hobkin ${version}`],
    ...['--notes-file', notesFile],
    '--latest',
    ...files,
  ]
}

/** A command as a shell line, each word quoted when the shell would otherwise split or read it. */
export function shellLine(words: readonly string[]): string {
  return words.map((word) => (/^[\w./:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`)).join(' ')
}

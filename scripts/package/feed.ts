/**
 * The names a release is published under, and the feed Tauri's updater reads to learn there is a newer one
 * (`latest.json`). Pure rules, and the one place the download address comes from: the updater endpoint in
 * `tauri.release.conf.json`. Every file of a release is published in the folder that holds the feed.
 */
import releaseConfig from './tauri.release.conf.json' with { type: 'json' }

/** The feed's file name. It is the one name that stays the same from version to version. */
export const FEED = 'latest.json'

interface UpdaterConfig {
  plugins?: { updater?: { endpoints?: readonly string[] } }
}

/** The folder a release is published in: where the config's one updater endpoint finds the feed. */
export function downloadsFrom(config: UpdaterConfig): string {
  const endpoints = config.plugins?.updater?.endpoints ?? []
  if (endpoints.length !== 1) throw Error(`The release config must name one endpoint for the updater, not ${endpoints.length}: the release is published beside it.`)
  const [endpoint] = endpoints as [string]
  if (!endpoint.endsWith(`/${FEED}`)) throw Error(`The updater endpoint must be the ${FEED} in the downloads folder, not ${endpoint}.`)
  return endpoint.slice(0, -`/${FEED}`.length)
}

export const DOWNLOADS = downloadsFrom(releaseConfig)

/** The chips the app is built for, as Rust and the updater name them: Apple silicon and Intel. */
export type Chip = 'aarch64' | 'x86_64'

export const CHIPS: readonly Chip[] = ['aarch64', 'x86_64']

/** A version is three numbers, as in package.json. It becomes part of a file name, so nothing else is taken. */
function checked(version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error(`A release version is three numbers, such as 0.1.19, not "${version}".`)
  return version
}

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
export function updateFeed({ version, notes, publishedAt, signatures }: Published): UpdateFeed {
  const platforms: UpdateFeed['platforms'] = {}

  for (const chip of CHIPS) {
    const signature = signatures[chip]
    if (signature === undefined) continue

    const signed = signature.trim()
    if (!signed) throw Error(`The ${chip} update archive has no signature, so no installed app would accept it.`)

    platforms[`darwin-${chip}`] = { url: `${DOWNLOADS}/${releaseNames(version, chip).archive}`, signature: signed }
  }

  if (Object.keys(platforms).length === 0) throw Error('A feed for no chip at all would tell every app there is nothing to install.')

  return { version: checked(version), notes, pub_date: publishedAt, platforms }
}

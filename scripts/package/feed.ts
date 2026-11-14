/**
 * The names a release is published under, and the feed Tauri's updater reads to learn there is a newer one
 * (`latest.json`). Pure rules. The files are served from hobkin-api's `/downloads/<file>` (its `docs/operations.md`).
 */

export const DOWNLOADS = 'https://api.hobkin.dev/downloads'

/** A version is three numbers, as in package.json. It becomes part of a file name, so nothing else is taken. */
function checked(version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error(`A release version is three numbers, such as 0.1.19, not "${version}".`)
  return version
}

/** The file names of one version. The archive is for Apple silicon, the only chip the app is built for today. */
export function releaseNames(version: string): { dmg: string; archive: string; feed: string } {
  const number = checked(version)
  return {
    dmg: `hobkin-alpha-${number}.dmg`,
    archive: `hobkin-${number}-aarch64.app.tar.gz`,
    feed: 'latest.json',
  }
}

export interface UpdateFeed {
  version: string
  notes: string
  pub_date: string
  platforms: { 'darwin-aarch64': { url: string; signature: string } }
}

interface Published {
  version: string
  notes: string
  /** When the release was made, as an ISO time. Given by the caller, so the rule itself reads no clock. */
  publishedAt: string
  /** The text of the archive's `.sig` file, as the build wrote it. */
  signature: string
}

/** The feed for a version: where its archive is, and the signature the installed app checks the download against. */
export function updateFeed({ version, notes, publishedAt, signature }: Published): UpdateFeed {
  const signed = signature.trim()
  if (!signed) throw Error('The update archive has no signature, so no installed app would accept it.')

  return {
    version: checked(version),
    notes,
    pub_date: publishedAt,
    platforms: {
      'darwin-aarch64': {
        url: `${DOWNLOADS}/${releaseNames(version).archive}`,
        signature: signed,
      },
    },
  }
}

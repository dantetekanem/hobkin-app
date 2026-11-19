/**
 * hobkin's directions: `AGENTS.md` in its home, which every agent it runs follows (`src/cli/directions.mjs` in hobkin).
 * hobkin reads it whole or not at all, so the editor keeps to the same cap.
 */
export const DIRECTIONS_MAX_BYTES = 65536

/** Said in place of a hash while there is no AGENTS.md yet. */
export const DIRECTIONS_MISSING = 'missing'

export interface DirectionsFile {
  path: string
  text: string
  /** The sha256 of the file's bytes, or `missing`. A save sends it back, and the host refuses when the file moved on. */
  version: string
  /** False while there is no AGENTS.md: `text` is then the default hobkin writes there the first time it reads it. */
  exists: boolean
}

/** A save that lost the race is no error: someone else wrote the file since it was read, and `message` says so. */
export type DirectionsSaved = { saved: true; file: DirectionsFile } | { saved: false; message: string }

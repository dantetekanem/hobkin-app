import { readFileSync } from 'node:fs'

const NOTE = readFileSync(new URL('./directions.md', import.meta.url), 'utf8').trim()

/**
 * What a run on Claude Code is told: how running there differs, then the directions hobkin gives a Pi run of the same
 * purpose. `workDirections` is hobkin's own (`harnesses.mjs`); a run with no purpose gets hobkin's background directions.
 */
export const claudeDirections =
  (workDirections: (purpose: string) => string, background: string) =>
  (purpose: string | undefined): string =>
    `${NOTE}\n\n${purpose ? workDirections(purpose) : background}`

import { sha256 } from './sha256.ts'

const SEPARATOR = /\r\n|\r|\n/

/** The lines of a file as a diff shows them: no separators, and no empty last line after a final newline. */
export function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split(SEPARATOR)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

export function lineCount(text: string): number {
  return splitLines(text).length
}

/**
 * The exact characters of lines `startLine` to `endLine` (1-based, inclusive), with the separators between
 * them and without the one after the last. Ported from pi-coder's `rawTextSliceForRange`.
 */
export function sliceLines(text: string, startLine: number, endLine: number): string {
  const starts = [0]
  const ends: number[] = []
  const separators = /\r\n|\r|\n/g
  for (let match = separators.exec(text); match != null; match = separators.exec(text)) {
    ends.push(match.index)
    starts.push(match.index + match[0].length)
  }
  ends.push(text.length)
  return text.slice(starts[startLine - 1] ?? text.length, ends[endLine - 1] ?? text.length)
}

/** The hash an anchor carries: SHA-256 of the exact characters of its lines. */
export function hashLines(text: string, startLine: number, endLine: number): string {
  return sha256(sliceLines(text, startLine, endLine))
}

/**
 * Model prose is display text. Control and bidirectional formatting characters go, whitespace collapses
 * and the length is capped. Ported from pi-coder's `noteText`.
 */
export function cleanProse(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const characters = Array.from(text)
  return characters.length <= limit ? text : `${characters.slice(0, limit - 1).join('').trimEnd()}…`
}

/** True when text is already clean and within its limit, as saved prose must be. */
export function isCleanProse(value: unknown, limit: number): value is string {
  return typeof value === 'string' && cleanProse(value, limit) === value
}

/** A path inside the repository: relative, forward slashes, no `.` or `..` parts. */
export function isSafePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  )
}

/** "one file", "3 files". */
export function count(amount: number, singular: string, plural = `${singular}s`): string {
  return `${amount.toLocaleString('en-US')} ${amount === 1 ? singular : plural}`
}

/** "a", "a and b", "a, b and c". */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

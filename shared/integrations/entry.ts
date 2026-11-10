import type { CommandServerEntry, Fill, PiServerEntry, ServerKind } from './types.ts'

/**
 * Reading and filling an `mcpServers` entry. An entry may hold two kinds of stand-in:
 * `${NAME}`, which Pi resolves from the environment when it connects, and `<key>`, which a person
 * fills in before the entry is written (an address, the id of an app). Neither is ever a secret.
 */

/** A value a person fills in, such as `<address>`. */
const FILL = /<([a-z][a-z0-9-]*)>/g
/** A reference to an environment variable, such as `${GITHUB_TOKEN}`. */
const REFERENCE = /\$\{([A-Z][A-Z0-9_]*)\}/g

export function isCommandEntry(entry: PiServerEntry): entry is CommandServerEntry {
  return typeof entry.command === 'string'
}

export function entryKind(entry: PiServerEntry): ServerKind {
  return isCommandEntry(entry) ? 'command' : 'remote'
}

/** Every text an entry holds, at any depth, in the order it is written. */
function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(texts)
  if (value && typeof value === 'object') return Object.values(value).flatMap(texts)
  return []
}

/** The same shape with every text passed through `change`. Nothing of the original is touched. */
function mapTexts<Value>(value: Value, change: (text: string) => string): Value {
  if (typeof value === 'string') return change(value) as Value
  if (Array.isArray(value)) return value.map((item) => mapTexts(item, change)) as Value
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapTexts(item, change)])) as Value
  }
  return value
}

function found(entry: PiServerEntry, pattern: RegExp): string[] {
  const names = texts(entry).flatMap((text) => [...text.matchAll(pattern)].map((match) => match[1]!))
  return [...new Set(names)]
}

/** The fills an entry still leaves open, each once, in the order they appear. */
export function openFills(entry: PiServerEntry): string[] {
  return found(entry, FILL)
}

/** The environment variables an entry reads, each once, in the order they appear. */
export function envNames(entry: PiServerEntry): string[] {
  return found(entry, REFERENCE)
}

/**
 * The entry with each `<key>` replaced by the value given for it. A fill with no value, or an empty one,
 * stays as written, so `openFills` of the result says what is still missing.
 */
export function fillEntry(entry: PiServerEntry, values: Readonly<Record<string, string>>): PiServerEntry {
  return mapTexts(entry, (text) => text.replace(FILL, (whole, key: string) => values[key]?.trim() || whole))
}

/**
 * Checks a value a person typed for a fill, and gives it back the way it is written into the entry:
 * trimmed, and an address without its last slash. A value that would read the environment or leave a
 * stand-in behind is refused, because a fill is only ever plain text.
 */
export function fillValue(fill: Fill, typed: string): { value: string } | { problem: string } {
  const value = typed.trim()
  if (!value) return { problem: 'Needed before connecting.' }
  if (/\s/.test(value)) return { problem: 'No spaces.' }
  if (/[<>]|\$\{/.test(value)) return { problem: 'Only the value itself.' }
  if (!/^https?:\/\//.test(fill.example)) return { value }
  let address: URL
  try {
    address = new URL(value)
  } catch {
    return { problem: `An address such as ${fill.example}.` }
  }
  if (address.protocol !== 'http:' && address.protocol !== 'https:') return { problem: `An address such as ${fill.example}.` }
  return { value: value.replace(/\/+$/, '') }
}

/**
 * The entry turned off or on. Off keeps it with `enabled: false`. On takes that key away, so the entry reads
 * as it did before. Every other field, known to hobkin or not, is kept as written.
 */
export function withEnabled(entry: PiServerEntry, on: boolean): PiServerEntry {
  if (!on) return { ...entry, enabled: false }
  if (entry.enabled !== false) return entry
  const { enabled: _enabled, ...rest } = entry
  return rest as PiServerEntry
}

/** The entry the way it sits under `mcpServers` in the file: its name, then its JSON. */
export function entryText(name: string, entry: PiServerEntry): string {
  return `${JSON.stringify(name)}: ${JSON.stringify(entry, null, 2)}`
}

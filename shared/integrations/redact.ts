import type { PiServerEntry } from './types.ts'

/**
 * Hides secrets before anything about an MCP server leaves the host (023-integrations, A9). An entry keeps its
 * shape, so the UI can still say where a server lives, but every value written into it
 * as a credential is replaced, and so is anything in a message that is shaped like one.
 *
 * A reference to the environment, `${NAME}` or `$NAME` as Pi reads them, is safe to show: Pi reads the secret only
 * when it connects. A value that runs a command (`!...`) is hidden, since the command line itself may hold one.
 */

/** What stands in for a hidden value. */
export const HIDDEN = '[hidden]'

/** Names of fields and options that hold a credential, whatever else they are called. */
const SECRET_NAME = /(?:secret|token|passw(?:or)?d|pwd|api[-_]?key|apikey|credential|private[-_]?key|auth[-_]?key|access[-_]?key|bearer|cookie|session)/i

/** `name=value` or `name: value` in text, where the name says it holds a credential. */
const NAMED_VALUE = new RegExp(`(?<name>\\b[\\w-]*${SECRET_NAME.source}[\\w-]*)(?<separator>\\s*[=:]\\s*)(?!\\[hidden\\])[^\\s&,;"']+`, 'gi')

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/

interface Template {
  /** The variables it reads from the environment. */
  names: string[]
  /** What is left once every reference is taken out. */
  rest: string
}

/** Pi's own reading of a value: `${NAME}` and `$NAME` read the environment, `$$` and `$!` are a plain `$` and `!`. */
function template(value: string): Template {
  const names: string[] = []
  let rest = ''
  for (let at = 0; at < value.length; ) {
    const dollar = value.indexOf('$', at)
    if (dollar === -1) {
      rest += value.slice(at)
      break
    }
    rest += value.slice(at, dollar)
    const next = value[dollar + 1]
    if (next === '$' || next === '!') {
      rest += next
      at = dollar + 2
      continue
    }
    if (next === '{') {
      const end = value.indexOf('}', dollar + 2)
      const name = end === -1 ? '' : value.slice(dollar + 2, end)
      if (end !== -1 && NAME.test(name) && NAME.exec(name)![0] === name) {
        names.push(name)
        at = end + 1
        continue
      }
      rest += '$'
      at = dollar + 1
      continue
    }
    const name = NAME.exec(value.slice(dollar + 1))?.[0]
    if (name) {
      names.push(name)
      at = dollar + 1 + name.length
      continue
    }
    rest += '$'
    at = dollar + 1
  }
  return { names, rest }
}

/** A value Pi resolves from the environment alone, such as `${TOKEN}` or `Bearer ${TOKEN}`. */
function onlyReferences(value: string): boolean {
  if (value.startsWith('!')) return false
  const { names, rest } = template(value)
  return names.length > 0 && /^\s*((bearer|basic|token)\s*)?$/i.test(rest)
}

/** Every variable an entry reads from the environment, each once. */
export function referencedNames(entry: PiServerEntry): string[] {
  const found = new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (!value.startsWith('!')) for (const name of template(value).names) found.add(name)
    } else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(entry)
  return [...found]
}

// Shapes of credentials that are hidden wherever they show up in text.
const SHAPES: RegExp[] = [
  /\bgh[opusr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{8,}/g,
  /\b[sprk]k_(live|test)_[A-Za-z0-9]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bya29\.[0-9A-Za-z_-]{10,}/g,
  /\b(sntrys|lin_api|ntn|secret)_[A-Za-z0-9_]{12,}/g,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
]

/** A long run of letters and digits with no word boundary in it: what an opaque key looks like. A path keeps its slashes and stays readable. */
const OPAQUE = /[A-Za-z0-9_+=-]{32,}/g
const looksOpaque = (run: string) => /[A-Za-z]/.test(run) && /[0-9]/.test(run)

/**
 * Text that is safe to show and to log: a message from a server or from Pi, with anything shaped like a credential
 * hidden, and with every value in `known` hidden wherever it appears, such as what an entry's variables hold.
 */
export function scrubText(text: string, known: readonly string[] = []): string {
  let safe = text
  for (const value of known) if (value.length >= 4) safe = safe.split(value).join(HIDDEN)
  for (const shape of SHAPES) safe = safe.replace(shape, HIDDEN)
  safe = safe.replace(/\b(Bearer|Basic)\s+(?!\[hidden\])\S+/gi, `$1 ${HIDDEN}`)
  safe = safe.replace(NAMED_VALUE, (...match: unknown[]) => {
    const { name, separator } = match.at(-1) as { name: string; separator: string }
    return `${name}${separator}${HIDDEN}`
  })
  safe = safe.replace(/(\/\/[^\s/:@]+:)[^\s/@]+@/g, `$1${HIDDEN}@`)
  safe = safe.replace(OPAQUE, (run) => (looksOpaque(run) ? HIDDEN : run))
  return safe
}

/** An address with its password and its secret query values hidden. An address that does not parse is treated as text. */
function scrubAddress(text: string): string {
  if (!URL.canParse(text)) return scrubText(text)
  const url = new URL(text)
  let changed = false
  if (url.password) {
    url.password = 'hidden'
    changed = true
  }
  for (const [key] of url.searchParams) {
    if (SECRET_NAME.test(key) || /^(key|sig|signature|code|auth)$/i.test(key)) {
      url.searchParams.set(key, 'hidden')
      changed = true
    }
  }
  // URL writes its own escapes. The marker goes in afterwards, so it reads as it does everywhere else.
  const written = changed ? url.href.replace(/:hidden@/, `:${HIDDEN}@`).replace(/=hidden(?=&|$|#)/g, `=${HIDDEN}`) : text
  return scrubText(written)
}

/** Arguments of a command, with the value after a secret option, a secret `--option=value`, and anything shaped like a key hidden. */
function scrubArgs(args: readonly unknown[]): unknown[] {
  return args.map((arg, index) => {
    if (typeof arg !== 'string') return arg
    const before = args[index - 1]
    if (typeof before === 'string' && /^-{1,2}[\w-]+$/.test(before) && SECRET_NAME.test(before)) return HIDDEN
    const option = /^(-{1,2}[\w-]+)=(.*)$/.exec(arg)
    if (option && SECRET_NAME.test(option[1]!)) return `${option[1]}=${HIDDEN}`
    return scrubText(arg)
  })
}

/** Values that may only be references: every header and every variable of a command's environment. */
function scrubValues(values: unknown): unknown {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return values
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' && onlyReferences(value) ? value : HIDDEN]))
}

function scrubAny(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (SECRET_NAME.test(key)) return onlyReferences(value) ? value : HIDDEN
    return value.startsWith('!') ? HIDDEN : scrubText(value)
  }
  if (Array.isArray(value)) return value.map((item) => scrubAny(item))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, scrubAny(item, name)]))
  return value
}

/**
 * The values written into an entry that `redactEntry` hides, so a message that repeats one can hide it too: header
 * and environment values that are not references (without a leading Bearer or Basic), a client secret, secret
 * command options, and the password of the address.
 */
export function writtenSecrets(entry: PiServerEntry): string[] {
  const found: string[] = []
  const add = (value: unknown) => {
    if (typeof value !== 'string' || onlyReferences(value) || value.startsWith('!')) return
    found.push(value, value.replace(/^\s*(bearer|basic|token)\s+/i, ''))
  }
  const record = entry as unknown as Record<string, unknown>
  for (const values of [record.headers, record.env]) if (values && typeof values === 'object') Object.values(values).forEach(add)
  add((record.oauth as { clientSecret?: unknown } | undefined)?.clientSecret)
  const args = Array.isArray(record.args) ? record.args : []
  args.forEach((arg, index) => {
    const before = args[index - 1]
    if (typeof before === 'string' && /^-{1,2}[\w-]+$/.test(before) && SECRET_NAME.test(before)) add(arg)
    const option = typeof arg === 'string' ? /^(-{1,2}[\w-]+)=(.*)$/.exec(arg) : null
    if (option && SECRET_NAME.test(option[1]!)) add(option[2])
  })
  if (typeof record.url === 'string' && URL.canParse(record.url)) {
    const url = new URL(record.url)
    if (url.password) add(decodeURIComponent(url.password))
    for (const [key, value] of url.searchParams) if (SECRET_NAME.test(key) || /^(key|sig|signature|code|auth)$/i.test(key)) add(value)
  }
  return [...new Set(found.filter((value) => value.trim().length >= 4))]
}

/**
 * The entry with every credential hidden: header and environment values that are not references, a client secret,
 * a password or secret query value in the address, secret command options, and any field named like a credential.
 * Everything else keeps its value and its place. The entry passed in is not changed.
 */
export function redactEntry(entry: PiServerEntry): PiServerEntry {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'url' && typeof value === 'string') out[key] = scrubAddress(value)
    else if (key === 'headers' || key === 'env') out[key] = scrubValues(value)
    else if (key === 'args' && Array.isArray(value)) out[key] = scrubArgs(value)
    else out[key] = scrubAny(value, key)
  }
  return out as unknown as PiServerEntry
}

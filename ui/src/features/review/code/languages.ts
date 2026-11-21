/**
 * Which language a file is, and where its grammar comes from. Each grammar is its own small file, fetched
 * the first time a file of that language is shown. Nothing here loads the highlighter itself.
 */
import type { LanguageRegistration } from 'shiki/core'

type Grammar = { default: LanguageRegistration[] }

export const GRAMMARS: Record<string, () => Promise<Grammar>> = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  // Shiki has neither: TLA+ models under `_specs/tla/` and the TLC config beside each.
  tlaplus: () => import('./grammars/tlaplus.ts'),
  'tlc-config': () => import('./grammars/tlc-config.ts'),
}

const BY_EXTENSION: Record<string, keyof typeof GRAMMARS> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  json: 'json', jsonc: 'json', md: 'markdown', mdx: 'markdown',
  css: 'css', html: 'html', htm: 'html', yml: 'yaml', yaml: 'yaml', toml: 'toml',
  rb: 'ruby', rake: 'ruby', py: 'python', rs: 'rust', go: 'go', swift: 'swift',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', sql: 'sql',
  tla: 'tlaplus', cfg: 'tlc-config',
}

/** The language of a file, by its extension. Null for a language that is not known: it shows as plain text. */
export function languageOf(path: string): string | null {
  const name = path.split('/').at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null) : null
}

const fetched = new Map<string, Promise<LanguageRegistration[]>>()

/** A language's grammar, fetched once. Null for a language that is not known. */
export function loadGrammar(language: string | null): Promise<LanguageRegistration[] | null> {
  if (!language || !GRAMMARS[language]) return Promise.resolve(null)
  if (!fetched.has(language)) fetched.set(language, GRAMMARS[language]!().then((grammar) => grammar.default))
  return fetched.get(language)!
}

/** The grammars fetched so far. */
export function fetchedGrammars(): string[] {
  return [...fetched.keys()]
}

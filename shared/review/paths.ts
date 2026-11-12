/** What a file is to a review, judged by its path, and for a script with no extension by the first line that names its language. */
export type FileRole = 'test' | 'code' | 'file'

// Ported from pi-coder's `isStoryTestPath`: a test folder anywhere in the path, or a test suffix on the name.
const TEST_PATH = /(?:^|\/)(?:test|tests|spec|specs|__tests__)\/|(?:[._](?:test|spec)|_tests)\.[^.]+$/

/** Extensions whose files hold declarations worth splitting into units. Everything else is prose, data or an asset. */
const CODE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx',
  'rb', 'rake', 'py', 'rs', 'go', 'swift', 'kt', 'kts', 'java', 'scala',
  'c', 'h', 'cc', 'cpp', 'hpp', 'm', 'mm', 'cs', 'php', 'lua', 'ex', 'exs', 'erl', 'clj', 'dart',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql',
  'vue', 'svelte', 'astro', 'erb', 'css', 'scss', 'sass', 'less', 'html',
])

export function extensionOf(path: string): string {
  const name = path.split('/').at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path)
}

/** The programs a script's shebang may name for the review to read it as code: Ruby and Node, as the call-graph scan does. */
const SCRIPT_PROGRAM = /^(?:ruby|jruby|truffleruby)[\d.]*$|^(?:node|nodejs|tsx|ts-node|bun|deno)$/

/**
 * Whether a first line names Ruby or Node to run the file: `#!/usr/bin/env ruby`, `#!/usr/bin/ruby`, `#!/usr/bin/env -S
 * node --no-warnings`. A shell, or any other program, does not: such a script stays a plain file.
 */
export function namesCodeShebang(firstLine: string | undefined): boolean {
  const match = /^#!\s*(\S+)(.*)$/.exec((firstLine ?? '').replace(/^\uFEFF/, '').trimEnd())
  if (!match) return false
  const words = [match[1]!.split('/').at(-1)!, ...match[2]!.trim().split(/\s+/).filter(Boolean)]
  const program = words[0] === 'env' ? words.slice(1).find((word) => !word.startsWith('-') && !word.includes('=')) : words[0]
  return program != null && SCRIPT_PROGRAM.test(program)
}

/** A file's role. `firstLine` is how a file with no extension, such as `bin/production-errors`, says it is code. */
export function fileRole(path: string, firstLine?: string): FileRole {
  const script = !fileName(path).includes('.') && namesCodeShebang(firstLine)
  if (!script && !CODE_EXTENSIONS.has(extensionOf(path))) return 'file'
  return isTestPath(path) ? 'test' : 'code'
}

export function fileName(path: string): string {
  return path.split('/').at(-1) ?? path
}

/** A file's name without its extension and without a test suffix: `parser.test.ts` and `parser.ts` share `parser`. */
export function fileStem(path: string): string {
  return fileName(path)
    .replace(/\.[^.]+$/, '')
    .replace(/[._](?:tests?|spec)$/, '')
}

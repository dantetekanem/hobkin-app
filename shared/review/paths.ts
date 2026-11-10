/** What a file is to a review, judged by its path alone. */
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

export function fileRole(path: string): FileRole {
  if (!CODE_EXTENSIONS.has(extensionOf(path))) return 'file'
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

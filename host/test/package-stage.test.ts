import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appPackage,
  classifyTarget,
  integrationEntries,
  leakedUserPaths,
  mapImport,
  nodeBinaryProblems,
  packageManifest,
  packageNameOf,
  referencesIn,
  stageArguments,
  undeclaredPackages,
} from '../../scripts/package/rules.ts'

test('finds what a source file loads, and leaves out what type stripping erases', () => {
  const source = [
    "import { readFileSync } from 'node:fs'",
    "import type { Review } from '#shared/review/types.ts'",
    "import { type Palette, paletteProblems } from '../../shared/protocol/appearance.ts'",
    'import {',
    '  Type,',
    '  type Static,',
    "} from 'typebox'",
    "export type { Units } from './units.ts'",
    "export * from './more.ts'",
    "import './side-effect.ts'",
    "const { openPiSession } = await import('hobkin/src/cli/pi-session.mjs')",
    "type Notices = typeof import('hobkin/src/cli/client-notices.mjs')",
    "const NOTE = readFileSync(new URL('./directions.md', import.meta.url), 'utf8')",
    "const help = import.meta.resolve('hobkin/src/prompts/help.md')",
    "const odd = new URL(`./${name}.md`, import.meta.url)",
    "export const words = 'this is not an import from here'",
  ].join('\n')

  assert.deepEqual(referencesIn(source), {
    modules: ['node:fs', '../../shared/protocol/appearance.ts', 'typebox', './more.ts', './side-effect.ts', 'hobkin/src/cli/pi-session.mjs'],
    urls: ['./directions.md'],
    resolved: ['hobkin/src/prompts/help.md'],
    computed: ['`./${name}.md`'],
  })
})

test('names the package a bare specifier belongs to', () => {
  assert.equal(packageNameOf('typebox/value'), 'typebox')
  assert.equal(packageNameOf('ws'), 'ws')
  assert.equal(packageNameOf('@earendil-works/pi-ai/dist/index.js'), '@earendil-works/pi-ai')
})

test('maps a # import through the package.json imports field', () => {
  const imports = { '#shared/*': './shared/*', '#exact': './exact.ts', '#conditional': { node: './node.ts' } }
  assert.equal(mapImport('#shared/review/types.ts', imports), './shared/review/types.ts')
  assert.equal(mapImport('#exact', imports), './exact.ts')
  assert.equal(mapImport('#conditional', imports), null, 'only plain string targets are understood')
  assert.equal(mapImport('#other/x.ts', imports), null)
  assert.equal(mapImport('#shared/x.ts', undefined), null)
})

test('sorts a file a source names next to itself into code, data, a known folder, or a problem', () => {
  assert.deepEqual(classifyTarget('host/src/scripted-main-child.ts'), { kind: 'code', path: 'host/src/scripted-main-child.ts' })
  assert.deepEqual(classifyTarget('host/src/claude-code/directions.md'), { kind: 'data', path: 'host/src/claude-code/directions.md' })
  assert.deepEqual(classifyTarget('package.json'), { kind: 'generated', path: 'package.json' })
  assert.deepEqual(classifyTarget(''), { kind: 'self', path: '' })
  assert.deepEqual(classifyTarget('ui/src/features/review/sample/'), {
    kind: 'folder',
    path: 'ui/src/features/review/sample/',
    files: ['ui/src/features/review/sample/review.json', 'ui/src/features/review/sample/files.json'],
  })
  assert.equal(classifyTarget('ui/src/other/').kind, 'problem')
  assert.equal(classifyTarget('../outside.md').kind, 'problem')
  assert.equal(classifyTarget('node_modules/ws/index.js').kind, 'problem')
})

test('writes the app package.json with only what the host imports, pinned', () => {
  const root = {
    name: 'hobkin-client',
    version: '0.1.19',
    type: 'module',
    engines: { node: '>=22.19.0' },
    imports: { '#shared/*': './shared/*' },
    scripts: { dev: 'vite' },
    dependencies: { react: '^19.3.1', ws: '^8.22.2', typebox: '^1.4.6', diff: '^9.0.0', hobkin: 'link:../hobkin' },
    devDependencies: { vite: '^8.3.6' },
  }
  assert.deepEqual(undeclaredPackages(['ws', 'left-pad'], root), ['left-pad'])
  assert.deepEqual(appPackage(root, { ws: '8.22.2', diff: '9.0.0', typebox: '1.4.6', hobkin: '0.1.6' }), {
    name: 'hobkin-client',
    version: '0.1.19',
    private: true,
    type: 'module',
    engines: { node: '>=22.19.0' },
    imports: { '#shared/*': './shared/*' },
    dependencies: { diff: '9.0.0', hobkin: '0.1.6', typebox: '1.4.6', ws: '8.22.2' },
  })
})

test('the manifest says what went in, and takes its time from the caller', () => {
  const manifest = packageManifest({
    createdAt: '2026-11-13T22:00:00.000Z',
    app: { name: 'hobkin-client', version: '0.1.19', commit: '39edb41', source: 'archive', uncommittedFiles: null },
    runtime: { name: 'hobkin', version: '0.1.6', commit: 'e8cdbc1', source: 'checkout', uncommittedFiles: 33 },
    node: { version: '26.3.1' },
    sizes: { node: 144511152, app: 2000 },
  })
  assert.deepEqual(manifest, {
    format: 1,
    createdAt: '2026-11-13T22:00:00.000Z',
    app: { name: 'hobkin-client', version: '0.1.19', commit: '39edb41', source: 'archive', uncommittedFiles: null },
    runtime: { name: 'hobkin', version: '0.1.6', commit: 'e8cdbc1', source: 'checkout', uncommittedFiles: 33 },
    node: { version: '26.3.1' },
    sizes: { app: 2000, node: 144511152 },
  })
  assert.throws(() => packageManifest({ ...manifest, createdAt: 'yesterday' }), /createdAt/)
})

test('a folder to stage from comes with the commit it holds', () => {
  assert.deepEqual(stageArguments([]), { time: null, client: null, runtime: null })
  assert.deepEqual(stageArguments(['--runtime', '/tmp/hobkin-at', '--runtime-commit', 'e8cdbc1', '--time', '2026-11-13T22:00:00Z']), {
    time: '2026-11-13T22:00:00.000Z',
    client: null,
    runtime: { dir: '/tmp/hobkin-at', commit: 'e8cdbc1' },
  })
  assert.throws(() => stageArguments(['--client', '/tmp/client-at']), /--client and --client-commit go together/)
  assert.throws(() => stageArguments(['--client-commit', '39edb41']), /--client and --client-commit go together/)
  assert.throws(() => stageArguments(['--client', '--client-commit', '39edb41']), /--client needs a value/)
  assert.throws(() => stageArguments(['--time', 'soon']), /ISO time/)
  assert.throws(() => stageArguments(['--check']), /Unknown option/)
})

const OFFICIAL = {
  file: '/x/node: Mach-O 64-bit executable arm64',
  libraries: [
    '/x/node:',
    '\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 150.0.0)',
    '\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0)',
    '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)',
  ].join('\n'),
  signature: ['Authority=Developer ID Application: Node.js Foundation (HX7739G8FX)', 'Authority=Apple Root CA', 'TeamIdentifier=HX7739G8FX'].join('\n'),
}

test('accepts only a standalone official arm64 Node', () => {
  assert.deepEqual(nodeBinaryProblems(OFFICIAL), [])
  assert.equal(nodeBinaryProblems({ ...OFFICIAL, file: '/x/node: Mach-O 64-bit executable x86_64' }).length, 1)
  const homebrew = { ...OFFICIAL, libraries: `${OFFICIAL.libraries}\n\t/opt/homebrew/opt/icu4c/lib/libicui18n.77.dylib (compatibility version 77.0.0)` }
  assert.match(nodeBinaryProblems(homebrew).join('\n'), /\/opt\/homebrew/)
  assert.equal(nodeBinaryProblems({ ...OFFICIAL, signature: 'Signature=adhoc\nTeamIdentifier=not set' }).length, 1)
})

test('finds a user folder in a staged file, but not a placeholder one', () => {
  assert.deepEqual(leakedUserPaths("home: '/Users/someone/.hobkin', cwd: '/Users/example/project'"), [])
  assert.deepEqual(leakedUserPaths('from /Users/alex/code and /Users/alex/code again, and /Users/sam/x'), ['/Users/alex', '/Users/sam'])
})

test('stages each integration folder\'s manifest and host part, and nothing else of it', () => {
  assert.deepEqual(
    integrationEntries(['github/host.ts', 'github/integration.ts', 'github/window.tsx', 'github/test/host.test.ts', 'github/host/state.ts', 'github/window/Card.tsx', 'echo/integration.ts', 'README.md', 'Bad_Name/host.ts']),
    ['integrations/echo/integration.ts', 'integrations/github/host.ts', 'integrations/github/integration.ts'],
  )
  assert.deepEqual(integrationEntries([]), [])
})

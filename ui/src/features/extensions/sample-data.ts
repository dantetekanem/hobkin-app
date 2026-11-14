import type { ExtensionEntry, ExtensionsState, PiPackage } from '#shared/pi-resources/wire.ts'

/**
 * Pi's packages and extensions for a window with no host, labelled as sample data on screen. Nothing here is read
 * from Pi, and a switch changes only this list.
 */

const extension = (path: string, name: string, from: ExtensionEntry['from'], on = true): ExtensionEntry => ({ path, name, file: path, on, from })

const pkg = (shape: Omit<PiPackage, 'installed' | 'pinned' | 'skills'> & Partial<Pick<PiPackage, 'installed' | 'pinned' | 'skills'>>): PiPackage => ({
  installed: true,
  pinned: false,
  skills: 0,
  ...shape,
})

const NPM = '~/.pi/agent/npm/node_modules'

export const SAMPLE_EXTENSIONS: ExtensionsState = {
  settings: '~/.pi/agent/settings.json',
  packages: [
    pkg({
      source: 'npm:pi-web-access',
      name: 'pi-web-access',
      kind: 'npm',
      version: '1.3.0',
      folder: `${NPM}/pi-web-access`,
      update: 'available',
      extensions: [extension(`${NPM}/pi-web-access/index.ts`, 'pi-web-access/index.ts', 'package')],
    }),
    pkg({
      source: 'npm:pi-memory',
      name: 'pi-memory',
      kind: 'npm',
      version: '0.9.2',
      folder: `${NPM}/pi-memory`,
      update: 'none',
      skills: 1,
      extensions: [extension(`${NPM}/pi-memory/extensions/memory.ts`, 'memory.ts', 'package')],
    }),
    pkg({
      source: 'https://github.com/example/pi-research',
      name: 'github.com/example/pi-research',
      kind: 'git',
      version: '2.0.1',
      folder: '~/.pi/agent/git/github.com/example/pi-research',
      update: 'none',
      skills: 2,
      extensions: [
        extension('~/.pi/agent/git/github.com/example/pi-research/extensions/research.ts', 'research.ts', 'package'),
        extension('~/.pi/agent/git/github.com/example/pi-research/extensions/dashboard.ts', 'dashboard.ts', 'package', false),
      ],
    }),
    pkg({
      source: '../../Projects/pi-tools',
      name: 'pi-tools',
      kind: 'local',
      version: '0.3.0',
      folder: '~/Projects/pi-tools',
      update: null,
      extensions: [extension('~/Projects/pi-tools/index.ts', 'pi-tools/index.ts', 'package')],
    }),
    pkg({
      source: 'npm:pi-compact@1.3.3',
      name: 'pi-compact',
      kind: 'npm',
      version: '1.3.3',
      folder: `${NPM}/pi-compact`,
      pinned: true,
      update: null,
      extensions: [extension(`${NPM}/pi-compact/index.ts`, 'pi-compact/index.ts', 'package')],
    }),
    pkg({ source: 'npm:pi-themes', name: 'pi-themes', kind: 'npm', version: '4.0.0', folder: `${NPM}/pi-themes`, update: 'none', extensions: [] }),
  ],
  own: [extension('~/.pi/agent/extensions/clock/index.ts', 'clock/index.ts', 'folder', false)],
  builtIn: ['llama.cpp', 'codemode', 'tool-search', 'mcp'].map((name) => ({ path: `builtin:${name}`, name, file: null, on: true, from: 'built-in' as const })),
  updates: { checking: false, checkedAt: '2026-11-13T21:40:00.000Z' },
  problems: [],
  readAt: null,
  error: null,
}

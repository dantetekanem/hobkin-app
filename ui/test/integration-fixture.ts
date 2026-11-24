import { GitPullRequest } from 'lucide-react'
import { Type } from 'typebox'
import { defineIntegration } from '#shared/integration/manifest.ts'
import type { WindowPart } from '../src/integration/contract.ts'
import { setWindowParts } from '../src/integration/registry.ts'

/** A made-up integration with one screen, for tests of the shell. Its id is `github` so places saved by the window before parts still name it. */
export const fixturePart: WindowPart<{ lines: number }> = {
  manifest: defineIntegration({
    id: 'github',
    name: 'Fixture',
    line: 'A test integration',
    commands: { 'github.refresh': { description: 'Read again.', runs: 'host', args: Type.Object({}, { additionalProperties: false }) } },
    screens: [{ id: 'github', label: 'GitHub', line: 'A page of its own', keywords: ['fixture'] }],
  }),
  unknown: { lines: -1 },
  sample: () => ({ lines: 3 }),
  screens: [{ id: 'github', icon: GitPullRequest, component: () => null }],
}

/** Hands the window the fixture part, as `loaded.ts` hands it the real ones. */
export const withFixturePart = (): void => setWindowParts([fixturePart])

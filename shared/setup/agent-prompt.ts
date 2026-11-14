import { scrubText } from '../integrations/redact.ts'
import type { PiSetup } from '../protocol/setup.ts'
import { PI_PACKAGES } from './pi-packages.ts'

/**
 * The last resort of the first-run setup (025-onboarding): a prompt the user hands to a coding agent when hobkin
 * cannot install Pi itself. It says what hobkin needs, where hobkin looks for programs, and what went wrong, and
 * lets the agent fix whatever stands in the way. Built only from what the host said about Pi and the failure's text,
 * so it holds nothing about the user, and the failure is scrubbed again of secrets and of the home folder's name.
 */

/** The oldest Node the pinned Pi runs on, from its package.json (Pi 1.5.0: `"engines": { "node": ">=22.19.0" }`). */
export const PI_NODE = '22.19'

/** Where `programPlaces` in the host looks after the PATH, with `~` for the home. */
const PLACES = '~/Library/pnpm, ~/.npm-global/bin, /opt/homebrew/bin and /usr/local/bin'

function nodeSaid({ canInstall, node }: PiSetup): string {
  const version = node?.version
  if (canInstall) return version ? `hobkin found Node ${version} with npm.` : 'hobkin found npm.'
  if (!node) return 'hobkin found no npm on this Mac.'
  if (!node.found) return 'hobkin found no Node on this Mac.'
  return version ? `hobkin found Node ${version}, but no npm beside it.` : 'hobkin found a Node that does not say its version, and no npm beside it.'
}

/** What a failure said, without secrets, with `~` for any home folder, and without fences that would end the prompt's own. */
const cleaned = (failure: string) =>
  scrubText(failure)
    .replace(/\/Users\/[^/\s]+/g, '~')
    .replaceAll('```', "'''")
    .trim()

export function agentPrompt(pi: PiSetup, failure: string | null): string {
  const needs = [`- Node ${PI_NODE} or newer, with npm. ${nodeSaid(pi)}`]
  if (!pi.installed || !pi.matches) {
    const found = pi.installed ? `hobkin found Pi ${pi.version ?? 'that does not say its version'}.` : 'hobkin found no `pi` program.'
    needs.push(`- Pi ${pi.pinned}, installed with exactly this command: \`${pi.installCommand}\`. ${found}`)
  }
  const missing = PI_PACKAGES.filter(({ name }) => pi.packages.some((entry) => entry.name === name && !entry.installed))
  if (missing.length) {
    needs.push('- These Pi packages, each installed with its command once Pi is there:', ...missing.map(({ source }) => `  - \`pi install ${source}\``))
  }

  let saw: string[] = []
  if (failure?.trim()) saw = ['The last install failed with this:', '', '```text', cleaned(failure), '```', '']
  else if (!pi.canInstall) saw = ['hobkin did not try to install anything, since it found no npm to install with.', '']

  return [
    'hobkin is a desktop app on this Mac. It runs on Pi, a coding agent, which it starts as the `pi` program. Its first-run setup could not install what Pi needs. Set up this Mac so hobkin finds all of it.',
    '',
    'hobkin needs:',
    ...needs,
    '',
    `hobkin looks for programs on the PATH it gets from the login shell (\`$SHELL -ilc\` printing \`$PATH\`), then in ${PLACES}, and in client/node/bin inside hobkin's home (~/.hobkin), where it keeps a Node of its own. A program installed anywhere else needs its folder on the login shell's PATH.`,
    '',
    ...saw,
    "You may change whatever stands in the way on this Mac: install or update Node and npm, fix npm's settings, permissions or cache, or fix the shell's PATH. When you are done, check that `node --version`, `npm --version` and `pi --version` work in a new login shell.",
    'Then tell the person to press Look again in hobkin.',
  ].join('\n')
}

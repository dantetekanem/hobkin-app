import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aboutUser, readProfile } from './profile.mjs';
import { aboutSetup, readSetupFacts } from './setup-facts.mjs';

const MAX_BYTES = 65536;
const DEFAULT_DIRECTIONS = new URL('../prompts/agents-default.md', import.meta.url);

export const directionsPath = root => join(root, 'AGENTS.md');

/** Who every agent here works for and how it should work, as the user last left it. Memory holds what matters now; this holds how to work. */
export function readDirections(root) {
  const file = directionsPath(root);
  if (!existsSync(file)) writeFileSync(file, readFileSync(DEFAULT_DIRECTIONS, 'utf8'), { mode: 0o600 });
  const stat = lstatSync(file);
  const tooLarge = () => Error(`AGENTS.md must be a regular file within ${MAX_BYTES} bytes; directions were not truncated.`);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw tooLarge();
  const bytes = readFileSync(file);
  if (bytes.length > MAX_BYTES) throw tooLarge();
  const directions = bytes.toString('utf8');
  // The setup answers sit outside the cap on AGENTS.md: their own limits keep them small.
  const about = [aboutUser(readProfile(root)), aboutSetup(readSetupFacts(root))].filter(Boolean);
  return about.length ? `${about.join('\n\n')}\n\n${directions}` : directions;
}

export const directionsSection = text => `## Directions\n\nThese are the user's standing directions, from AGENTS.md in the data root.\n\n${text}`;

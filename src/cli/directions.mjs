import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aboutUser, readProfile } from './profile.mjs';
import { aboutSetup, readSetupFacts } from './setup-facts.mjs';

const MAX_BYTES = 16384;
const DEFAULT_DIRECTIONS = new URL('../prompts/agents-default.md', import.meta.url);

export const directionsPath = root => join(root, 'AGENTS.md');

/** Who every agent here works for and how it should work, as the user last left it. Memory holds what matters now; this holds how to work. */
export function readDirections(root) {
  const file = directionsPath(root);
  if (!existsSync(file)) writeFileSync(file, readFileSync(DEFAULT_DIRECTIONS, 'utf8'), { mode: 0o600 });
  const directions = readFileSync(file).subarray(0, MAX_BYTES).toString('utf8');
  // The setup answers sit outside the cap on AGENTS.md: their own limits keep them small.
  const about = [aboutUser(readProfile(root)), aboutSetup(readSetupFacts(root))].filter(Boolean);
  return about.length ? `${about.join('\n\n')}\n\n${directions}` : directions;
}

export const directionsSection = text => `## Directions\n\nThese are the user's standing directions, from AGENTS.md in the data root.\n\n${text}`;

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 16384;
const DEFAULT_DIRECTIONS = new URL('../prompts/agents-default.md', import.meta.url);

export const directionsPath = root => join(root, 'AGENTS.md');

/** How every agent here should work, as the user last left it. Memory holds what matters now; this holds how to work. */
export function readDirections(root) {
  const file = directionsPath(root);
  if (!existsSync(file)) writeFileSync(file, readFileSync(DEFAULT_DIRECTIONS, 'utf8'), { mode: 0o600 });
  return readFileSync(file).subarray(0, MAX_BYTES).toString('utf8');
}

export const directionsSection = text => `## Directions\n\nThese are the user's standing directions, from AGENTS.md in the data root.\n\n${text}`;

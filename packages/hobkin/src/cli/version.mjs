import { readFileSync } from 'node:fs';

/** The version hobkin runs, from its package.json, which the changelog's numbered sections follow. */
export const HOBKIN_VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

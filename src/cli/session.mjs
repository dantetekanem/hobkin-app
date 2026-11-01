import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extensionPaths } from './pi-extensions.mjs';
import { insideHerdr, WorkPanes } from './work/panes.mjs';

const TAB_LABEL = 'Hobkin';
const MAX_TITLE_LENGTH = 20;

const sessionName = title => {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, MAX_TITLE_LENGTH).replace(/^-|-$/g, '');
  return `hobkin-${words || 'session'}-${randomBytes(2).toString('hex')}`;
};

export function requireHerdr(env = process.env) {
  if (!insideHerdr(env)) throw Error('Not inside Herdr, so do this work here.');
}

export async function readBrief(input) {
  const pieces = [];
  for await (const piece of input) pieces.push(Buffer.from(piece));
  return Buffer.concat(pieces).toString('utf8');
}

// A brief can hold a whole conversation, and only a short line fits through a terminal.
function saveBrief(root, name, brief) {
  const folder = join(root, 'runtime', 'handoffs');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, `${name}.md`);
  writeFileSync(file, brief, { mode: 0o600 });
  return file;
}

/** Hands massive work or a whole conversation to a full Pi session the user can watch and carry on in. Nothing waits for it. */
export async function startSession({ root, title = 'session', cwd = process.cwd(), brief, env = process.env, panes = new WorkPanes({ tab: TAB_LABEL, extensionsFor: extensionPaths }) }) {
  requireHerdr(env);
  if (!brief.trim()) throw Error('A session needs a brief: pipe in what to do, what is known and what finished looks like.');
  const name = sessionName(title);
  return panes.startSession({ name, cwd: resolve(cwd), brief: saveBrief(root, name, brief) });
}

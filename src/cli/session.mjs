import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { insideHerdr, WorkPanes } from './work/panes.mjs';

const TAB_LABEL = 'Hobkin';
const MAX_TITLE_LENGTH = 20;

const sessionName = title => {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, MAX_TITLE_LENGTH).replace(/^-|-$/g, '');
  return `hobkin-${words || 'session'}-${randomBytes(2).toString('hex')}`;
};

export async function readBrief(input) {
  let text = '';
  for await (const chunk of input) text += chunk;
  return text;
}

/** Hands massive work to a full Pi session the user can watch and carry on in. Nothing waits for it. */
export function startSession({ title = 'session', cwd = process.cwd(), brief, env = process.env, panes = new WorkPanes({ tab: TAB_LABEL }) }) {
  if (!insideHerdr(env)) return Promise.reject(Error('Not inside Herdr, so do this work here.'));
  if (!brief.trim()) return Promise.reject(Error('A session needs a brief: pipe in what to do, what is known and what finished looks like.'));
  return panes.startSession({ name: sessionName(title), cwd: resolve(cwd), brief });
}

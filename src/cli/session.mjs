import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectedLessons } from './learning/store.mjs';
import { insideHerdr, SESSION_TAB, WorkPanes } from './work/panes.mjs';

const MAX_TITLE_LENGTH = 20;
const followScript = fileURLToPath(new URL('./session-follow.mjs', import.meta.url));

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

const handoffs = root => join(root, 'runtime', 'handoffs');
const finishing = report => `\n\n## When you finish\n\nWrite a short report of what you did to \`${report}\`, then stop. Hobkin closes this pane when that file appears.\n`;

// A brief can hold a whole conversation, and only a short line fits through a terminal.
function saveBrief(root, name, brief, report) {
  const folder = handoffs(root);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, `${name}.md`);
  const lessons = injectedLessons(root);
  const learned = lessons.length ? `\n\n## Learned\n\n${lessons.join('\n')}\n` : '';
  writeFileSync(file, `${brief}${learned}${report ? finishing(report) : ''}`, { mode: 0o600 });
  return file;
}

/** The command that starts a session returns at once and the work can take hours, so a process of its own waits to close the pane. */
export function followInBackground({ name, pane, report, kind }) {
  const follower = spawn(process.execPath, [followScript, name, pane, ...(report ? [report] : []), ...(kind ? [kind] : [])], { detached: true, stdio: 'ignore' });
  follower.unref();
}

/**
 * Hands massive work to a full Pi session the user can watch. Nothing waits for it, and `follow` closes its pane when it ends.
 * `keep` is for a whole conversation the user means to carry on in, which stays open until they close it.
 */
export async function startSession({ root, title = 'session', cwd = process.cwd(), brief, keep = false, follow = () => {}, env = process.env, panes = new WorkPanes({ tab: SESSION_TAB }) }) {
  requireHerdr(env);
  if (!brief.trim()) throw Error('A session needs a brief: pipe in what to do, what is known and what finished looks like.');
  const name = sessionName(title);
  const report = keep ? null : join(handoffs(root), `${name}.report.md`);
  const started = await panes.startSession({ name, cwd: resolve(cwd), brief: saveBrief(root, name, brief, report) });
  if (keep) return started;

  const session = { ...started, report };
  follow(session);
  return session;
}

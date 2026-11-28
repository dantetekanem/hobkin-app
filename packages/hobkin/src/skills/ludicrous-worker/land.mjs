#!/usr/bin/env node
/**
 * `land`: how a Ludicrous agent commits (076, Commits). It makes the commit in a private index from the branch head with only the paths its
 * packet owns and its own trail, then moves the branch with a compare-and-swap (`git update-ref <branch> <new> <old>`), and makes the commit
 * again on the new head when another agent landed first. It refuses, and writes why in the trail, when a path it would write changed on the
 * branch since the agent read it, so no commit ever writes over another agent's change. It runs no check.
 *
 *   land <packet> <message> [--read <commit>]     a worker's packet: its paths in the area's queue, and its trail
 *   land leader <message> [--read <commit>]       the area's leader: its queue, status, notes and spec, and what the plan gives it
 *
 * The conductor sets LUDICROUS_BRANCH, LUDICROUS_AREA and LUDICROUS_READ, the branch head when the agent started. It runs in the project's folder.
 */
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MOST_TRIES = 50;
const LEADER = 'leader';
const trails = area => `_specs/ludicrous/trails/${area}`;

class Refused extends Error {}

const git = async (args, env = {}) => (await exec('git', args, {
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
  maxBuffer: 64 * 1024 * 1024,
})).stdout.trim();
const short = commit => commit.slice(0, 12);
const literal = path => `:(literal)${path}`;
const pause = () => new Promise(done => setTimeout(done, 5 + Math.random() * 40));

function readLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap(line => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

function assertInside(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || normalize(path).split('/').includes('..')) throw new Refused(`${path} is not a path inside the project.`);
  return normalize(path).replace(/\/$/, '');
}

/** What this agent owns: a packet's paths as its leader wrote them, or a leader's own files. Its trail is always its own. */
function ownedPaths(area, id) {
  if (id === LEADER) {
    const plan = JSON.parse(existsSync('_specs/ludicrous/plan.json') ? readFileSync('_specs/ludicrous/plan.json', 'utf8') : '{}');
    const given = plan.areas?.find(each => each.id === area)?.leaderPaths ?? [];
    return [...['queue.jsonl', 'status.json', 'leader.md'].map(name => `${trails(area)}/${name}`), `_specs/${area}`, ...given].map(assertInside);
  }
  // A leader that writes a packet again changes it, so the last line for an id is the packet.
  const packet = readLines(`${trails(area)}/queue.jsonl`).filter(each => each?.id === id).at(-1);
  if (!packet) throw new Refused(`${id} is not in the ${area} area's queue, so there is nothing of yours to land.`);
  if (!Array.isArray(packet.paths) || !packet.paths.length) throw new Refused(`${id} owns no paths in the ${area} area's queue.`);
  return [...packet.paths, `${trails(area)}/${id}.md`].map(assertInside);
}

async function authorEnv() {
  const named = await git(['config', 'user.name']).catch(() => '');
  if (named) return {};
  const who = { name: 'hobkin Ludicrous', email: 'ludicrous@hobkin.invalid' };
  return { GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email };
}

/** The paths that are in the folder or at the head, since `git add` refuses one that is in neither. */
async function present(paths, head) {
  const kept = [];
  for (const path of paths) {
    if (existsSync(path) || await git(['ls-tree', '-r', '--name-only', head, '--', literal(path)])) kept.push(path);
  }
  return kept;
}

/** Puts the shared index right for what landed, so `git status` there shows only what is still not committed. Another agent may hold it. */
async function refreshIndex(branch, paths) {
  if (await git(['symbolic-ref', '-q', 'HEAD']).catch(() => '') !== `refs/heads/${branch}`) return;
  for (let tries = 0; tries < 5; tries += 1) {
    if (await git(['reset', '-q', '--', ...paths.map(literal)]).then(() => true, () => false)) return;
    await pause();
  }
}

export async function land({ id, message, read, branch, area }) {
  if (!branch || !area) throw new Refused('land runs only in a Ludicrous run, which names its branch and area.');
  if (!read) throw new Refused('Say which commit you read the branch at, with --read.');
  if (!message?.trim()) throw new Refused('Say what this commit does.');
  const owned = ownedPaths(area, id);
  const author = await authorEnv();
  const scratch = mkdtempSync(join(tmpdir(), 'ludicrous-land-'));
  try {
    for (let tries = 0; tries < MOST_TRIES; tries += 1) {
      const head = await git(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]);
      const changed = head === read ? [] : (await git(['diff', '--name-only', read, head, '--', ...owned.map(literal)])).split('\n').filter(Boolean);
      if (changed.length) throw new Refused(changed.join(', '), { cause: { read, head, changed } });

      const index = { GIT_INDEX_FILE: join(scratch, `index-${tries}`) };
      await git(['read-tree', head], index);
      const paths = await present(owned, head);
      if (paths.length) await git(['add', '-A', '--', ...paths.map(literal)], index);
      const tree = await git(['write-tree'], index);
      if (tree === await git(['rev-parse', `${head}^{tree}`])) return { landed: null, head };

      const commit = await git(['commit-tree', tree, '-p', head, '-m', `${message.trim()}\n\nPacket: ${id === LEADER ? `${area} leader` : id}`], author);
      // The compare-and-swap: it moves only from the head this commit was made on.
      if (await git(['update-ref', '-m', `land ${id}`, `refs/heads/${branch}`, commit, head]).then(() => true, () => false)) {
        await refreshIndex(branch, paths);
        return { landed: commit, head: commit };
      }
      await pause();
    }
    throw Error(`The branch kept moving, so ${id} did not land after ${MOST_TRIES} tries. Run land again.`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A refusal for a path that changed since it was read, in the trail and on stderr. */
function refuse(area, id, error) {
  const { read, head, changed } = error.cause ?? {};
  if (!changed) return error.message;
  const them = changed.length === 1 ? 'it' : 'them';
  const trail = id === LEADER ? `${trails(area)}/leader.md` : `${trails(area)}/${id}.md`;
  appendFileSync(trail, `\n## Refused\n\n${changed.join(', ')} changed on the branch since ${short(read)}, by ${short(head)}. Nothing of this packet landed.\n`);
  return `${changed.join(', ')} changed on the branch since you read ${them} at ${short(read)}. Read ${them} again, then land with --read ${head}.`;
}

async function main(argv) {
  const [id, message, ...rest] = argv;
  const flag = rest.indexOf('--read');
  const read = flag >= 0 ? rest[flag + 1] : process.env.LUDICROUS_READ;
  const area = process.env.LUDICROUS_AREA;
  try {
    const { landed, head } = await land({ id, message, read, branch: process.env.LUDICROUS_BRANCH, area });
    process.stdout.write(landed ? `Landed ${id} as ${landed}.\n` : `Nothing of ${id} differs from ${short(head)}, so nothing landed.\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    process.stderr.write(`${refuse(area, id, error)}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  process.exitCode = await main(process.argv.slice(2));
}

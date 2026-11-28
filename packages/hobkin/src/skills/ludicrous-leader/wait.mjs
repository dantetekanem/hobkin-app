#!/usr/bin/env node
/**
 * `wait`: how a Ludicrous leader waits for its workers without spending tokens (076, Building). It returns when its area changed since the
 * last time it looked: new commits of the area's packets, new or changed trails, a trail of another area that names this one under Needs, a
 * packet that failed or came back, or fewer ready packets than `--low` (2). After `--most` milliseconds (ten minutes) it returns anyway.
 * What it saw is kept in the run's folder, so each wait reports only what is new.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const { LUDICROUS_BRANCH: branch, LUDICROUS_AREA: area, LUDICROUS_RUN: run } = process.env;
const POLL_MS = Number(process.env.LUDICROUS_WAIT_POLL_MS ?? 3000);
const OWN = new Set(['queue.jsonl', 'status.json', 'leader.md']);
const TRAILS = '_specs/ludicrous/trails';

const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? Number(process.argv[at + 1]) : fallback;
};
const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const git = async args => (await exec('git', args, { maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
const queue = () => {
  const file = join(TRAILS, area, 'queue.jsonl');
  const packets = new Map();
  for (const line of existsSync(file) ? readFileSync(file, 'utf8').split('\n') : []) {
    try {
      const packet = line.trim() ? JSON.parse(line) : null;
      if (packet?.id) packets.set(packet.id, packet);
    } catch {
      // A torn line is read next time.
    }
  }
  return [...packets.values()];
};

const isFolder = path => existsSync(path) && statSync(path).isDirectory();
const otherAreas = () => (existsSync(TRAILS) ? readdirSync(TRAILS) : []).filter(other => other !== area && isFolder(join(TRAILS, other)));
const trailsOf = other => readdirSync(join(TRAILS, other)).filter(name => name.endsWith('.md') && !OWN.has(name));

/** The lines under a trail's "## Needs" that name this area, each with the trail it came from. */
function needsIn(other, name) {
  const text = readFileSync(join(TRAILS, other, name), 'utf8');
  const section = text.split(/\n## Needs\n/)[1]?.split(/\n## /)[0] ?? '';
  const named = `- ${area}:`;
  return section.split('\n').filter(line => line.startsWith(named)).map(line => `${other}/${name}: ${line.slice(named.length).trim()}`);
}

/** What the leader can see of its area now. */
async function look() {
  const head = await git(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]);
  const folder = join(TRAILS, area);
  const trails = Object.fromEntries((existsSync(folder) ? readdirSync(folder) : []).filter(name => name.endsWith('.md') && !OWN.has(name))
    .map(name => [name, statSync(join(folder, name)).mtimeMs]));
  const needs = otherAreas().flatMap(other => trailsOf(other).flatMap(name => needsIn(other, name)));
  const states = readJson(join(run, 'packets.json'), {});
  const mine = queue();
  const packets = Object.fromEntries(mine.filter(packet => states[packet.id]).map(packet => [packet.id, states[packet.id].state]));
  const ready = mine.filter(packet => !packet.cancelled && (!states[packet.id] || states[packet.id].state === 'back')).length;
  return { head, trails, needs, packets, ready };
}

async function newCommits(from, to) {
  if (!from || from === to) return [];
  const ids = new Set(queue().map(packet => packet.id));
  const listed = await git(['log', '--format=%h%x1f%s%x1f%(trailers:key=Packet,valueonly,separator=%x1e)', `${from}..${to}`]);
  return listed.split('\n').filter(Boolean).map(line => line.split('\x1f')).filter(([, , packet]) => ids.has(packet.trim())).map(([hash, subject]) => `${hash} ${subject}`);
}

/** The lines that say what changed between two looks, empty when nothing did. */
async function changes(before, now, low) {
  const lines = [];
  for (const commit of await newCommits(before.head, now.head)) lines.push(`Landed: ${commit}`);
  for (const [name, time] of Object.entries(now.trails)) if (before.trails?.[name] !== time) lines.push(`Trail ${before.trails?.[name] ? 'changed' : 'new'}: ${TRAILS}/${area}/${name}`);
  for (const need of now.needs) if (!before.needs?.includes(need)) lines.push(`Needs ${area}: ${need}`);
  for (const [id, state] of Object.entries(now.packets)) {
    if (before.packets?.[id] !== state && ['failed', 'back'].includes(state)) lines.push(`Packet ${id} is ${state === 'failed' ? 'failed: it ended three times without landing' : 'back in the queue'}.`);
  }
  if (now.ready < low) lines.push(`${now.ready} ready ${now.ready === 1 ? 'packet' : 'packets'} left in the queue.`);
  return lines;
}

async function main() {
  if (!branch || !area || !run) {
    process.stderr.write('wait runs only for a Ludicrous leader.\n');
    return 1;
  }
  const low = option('--low', 2);
  const until = Date.now() + option('--most', 600000);
  const seenFile = join(run, 'leaders', `${area}.json`);
  // A leader's first wait looks from now.
  const before = readJson(seenFile, null) ?? await look();
  for (;;) {
    const now = await look();
    const lines = await changes(before, now, low);
    if (lines.length || Date.now() >= until) {
      mkdirSync(join(run, 'leaders'), { recursive: true });
      writeFileSync(seenFile, JSON.stringify(now));
      process.stdout.write(lines.length ? `${lines.join('\n')}\n` : 'Nothing changed in your area while you waited.\n');
      return 0;
    }
    await new Promise(done => setTimeout(done, POLL_MS));
  }
}

process.exitCode = await main();

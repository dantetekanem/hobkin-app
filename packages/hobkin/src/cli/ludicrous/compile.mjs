import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { atomicJson } from '../config.mjs';
import { dropReport, readReport, saveReport } from '../reports.mjs';
import { readJson } from '../work/store.mjs';
import { ghWithin } from '../work/unmerged.mjs';
import { readPlan, stepsOf, trailsOf } from './areas.mjs';
import { buildingMs, ludicrousRoot } from './run.mjs';

/**
 * The compile's code (076): the facts the compile agent is given, the report when the agent leaves none, the report in Reports, the trails
 * folded into each area's notes once the run is done, and the branch pushed with its one pull request, opened as a draft after a stop, or
 * updated when it is open already. Nothing here merges.
 */

const exec = promisify(execFile);
const git = async (folder, args) => (await exec('git', ['-C', folder, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
const PUSH_TIMEOUT_MS = 600000;
const defaultGh = ghWithin(120000);
const indexFile = root => join(ludicrousRoot(root), 'reports.json');
export const reportFile = directory => join(directory, 'report.md');

const hours = ms => {
  const minutes = Math.round(ms / 60000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

/** What hobkin counted, for the compile agent and the report. */
export function factsOf(run, now = Date.now()) {
  return [
    `- Agents spawned: ${run.spawned}, at most ${run.tier} at once.`,
    `- Time building: ${hours(buildingMs(run, now))}.`,
    `- Tokens: ${(run.tokens ?? 0).toLocaleString('en-US')}.`,
  ].join('\n');
}

/** The report hobkin writes itself when the compile agent leaves none: each area's steps, and the counts. */
export function plainReport(run, { saved = [], now = Date.now() } = {}) {
  const areas = readableAreas(run.folder);
  const rows = areas.map(area => {
    const { done, total } = stepsOf(run.folder, area.id);
    const left = total - done ? `${total - done} steps` : 'nothing';
    return `| ${area.name} | ${done} of ${total} | ${left} |`;
  });
  const table = rows.length ? ['| Area | Steps checked | Left |', '| --- | --- | --- |', ...rows, '', ''].join('\n') : '';
  const patches = saved.length ? saved.map(({ packet, patch }) => `- ${packet ?? 'the rest'}: ${patch}`).join('\n') : '- None.';
  return [
    `Ludicrous built ${run.name} on ${run.branch}. The compile agent wrote no report, so hobkin wrote this one from the specs' boxes.`,
    '',
    `${table}<details><summary>What hobkin counted</summary>`,
    '',
    factsOf(run, now),
    '',
    'Unfinished work saved as patches, not in the branch:',
    patches,
    '',
    '</details>',
    '',
  ].join('\n');
}

/** The plan's areas, or none when the plan cannot be read: the report is still written. */
function readableAreas(folder) {
  try {
    return readPlan(folder)?.areas ?? [];
  } catch {
    return [];
  }
}

/** The run's report, kept in Reports under one id for the run: a later compile of the same run replaces it. */
export function fileReport(root, run, body, now = Date.now()) {
  const at = new Date(now).toISOString();
  const id = `ludicrous:${run.id}:${at}`;
  saveReport(root, id, body);
  const index = readJson(indexFile(root), {});
  const before = index[run.id];
  atomicJson(indexFile(root), { ...index, [run.id]: { id, title: `Ludicrous on ${run.name}`, at, slug: run.slug } });
  if (before?.id && before.id !== id) dropReport(root, before.id);
  return id;
}

/** Each run's report as Reports lists it, unless the user deleted it. */
export function ludicrousReports(root, deleted = new Set()) {
  return Object.values(readJson(indexFile(root), {})).flatMap(({ id, title, at, slug }) => {
    if (deleted.has(id)) return [];
    const body = readReport(root, id, null);
    return body === null ? [] : [{ id, title, scheduleId: `work.${slug}.ludicrous`, at, body, outcome: 'completed' }];
  });
}

/**
 * Done: each area's trails fold into its `_specs/<area>/notes.md`, and the last commit removes `_specs/ludicrous/trails/`, so the branch
 * keeps what was learned and not the scaffolding.
 */
export async function foldTrails(run) {
  const plan = readPlan(run.folder);
  for (const area of plan?.areas ?? []) {
    const folder = join(run.folder, trailsOf(area.id));
    if (!existsSync(folder)) continue;
    const trails = readdirSync(folder).filter(name => name.endsWith('.md')).sort().map(name => readFileSync(join(folder, name), 'utf8').trim());
    if (!trails.length) continue;
    const notes = join(run.folder, '_specs', area.id, 'notes.md');
    const before = existsSync(notes) ? `${readFileSync(notes, 'utf8').trimEnd()}\n\n` : `# ${area.name}: notes\n\n`;
    writeFileSync(notes, `${before}## What the Ludicrous run left\n\n${trails.map(text => text.replace(/^# /, '### ').replace(/\n## /g, '\n#### ')).join('\n\n')}\n`);
  }
  await git(run.folder, ['rm', '-rq', '--ignore-unmatch', '--', '_specs/ludicrous/trails']);
  await git(run.folder, ['add', '-A', '--', '_specs']);
  await git(run.folder, ['commit', '-q', '-m', 'Ludicrous: the trails fold into each area\'s notes']).catch(() => '');
}

const titleOf = run => {
  const first = run.idea.split(/(?<=[.!?])\s|\n/)[0].trim();
  return first.length > 72 ? `${first.slice(0, 71)}…` : first;
};

/**
 * Pushes the branch and opens its one pull request, as a draft after a stop, or updates the one that is open. A project with no remote
 * keeps its branch here. Done marks a draft ready for review. Nothing merges.
 */
export async function publishRun(run, { body, ready, gh = defaultGh }) {
  if (!run.remote) return { pr: null, line: 'This project has no remote, so its branch stays on this computer and no pull request opened.' };
  await exec('git', ['-C', run.folder, 'push', '-q', 'origin', `refs/heads/${run.branch}:refs/heads/${run.branch}`], { timeout: PUSH_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    .catch(error => {
      throw Error(`The branch was not pushed: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
    });
  const bodyFile = join(run.folder, '.git', 'LUDICROUS_PR_BODY');
  writeFileSync(bodyFile, body);
  const open = JSON.parse(await gh(['pr', 'list', '--head', run.branch, '--state', 'open', '--json', 'url,isDraft'], run.folder) || '[]')[0];
  if (open) {
    await gh(['pr', 'edit', open.url, '--body-file', bodyFile], run.folder);
    if (ready && open.isDraft) await gh(['pr', 'ready', open.url], run.folder);
    return { pr: { url: open.url, draft: ready ? false : open.isDraft }, line: `Updated its pull request, ${open.url}.` };
  }
  const created = await gh(['pr', 'create', '--head', run.branch, '--base', run.base, '--title', titleOf(run), '--body-file', bodyFile, ...(ready ? [] : ['--draft'])], run.folder);
  const url = created.trim().split('\n').at(-1);
  return { pr: { url, draft: !ready }, line: `Opened its pull request${ready ? '' : ' as a draft'}, ${url}.` };
}

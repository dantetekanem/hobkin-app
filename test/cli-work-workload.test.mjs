import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forecastWork } from '../src/cli/work/forecast.mjs';
import { planWork } from '../src/cli/work/plan.mjs';
import { readUnmerged } from '../src/cli/work/unmerged.mjs';
import { chooseProject, fileItem, paths, recordTokens, updateItem, writeMode, writeState } from '../src/cli/work/store.mjs';
import { writeJson } from './helpers/work-fixture.mjs';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
// 20:00 local on a Monday: outside a working day's hours, with runs already started that morning.
const evening = new Date(2026, 5, 1, 20).getTime();
const at = time => new Date(time).toISOString();
const brief = 'Evidence, who benefits, the first change, the proof.';
const item = (key, details = {}) => ({ key, kind: 'fix', title: key, brief, ...details });

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-workload-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeMode(root, { enabled: true, autoPick: true, machinesLook: false });
  writeJson(join(root, 'work', 'subscription.json'), { secondary: { usedPercent: 10, windowMinutes: 10080, resetAt: evening + 3 * 24 * HOUR } });
  return root;
}

/** A project past its study that has just had its looks, so nothing is due on it but what a test files. */
function project(root, slug, time) {
  chooseProject(root, `/repos/${slug}`, 'important', time);
  mkdirSync(paths(root, slug).directory, { recursive: true });
  writeFileSync(paths(root, slug).project, '# What it is\n');
  writeState(root, slug, { lastLensAt: at(time), lastIdeasAt: at(time), lastSignalsAt: at(time), lastMachinesAt: at(time) });
}

/** Item runs that started and ended earlier today, as the token record keeps them. */
function ranToday(root, slug, starts) {
  for (const start of starts) recordTokens(root, { slug, lane: 'do', kind: 'do', tokens: 1000, startedAt: at(start) }, start + 10 * MINUTE);
}

/** Finished changes waiting on a project, as the last survey read them and Done lists them. */
function finishedOn(root, slug, count, time) {
  const rows = Array.from({ length: count }, (_row, index) => {
    const branch = `hobkin/${slug}-${index}`;
    const { id } = fileItem(root, slug, item(`finished on ${branch}`), time);
    return updateItem(root, slug, id, { state: 'branch', branch, proof: 'It failed, then it passed.' }, time);
  });
  const { projects } = readUnmerged(root);
  const open = rows.map(({ branch }) => ({ kind: 'branch', branch, sha: `sha-${branch}`, conflict: false, size: { additions: 1, deletions: 0, files: 1 } }));
  writeJson(join(root, 'work', 'unmerged.json'), { at: at(time), projects: { ...projects, [slug]: { lastMergeAt: null, trees: 0, open } } });
}

/** The same home every time: two projects, three item runs this morning, an urgent fix, two new fixes and a feature. */
function busyHome(t, { waiting = 0 } = {}) {
  const root = dataRoot(t);
  const morning = new Date(2026, 5, 1, 8).getTime();
  project(root, 'api', morning);
  project(root, 'web', morning);
  ranToday(root, 'api', [new Date(2026, 5, 1, 9).getTime(), new Date(2026, 5, 1, 10).getTime()]);
  ranToday(root, 'web', [new Date(2026, 5, 1, 11).getTime()]);
  if (waiting) finishedOn(root, 'web', waiting, morning);
  fileItem(root, 'api', item('Fix login'), morning);
  fileItem(root, 'api', item('Add export', { kind: 'feature' }), morning);
  fileItem(root, 'web', item('Fix the outage', { urgent: true }), morning);
  fileItem(root, 'web', item('Fix the footer'), morning);
  return root;
}

const plan = (root, options = {}) => planWork(root, { now: evening, ...options });
const waits = ({ entries }) => entries.map(({ title, waiting }) => [title, waiting]);
const NEW_SETTINGS = ['changesADay', 'hours', 'shipFirstOn', 'shipFirstAt', 'reviewPulls'];

test('a home that set none of the workload starts work exactly as before', t => {
  const root = busyHome(t);
  const running = [{ slug: 'web', lane: 'do', item: 'zzzzzz', startedAt: at(evening - 5 * MINUTE) }];
  const free = plan(root, { running, lastStartAt: evening - MINUTE });

  assert.equal(free.next.title, 'Fix login');
  assert.equal(free.pause, null);
  assert.deepEqual(waits(free), [
    ['Fix the outage', 'one item at a time here'],
    ['Fix login', null],
    ['Fix the footer', 'one item at a time here'],
    ['Add export', null],
  ]);
  assert.equal(forecastWork(root, free, { now: evening, running }).line, 'Next 8h: about 4 jobs · 1 P0 · 2 P1 · 1 P2 · 2 agents at a time.');

  // Eight finished changes wait, so new work holds and what still runs at the bar goes on.
  const held = plan(busyHome(t, { waiting: 8 }), { lastStartAt: evening - MINUTE });
  assert.equal(held.next.title, 'Fix the outage');
  assert.deepEqual(held.shipFirst, { pile: 8, bar: 8, holding: true, line: 'Shipping first: 8 finished and waiting. New work starts under 8.' });
  assert.deepEqual(waits(held).filter(([, waiting]) => waiting === 'shipping first').map(([title]) => title), ['Fix login', 'Fix the footer', 'Add export']);

  const kept = JSON.parse(readFileSync(join(root, 'work', 'mode.json'), 'utf8'));
  assert.deepEqual(NEW_SETTINGS.filter(name => name in kept), [], 'nothing of the workload is written for a home that set none of it');
});

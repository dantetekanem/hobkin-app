import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../../src/cli/config.mjs';
import { recordMachines } from '../../src/cli/work/machines.mjs';
import { chooseProject, fileItem, readItems, updateItem, writeMode } from '../../src/cli/work/store.mjs';
import { surveyUnmerged } from '../../src/cli/work/unmerged.mjs';
import { recordReadiness, setYolo } from '../../src/cli/work/yolo.mjs';
import { branched, commit, git, repository, writeJson } from './work-fixture.mjs';

export const NOW = Date.parse('2026-06-01T12:00:00Z');
export const READY_KEY = 'yolo:ready';
export const SPEC = '_specs/tla/WorkItem.tla';
const specText = '---- MODULE WorkItem ----\n\\* models: app.txt\n====\n';
const specHash = createHash('sha256').update(specText).digest('hex');

export const scored = (numbers = {}) => Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback']
  .map(name => [name, { score: numbers[name] ?? 10, evidence: `What the review saw of ${name}.` }]));

export const allReady = (change = {}) => ({
  tests: { ready: true, how: 'node --test runs 40 tests in 3 s.' },
  errors: { ready: true, how: 'Exceptions reach the error tracker, which mails the user.' },
  slowQueries: { ready: true, how: 'The database logs queries over 200 ms, and the test suite fails on an N+1.' },
  performance: { ready: true, how: 'Request and job timings are kept, with last week as the baseline.' },
  logs: { ready: true, how: 'bin/logs search finds any request by id.' },
  alerts: { ready: true, how: 'An alert goes to the user by mail within 5 minutes.' },
  rollback: { ready: true, how: 'bin/deploy rollback takes the last release back.' },
  deploy: { ready: true, how: 'bin/deploy from main, undone by bin/deploy rollback.' },
  ...change,
});

/** A project with each chosen repository, its state machines looked for with TLC and none found, and work mode on. */
export function workspace(t, projects = ['api']) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-yolo-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkouts = Object.fromEntries(projects.map(name => [name, repository(base, name)]));
  for (const name of projects) chooseProject(root, checkouts[name], 'important', NOW);
  for (const name of projects) recordMachines(root, name, { machines: [] }, { tlc: true, now: NOW });
  writeMode(root, { enabled: true });
  return { base, root, checkouts };
}

export const itemsOf = (h, slug = 'api') => readItems(h.root, slug);
export const readinessItem = (h, slug = 'api') => itemsOf(h, slug).find(({ key }) => key === READY_KEY);
export const stateOf = (h, { id }, slug = 'api') => itemsOf(h, slug).find(item => item.id === id).state;

/** Finished work on a branch of its own, rated by Change Review at its head with these scores. */
export function finished(h, title, { slug = 'api', kind = 'bug-fix', numbers, item = {}, file, text } = {}) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  if (file) branched(h.checkouts[slug], branch, file, text ?? `${title}\n`);
  else branched(h.checkouts[slug], branch);
  const head = git(h.checkouts[slug], 'rev-parse', branch);
  const { id } = fileItem(h.root, slug, { key: title, kind: 'fix', title, brief: 'Evidence and first change.', ...item }, NOW);
  updateItem(h.root, slug, id, { state: 'branch', branch, proof: 'The spec passes.', review: { kind, scores: scored(numbers), head, by: 'change-review' } }, NOW);
  return { id, branch, head };
}

/** A project the user's yes made ready: every part recorded as in place, and the readiness work merged. */
export function makeReady(h, slug = 'api', parts = allReady()) {
  setYolo(h.root, { on: true }, NOW);
  const { id } = readinessItem(h, slug);
  updateItem(h.root, slug, id, { state: 'doing' }, NOW);
  recordReadiness(h.root, slug, parts, NOW);
  updateItem(h.root, slug, id, { state: 'merged' }, NOW);
}

export const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });

export function withSpec(h, slug = 'api') {
  mkdirSync(join(h.checkouts[slug], '_specs', 'tla'), { recursive: true });
  commit(h.checkouts[slug], SPEC, specText);
}

/** A run as `hobkin proof check` leaves it, which only that process writes. */
export const writeRun = (h, id, change) => writeJson(join(h.root, 'proofs', id, 'result.json'), {
  id,
  project: 'api',
  spec: SPEC,
  specHash,
  outcome: 'holds',
  finished: new Date(NOW).toISOString(),
  stats: { generated: 40, distinct: 12, queue: 0, depth: 4 },
  rules: [{ name: 'MergedAtReviewedHead', kind: 'invariant', status: 'holds' }],
  actions: [{ name: 'Merge', count: 3 }],
  ...change,
});
export const brokenRun = { outcome: 'broken', broken: 'MergedAtReviewedHead', traceLength: 5 };

/** Finished work that changes the file the model covers, rated at its head with every score at 10. */
export function modeledChange(h, title) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkouts.api, branch, 'app.txt', `${title}\n`);
  const head = git(h.checkouts.api, 'rev-parse', branch);
  const { id } = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'The spec passes.', review: { kind: 'bug-fix', scores: scored(), head, by: 'change-review' } }, NOW);
  return { id, branch, head };
}

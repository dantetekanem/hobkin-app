import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initialize } from '../src/cli/config.mjs';
import { chooseProject, readMode } from '../src/cli/work/store.mjs';
import { RULE_DEFAULTS, rulesOf, setYoloRules } from '../src/cli/work/yolo-rules.mjs';
import { readYolo, setYolo, yoloView } from '../src/cli/work/yolo.mjs';
import { repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');

function workspace(t, projects = ['api', 'web']) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-rules-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  for (const name of projects) chooseProject(root, repository(base, name), 'important', NOW);
  return { base, root };
}

test('a home that set nothing has today\'s rules, and each default is what the code did before', t => {
  const { root } = workspace(t);
  const rules = rulesOf(root, 'api');
  assert.equal(rules.testsPass, true);
  assert.equal(rules.wayBackKnown, true);
  assert.equal(rules.noModelBreaks, true);
  assert.equal(rules.brokenModelFixMayMerge, false);
  assert.equal(rules.holdAfterRegression, true);
  assert.equal(rules.mergePulls, false);
  assert.equal(rules.mergeWhenChecksUnlisted, false);
  assert.equal(rules.lowestRate, 8);
  assert.deepEqual([rules.floorCoverage, rules.floorProof, rules.floorSafety, rules.floorVisibility, rules.floorRollback], [5, 5, 8, 7, 7]);
  assert.deepEqual(rules.kinds, ['performance', 'bug-fix', 'state-machine', 'package-update', 'small-change']);
  assert.equal(rules.mostLines, 300);
  assert.equal(rules.mostAreas, 2);
  assert.deepEqual([rules.deletedTestsMayMerge, rules.oneWayUndoMayMerge, rules.earlierBranchesMayMerge, rules.leftNoteMayMerge], [false, false, false, false]);
  assert.equal(rules.mergesAPass, 1);
  assert.deepEqual([rules.keptCurrent, rules.tries], [3, 3]);
  assert.equal(rules.reviewPulls, 'none');
  assert.deepEqual(rulesOf(root, null), rules);
  assert.deepEqual(Object.keys(RULE_DEFAULTS).toSorted(), Object.keys(rules).toSorted());
});

test('each setting takes its range and refuses what is outside it in plain words, writes nothing when one value is refused, refuses a name it does not know and takes none where the table allows it', t => {
  const { root } = workspace(t);
  const refused = (change, words) => {
    const before = JSON.stringify(readMode(root));
    assert.throws(() => setYoloRules(root, null, change), words);
    assert.equal(JSON.stringify(readMode(root)), before, `nothing written for ${JSON.stringify(change)}`);
  };

  refused({ lowestRate: 0.9 }, /lowest general rate.*1 to 10/i);
  refused({ lowestRate: 10.5 }, /1 to 10/);
  refused({ lowestRate: 8.25 }, /one decimal/);
  refused({ floorSafety: 0 }, /1 to 10/);
  refused({ floorProof: 5.5 }, /whole number/);
  refused({ testsPass: 'yes' }, /on or off/);
  refused({ kinds: [] }, /at least one/);
  refused({ kinds: ['feature', 'nonsense'] }, /nonsense/);
  refused({ mostLines: 0 }, /1 or more, or none/);
  refused({ mostAreas: -1 }, /1 or more, or none/);
  refused({ mergesAPass: 6 }, /1 to 5/);
  refused({ mergesAPass: 0 }, /1 to 5/);
  refused({ tries: 11 }, /1 to 10/);
  refused({ keptCurrent: 0 }, /1 or more, or none/);
  refused({ askPaths: ['x'.repeat(81)] }, /80 characters/);
  refused({ askPaths: Array.from({ length: 101 }, (_, index) => `word${index}`) }, /100 words/);
  refused({ askPaths: [''] }, /plain text/);
  refused({ reviewPulls: 'some' }, /none, mine, waiting or both/);
  refused({ madeUp: true }, /Not a YOLO setting: madeUp/);
  refused({ testsPass: false, mostLines: 0 }, /1 or more, or none/);
  refused({}, /Name a YOLO setting/);
  assert.equal(rulesOf(root, null).testsPass, true, 'the valid value in a refused call stayed unset');

  setYoloRules(root, null, { mostLines: null, mostAreas: null, keptCurrent: null, mergesAPass: 5, tries: 10, askPaths: [], lowestRate: 9.5 });
  const rules = rulesOf(root, null);
  assert.deepEqual([rules.mostLines, rules.mostAreas, rules.keptCurrent], [null, null, null]);
  assert.deepEqual([rules.mergesAPass, rules.tries, rules.askPaths, rules.lowestRate], [5, 10, [], 9.5]);
  assert.equal(readYolo(root).rate, 9.5, 'the lowest rate stays where the main switch keeps it');
  setYoloRules(root, null, { lowestRate: 1 });
  assert.equal(rulesOf(root, null).lowestRate, 1);
  setYoloRules(root, null, { reviewPulls: 'both', kinds: ['feature'] });
  assert.equal(rulesOf(root, null).reviewPulls, 'both');
  assert.equal(readMode(root).reviewPulls, 'both', 'rating other pull requests is the workload\'s own setting');
  assert.deepEqual(rulesOf(root, null).kinds, ['feature']);
});

test('setYolo takes rules with the switch and the rate, all checked before any is written, and keeps them when the switch moves', t => {
  const { root } = workspace(t);
  assert.throws(() => setYolo(root, { on: true, rules: { mostLines: 0 } }, NOW), /1 or more, or none/);
  assert.equal(readYolo(root).on, false, 'the refused call turned nothing on');
  setYolo(root, { on: true, rate: 7.5, rules: { mostLines: 500 } }, NOW);
  assert.deepEqual(readYolo(root), { on: true, rate: 7.5 });
  assert.equal(rulesOf(root, 'api').mostLines, 500);
  setYolo(root, { on: false }, NOW);
  setYolo(root, { rate: 9 }, NOW);
  assert.equal(rulesOf(root, 'api').mostLines, 500, 'moving the switch or the rate leaves the rules');
  assert.equal(rulesOf(root, 'api').lowestRate, 9);
  assert.throws(() => setYolo(root, { rate: 0.5 }, NOW), /1 to 10/);
});

test('a setting for one project changes that project only, and clearing it returns the project to the rest', t => {
  const { root } = workspace(t);
  setYoloRules(root, null, { mostLines: 400, lowestRate: 8.5 });
  setYoloRules(root, 'api', { mostLines: 100, mergePulls: true, lowestRate: 9.2 });
  assert.equal(rulesOf(root, 'api').mostLines, 100);
  assert.equal(rulesOf(root, 'api').mergePulls, true);
  assert.equal(rulesOf(root, 'api').lowestRate, 9.2);
  assert.equal(rulesOf(root, 'web').mostLines, 400);
  assert.equal(rulesOf(root, 'web').mergePulls, false);
  assert.equal(rulesOf(root, 'web').lowestRate, 8.5);
  assert.equal(readYolo(root).rate, 8.5, 'a project\'s own rate does not move the rate of the rest');

  const view = yoloView(root);
  const api = view.projects.find(({ slug }) => slug === 'api');
  assert.deepEqual(api.overrides.toSorted(), ['lowestRate', 'mergePulls', 'mostLines']);
  assert.equal(api.rules.mostLines, 100);
  assert.deepEqual(view.projects.find(({ slug }) => slug === 'web').overrides, []);
  assert.equal(view.rules.mostLines, 400);

  setYoloRules(root, 'api', { same: ['mostLines', 'lowestRate'] });
  assert.equal(rulesOf(root, 'api').mostLines, 400);
  assert.equal(rulesOf(root, 'api').lowestRate, 8.5);
  assert.equal(rulesOf(root, 'api').mergePulls, true, 'the other override stays');
  assert.throws(() => setYoloRules(root, 'api', { same: ['tries'] }), /all projects/);
  assert.throws(() => setYoloRules(root, 'api', { tries: 2 }), /all projects/);
  assert.throws(() => setYoloRules(root, 'nowhere', { mostLines: 2 }), /not a project/);
  assert.throws(() => setYoloRules(root, null, { same: ['mostLines'] }), /one project/);
});

test('no hobkin work command writes a rule', () => {
  const sources = readdirSync(new URL('../src', import.meta.url), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.mjs$/.test(entry.name))
    .map(entry => join(entry.parentPath, entry.name));
  const users = sources.filter(file => /setYoloRules|setYolo\b/.test(readFileSync(file, 'utf8'))).map(file => file.split('/src/')[1]);
  assert.deepEqual(users.toSorted(), ['cli/work/yolo-rules.mjs', 'cli/work/yolo.mjs']);
});

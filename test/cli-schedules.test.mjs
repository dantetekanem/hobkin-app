import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { scheduleDefinition } from '../src/cli/checks.mjs';
import { initialize, loadConfig, validateConfig } from '../src/cli/config.mjs';
import { changeSchedule, parseSchedule, loadSchedules, formatSchedule, moveRoutinesFolder, routinesFolder, validateBinding, whenItRuns } from '../src/cli/schedules.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const metadata = {
  id: 'recap',
  title: 'Morning recap',
  at: '09:00',
  timezone: 'America/Sao_Paulo',
  enabled: false,
  harness: 'pi',
  effort: 'medium',
  cwd: '/project',
  context: ['notes/current.md'],
};
const file = (patch = {}, body = 'Read the approved notes and report useful changes.') =>
  `---\n${JSON.stringify({ ...metadata, ...patch })}\n---\n${body}\n`;

test('initialization is model-free, private, repeatable and does not replace edited configuration', t => {
  const root = fixture(t);
  const now = '2026-10-26T12:00:00.000Z';

  const config = initialize(root, { cwd: '/project', now });

  assert.equal(config.initializedAt, now);
  assert.equal(config.version, 2);
  assert.equal(config.main.cwd, '/project');
  assert.equal(statSync(join(root, 'config.json')).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(join(root, 'routines')).sort(), ['README.md', 'daily', 'monthly', 'once', 'weekly']);
  const saved = { ...config, background: { harness: 'claude', model: 'sonnet', effort: 'high' } };
  writeFileSync(join(root, 'config.json'), JSON.stringify(saved));
  assert.deepEqual(initialize(root, { cwd: '/different', now: '2027-01-01T00:00:00.000Z' }), saved);
  assert.deepEqual(loadConfig(root), saved);
  assert.equal(loadSchedules(root).schedules.length, 0);
});

test('active binding validation rejects legacy harnesses while saved config reads preserve identities', t => {
  const root = fixture(t);
  const config = initialize(root, { cwd: root });
  validateBinding({ harness: 'pi', model: 'anthropic/claude-sonnet', effort: 'xhigh' });
  assert.throws(() => validateBinding({ harness: 'claude', effort: 'max' }), /harness.*pi/);
  assert.throws(() => validateBinding({ harness: 'pi', effort: 'max' }), /effort/);
  for (const target of ['main', 'background']) {
    const saved = { ...config, [target]: { ...config[target], harness: 'claude', effort: 'max' } };
    const bytes = JSON.stringify(saved);
    writeFileSync(join(root, 'config.json'), bytes);
    assert.throws(() => validateConfig(saved), /harness.*pi/);
    assert.deepEqual(loadConfig(root), saved);
    assert.equal(readFileSync(join(root, 'config.json'), 'utf8'), bytes);
  }
});

test('legacy admission blocks fresh initialization without reading or mutating the legacy source', t => {
  const base = fixture(t);
  const legacy = join(base, 'legacy.md');
  const root = join(base, 'v2');
  writeFileSync(legacy, 'private legacy bytes');

  assert.throws(() => initialize(root, { cwd: base, legacySources: [legacy] }), /migration/i);
  assert.equal(readFileSync(legacy, 'utf8'), 'private legacy bytes');
  assert.throws(() => statSync(join(root, 'config.json')), { code: 'ENOENT' });
});

test('calendar schedules round-trip without changing recurrence, settings or instructions', () => {
  for (const [cadence, extra] of [['daily', {}], ['weekly', { weekday: 1 }], ['monthly', { day: 31 }]]) {
    const schedule = parseSchedule(file(extra), cadence, `${cadence}/recap.md`);
    assert.equal(schedule.cadence, cadence);
    assert.equal(schedule.timezone, metadata.timezone);
    assert.equal(schedule.enabled, false);
    assert.deepEqual(parseSchedule(formatSchedule(schedule), cadence, schedule.path), schedule);
  }
});

test('one paused schedule can hold multiple times and round-trip in every recurrence folder', t => {
  const root = fixture(t);
  initialize(root, { cwd: root });
  const at = Array.from({ length: 10 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`);
  for (const [cadence, extra] of [['daily', {}], ['weekly', { weekday: 1 }], ['monthly', { day: 31 }]]) {
    const source = file({ ...extra, at, id: cadence });
    const path = join(root, `routines/${cadence}/check.md`);
    writeFileSync(path, source);
    const schedule = parseSchedule(source, cadence, path);
    assert.deepEqual(schedule.at, at);
    assert.equal(schedule.enabled, false);
    assert.deepEqual(parseSchedule(formatSchedule(schedule), cadence, path), schedule);
    assert.equal(readFileSync(path, 'utf8'), source);
  }
  assert.deepEqual(loadSchedules(root).counts, { daily: 1, weekly: 1, monthly: 1, once: 0 });
});

test('one paused window schedule round-trips and invalid or conflicting windows fail closed', t => {
  const root = fixture(t);
  initialize(root, { cwd: root });
  const window = { start: '08:00', end: '17:00', everyMinutes: 60 };
  for (const [cadence, extra] of [['daily', {}], ['weekly', { weekday: 1 }], ['monthly', { day: 31 }]]) {
    const source = file({ ...extra, at: undefined, window, id: cadence });
    const path = join(root, `routines/${cadence}/check.md`);
    writeFileSync(path, source);
    const schedule = parseSchedule(source, cadence, path);
    assert.deepEqual(schedule.window, window);
    assert.equal(schedule.enabled, false);
    assert.deepEqual(parseSchedule(formatSchedule(schedule), cadence, path), schedule);
    assert.equal(readFileSync(path, 'utf8'), source);
  }
  assert.deepEqual(loadSchedules(root).counts, { daily: 1, weekly: 1, monthly: 1, once: 0 });
  for (const invalid of [
    null, [], {}, { ...window, end: '07:00' }, { ...window, start: ['08:00'] },
    { ...window, end: '24:00' }, { ...window, everyMinutes: 0 },
    { ...window, everyMinutes: '60' }, { ...window, everyMinutes: 1.5 },
    { ...window, everyMinutes: 1 }, { ...window, everyMinutes: 1441 },
    { ...window, extra: true },
  ]) {
    assert.throws(() => parseSchedule(file({ at: undefined, window: invalid }), 'daily', 'check.md'), /window/);
  }
  assert.throws(() => parseSchedule(file({ window }), 'daily', 'check.md'), /at.*window|window.*at/);
});

test('validation rejects ambiguous configuration, unsafe input and unsupported effort without guessing', () => {
  const invalidSettings = [
    { at: '24:00' },
    ...[[], ['09:00', '09:00'], ['9:00'], [900], [['09:00']], Array(49).fill('09:00')].map(at => ({ at })),
    { timezone: 'not/a/timezone' },
    { enabled: 'yes' },
    { harness: 'other' },
    { effort: 'ultra' },
    { cwd: 'relative' },
    { context: ['../secret'] },
    { id: '../escape' },
    { unknown: true },
    { title: '\u001b[2J' },
    { model: '-bad' },
  ];
  for (const patch of invalidSettings) {
    assert.throws(() => parseSchedule(file(patch), 'daily', 'daily/recap.md'), /daily\/recap.md/);
  }
  assert.throws(() => parseSchedule(file(), 'weekly', 'weekly/recap.md'), /weekday/);
  assert.deepEqual(parseSchedule(file({ weekday: [1, 2, 3, 4, 5] }), 'weekly', 'weekly/recap.md').weekday, [1, 2, 3, 4, 5]);
  for (const weekday of [[], [1, 1], [7], [1.5], ['1'], [[1]]]) {
    assert.throws(() => parseSchedule(file({ weekday }), 'weekly', 'weekly/recap.md'), /weekday/);
  }
  assert.throws(() => parseSchedule(file({ weekday: [1] }), 'daily', 'daily/recap.md'), /weekday/);
  assert.throws(() => parseSchedule(file({ day: 32 }), 'monthly', 'monthly/recap.md'), /day/);
  assert.throws(() => parseSchedule(file({}, ''), 'daily', 'daily/recap.md'), /instructions/);
  assert.throws(() => parseSchedule(file({}, 'a'.repeat(66000)), 'daily', 'daily/recap.md'), /large/);
});

test('loader reports per-file errors and rejects every conflicting ID or symlink rather than executing one', t => {
  const root = fixture(t);
  initialize(root, { cwd: root });
  writeFileSync(join(root, 'routines/daily/first.md'), file());
  writeFileSync(join(root, 'routines/weekly/duplicate.md'), file({ weekday: 1 }));
  writeFileSync(join(root, 'routines/daily/broken.md'), 'not metadata');
  writeFileSync(join(root, 'routines/monthly/valid.md'), file({ id: 'monthly', day: 1 }));
  symlinkSync(join(root, 'routines/monthly/valid.md'), join(root, 'routines/daily/link.md'));
  const legacyPath = join(root, 'routines/daily/legacy.md');
  const legacy = file({ id: 'legacy', harness: 'claude', effort: 'max' });
  writeFileSync(legacyPath, legacy);

  const result = loadSchedules(root);

  assert.deepEqual(result.schedules.map(item => item.id), ['monthly']);
  assert.equal(result.errors.length, 5);
  assert.match(result.errors.find(item => item.path === legacyPath).message, /harness.*pi/);
  assert.equal(readFileSync(legacyPath, 'utf8'), legacy);
  assert.ok(result.errors.every(item => item.path && item.message));
  assert.deepEqual(result.counts, { daily: 0, weekly: 0, monthly: 1, once: 0 });
});

test('CLI init/list uses only the explicit temporary root and fails on invalid schedules', t => {
  const root = join(fixture(t), 'data');
  const run = (...args) => spawnSync(process.execPath, ['src/cli/main.mjs', ...args, '--home', root], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(run('init').status, 0);
  const listed = run('schedules');
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /daily.*0/i);
  assert.doesNotMatch(listed.stdout, /\u001b/);
  const recap = { id: 'recap', title: 'Recap', at: '09:30', weekday: [1, 3], timezone: 'UTC', enabled: true, harness: 'pi', model: null, effort: 'medium', cwd: root, context: [] };
  writeFileSync(join(root, 'routines/weekly/recap.md'), `---\n${JSON.stringify(recap)}\n---\nDo it.\n`);
  assert.match(run('schedules').stdout, /enabled {2}weekly\/recap {2}Recap {2}Mon, Wed 09:30/);
  writeFileSync(join(root, 'routines/daily/broken.md'), 'broken');
  assert.equal(run('schedules').status, 1);
  assert.equal(run('unknown-command').status, 1);
});

test('a check says when it runs in a few words, so a list reads as the calendar', () => {
  assert.equal(whenItRuns({ cadence: 'daily', at: '08:10' }), '08:10');
  assert.equal(whenItRuns({ cadence: 'daily', at: ['09:00', '18:00'] }), '09:00, 18:00');
  assert.equal(whenItRuns({ cadence: 'daily', window: { start: '09:00', end: '18:00', everyMinutes: 120 } }), '09:00-18:00 every 120m');
  assert.equal(whenItRuns({ cadence: 'weekly', weekday: 5, at: '09:00' }), 'Fri 09:00');
  assert.equal(whenItRuns({ cadence: 'weekly', weekday: [1, 2], at: '09:00' }), 'Mon, Tue 09:00');
  assert.equal(whenItRuns({ cadence: 'monthly', day: 27, at: '09:00' }), 'day 27 09:00');
  assert.equal(whenItRuns({ cadence: 'once', date: '2026-05-04', at: '15:00' }), '2026-05-04 15:00');
  assert.equal(whenItRuns({ cadence: 'compatibility' }), '');
});

const oldHome = t => {
  const root = fixture(t);
  mkdirSync(join(root, 'schedules', 'daily'), { recursive: true });
  writeFileSync(join(root, 'schedules', 'daily', 'recap.md'), formatSchedule({ ...metadata, prompt: 'Check it.' }));
  return root;
};

test('a home that has not moved yet keeps working from its old folder', t => {
  const root = oldHome(t);

  assert.equal(routinesFolder(root), join(root, 'schedules'));
  assert.deepEqual(loadSchedules(root).schedules.map(({ id }) => id), ['recap']);
});

test('moving the folder keeps every routine, and a path written inside one still works', t => {
  const root = oldHome(t);

  moveRoutinesFolder(root);

  assert.equal(routinesFolder(root), join(root, 'routines'));
  assert.deepEqual(loadSchedules(root).schedules.map(({ id }) => id), ['recap']);
  assert.match(readFileSync(join(root, 'schedules', 'daily', 'recap.md'), 'utf8'), /Check it/);
  assert.equal(lstatSync(join(root, 'schedules')).isSymbolicLink(), true);

  moveRoutinesFolder(root);
  assert.equal(lstatSync(join(root, 'routines')).isDirectory(), true, 'moving twice changes nothing');
});

test('a folder already moved is never overwritten', t => {
  const root = oldHome(t);
  mkdirSync(join(root, 'routines', 'daily'), { recursive: true });

  moveRoutinesFolder(root);

  assert.equal(lstatSync(join(root, 'schedules')).isDirectory(), true);
  assert.equal(routinesFolder(root), join(root, 'routines'));
});

test('a new home starts with routines, and init leaves an old home where it is', t => {
  const fresh = fixture(t);
  initialize(fresh, { cwd: fresh });
  assert.equal(lstatSync(join(fresh, 'routines', 'daily')).isDirectory(), true);
  assert.equal(lstatSync(join(fresh, 'schedules'), { throwIfNoEntry: false }), undefined);

  const old = oldHome(t);
  initialize(old, { cwd: old });
  assert.equal(lstatSync(join(old, 'routines'), { throwIfNoEntry: false }), undefined, 'an empty new folder would hide the old one');
  assert.deepEqual(loadSchedules(old).schedules.map(({ id }) => id), ['recap']);
});

test('moving the folder does not change a routine\'s fingerprint, so holds and answers stand', () => {
  const routine = { id: 'recap', prompt: 'Check it.', path: '/home/me/.hobkin/schedules/daily/recap.md' };
  const moved = { ...routine, path: '/home/me/.hobkin/routines/daily/recap.md' };

  assert.equal(scheduleDefinition(moved), scheduleDefinition(routine));
  assert.equal(scheduleDefinition(routine), createHash('sha256').update(JSON.stringify(routine)).digest('hex'), 'runs already saved keep matching');
  assert.notEqual(scheduleDefinition({ ...moved, prompt: 'Check more.' }), scheduleDefinition(routine));
});

test('a routine turns on or off and takes new times in its own file, and the rest of the file stays as written', t => {
  const root = fixture(t);
  initialize(root, { cwd: root });
  const folder = join(routinesFolder(root), 'daily');
  const path = join(folder, 'recap.md');
  const body = 'Read the approved notes.\n\nReport useful changes.';
  writeFileSync(path, file({}, body));
  const before = parseSchedule(readFileSync(path, 'utf8'), 'daily', path);
  const window = { start: '08:00', end: '17:00', everyMinutes: 60 };
  const { at: _at, ...withoutTimes } = before;

  assert.deepEqual(changeSchedule(root, 'recap', { enabled: true }), { ...before, enabled: true });
  assert.deepEqual(changeSchedule(root, 'recap', { window }), { ...withoutTimes, enabled: true, window });
  assert.deepEqual(changeSchedule(root, 'recap', { at: ['08:00', '13:00'] }), { ...before, enabled: true, at: ['08:00', '13:00'] });
  const source = readFileSync(path, 'utf8');
  assert.deepEqual(loadSchedules(root).schedules, [parseSchedule(source, 'daily', path)]);
  assert.ok(source.endsWith(`\n---\n${body}\n`), 'its instructions stay as written');

  // A change hobkin would not load is refused in its own words, and the file stays as it was.
  assert.throws(() => changeSchedule(root, 'recap', { window: { ...window, everyMinutes: 1 } }), { message: 'window may contain at most 48 checks per day' });
  assert.throws(() => changeSchedule(root, 'recap', { at: '25:00' }), { message: 'at must be HH:mm or a list of 1–48 unique HH:mm times' });
  assert.throws(() => changeSchedule(root, 'recap', { title: 'Other' }), { message: 'Only enabled, at or window change here.' });
  assert.throws(() => changeSchedule(root, 'missing', { enabled: false }), { message: 'Unknown exact native routine ID; list candidates first.' });
  assert.equal(readFileSync(path, 'utf8'), source);
  assert.deepEqual(readdirSync(folder).filter(name => name.endsWith('.tmp')), []);
});

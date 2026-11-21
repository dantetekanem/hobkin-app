import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileDecision, openDecisions, waitingDecisions } from '../src/cli/decisions.mjs';
import { readLaunches, readMode, readState, recordTokens, tokenEvents, writeMode, writeState } from '../src/cli/work/store.mjs';
import { readUnmerged } from '../src/cli/work/unmerged.mjs';
import { readSignals } from '../src/cli/work/signals.mjs';
import { readMachines } from '../src/cli/work/machines.mjs';
import { readSubscription } from '../src/cli/work/usage.mjs';
import { lastUpkeep } from '../src/cli/work/upkeep.mjs';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, prFile, updateItem } from '../src/cli/work/store.mjs';
import { repository } from './helpers/work-fixture.mjs';
import { atomicJson, initialize, learningEnabled, loadConfig } from '../src/cli/config.mjs';
import { loadSchedules } from '../src/cli/schedules.mjs';
import { dueOccurrence, nextOccurrence } from '../src/cli/runner.mjs';

// The read-counting pattern of cli-work-read-cache.test.mjs: every whole-file read under the home is counted, by file name.
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'hobkin-read-caches-'));
  const original = fs.readFileSync;
  const reads = new Map();
  // A file that is not there costs a read that throws, and is counted apart.
  let missing = 0;
  t.mock.method(fs, 'readFileSync', (...args) => {
    const file = String(args[0]);
    if (file.startsWith(root)) reads.set(file.slice(root.length + 1), (reads.get(file.slice(root.length + 1)) ?? 0) + 1);
    try {
      return original(...args);
    } catch (error) {
      if (file.startsWith(root)) missing++;
      throw error;
    }
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, reads: name => reads.get(name) ?? 0, missing: () => missing };
}

const question = text => ({ from: 'work', question: text, choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] });

test('the decisions log is folded once per version, and another process\'s answer shows on the next read', t => {
  const h = fixture(t);
  const { id } = fileDecision(h.root, question('Merge it?'));
  fileDecision(h.root, question('Ship it?'));
  const before = h.reads('decisions.jsonl');
  for (let i = 0; i < 20; i++) {
    assert.equal(openDecisions(h.root).length, 2);
    assert.equal(waitingDecisions(h.root).length, 2);
  }
  assert.ok(h.reads('decisions.jsonl') - before <= 1, 'an unchanged log is not read again');
  const [first] = openDecisions(h.root);
  assert.throws(() => { first.question = 'changed'; }, TypeError);
  assert.throws(() => first.choices.push({ value: 'maybe', label: 'Maybe' }), TypeError);

  // As `hobkin decide` in another process answers it.
  fs.appendFileSync(join(h.root, 'decisions.jsonl'), `${JSON.stringify({ id, answer: 'yes', answeredAt: new Date().toISOString() })}\n`);
  assert.deepEqual(openDecisions(h.root).map(decision => decision.question), ['Ship it?']);
  fs.rmSync(join(h.root, 'decisions.jsonl'));
  assert.deepEqual(openDecisions(h.root), []);
});

test('the token and launch logs are parsed once per version, and a line another process adds shows on the next read', t => {
  const h = fixture(t);
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 100 });
  const launches = join(h.root, 'work', 'api', 'launches.jsonl');
  fs.mkdirSync(join(h.root, 'work', 'api'), { recursive: true });
  fs.writeFileSync(launches, '{"item":"one","state":"live"}\n');
  for (let i = 0; i < 20; i++) {
    assert.equal(tokenEvents(h.root).length, 1);
    assert.equal(readLaunches(h.root, 'api')[0].state, 'live');
  }
  assert.ok(h.reads('work/tokens.jsonl') <= 1, 'an unchanged token log is not read again');
  assert.ok(h.reads('work/api/launches.jsonl') <= 1, 'an unchanged launch log is not read again');
  assert.throws(() => { tokenEvents(h.root)[0].tokens = 1; }, TypeError);

  fs.appendFileSync(join(h.root, 'work', 'tokens.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), slug: 'api', lane: 'look', tokens: 5 })}\n`);
  fs.appendFileSync(launches, '{"item":"one","state":"settled"}\n');
  assert.deepEqual(tokenEvents(h.root).map(event => event.tokens), [100, 5]);
  assert.equal(readLaunches(h.root, 'api')[0].state, 'settled');
});

test('a routine file is parsed only when it changes, and an edit or a deletion shows on the next load', t => {
  const h = fixture(t);
  const folder = join(h.root, 'routines', 'daily');
  fs.mkdirSync(folder, { recursive: true });
  const file = join(folder, 'news.md');
  const write = title => fs.writeFileSync(file, `---\n${JSON.stringify({ id: 'news', title, timezone: 'America/Toronto', enabled: true, harness: 'pi', model: null, effort: 'low', cwd: h.root, context: [], at: '07:00' })}\n---\nRead the news.\n`);
  write('Morning news');
  for (let i = 0; i < 20; i++) assert.equal(loadSchedules(h.root).schedules[0].title, 'Morning news');
  assert.equal(h.reads('routines/daily/news.md'), 1, 'an unchanged routine is not read again');
  assert.throws(() => { loadSchedules(h.root).schedules[0].enabled = false; }, TypeError);
  write('Evening news');
  assert.equal(loadSchedules(h.root).schedules[0].title, 'Evening news');
  fs.writeFileSync(file, 'not a routine');
  assert.equal(loadSchedules(h.root).schedules.length, 0);
  assert.match(loadSchedules(h.root).errors[0].message, /expected JSON metadata/);
  assert.equal(h.reads('routines/daily/news.md'), 3, 'a broken routine is not read again either');
  fs.rmSync(file);
  assert.deepEqual(loadSchedules(h.root).errors, []);
});

test('a routine\'s times are worked out once per day and time zone, so a later tick formats no dates, and the answers stay the same', t => {
  const formats = t.mock.method(Intl.DateTimeFormat.prototype, 'formatToParts');
  const routine = { id: 'news', enabled: true, cadence: 'daily', timezone: 'America/Halifax', window: { start: '08:00', end: '20:00', everyMinutes: 30 } };
  const now = Date.parse('2026-11-21T19:00:20Z');
  const first = dueOccurrence(routine, new Date(now));
  assert.deepEqual(first, { id: 'news:2026-11-21:15:00', scheduledAt: '2026-11-21T19:00:00.000Z', localDate: '2026-11-21' });
  const counted = formats.mock.callCount();
  for (let second = 1; second < 30; second++) assert.deepEqual(dueOccurrence(routine, new Date(now + second * 1000)), first);
  assert.equal(formats.mock.callCount(), counted, 'the same minute formats nothing again');
  assert.equal(dueOccurrence(routine, new Date(now + 60000)).id, 'news:2026-11-21:15:00');
  assert.ok(formats.mock.callCount() - counted <= 1, 'a new minute formats the clock once');
  // Spring forward in Toronto: 02:30 does not exist on 2026-03-08, so the run waits for the next day's.
  const early = { id: 'early', enabled: true, cadence: 'daily', timezone: 'America/Toronto', at: '02:30' };
  for (let i = 0; i < 2; i++) assert.equal(nextOccurrence(early, new Date('2026-03-08T05:00:00Z')).scheduledAt, '2026-03-09T06:30:00.000Z');
});

test('the mode, a project\'s state, the branch survey and the settings are read once per version, and a write from elsewhere shows next', t => {
  const h = fixture(t);
  initialize(h.root, { cwd: h.root });
  writeMode(h.root, { enabled: true, queueNext: ['item:api:one'] });
  writeState(h.root, 'api', { lastLookAt: 'then' });
  atomicJson(join(h.root, 'work', 'unmerged.json'), { at: 'then', projects: {} });
  const before = ['work/mode.json', 'work/api/state.json', 'work/unmerged.json', 'config.json'].map(h.reads);
  for (let i = 0; i < 20; i++) {
    assert.equal(readMode(h.root).enabled, true);
    assert.equal(readState(h.root, 'api').lastLookAt, 'then');
    assert.equal(readUnmerged(h.root).at, 'then');
    assert.equal(learningEnabled(h.root), false);
  }
  const after = ['work/mode.json', 'work/api/state.json', 'work/unmerged.json', 'config.json'].map(h.reads);
  assert.deepEqual(after.map((n, i) => n - before[i] <= 1), [true, true, true, true], 'unchanged files are not read again');
  readMode(h.root).queueNext.push('item:api:two');
  readState(h.root, 'api').lastLookAt = 'changed';
  assert.deepEqual(readMode(h.root).queueNext, ['item:api:one'], 'each reader gets a copy of its own to change');
  assert.equal(readState(h.root, 'api').lastLookAt, 'then');

  // As a command in another process writes them.
  atomicJson(join(h.root, 'work', 'mode.json'), { ...readMode(h.root), enabled: false });
  atomicJson(join(h.root, 'work', 'api', 'state.json'), { lastLookAt: 'now' });
  atomicJson(join(h.root, 'work', 'unmerged.json'), { at: 'now', projects: {} });
  atomicJson(join(h.root, 'config.json'), { ...loadConfig(h.root), learning: { enabled: true } });
  assert.equal(readMode(h.root).enabled, false);
  assert.equal(readState(h.root, 'api').lastLookAt, 'now');
  assert.equal(readUnmerged(h.root).at, 'now');
  assert.equal(learningEnabled(h.root), true);
  const config = loadConfig(h.root);
  config.main.model = 'changed/here';
  assert.notEqual(loadConfig(h.root).main.model, 'changed/here', 'the whole configuration is still a copy of its own');
});

test('a project\'s signals and models, the subscription reading, the upkeep clock and a branch\'s description are read once per version', t => {
  const h = fixture(t);
  const checkout = repository(h.root, 'repo');
  chooseProject(h.root, checkout, 'important', Date.now());
  const { id } = fileItem(h.root, 'repo', { key: 'fix', kind: 'fix', title: 'Fix the job', brief: 'It fails.' });
  updateItem(h.root, 'repo', id, { state: 'branch', branch: 'hobkin/fix', summary: 'Fixed the job.' });
  const description = prFile(h.root, 'repo', id);
  const asked = () => [readSignals(h.root, 'repo'), readMachines(h.root, 'repo'), readSubscription(h.root), lastUpkeep(h.root), readyItems(h.root)[0].about];
  assert.deepEqual(asked(), [null, null, null, null, 'Fixed the job.']);
  const missing = h.missing();
  for (let i = 0; i < 10; i++) asked();
  assert.equal(h.missing(), missing, 'a file that is not there is not tried again while nothing is there');

  fs.mkdirSync(join(h.root, 'work', 'repo', 'prs'), { recursive: true });
  fs.writeFileSync(description, '# Fix the job\n\nThe job ran out of memory, so it streams now.\n');
  fs.writeFileSync(join(h.root, 'work', 'repo', 'signals.json'), JSON.stringify({ signal: 2 }));
  fs.writeFileSync(join(h.root, 'work', 'subscription.json'), JSON.stringify({ at: 'now' }));
  fs.mkdirSync(join(h.root, 'runtime'), { recursive: true });
  fs.writeFileSync(join(h.root, 'runtime', 'upkeep.json'), JSON.stringify({ at: 'then' }));
  assert.deepEqual(asked().filter((_, i) => i !== 1), [{ signal: 2 }, { at: 'now' }, 'then', 'The job ran out of memory, so it streams now.']);
  const read = h.reads(`work/repo/prs/${id}.md`);
  for (let i = 0; i < 10; i++) asked();
  assert.equal(h.reads(`work/repo/prs/${id}.md`), read, 'an unchanged description is not read again');
  readSignals(h.root, 'repo').signal = 3;
  assert.equal(readSignals(h.root, 'repo').signal, 2, 'each reader gets a copy of its own to change');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize, loadConfig } from '../src/cli/config.mjs';
import { buildInvocation } from '../src/cli/harnesses.mjs';
import { deleteReports, readShortReport, saveReport, saveShortReport } from '../src/cli/reports.mjs';
import { checkedShort, readShortReports, setShortReports, ShortReports } from '../src/cli/short-reports.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const HOUR = 3600000;
const ON_AT = Date.parse('2026-11-20T09:00:00Z');
const iso = ms => new Date(ms).toISOString();

const long = [
  'Useful: The nightly import missed 12 rows from the March statement, so the balance is off by `$412.50`.',
  '',
  'Next: Re-run the import for March.',
  '',
  ...Array.from({ length: 12 }, (_, index) => `Step ${index + 1} of the check read the statement and the ledger again and found the same rows still missing from the table.`),
].join('\n');
const short = 'The nightly import missed 12 rows from March, so the balance is off by `$412.50`. Re-run the import for March.';

function home(t, { fast = { model: 'fixture/fast', effort: 'low' } } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-short-reports-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  if (fast) config.tiers = { fast };
  atomicJson(join(root, 'config.json'), config);
  return root;
}

function queue(t, root, reply = short) {
  const requests = [];
  const made = [];
  const runHarness = async request => {
    requests.push(request);
    return typeof reply === 'function' ? reply(request) : { status: 'completed', text: reply, cost: null };
  };
  const shorts = new ShortReports({ root, runHarness, onMade: id => made.push(id) });
  t.after(() => shorts.close());
  return { shorts, requests, made };
}

const report = (id, at, body = long) => ({ id, title: 'Statement import', scheduleId: 'import', at: iso(at), body, outcome: 'completed' });
const shortFile = (root, id) => join(root, 'reports', `${createHash('sha256').update(id).digest('hex')}.short.md`);

test('with the switch off nothing is asked and no report carries a short version', async t => {
  const root = home(t);
  const { shorts, requests } = queue(t, root);

  assert.deepEqual(readShortReports(root), { on: false, since: null }, 'a new home starts with it off');
  const listed = shorts.carry([report('run:1', ON_AT + HOUR)]);
  await shorts.idle();

  assert.equal('short' in listed[0], false);
  assert.deepEqual(requests, []);
  assert.equal(existsSync(join(root, 'reports')), false);

  setShortReports(root, true, ON_AT);
  setShortReports(root, false, ON_AT + HOUR);
  assert.deepEqual(readShortReports(root), { on: false, since: null });
  assert.equal(loadConfig(root).background.model, 'fixture/check', 'the rest of config.json stays as it was');
});

test('a new report gets a short version on the fast tier, saved beside it and carried in the list', async t => {
  const root = home(t);
  setShortReports(root, true, ON_AT);
  assert.deepEqual(readShortReports(root), { on: true, since: iso(ON_AT) });
  setShortReports(root, true, ON_AT + HOUR);
  assert.equal(readShortReports(root).since, iso(ON_AT), 'turning it on again keeps when it was turned on');
  const { shorts, requests, made } = queue(t, root);

  const first = shorts.carry([report('run:1', ON_AT + HOUR)]);
  assert.equal('short' in first[0], false, 'the report is listed before its short version exists');
  await shorts.idle();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].purpose, 'short-report');
  assert.equal(requests[0].harness, 'pi');
  assert.equal(requests[0].model, 'fixture/fast');
  assert.equal(requests[0].effort, 'low');
  assert.equal(requests[0].prompt, long);
  assert.deepEqual(made, ['run:1']);
  assert.equal(readShortReport(root, 'run:1'), short);
  assert.equal(statSync(shortFile(root, 'run:1')).mode & 0o777, 0o600);
  assert.equal(shorts.carry([report('run:1', ON_AT + HOUR)])[0].short, short);

  const { args } = buildInvocation({ ...requests[0], sessionFile: join(root, 'job.jsonl') });
  assert.ok(args.includes('--no-tools'));
  assert.ok(args.includes('--no-extensions'));
  assert.match(args[args.indexOf('--system-prompt') + 1], /under 30 seconds/);
});

test('with no fast tier of its own, the short version runs on the model the fast tier follows', async t => {
  const root = home(t, { fast: null });
  setShortReports(root, true, ON_AT);
  const { shorts, requests } = queue(t, root);

  shorts.carry([report('run:1', ON_AT + HOUR)]);
  await shorts.idle();

  assert.equal(requests[0].model, 'fixture/check');
});

test('an answer that is empty, too long or adds a fact is thrown away and the report stays as it was', async t => {
  assert.equal(checkedShort(long, `TL;DR: ${short}`), short);
  assert.equal(checkedShort(long, `**Useful:** ${short}`), short);
  assert.equal(checkedShort(long, `\`\`\`\n${short}\n\`\`\``), short);
  assert.equal(checkedShort(long, '   '), null);
  assert.equal(checkedShort(long, `${short} ${'More words here. '.repeat(50)}`), null, 'over 130 words');
  assert.equal(checkedShort(long, `${short} It took 40 minutes.`), null, 'a number the report does not have');
  assert.equal(checkedShort(long, `${short} See https://ledger.invalid/march.`), null, 'a link the report does not have');
  assert.equal(checkedShort(long, `${short} Run \`import --force\`.`), null, 'code the report does not have');

  const root = home(t);
  setShortReports(root, true, ON_AT);
  const answers = [
    { status: 'completed', text: `${short} It took 40 minutes.` },
    { status: 'failed', text: '', error: 'The model is not signed in.' },
    () => { throw Error('No model.'); },
  ];
  const { shorts, requests, made } = queue(t, root, request => {
    const answer = answers[requests.indexOf(request)];
    return typeof answer === 'function' ? answer() : answer;
  });
  const reports = [report('run:1', ON_AT + HOUR), report('run:2', ON_AT + 2 * HOUR), report('run:3', ON_AT + 3 * HOUR)];
  saveReport(root, 'run:1', long);

  shorts.carry(reports);
  await shorts.idle();

  assert.equal(requests.length, 3);
  assert.deepEqual(made, []);
  for (const { id } of reports) assert.equal(readShortReport(root, id), null);
  assert.equal(readFileSync(join(root, 'reports', `${createHash('sha256').update('run:1').digest('hex')}.md`), 'utf8'), long);
  assert.equal(shorts.carry(reports).some(listed => 'short' in listed), false);
});

test('old reports and short ones are left alone, and none is asked for twice', async t => {
  const root = home(t);
  setShortReports(root, true, ON_AT);
  const { shorts, requests } = queue(t, root, { status: 'failed', text: '', error: 'No answer.' });
  const reports = [
    report('before', ON_AT - HOUR),
    report('brief', ON_AT + HOUR, 'Useful: The backup ran and nothing changed.'),
    { ...report('no-time', ON_AT + HOUR), at: undefined },
    report('new', ON_AT + HOUR),
  ];

  shorts.carry(reports);
  await shorts.idle();
  shorts.carry(reports);
  await shorts.idle();

  assert.deepEqual(requests.map(({ prompt }) => prompt), [long]);
});

test('deleting a report deletes its short version', t => {
  const root = home(t);
  saveReport(root, 'run:1', long);
  saveShortReport(root, 'run:1', short);

  deleteReports(root, ['run:1']);

  assert.equal(existsSync(shortFile(root, 'run:1')), false);
  assert.equal(readShortReport(root, 'run:1'), null);
});

test('hobkin\'s snapshot lists a finished report at once and carries its short version once it is made', { timeout: 10000 }, async t => {
  const root = home(t);
  setShortReports(root, true, Date.now() - HOUR);
  const fake = fakePi(root);
  const asked = Promise.withResolvers();
  const answer = Promise.withResolvers();
  const runHarness = async request => {
    if (request.purpose !== 'short-report') throw Error(`Unexpected ${request.purpose} job.`);
    asked.resolve(request);
    await answer.promise;
    return { status: 'completed', text: short, cost: null };
  };
  const app = await HobkinApplication.open(root, { createMain: fake.createMain, runHarness, intervalMs: 60000 });
  t.after(() => app.close());
  await app.runtime.admit({ id: 'import-run', kind: 'background', scheduleId: 'import', title: 'Statement import' });
  await app.runtime.finish('import-run', { status: 'completed', text: long });

  const listed = (await app.refresh()).reports.find(({ id }) => id === 'import-run');
  assert.equal(listed.body, long);
  assert.equal('short' in listed, false);
  assert.equal((await asked.promise).model, 'fixture/fast');
  answer.resolve();
  await app.shortReports.idle();

  assert.equal((await app.refresh()).reports.find(({ id }) => id === 'import-run').short, short);
});

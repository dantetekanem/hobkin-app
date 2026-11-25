import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { main } from '../src/cli/main.mjs';
import { reportReadStates, Telemetry } from '../src/cli/telemetry.mjs';

const MINUTE = 60000;
const STARTED = Date.parse('2026-11-01T00:00:00Z');
const iso = ms => new Date(ms).toISOString();

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-catch-up-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  config.tiers = { fast: { model: 'fixture/fast', effort: 'medium' } };
  atomicJson(join(root, 'config.json'), config);
  return root;
}

const output = () => ({ text: '', write(chunk) { this.text += chunk; } });

/** A saved list of reports, as the running hobkin leaves it for `hobkin reports`. */
function savedView(root, reports) {
  mkdirSync(join(root, 'runtime'), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'runtime/view.json'), JSON.stringify({ version: 1, reports }));
}

const listed = (id, minutes, body = `Useful: ${id} found something.`, patch = {}) => ({
  id, title: `Routine ${id}`, scheduleId: `routine-${id}`, at: iso(STARTED + minutes * MINUTE), body, outcome: 'completed', ...patch,
});

test('a report is read once opened for 3 seconds or asked about, caught up once a catch-up covered it, and read wins', t => {
  const root = home(t);
  const telemetry = Telemetry.open(root, STARTED);

  telemetry.recordReportRead({ id: 'opened', dwellMs: 4000 }, STARTED + MINUTE);
  telemetry.recordReportRead({ id: 'glanced', dwellMs: 1000 }, STARTED + MINUTE);
  telemetry.recordReportDiscussed('asked', STARTED + MINUTE);
  telemetry.recordCaughtUp(['covered', 'opened later', 'opened'], 'catch-up:1', STARTED + 2 * MINUTE);
  telemetry.recordReportRead({ id: 'opened later', dwellMs: 3000 }, STARTED + 3 * MINUTE);

  assert.deepEqual(Object.fromEntries(reportReadStates(root)), {
    opened: 'read', asked: 'read', covered: 'caught-up', 'opened later': 'read',
  });
  const caught = telemetry.events.filter(({ type }) => type === 'report_caught_up');
  assert.deepEqual(caught[0], { type: 'report_caught_up', at: iso(STARTED + 2 * MINUTE), id: 'covered', by: 'catch-up:1' });
});

test('a caught-up report is still unopened in report-attention.json', t => {
  const root = home(t);
  const telemetry = Telemetry.open(root, STARTED);
  const runs = Array.from({ length: 6 }, (_, day) => ({
    id: `digest-${day}`, kind: 'background', scheduleId: 'digest', title: 'Digest', status: 'completed',
    finishedAt: iso(STARTED + (day + 1) * 86400000), result: { status: 'completed', text: 'Useful: Something happened.' },
  }));

  telemetry.recordCaughtUp(runs.map(({ id }) => id), 'catch-up:1', STARTED + 7 * 86400000);
  const [digest] = telemetry.attention(runs, STARTED + 8 * 86400000);

  assert.equal(digest.read, 0);
  assert.equal(digest.ignored, true);
});

test('hobkin reports gives each report its read state: read, caught-up or unread', async t => {
  const root = home(t);
  savedView(root, [listed('a', 1), listed('b', 2), { ...listed('c', 3), readState: 'read' }]);
  const telemetry = Telemetry.open(root, STARTED);
  telemetry.recordReportRead({ id: 'a', dwellMs: 5000 }, STARTED + 10 * MINUTE);
  telemetry.recordCaughtUp(['b'], 'catch-up:1', STARTED + 10 * MINUTE);
  const printed = output();

  assert.equal(await main(['reports', '--home', root], printed), 0);

  const reports = JSON.parse(printed.text);
  assert.deepEqual(reports.map(({ id, read }) => [id, read]), [['c', 'unread'], ['b', 'caught-up'], ['a', 'read']]);
  assert.equal(reports.some(report => 'readState' in report), false, 'one field says it, from the reads themselves');
  assert.equal(reports[0].routineId, 'routine-c');
});

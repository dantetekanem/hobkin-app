import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { endSessionJob, sessionReports, sessionsToTell } from '../src/cli/session-log.mjs';
import { runReport, saveReport } from '../src/cli/reports.mjs';

test('a missing worker handoff preserves its failed run report, including partial output', t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-handoff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'runtime', 'handoffs');
  mkdirSync(folder, { recursive: true });
  for (const text of ['', 'Partial findings']) {
    const session = { name: text ? 'partial' : 'empty', report: join(folder, text ? 'partial.md' : 'empty.md') };
    const result = { status: 'failed', text, error: 'Pi did not finish a response (error): Quota reached; provider reported a wait of 37m13s.' };
    endSessionJob(root, session, { status: 'failed', result });
    assert.equal(readFileSync(session.report, 'utf8'), runReport(result));
    const told = sessionsToTell(root).find(item => item.name === session.name);
    assert.equal(told.report, session.report);
    assert.match(told.said, /Quota reached; provider reported a wait of 37m13s/);
    saveReport(root, `session:${session.name}`, runReport(result));
    // If the live run record is no longer available, the session report still has its original outcome.
    assert.equal(sessionReports(root, new Set()).find(report => report.id === `session:${session.name}`).outcome, 'failed');
  }
});

test('ending a failed worker never replaces its own handoff', t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-handoff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const session = { name: 'own', report: join(root, 'own.md') };
  writeFileSync(session.report, 'Agent report');
  endSessionJob(root, session, { status: 'failed', result: { status: 'failed', error: 'Failure' } });
  assert.equal(readFileSync(session.report, 'utf8'), 'Agent report');
});

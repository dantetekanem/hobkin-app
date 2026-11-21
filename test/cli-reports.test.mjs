import assert from 'node:assert/strict';
import test from 'node:test';
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, chmodSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runReport, saveReport, readReport, reportText, reportTriage } from '../src/cli/reports.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-report-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const triaged = text => reportTriage({ status: 'completed', result: { text } });

test('a Next line after the triage line is the one call the report asks for', () => {
  assert.deepEqual(triaged('Useful: The bank wrote.\n\nNext: Reply by Friday.\n\nDetails.'), { level: 'useful', message: 'The bank wrote.', next: 'Reply by Friday.' });
  assert.equal(triaged('**Critical:** Rent is due.\n**Next:** Pay it today.').next, 'Pay it today.');
});

test('a report with no Next line asks for no call, wherever the word appears later', () => {
  assert.deepEqual(triaged('Useful: The bank wrote.\n\nDetails.\n\nNext: not this one.'), { level: 'useful', message: 'The bank wrote.' });
  assert.deepEqual(triaged('Nothing new.\n\nNext: not this one.'), { level: 'nothing' });
});

test('ordinary Markdown is saved whole in a private file and read ahead of legacy text', t => {
  const root = fixture(t);
  const body = `# Findings\n\n${'Evidence.\n'.repeat(5000)}\n`;
  const file = saveReport(root, 'schedule:one', body);
  assert.equal(file.endsWith('.md'), true);
  assert.equal(readFileSync(file, 'utf8'), body);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(root, 'reports')).mode & 0o777, 0o700);
  assert.equal(readReport(root, 'schedule:one', 'stale cached text'), body);
  assert.deepEqual(readdirSync(join(root, 'reports')), [file.split('/').at(-1)]);
  assert.equal(readReport(root, 'historical', 'Preserved imported body'), 'Preserved imported body');
});

test('a saved report is read from disk once while it stays the same, and again once it changes', t => {
  const root = fixture(t);
  const file = saveReport(root, 'session:one', '# One\n\nFirst words.\n');
  let reads = 0;
  const { readFileSync: read } = fs;
  t.mock.method(fs, 'readFileSync', (...args) => {
    if (String(args[0]) === file) reads += 1;
    return read(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  // Every refresh lists every report, and most never change again.
  for (let refresh = 0; refresh < 5; refresh += 1) assert.equal(readReport(root, 'session:one', null), '# One\n\nFirst words.\n');
  assert.equal(reads, 1);

  saveReport(root, 'session:one', '# One\n\nWords written again.\n');
  assert.equal(readReport(root, 'session:one', null), '# One\n\nWords written again.\n');
  writeFileSync(file, '# One\n\nEdited where it lies.\n');
  assert.equal(readReport(root, 'session:one', null), '# One\n\nEdited where it lies.\n');
  assert.equal(reads, 3);
});

test('saved reports reject symlinks and public files rather than reading another source', t => {
  const root = fixture(t);
  const file = saveReport(root, '../untrusted-id', '# Private report');
  chmodSync(file, 0o644);
  assert.throws(() => readReport(root, '../untrusted-id', ''), /private.*regular file/i);
  rmSync(file);
  symlinkSync(join(root, 'missing-target'), file);
  assert.throws(() => readReport(root, '../untrusted-id', ''), /private.*regular file/i);
});

test('visible legacy reports strip private publication markers without dropping the report', () => {
  const body = '# Finding\n<!-- hobkin-publication:scope:id:hash -->\nUseful evidence.\n<!-- hobkin-question:id:unfinished';
  assert.equal(reportText(body), '# Finding\n\nUseful evidence.');
});

const crashed = `Harness exited before completion (1). or]: This operation was aborted
      at new DOMException (node:internal/per_context/domexception:76:18)
      at AbortController.abort (node:internal/abort_controller:504:18)
      at Execution.finish (file:///pi/dist/bundle/chunks/execute-L2EEDV3L.js:2:8423)`;
const details = raw => `<details><summary>Error details</summary>\n\n\`\`\`text\n${raw}\n\`\`\`\n\n</details>`;

test("a failed run's report opens with one plain line, and the raw error with its stack is collapsed below it", () => {
  const error = 'Harness exited before completion (1). Error: boom\n    at tool (file:///tool.js:1:1)';

  assert.equal(runReport({ status: 'failed', error }), `The run failed: Harness exited before completion (1).\n\n${details(error)}`);
  assert.equal(runReport({ status: 'failed', error: crashed }), `The run failed: Pi crashed in its code tool.\n\n${details(crashed)}`);
  assert.equal(runReport({ status: 'failed' }), 'The run failed: it gave no reason.');
});

test("a failed run's partial report follows its line, and an error that is only that line is not repeated", () => {
  assert.equal(runReport({ status: 'failed', text: '# Partial evidence\n\nCollected before failure.', error: 'Tool failed' }),
    'The run failed: Tool failed.\n\n# Partial evidence\n\nCollected before failure.');
});

test('a restarted run says Pi crashed in its code tool and hobkin restarted it, whether the restart worked or failed', () => {
  assert.equal(runReport({ status: 'completed', text: 'Useful: registered.', restarted: { error: crashed } }),
    `Useful: registered.\n\n---\n\nPi crashed in its code tool, and hobkin restarted it.\n\n${details(crashed)}`);
  assert.equal(runReport({ status: 'failed', error: 'Pi did not finish a response (length).', restarted: { error: crashed } }),
    `Pi crashed in its code tool, and hobkin restarted it. The restarted run failed: Pi did not finish a response (length).\n\n${details(`${crashed}\n\nPi did not finish a response (length).`)}`);
});

test('collapsed error details keep an error with backticks whole', () => {
  const report = runReport({ status: 'failed', error: 'Failed: ```oops```\n    at x (file:///x.js:1:1)' });

  assert.match(report, /\n````text\nFailed: ```oops```\n    at x \(file:\/\/\/x\.js:1:1\)\n````\n/);
});

test('other runs keep their report as before', () => {
  assert.equal(runReport({ status: 'completed', text: 'Done.' }), 'Done.');
  assert.equal(runReport({ status: 'interrupted', text: 'Partial.', error: 'Harness cancelled.' }), 'Partial.\n\n---\n\n**Execution failure:** Harness cancelled.');
  assert.equal(runReport({ status: 'interrupted', error: 'Harness cancelled.' }), 'Harness cancelled.');
  assert.equal(runReport({ status: 'incomplete' }), 'No result text.');
});

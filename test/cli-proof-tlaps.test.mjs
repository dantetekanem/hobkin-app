// TLAPS through `tlapm --toolbox 0 0 --strict` (_specs/050-tla-proofs, A11). The fixtures in test/fixtures/tlc/tlapm-*.err
// are built from the toolbox messages in tlapm 1.6.0-pre's source (src/toolbox_msg.ml, src/backend/toolbox.ml and
// src/tlapm_lib.ml), not recorded from a real run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCheck } from '../src/cli/proof/check.mjs';
import { proofFrom, readToolbox, tlapmArguments } from '../src/cli/proof/tlaps.mjs';
import { jarPath } from '../src/cli/proof/tools.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/tlc/${name}`, import.meta.url));
const source = readFileSync(fixture('Proved.tla'), 'utf8');
const proof = (name, exitCode, strict = true) => proofFrom(readToolbox(readFileSync(fixture(name), 'utf8')), { source, exitCode, strict });

function temp(t, prefix) {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

test('tlapm always runs strict, over the whole module, with its cache in the run\'s folder', () => {
  assert.deepEqual(tlapmArguments('/p/Proved.tla', '/home/proofs/run/tlapm'), ['--toolbox', '0', '0', '--strict', '--cache-dir', '/home/proofs/run/tlapm', '/p/Proved.tla']);
});

test('the toolbox messages become the proof\'s steps, each with its label, status, backend and time', () => {
  const blocks = readToolbox(readFileSync(fixture('tlapm-proved.err'), 'utf8'));
  assert.equal(blocks.filter(block => block.type === 'obligation').length, 9);
  assert.deepEqual(blocks.find(block => block.type === 'obligationsnumber'), { type: 'obligationsnumber', count: '3' });

  const done = proof('tlapm-proved.err', 0);
  assert.equal(done.strict, true);
  assert.equal(done.proved, true);
  assert.deepEqual(done.obligations, [
    { id: '<1>1', label: 'Init ⇒ TypeOK', status: 'proved', depth: 1, backend: 'zenon', seconds: 0.1 },
    { id: '<1>2', label: 'TypeOK ∧ [Next]_x ⇒ TypeOK′', status: 'proved', depth: 1, backend: 'smt', seconds: 0.4 },
    { id: '<1>3', label: 'QED', status: 'proved', depth: 1, backend: 'ls4', seconds: 0.2 },
  ]);
});

test('a failed step shows its goal and what it knew', () => {
  const failed = proof('tlapm-failed.err', 10);
  assert.equal(failed.proved, false);
  assert.deepEqual(failed.obligations[1], {
    id: '<1>2',
    label: 'TypeOK ∧ [Next]_x ⇒ TypeOK′',
    status: 'failed',
    depth: 1,
    backend: 'smt',
    seconds: 5,
    goal: 'x′ ∈ ℕ',
    known: ['NEW VARIABLE x', 'x ∈ ℕ', 'x′ = x + 1'],
  });
});

test('a step counts as proved only when tlapm --strict exits 0', () => {
  // Every obligation tlapm sent says proved, but a step has no proof at all: only --strict says so, by its exit code.
  const missing = proof('tlapm-missing.err', 11);
  assert.equal(missing.proved, false);
  assert.deepEqual(missing.obligations.map(({ id, status }) => [id, status]), [['<1>1', 'proved'], ['<1>2', 'proved'], ['<1>3', 'missing']]);

  assert.equal(proof('tlapm-proved.err', 0, false).proved, false, 'not without --strict');
  assert.equal(proof('tlapm-proved.err', 3).proved, false, 'not when tlapm failed');
});

function provedSpec(t, plan) {
  const home = temp(t, 'hobkin-tlaps-home-');
  const project = realpathSync(temp(t, 'hobkin-tlaps-project-'));
  execFileSync('git', ['init', '-q'], { cwd: project });
  copyFileSync(fixture('Proved.tla'), join(project, 'Proved.tla'));
  mkdirSync(join(home, 'tools', 'tla'), { recursive: true });
  writeFileSync(jarPath(home), '');
  const stubFolder = temp(t, 'hobkin-tlaps-stub-');
  const log = join(stubFolder, 'calls.jsonl');
  writeFileSync(log, '');
  writeFileSync(join(stubFolder, 'plan.json'), JSON.stringify({ java: '21.0.2', log, sany: { stdout: 'sany-ok.out' }, ...plan }));
  const tool = join(stubFolder, 'tool');
  writeFileSync(tool, `#!/bin/sh\nHOBKIN_STUB='${join(stubFolder, 'plan.json')}' exec '${process.execPath}' '${fixture('stub-tool.mjs')}' "$@"\n`);
  chmodSync(tool, 0o755);
  const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { home, spec: join(project, 'Proved.tla'), tools: { java: tool, jar: jarPath(home), tlapm: tool }, calls };
}

test('a spec with a proof and no cfg is proved by TLAPS, and the run says what the proof shows', async t => {
  const place = provedSpec(t, { tlapm: { stderr: 'tlapm-proved.err' } });
  const run = await runCheck({ home: place.home, spec: place.spec, workers: 1, tools: place.tools });

  assert.deepEqual(run.steps.map(({ id, state }) => [id, state]), [['parse', 'done'], ['check', 'skipped'], ['prove', 'done']]);
  assert.equal(run.outcome, 'holds');
  assert.equal(run.proof.proved, true);
  assert.equal(run.proof.obligations.length, 3);
  const tlapm = place.calls().find(call => call.args.includes('--toolbox'));
  assert.deepEqual(tlapm.args.slice(0, 4), ['--toolbox', '0', '0', '--strict']);
  assert.equal(run.counts, false, 'a proof alone is not a model check, so it is not the item\'s evidence');

  const failing = provedSpec(t, { tlapm: { stderr: 'tlapm-failed.err', code: 10 } });
  const failed = await runCheck({ home: failing.home, spec: failing.spec, workers: 1, tools: failing.tools });
  assert.equal(failed.outcome, 'broken');
  assert.equal(failed.steps[2].state, 'failed');
  assert.equal(failed.proof.proved, false);
});

test('without tlapm the proof step is skipped and says why', async t => {
  const place = provedSpec(t, {});
  const run = await runCheck({ home: place.home, spec: place.spec, workers: 1, tools: { ...place.tools, tlapm: null } });
  assert.equal(run.steps[2].state, 'skipped');
  assert.equal(run.steps[2].note, 'TLAPS is not installed, so the proof did not run');
  assert.equal(run.outcome, 'error');
  assert.equal(run.message, 'Nothing checked: the spec has no .cfg for TLC, and TLAPS is not installed for its proof.');
});

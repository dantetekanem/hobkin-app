import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { registerHooks, syncBuiltinESMExports } from 'node:module';

const blocked = () => { throw Error('Unexpected process, network or SDK operation'); };
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[key] = blocked;
for (const module of [http, https]) for (const key of ['request', 'get']) module[key] = blocked;
net.connect = net.createConnection = blocked;
net.Socket.prototype.connect = blocked;
globalThis.fetch = blocked;
syncBuiltinESMExports();
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@earendil-works/pi-coding-agent') return { shortCircuit: true,
    url: 'data:text/javascript,export const defineTool = value => value;' };
  if (specifier.includes('pi-coding-agent/')) throw Error('Unexpected SDK subpath');
  return next(specifier, context);
} });
const { initialize, atomicJson, setPersona } = await import('../src/cli/config.mjs');
const { HobkinApplication, readLocalView } = await import('../src/cli/application.mjs');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-persona-view-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root });
  return root;
}

test('offline persona is the validated saved selection, not a stale dashboard value', t => {
  const root = fixture(t);
  assert.equal(readLocalView(root).persona, 'Normal');
  atomicJson(join(root, 'runtime/view.json'), { version: 1, persona: 'hal' });
  for (const persona of ['Funnier', 'Serious', 'hal', 'her', 'jarvis', 'marvin', 'rocky', 'yoda', 'Normal']) {
    setPersona(root, persona);
    assert.equal(readLocalView(root).persona, persona);
  }
});

test('live projection rereads selection without changing the active model or cached config', async t => {
  const root = fixture(t);
  const app = new HobkinApplication();
  const main = { model: { provider: 'fixture', id: 'unchanged' }, thinkingLevel: 'off' };
  Object.assign(app, { snapshot: readLocalView(root), config: { persona: 'Normal' }, now: () => 0,
    delivery: { syncEvidence: async () => {} }, noticeRunIds: new Set(), templatesLooked: true, uploadLooked: true,
    runtime: { directory: root, state: async () => ({ runs: {} }), messages: () => [], contextInfo: () => ({}),
      main, mainChildren: () => [], mainActivity: () => null },
    runner: { snapshot: async () => ({ errors: [], schedules: [], counts: {} }), steeringReceipts: () => [] },
    workView: () => ({ harnessLines: [], folderLines: [], discovery: {} }), learner: { takePost: () => null },
    yesterdayWins: () => null, winsToday: () => [], waitingNow: () => [],
    ledger: { sync: () => ({}) }, telemetry: { attention: () => ({}) }, moods: { observe() {} },
  });
  for (const persona of ['jarvis', 'Normal']) {
    setPersona(root, persona);
    assert.equal((await app.project()).persona, persona);
    assert.equal(app.config.persona, 'Normal');
    assert.equal(app.runtime.main, main);
    assert.equal(app.snapshot.main.model, 'fixture/unchanged');
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize, loadConfig } from '../src/cli/config.mjs';
import { runModelSettings } from '../src/cli/model-settings.mjs';
import { readSettings, updateSettings } from '../src/cli/settings.mjs';

const model = { provider: 'openai-codex', id: 'gpt-6-luna', reasoning: true, thinkingLevelMap: { xhigh: 'xhigh' } };
function fixture(t, background = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-settings-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root });
  config.main.model = 'openai-codex/old';
  config.background = { harness: 'pi', model: 'openai-codex/old', effort: 'low', ...background };
  atomicJson(join(root, 'config.json'), config);
  return root;
}
function schedule(root, id, patch = {}, body = 'Do the scheduled work.\n') {
  const path = join(root, 'routines/daily', `${id}.md`);
  const data = { id, title: id, at: '09:00', timezone: 'UTC', enabled: false, harness: 'pi', effort: 'medium', cwd: root, context: [], ...patch };
  writeFileSync(path, `---\n${JSON.stringify(data, null, 2)}\n---\n${body}`);
  return path;
}
const modelRuntime = { getModel: (provider, id) => provider === model.provider && id === model.id ? model : undefined };
function activatedHome(t) {
  const home = fixture(t);
  const config = loadConfig(home);
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const fingerprint = 'synthetic-fingerprint';
  const dataRoot = join(home, 'migration', id, 'data');
  for (const cadence of ['daily', 'weekly', 'monthly']) mkdirSync(join(dataRoot, 'routines', cadence), { recursive: true, mode: 0o700 });
  atomicJson(join(dataRoot, 'config.json'), config);
  const schedulePath = schedule(dataRoot, 'migrated');
  const controlRoot = join(home, 'control');
  mkdirSync(controlRoot, { mode: 0o700 });
  const migration = { id, destination: home, fingerprint };
  const receipt = 'synthetic-shutdown-receipt';
  writeFileSync(join(controlRoot, 'fence.json'), JSON.stringify({ version: 1, ...migration }), { mode: 0o600 });
  const validation = { errors: [], ownership: { shutdownReceipt: receipt }, artifacts: [], legacyFence: { controlRoot, migration } };
  const validationId = createHash('sha256').update(JSON.stringify(validation)).digest('hex');
  const active = { version: 2, directory: `migration/${id}/data`, migrationId: id, fingerprint, validationId };
  const record = {
    version: 1, phase: 'verified', id, activation: active, manifest: { fingerprint },
    validation: { ...validation, id: validationId }, fence: { validationId, shutdownReceipt: receipt },
  };
  writeFileSync(join(home, 'active.json'), JSON.stringify(active), { mode: 0o600 });
  writeFileSync(join(home, 'migration', 'journal.json'), JSON.stringify(record), { mode: 0o600 });
  return { home, dataRoot, schedulePath };
}

test('updates all Pi conversation and schedule bindings without touching unrelated values', { concurrency: false }, async t => {
  const root = fixture(t);
  const path = schedule(root, 'paused', { model: 'openai-codex/schedule-model', effort: 'high', context: ['notes.md'] }, 'Keep this body.\n');
  let applied;
  const result = await updateSettings(root, { scope: 'all', model: 'openai-codex/gpt-6-luna', effort: 'xhigh' }, {
    modelRuntime,
    applyCurrent: value => { applied = value; return { model: 'openai-codex/gpt-6-luna', effort: 'xhigh' }; },
  });
  assert.equal(loadConfig(root).main.model, 'openai-codex/gpt-6-luna');
  const saved = readFileSync(path, 'utf8');
  assert.match(saved, /"effort": "xhigh"/);
  assert.match(saved, /"enabled": false/);
  assert.match(saved, /"context": \[\s+"notes.md"/);
  assert.ok(saved.endsWith('Keep this body.\n'));
  assert.deepEqual(applied, { model, effort: 'xhigh' });
  assert.deepEqual([result.persisted.settings.background.effort, result.persisted.settings.routines[0].model], ['xhigh', 'openai-codex/gpt-6-luna']);
  assert.deepEqual(result.activeRuntime, { status: 'verified', effective: { model: 'openai-codex/gpt-6-luna', effort: 'xhigh' } });
});

test('saved Claude background model and effort updates stay unchanged; native bindings fail preflight', async t => {
  const root = fixture(t, { harness: 'claude', model: 'sonnet', effort: 'high' });
  const before = readFileSync(join(root, 'config.json'), 'utf8');
  let applied = false;
  const runtime = { modelRuntime, applyCurrent: () => { applied = true; } };
  for (const patch of [{ model: 'openai-codex/gpt-6-luna' }, { effort: 'high' }]) {
    const result = await updateSettings(root, { scope: 'background', ...patch }, runtime);
    assert.deepEqual([result.persisted.status, result.incompatibleScopes, result.activeRuntime.status], ['unchanged', ['background'], 'unchanged']);
    assert.equal(readFileSync(join(root, 'config.json'), 'utf8'), before);
  }
  const path = schedule(root, 'claude', { harness: 'claude', model: 'sonnet', effort: 'high' });
  const nativeBefore = readFileSync(path, 'utf8');
  await assert.rejects(updateSettings(root, { scope: 'all', effort: 'high' }, runtime), /invalid native/i);
  assert.equal(readFileSync(join(root, 'config.json'), 'utf8'), before);
  assert.equal(readFileSync(path, 'utf8'), nativeBefore);
  assert.equal(applied, false);
});

test('reports persisted bindings separately when the active-session setter fails', async t => {
  const root = fixture(t);
  const result = await updateSettings(root, { scope: 'main', effort: 'high' }, {
    applyCurrent: () => { throw Error('setter failed'); },
  });
  assert.deepEqual([result.persisted.status, result.persisted.settings.main.effort], ['complete', 'high']);
  assert.deepEqual(result.activeRuntime, { status: 'unverified', error: 'setter failed' });
  assert.deepEqual(result.unchangedScopes, ['background', 'routines']);
});

test('requires a fully qualified installed Pi model and leaves unrelated scopes unchanged', async t => {
  const root = fixture(t);
  const path = schedule(root, 'paused', { model: 'provider/custom' }); const before = [readFileSync(join(root, 'config.json'), 'utf8'), readFileSync(path, 'utf8')];
  await Promise.all([
    assert.rejects(updateSettings(root, { scope: 'main', model: 'gpt-6-luna' }, { modelRuntime }), /provider\/model/i),
    assert.rejects(updateSettings(root, { scope: 'main', model: 'openai-codex/missing' }, { modelRuntime }), /installed/i),
  ]);
  assert.deepEqual([readFileSync(join(root, 'config.json'), 'utf8'), readFileSync(path, 'utf8')], before);
  assert.equal(readSettings(root, 'background').background.model, 'openai-codex/old');
});

test('does not verify a requested active binding when the setter reports a different one', async t => {
  const root = fixture(t);
  const observed = { model: 'openai-codex/other', effort: 'medium' };
  const result = await updateSettings(root, { scope: 'main', model: 'openai-codex/gpt-6-luna', effort: 'high' }, {
    modelRuntime,
    applyCurrent: () => observed,
  });

  assert.deepEqual(result.activeRuntime, { status: 'unverified', effective: observed });
});

test('classifies a saved config followed by a failed native schedule write as partial persistence', async t => {
  const root = fixture(t);
  const path = schedule(root, 'paused', { model: 'openai-codex/old' });
  const directory = join(root, 'routines', 'daily');
  chmodSync(directory, 0o500);
  let result;
  try {
    result = await updateSettings(root, { scope: 'all', model: 'openai-codex/gpt-6-luna', effort: 'high' }, { modelRuntime });
  } finally {
    chmodSync(directory, 0o700);
  }

  assert.equal(result.persisted.status, 'partial');
  assert.equal(result.persisted.settings.main.model, 'openai-codex/gpt-6-luna');
  assert.equal(result.persisted.failed.target, 'routines:paused');
  assert.match(readFileSync(path, 'utf8'), /"model": "openai-codex\/old"/);
});

test('reads and writes model settings within a verified activated data root', async t => {
  const { home, dataRoot, schedulePath } = activatedHome(t);
  const beforeHomeConfig = readFileSync(join(home, 'config.json'), 'utf8');
  const result = await updateSettings(home, { scope: 'all', model: 'openai-codex/gpt-6-luna', effort: 'high' }, { modelRuntime });

  assert.equal(result.persisted.status, 'complete');
  assert.equal(loadConfig(dataRoot).main.model, 'openai-codex/gpt-6-luna');
  assert.equal(readFileSync(join(home, 'config.json'), 'utf8'), beforeHomeConfig);
  assert.match(readFileSync(schedulePath, 'utf8'), /"model": "openai-codex\/gpt-6-luna"/);
  assert.equal(readSettings(home, 'all').routines[0].model, 'openai-codex/gpt-6-luna');
});

test('settings updates cover once schedules and keep their date', { concurrency: false }, async t => {
  const root = fixture(t);
  const path = join(root, 'routines/once/dentist.md');
  const data = { id: 'dentist', title: 'Dentist', date: '2026-05-04', at: '15:00', timezone: 'UTC', enabled: true, harness: 'pi', effort: 'medium', cwd: root, context: [] };
  writeFileSync(path, `---\n${JSON.stringify(data, null, 2)}\n---\nRemind me.\n`);
  const result = await updateSettings(root, { scope: 'routines', model: 'openai-codex/gpt-6-luna', effort: 'high' }, { modelRuntime });
  const saved = readFileSync(path, 'utf8');
  assert.match(saved, /"date": "2026-05-04"/);
  assert.match(saved, /"effort": "high"/);
  assert.ok(saved.endsWith('Remind me.\n'));
  assert.deepEqual(result.persisted.settings.routines.map(item => [item.id, item.cadence]), [['dentist', 'once']]);
});

test('scheduleId changes one schedule and leaves the others and the conversations alone', async t => {
  const root = fixture(t);
  const target = schedule(root, 'target', { model: 'openai-codex/old', effort: 'low' });
  const other = schedule(root, 'other', { model: 'openai-codex/old', effort: 'low' });
  const untouched = readFileSync(other, 'utf8');
  let applied = false;

  const result = await updateSettings(root, { scope: 'routines', scheduleId: 'target', model: 'openai-codex/gpt-6-luna', effort: 'high' }, {
    modelRuntime,
    applyCurrent: () => { applied = true; },
  });

  assert.deepEqual(result.persisted.completed, ['routines:target']);
  assert.deepEqual(result.persisted.settings.routines.map(({ id, model, effort }) => [id, model, effort]), [['target', 'openai-codex/gpt-6-luna', 'high']]);
  assert.match(readFileSync(target, 'utf8'), /"effort": "high"/);
  assert.equal(readFileSync(other, 'utf8'), untouched);
  assert.equal(applied, false);
  assert.equal(loadConfig(root).main.effort, 'medium');
  assert.equal(loadConfig(root).background.effort, 'low');
  assert.deepEqual(readSettings(root, 'routines', 'other').routines.map(item => item.id), ['other']);
});

test('scheduleId must name a native schedule under the schedules scope', async t => {
  const root = fixture(t);
  const path = schedule(root, 'target', { effort: 'low' });
  const before = readFileSync(path, 'utf8');

  await assert.rejects(updateSettings(root, { scope: 'routines', scheduleId: 'missing', effort: 'high' }, { modelRuntime }), /Unknown routine: missing/);
  await assert.rejects(updateSettings(root, { scope: 'all', scheduleId: 'target', effort: 'high' }, { modelRuntime }), /routineId needs scope routines/);
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('a model without credentials is refused before anything is saved', async t => {
  const root = fixture(t);
  const before = loadConfig(root);
  const noKey = { ...modelRuntime, hasConfiguredAuth: () => false };

  await assert.rejects(updateSettings(root, { scope: 'main', model: 'openai-codex/gpt-6-luna' }, { modelRuntime: noKey }), /No credentials for openai-codex/);
  assert.deepEqual(loadConfig(root), before);
});

test('a level a schedule could never run is refused before anything is saved', async t => {
  const root = fixture(t);
  const path = schedule(root, 'target', { model: 'openai-codex/gpt-6-luna', effort: 'low' });
  const before = readFileSync(path, 'utf8');
  const noExtraHigh = { provider: 'openai-codex', id: 'gpt-6-luna', reasoning: true };
  const runtime = { getModel: () => noExtraHigh };

  await assert.rejects(
    updateSettings(root, { scope: 'routines', scheduleId: 'target', effort: 'xhigh' }, { modelRuntime: runtime }),
    /target cannot run at xhigh on openai-codex\/gpt-6-luna/,
  );
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('moving a schedule to a model that lacks its level is refused too', async t => {
  const root = fixture(t);
  const path = schedule(root, 'target', { model: 'openai-codex/old', effort: 'high' });
  const before = readFileSync(path, 'utf8');
  const noThinking = { provider: 'openai-codex', id: 'gpt-6-luna', reasoning: false };
  const runtime = { getModel: () => noThinking };

  await assert.rejects(
    updateSettings(root, { scope: 'routines', model: 'openai-codex/gpt-6-luna' }, { modelRuntime: runtime }),
    /target cannot run at high/,
  );
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('a schedule on an unknown model keeps its effort free, since nothing can be checked', async t => {
  const root = fixture(t);
  schedule(root, 'target', { effort: 'low' });

  const result = await updateSettings(root, { scope: 'routines', effort: 'xhigh' }, { modelRuntime });

  assert.equal(result.persisted.status, 'complete');
});

function catalogThatChanges() {
  const installed = [];
  return {
    installed,
    runtime: {
      getModel: (provider, id) => installed.find(entry => entry.provider === provider && entry.id === id),
      getAvailable: async () => installed,
      refresh: async options => {
        assert.deepEqual(options, { allowNetwork: false });
        installed.push(model);
      },
    },
  };
}

test('a model added to models.json while hobkin runs is found, with no restart', async t => {
  const root = fixture(t);
  const { runtime } = catalogThatChanges();

  const result = await runModelSettings({
    root,
    config: loadConfig(root),
    request: { action: 'update', scope: 'background', model: `${model.provider}/${model.id}` },
    binding: async () => ({}),
    modelRuntime: async () => runtime,
    apply: async () => ({}),
  });

  assert.equal(result.persisted.status, 'complete');
  assert.equal(readSettings(root, 'background').background.model, `${model.provider}/${model.id}`);
});

test('inspecting lists what models.json holds now', async t => {
  const root = fixture(t);
  const { runtime } = catalogThatChanges();

  const { availableModels } = await runModelSettings({ root, config: loadConfig(root), request: { action: 'inspect', scope: 'background' }, binding: async () => ({}), modelRuntime: async () => runtime });

  assert.deepEqual(availableModels, [`${model.provider}/${model.id}`]);
});

test('a catalog that cannot be read again keeps the one it has', async t => {
  const root = fixture(t);
  const runtime = { ...modelRuntime, getAvailable: async () => [model], refresh: async () => { throw Error('models.json is broken'); } };

  const { availableModels } = await runModelSettings({ root, config: loadConfig(root), request: { action: 'inspect', scope: 'background' }, binding: async () => ({}), modelRuntime: async () => runtime });

  assert.deepEqual(availableModels, [`${model.provider}/${model.id}`]);
});

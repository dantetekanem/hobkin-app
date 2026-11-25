import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize, loadConfig } from '../src/cli/config.mjs';
import { clientNoticesToPost } from '../src/cli/client-notices.mjs';
import { fileVersion } from '../src/cli/file-version.mjs';
import { TeamsTiers, teamsSettingsFile, teamsTiers, teamsTiersOf, writeTeamsTiers } from '../src/cli/teams-tiers.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const place = () => mkdtempSync(join(tmpdir(), 'hobkin-teams-tiers-'));
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const config = {
  main: { cwd: '/work', model: 'anthropic/chat', effort: 'high' },
  background: { harness: 'pi', model: 'anthropic/checks', effort: 'low' },
  tiers: { mid: { model: 'openai/mid', effort: 'medium' }, max: { model: 'openai/max', effort: 'max' } },
};

test('each of hobkin\'s tiers drives the two teams tiers for the same use, with the model and level it runs on now', () => {
  assert.deepEqual(teamsTiersOf, {
    fast: ['read-collect', 'write-patch'],
    mid: ['read-review', 'write-feature'],
    high: ['read-analyze', 'write-system'],
    max: ['read-critical', 'write-critical'],
  });
  assert.deepEqual(teamsTiers(config), {
    // fast follows the checks model and high the chat's, as their jobs do.
    'read-collect': { model: 'anthropic/checks', thinking: 'low' },
    'write-patch': { model: 'anthropic/checks', thinking: 'low' },
    'read-review': { model: 'openai/mid', thinking: 'medium' },
    'write-feature': { model: 'openai/mid', thinking: 'medium' },
    'read-analyze': { model: 'anthropic/chat', thinking: 'high' },
    'write-system': { model: 'anthropic/chat', thinking: 'high' },
    'read-critical': { model: 'openai/max', thinking: 'max' },
    'write-critical': { model: 'openai/max', thinking: 'max' },
  });
});

test('a tier that follows a model Pi picks by itself names none, so its teams tiers are left as they are', () => {
  const wanted = teamsTiers({ ...config, background: { harness: 'pi', model: null, effort: 'low' } });
  assert.equal('read-collect' in wanted, false);
  assert.equal('write-patch' in wanted, false);
  assert.deepEqual(wanted['read-review'], { model: 'openai/mid', thinking: 'medium' });
});

test('teams reads its tiers from its global settings in the user\'s home', () => {
  assert.equal(teamsSettingsFile('/home/someone'), '/home/someone/.pi/agent/pi-extended-teams/settings.json');
});

test('a missing settings file is created with the tiers alone', () => {
  const file = teamsSettingsFile(place());
  assert.deepEqual(writeTeamsTiers(file, teamsTiers(config)), { changed: true });
  assert.deepEqual(read(file), { favoriteModels: teamsTiers(config) });
});

test('only the model and thinking of hobkin\'s tiers change; every other key and field stays as it was', () => {
  const file = teamsSettingsFile(place());
  mkdirSync(join(file, '..'), { recursive: true });
  const saved = {
    watchdog: { bufferSeconds: 45 },
    favoriteModels: {
      'write-critical': { harness: 'opus', model: 'old/model', thinking: 'low', note: 'kept' },
      'reading-fast': { model: 'legacy/model', thinking: 'low' },
      'read-review': null,
    },
    externalHarnesses: { opus: { command: 'claude' } },
  };
  writeFileSync(file, JSON.stringify(saved));
  assert.deepEqual(writeTeamsTiers(file, { 'write-critical': { model: 'openai/max', thinking: 'max' }, 'read-review': { model: 'openai/mid', thinking: 'medium' } }), { changed: true });
  assert.deepEqual(read(file), {
    watchdog: { bufferSeconds: 45 },
    favoriteModels: {
      'write-critical': { harness: 'opus', model: 'openai/max', thinking: 'max', note: 'kept' },
      'reading-fast': { model: 'legacy/model', thinking: 'low' },
      'read-review': { model: 'openai/mid', thinking: 'medium' },
    },
    externalHarnesses: { opus: { command: 'claude' } },
  });
  assert.equal(readFileSync(file, 'utf8').endsWith('}\n'), true, 'written as teams writes it');
});

test('nothing is written when the tiers are already the same', () => {
  const file = teamsSettingsFile(place());
  writeTeamsTiers(file, teamsTiers(config));
  const before = fileVersion(file);
  assert.deepEqual(writeTeamsTiers(file, teamsTiers(config)), { changed: false });
  assert.equal(fileVersion(file), before);
  assert.deepEqual(writeTeamsTiers(teamsSettingsFile(place()), {}), { changed: false }, 'no tiers to give, no file made');
});

test('a file hobkin cannot make sense of is left alone and its problem told in plain words', () => {
  const home = place();
  const file = teamsSettingsFile(home);
  mkdirSync(join(file, '..'), { recursive: true });
  const cases = [
    ['{ "favoriteModels": ', 'is not valid JSON'],
    ['[]', 'does not hold a settings object'],
    ['{ "favoriteModels": [] }', 'has favoriteModels that is not an object'],
    ['{ "favoriteModels": { "read-collect": "fast" } }', 'has a read-collect tier that is not an object'],
  ];
  for (const [text, problem] of cases) {
    writeFileSync(file, text);
    assert.deepEqual(writeTeamsTiers(file, teamsTiers(config)), { problem });
    assert.equal(readFileSync(file, 'utf8'), text);
  }
  const folder = teamsSettingsFile(place());
  mkdirSync(folder, { recursive: true });
  assert.deepEqual(writeTeamsTiers(folder, teamsTiers(config)), { problem: 'cannot be read (EISDIR)' });
});

test('a settings file that is a link is written where it points, and stays a link', () => {
  const home = place();
  const file = teamsSettingsFile(home);
  mkdirSync(join(file, '..'), { recursive: true });
  const real = join(home, 'dotfiles-settings.json');
  writeFileSync(real, '{}');
  symlinkSync(real, file);
  assert.deepEqual(writeTeamsTiers(file, teamsTiers(config)), { changed: true });
  assert.equal(readlinkSync(file), real);
  assert.deepEqual(read(real).favoriteModels, teamsTiers(config));
});

function running() {
  const root = place();
  const home = place();
  initialize(root, { cwd: root });
  const save = change => atomicJson(join(root, 'config.json'), { ...loadConfig(root), ...change });
  save({ main: { cwd: root, model: 'anthropic/chat', effort: 'high' }, background: { harness: 'pi', model: 'anthropic/checks', effort: 'low' } });
  return { root, file: teamsSettingsFile(home), keeper: new TeamsTiers({ root, home }), save };
}

test('while hobkin runs, its first tick writes the tiers, and each change to them writes again', () => {
  const { file, keeper, save } = running();
  keeper.tick();
  assert.deepEqual(read(file).favoriteModels['read-collect'], { model: 'anthropic/checks', thinking: 'low' });

  save({ tiers: { fast: { model: 'openai/quick', effort: 'minimal' } } });
  keeper.tick();
  assert.deepEqual(read(file).favoriteModels['write-patch'], { model: 'openai/quick', thinking: 'minimal' });

  // A tier that follows the chat's model moves when the chat's model does.
  save({ main: { cwd: '/work', model: 'anthropic/newer', effort: 'xhigh' } });
  keeper.tick();
  assert.deepEqual(read(file).favoriteModels['write-system'], { model: 'anthropic/newer', thinking: 'xhigh' });
});

test('a tier changed in teams stays until hobkin\'s own tiers change, and nothing else of hobkin\'s settings rewrites it', () => {
  const { file, keeper, save } = running();
  keeper.tick();
  const changed = read(file);
  changed.favoriteModels['read-review'] = { model: 'picked/in-pi', thinking: 'low' };
  writeFileSync(file, JSON.stringify(changed));
  keeper.tick();
  save({ learning: { enabled: true } });
  keeper.tick();
  assert.deepEqual(read(file).favoriteModels['read-review'], { model: 'picked/in-pi', thinking: 'low' });
});

test('a bad file is told once in Chat, left alone, and kept again once it is fixed', () => {
  const { root, file, keeper } = running();
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '{ broken');
  keeper.tick();
  keeper.tick();
  const told = clientNoticesToPost(root);
  assert.equal(told.length, 1);
  assert.match(told[0].line, /^hobkin cannot keep pi-extended-teams' tiers equal to its own: .*settings\.json is not valid JSON, so it was left as it is\.$/);
  assert.equal(readFileSync(file, 'utf8'), '{ broken');

  writeFileSync(file, '{}');
  keeper.tick();
  assert.deepEqual(read(file).favoriteModels['read-analyze'], { model: 'anthropic/chat', thinking: 'high' });
});

test('hobkin keeps the tiers of the home it is given from the moment it opens', async t => {
  const { root, file, save } = running();
  // The chat runs on the fixture's own model, as the fake Pi does.
  save({ main: { cwd: root, model: 'fixture/local', effort: 'medium' }, tiers: { max: { model: 'openai/max', effort: 'max' } } });
  const home = join(file, '..', '..', '..', '..');
  const app = await HobkinApplication.open(root, {
    createMain: fakePi(root).createMain,
    runHarness: async () => { throw Error('No agent runs in this test.'); },
    fetch: async () => { throw Error('No network in this test.'); },
    intervalMs: 3600000,
    teamsHome: home,
  });
  t.after(() => app.close());
  for (const end = Date.now() + 5000; !fileVersion(file); await wait(20)) if (Date.now() > end) throw Error('The tiers were never written.');
  assert.deepEqual(read(file).favoriteModels['read-critical'], { model: 'openai/max', thinking: 'max' });
});

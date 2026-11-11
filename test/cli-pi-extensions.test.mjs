import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extensionArguments, extensionPaths, ownedExtensionArguments } from '../src/cli/pi-extensions.mjs';

function agentHome(t, settings) {
  const home = mkdtempSync(join(tmpdir(), 'hobkin-extensions-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const cwd = join(home, 'project');
  const agentDir = join(home, 'agent');
  mkdirSync(cwd);
  mkdirSync(agentDir);
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify(settings));
  return { home, cwd, agentDir };
}

function piPackage(home, name) {
  const folder = join(home, name);
  mkdirSync(folder);
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, pi: { extensions: ['./index.mjs'] } }));
  writeFileSync(join(folder, 'index.mjs'), 'export default function () {}\n');
  return join(folder, 'index.mjs');
}

test('Hobkin gets every extension Pi would load, without pi-emote', async t => {
  const { home, cwd, agentDir } = agentHome(t, { packages: ['../pi-emote', '../pi-chrome'] });
  const chrome = piPackage(home, 'pi-chrome');
  piPackage(home, 'pi-emote');

  const paths = await extensionPaths(cwd, { agentDir });

  assert.ok(paths.includes(chrome));
  assert.ok(paths.includes('builtin:mcp'), 'naming extensions must not lose the built-in ones');
  assert.deepEqual(paths.filter(path => path.includes('pi-emote')), []);
});

test('an extension the user switched off in Pi stays off', async t => {
  const { home, cwd, agentDir } = agentHome(t, {
    packages: [{ source: '../pi-chrome', extensions: [] }],
    extensions: ['-builtin:mcp'],
  });
  const chrome = piPackage(home, 'pi-chrome');

  const paths = await extensionPaths(cwd, { agentDir });

  assert.ok(!paths.includes(chrome));
  assert.ok(!paths.includes('builtin:mcp'));
});

test('a project\'s own extensions still load for the checks that run in it', async t => {
  const { cwd, agentDir } = agentHome(t, {});
  const own = join(cwd, '.pi/extensions/project-tool.ts');
  mkdirSync(join(cwd, '.pi/extensions'), { recursive: true });
  writeFileSync(own, 'export default function () {}\n');

  assert.ok((await extensionPaths(cwd, { agentDir })).includes(own));
});

test('finding the list installs nothing', async t => {
  const { home, cwd, agentDir } = agentHome(t, { packages: ['npm:hobkin-test-package-that-is-not-installed'] });

  await extensionPaths(cwd, { agentDir });

  assert.equal(existsSync(join(agentDir, 'npm')), false);
  assert.equal(existsSync(join(home, 'project/.pi/npm')), false);
});

test('Pi is told to discover nothing and load exactly the named list', () => {
  assert.deepEqual(
    extensionArguments(['/a/index.ts', 'builtin:mcp']),
    ['--no-extensions', '--extension', '/a/index.ts', '--extension', 'builtin:mcp'],
  );
});

test('owned children allow only their role tools with explicit extension exclusion', () => {
  for (const role of ['read', 'write']) {
    const args = ownedExtensionArguments(role);
    assert.ok(args.includes('--no-extensions'));
    assert.ok(args.includes('--no-mcp'));
    assert.equal(args[args.indexOf('--extension') + 1].endsWith('/owned-agent-extension.mjs'), true);
    assert.equal(args[args.indexOf('--tools') + 1].includes('bash'), role === 'write');
    assert.equal(args[args.indexOf('--exclude-tools') + 1], 'mcp__*');
  }
});

test('with no list, Pi keeps choosing for itself', () => {
  assert.deepEqual(extensionArguments(undefined), []);
});

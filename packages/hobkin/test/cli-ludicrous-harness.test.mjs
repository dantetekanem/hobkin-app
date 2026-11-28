import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { ludicrousInvocation } from '../src/cli/harnesses.mjs';
import { loadSkillExtension } from '../src/cli/load-skill-extension.mjs';
import { prepareTools, refusalsOf } from '../src/cli/ludicrous/conductor.mjs';
import { SHIPPED_SKILLS } from '../src/cli/skills-extension.mjs';

const exec = promisify(execFile);
const asked = (change = {}) => ({
  prompt: 'Packet api-1.', system: 'You are a worker.', model: 'fixture/local', effort: 'medium',
  sessionFile: '/runs/r1/sessions/0001-worker-api.jsonl', skills: ['/skills/ludicrous-worker/SKILL.md'], ...change,
});
const valuesOf = (args, flag) => args.flatMap((arg, at) => (arg === flag ? [args[at + 1]] : []));

function folder(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-ludicrous-harness-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

test('a Ludicrous Pi loads only its skills, and MCP servers only when the plan names them', () => {
  const { command, args } = ludicrousInvocation(asked());
  assert.equal(command, 'pi');
  assert.deepEqual(args.slice(0, 3), ['--print', '--mode', 'text']);
  // Discovery is off for extensions, so only the named one loads, load_skill, and Pi's MCP support is off: no server of the user's.
  assert.equal(args.filter(arg => arg === '--no-extensions').length, 1);
  assert.deepEqual(valuesOf(args, '--extension'), [loadSkillExtension]);
  assert.ok(args.includes('--no-mcp'));
  assert.deepEqual(valuesOf(args, '--skill'), [...SHIPPED_SKILLS, '/skills/ludicrous-worker/SKILL.md']);
  assert.ok(!args.includes('--no-skills'));
  assert.ok(!args.includes('--approve'));
  assert.deepEqual(args.slice(-2), ['--', 'Packet api-1.']);
  assert.equal(valuesOf(args, '--session')[0], '/runs/r1/sessions/0001-worker-api.jsonl');
  assert.equal(valuesOf(args, '--append-system-prompt')[0], 'You are a worker.');

  // A plan that names a server the project needs turns Pi's own MCP support on, with every other server's tools left out.
  const named = ludicrousInvocation(asked({ mcp: true, hideMcp: ['gmail', 'home-assistant'] })).args;
  assert.deepEqual(valuesOf(named, '--extension'), [loadSkillExtension, 'builtin:mcp', 'builtin:codemode', 'builtin:tool-search']);
  assert.ok(!named.includes('--no-mcp'));
  assert.deepEqual(valuesOf(named, '--exclude-tools'), ['mcp__gmail__*,mcp__home_assistant__*']);

  assert.throws(() => ludicrousInvocation(asked({ launcher: { command: ['managed-pi'], managedExtensions: true } })), /starts with no extensions/);
});

test('a worker\'s check command is refused and logged', async t => {
  const directory = folder(t);
  const { bin, tools, refused } = prepareTools(directory, { checkCommands: ['pnpm', 'vitest', 'node'] });
  assert.deepEqual(refused.sort(), ['check', 'java', 'node', 'pnpm', 'vitest', 'wait']);
  const env = { ...process.env, PATH: `${bin}:${tools}:${process.env.PATH}`, LUDICROUS_AGENT: '0007-worker-api' };

  const ran = await exec('/bin/sh', ['-c', 'pnpm test --filter api'], { env }).catch(error => error);
  assert.equal(ran.code, 1);
  assert.equal(ran.stderr, 'Workers don\'t run checks. Your leader does.\n');
  assert.match(refusalsOf(directory)[0], /^\d{4}-\d\d-\d\dT[\d:]+Z 0007-worker-api pnpm test --filter api$/);

  // `land` runs on hobkin's own Node, so a stand-in for `node` does not stop it.
  const landed = await exec('/bin/sh', ['-c', 'land api-1 "the users route"'], { env }).catch(error => error);
  assert.equal(landed.code, 2);
  assert.match(landed.stderr, /land runs only in a Ludicrous run/);
  assert.equal(refusalsOf(directory).length, 1);
  assert.match(readFileSync(join(tools, 'land'), 'utf8'), /^#!\/bin\/sh\nexec ".+" ".+land\.mjs" "\$@"\n$/);
});

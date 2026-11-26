import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkills } from '@earendil-works/pi-coding-agent';
import shippedSkills, { SHIPPED_SKILLS, TLA_SKILL, skillsExtension, withShippedSkills } from '../src/cli/skills-extension.mjs';

test('Pi loads the TLA+ skill hobkin ships, with nothing to warn about', t => {
  const agentDir = mkdtempSync(join(tmpdir(), 'hobkin-shipped-skills-'));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));

  const { skills, diagnostics } = loadSkills({ cwd: agentDir, agentDir, skillPaths: SHIPPED_SKILLS, includeDefaults: false });

  assert.deepEqual(skills.map(({ name, filePath }) => ({ name, filePath })), [{ name: 'tla-plus', filePath: TLA_SKILL }]);
  assert.deepEqual(diagnostics, []);
});

test('the extension hands Pi the shipped skills when Pi looks for resources', async () => {
  const handlers = {};
  shippedSkills({ on: (event, handler) => { handlers[event] = handler; } });

  const found = await handlers.resources_discover({ type: 'resources_discover', cwd: '/project', reason: 'startup' });

  assert.deepEqual(found, { skillPaths: SHIPPED_SKILLS });
});

test('work runs that name their extensions get the skills extension, and other runs and a launcher\'s are left alone', async () => {
  const seen = [];
  const run = withShippedSkills(async request => { seen.push(request); });
  const named = ['/chrome/index.ts'];

  for (const purpose of ['work-discover', 'work-look', 'work-do']) await run({ purpose, extensions: named });
  await run({ purpose: 'reflection', extensions: named });
  await run({ extensions: named });
  await run({ purpose: 'work-do' });

  const [discover, look, work, reflection, routine, underLauncher] = seen;
  for (const workRun of [discover, look, work]) assert.deepEqual(workRun.extensions, [...named, skillsExtension]);
  assert.deepEqual(reflection.extensions, named);
  assert.deepEqual(routine.extensions, named);
  assert.equal(underLauncher.extensions, undefined);
});

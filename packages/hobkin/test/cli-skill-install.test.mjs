import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main } from '../src/cli/main.mjs';
import { skillsFolder } from '../src/cli/skill.mjs';

async function run(args) {
  let text = '';
  const code = await main(args, { write: chunk => { text += chunk; } });
  return { code, text };
}

/** Every install in these tests goes to a folder of its own, never to an agent's real skills. */
function skillsDir(t) {
  const folder = mkdtempSync(join(tmpdir(), 'hobkin-skills-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

test('skill install writes the skill hobkin prints into <folder>/hobkin/SKILL.md, says where, and changes nothing else', async t => {
  const folder = skillsDir(t);
  mkdirSync(join(folder, 'other'));
  writeFileSync(join(folder, 'other', 'SKILL.md'), 'Another skill.');
  const { text: skill } = await run(['skill']);

  const { code, text } = await run(['skill', 'install', '--to', folder]);

  const file = join(folder, 'hobkin', 'SKILL.md');
  const everything = readdirSync(folder, { recursive: true }).toSorted();
  assert.equal(code, 0);
  assert.equal(readFileSync(file, 'utf8'), skill);
  assert.ok(text.includes(file), text);
  assert.match(text, /--to/, 'it says how to install it for another agent');
  assert.deepEqual(everything, ['hobkin', join('hobkin', 'SKILL.md'), 'other', join('other', 'SKILL.md')]);
  assert.equal(readFileSync(join(folder, 'other', 'SKILL.md'), 'utf8'), 'Another skill.');
});

test('installing again brings an older copy up to date', async t => {
  const folder = skillsDir(t);
  mkdirSync(join(folder, 'hobkin'));
  writeFileSync(join(folder, 'hobkin', 'SKILL.md'), 'An old copy.');

  await run(['skill', 'install', '--to', folder]);

  assert.equal(readFileSync(join(folder, 'hobkin', 'SKILL.md'), 'utf8'), (await run(['skill'])).text);
});

test('the skill goes to Pi\'s skills folder unless --to names another, and ~ there is the home folder', () => {
  const home = '/Users/someone';

  assert.equal(skillsFolder({ home }), '/Users/someone/.pi/agent/skills');
  assert.equal(skillsFolder({ to: '~/.claude/skills', home }), '/Users/someone/.claude/skills');
  assert.equal(skillsFolder({ to: 'skills', home }), resolve('skills'));
});

test('skill takes install and nothing else', async () => {
  await assert.rejects(run(['skill', 'everywhere']), /Usage: hobkin skill/);
});

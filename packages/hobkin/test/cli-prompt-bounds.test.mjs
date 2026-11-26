import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../src/cli/context.mjs';
import { buildInvocation } from '../src/cli/harnesses.mjs';

function fixture(t, limit) {
  const prior = process.env.HOBKIN_MAX_PROMPT_BYTES;
  if (limit === undefined) delete process.env.HOBKIN_MAX_PROMPT_BYTES;
  else process.env.HOBKIN_MAX_PROMPT_BYTES = String(limit);
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-prompt-')));
  t.after(() => {
    if (prior === undefined) delete process.env.HOBKIN_MAX_PROMPT_BYTES;
    else process.env.HOBKIN_MAX_PROMPT_BYTES = prior;
    rmSync(cwd, { recursive: true, force: true });
  });
  return {
    id: 'f094b0ba-036c-4abc-9198-745fd1226765', title: 'Watch', cwd,
    harness: 'pi', model: null, effort: 'medium', context: [],
    prompt: 'Check.', sessionFile: join(cwd, 'job.jsonl'),
  };
}

test('a watch-sized request preserves directions, checkpoint and launch evidence through both admission gates', async t => {
  const schedule = fixture(t);
  const check = {
    directions: 'Permission boundary.\n'.repeat(1500),
    memory: { path: 'checkpoint.md', text: 'checkpoint '.repeat(700), truncated: false },
    log: ['Previous successful look.'],
  };
  const work = {
    lane: 'look', focus: 'watch', projectNotes: 'n'.repeat(16384), directions: 'd'.repeat(2970),
    items: Array.from({ length: 40 }, (_, id) => ({ id, title: 'Repair '.repeat(20) })),
    watch: { launches: Array.from({ length: 25 }, (_, id) => ({ id, note: 'Evidence. '.repeat(40) })) },
  };
  const previous = { status: 'completed', result: { text: 'Last successful baseline.' } };

  const prompt = await buildContext(schedule, previous, ['User preference.'], check, work);

  assert.ok(Buffer.byteLength(prompt) > 65536);
  const envelope = JSON.parse(prompt);
  assert.equal(envelope.directions, check.directions);
  assert.deepEqual(envelope.checkMemory, check.memory);
  assert.deepEqual(envelope.work, work);
  assert.equal(envelope.latestOutcome.text, previous.result.text);
  assert.doesNotThrow(() => buildInvocation({ ...schedule, purpose: 'work-look', prompt }));
});

for (const configured of [undefined, 65536, 131072, 1048576]) {
  test(`both gates enforce exact UTF-8/JSON bytes at limit ${configured ?? 'default 262144'}`, async t => {
    const schedule = fixture(t, configured);
    const limit = configured ?? 262144;
    // UTF-8 and JSON escaping both inflate this beyond its JavaScript character count.
    const instructions = '界🙂"\\\n'.repeat(100);
    const base = await buildContext({ ...schedule, prompt: instructions });
    const padding = limit - Buffer.byteLength(base);
    for (const delta of [-1, 0]) {
      const prompt = await buildContext({ ...schedule, prompt: instructions + 'x'.repeat(padding + delta) });
      assert.equal(Buffer.byteLength(prompt), limit + delta);
      assert.doesNotThrow(() => buildInvocation({ ...schedule, prompt }));
    }
    const overLimit = new RegExp(`byte limit \\(${limit + 1} > ${limit} UTF-8 bytes\\)`);
    await assert.rejects(buildContext({ ...schedule, prompt: instructions + 'x'.repeat(padding + 1) }), overLimit);
    const oversized = '界'.repeat(Math.floor(limit / 3)) + 'x'.repeat(limit % 3 + 1);
    assert.throws(() => buildInvocation({ ...schedule, prompt: oversized }), overLimit);
  });
}

test('invalid byte-limit settings fail closed at both gates without echoing values', async t => {
  const schedule = fixture(t);
  for (const value of ['', '0', '-1', '65535', '1048577', '1.5', 'NaN', 'Infinity', '1e6', ' 131072', 'private-invalid-value']) {
    process.env.HOBKIN_MAX_PROMPT_BYTES = value;
    const rejectsSetting = error => {
      assert.match(error.message, /HOBKIN_MAX_PROMPT_BYTES/);
      assert.ok(!error.message.includes('private-invalid-value'));
      return true;
    };
    await assert.rejects(buildContext(schedule), rejectsSetting);
    assert.throws(() => buildInvocation(schedule), rejectsSetting);
  }
});

test('optional lessons yield to the configured bound, not required context', async t => {
  const schedule = fixture(t, 131072);
  const base = await buildContext(schedule);
  schedule.prompt += 'x'.repeat(131072 - Buffer.byteLength(base));
  const required = await buildContext(schedule);
  assert.equal(await buildContext(schedule, null, [], { memory: null, log: [], learning: ['Optional advice.'] }), required);
});

test('larger envelopes retain the named-source size and path defenses', async t => {
  const schedule = fixture(t);
  const file = join(schedule.cwd, 'source.md');
  writeFileSync(file, 's'.repeat(32768));
  const withSource = { ...schedule, context: ['source.md'] };
  assert.equal(JSON.parse(await buildContext(withSource)).sources[0].text.length, 32768);
  writeFileSync(file, 's'.repeat(32769));
  await assert.rejects(buildContext(withSource), /byte limit/);
  await assert.rejects(buildContext({ ...schedule, context: ['../outside'] }), /escapes cwd/);
  symlinkSync(file, join(schedule.cwd, 'link.md'));
  await assert.rejects(buildContext({ ...schedule, context: ['link.md'] }), /symlinks/);
  assert.throws(() => buildInvocation({ ...schedule, model: '--bad-model' }), /invalid model/);
});
